/**
 * Agent notes in the store (release-expansion N3), against the real file system and watcher.
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Comment, ReviewFile } from '../../../anchor/types.js';
import { ReviewStore } from '../../../store/ReviewStore.js';
import { globalSidecarFileName, REVIEWS_DIR } from '../../../store/sidecarPath.js';
import {
  exists,
  GLOBAL_STORAGE_DIR,
  readSettledText,
  readText,
  stubContext,
  stubOutput,
  workspaceUri,
  writeText,
} from './context.js';
import { createAnchor } from '../../../anchor/create.js';
import { renderPlainText } from '../../../render/plaintext.js';
import { describe, it, waitFor } from './harness.js';

function comment(id: string): Comment {
  return {
    id,
    body: `body ${id}`,
    author: 'integration',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    anchor: { exact: 'the anchored sentence', prefix: 'before ', suffix: ' after', hintLine: 2, hintOffset: 42 },
  };
}

async function notesStore(name: string): Promise<{
  store: ReviewStore;
  notes: vscode.Uri;
  lines: string[];
  a: string;
  b: string;
}> {
  const target = workspaceUri(name);
  await writeText(target, `# ${name}\n\nthe anchored sentence, with words on either side.\n`);
  const lines: string[] = [];
  const store = ReviewStore.for(stubContext().context, target, stubOutput(lines));
  await store.ensureLoaded();
  const a = `${name}-a`;
  const b = `${name}-b`;
  store.addComment(comment(a));
  store.addComment(comment(b));
  store.snapshotBaseline('plain', [a, b]);
  return { store, notes: workspaceUri(REVIEWS_DIR, `${name}.notes.md`), lines, a, b };
}

const noteOf = async (store: ReviewStore, id: string): Promise<string | undefined> =>
  (await store.ensureLoaded()).comments.find((c) => c.id === id)?.agentNote?.text;

const stateOf = (store: ReviewStore) => store.ensureLoaded();

describe('agent notes', () => {
  it('ingests a notes file written to disk', async () => {
    const { store, notes, a } = await notesStore('n-ingest.md');
    const chunk = 'Comment 1: I left this as is because it is intentional.';
    await writeText(notes, chunk);
    await waitFor(async () => (await noteOf(store, a)) === chunk, 'the note to attach');
  });

  it('blank notes file is ignored', async () => {
    const { store, a } = await notesStore('n-blank.md');
    store.ingestAgentNotes('Comment 1: first');
    store.ingestAgentNotes('   \n');
    assert.equal(await noteOf(store, a), 'Comment 1: first');
  });

  it('re-ingest replaces', async () => {
    const { store, a, b } = await notesStore('n-reingest.md');
    store.ingestAgentNotes('Comment 1: first\n\nComment 2: second');
    store.ingestAgentNotes('Comment 1: changed');
    assert.equal(await noteOf(store, a), 'Comment 1: changed');
    assert.equal(await noteOf(store, b), 'Comment 2: second');
  });

  it('dismissed note stays dismissed', async () => {
    const { store, a } = await notesStore('n-dismiss.md');
    store.ingestAgentNotes('Comment 1: first');
    store.dismissAgentNote(a);
    assert.equal(await noteOf(store, a), undefined);
    store.ingestAgentNotes('Comment 1: first\n');
    assert.equal(await noteOf(store, a), undefined);
  });

  it('dismissed chunk stays dismissed when the file grows', async () => {
    const { store, a } = await notesStore('n-grow.md');
    store.ingestAgentNotes('Comment 1: first');
    store.dismissAgentNote(a);
    store.ingestAgentNotes('Comment 1: first\n\nA general remark.');
    assert.equal(await noteOf(store, a), undefined);
    assert.equal((await stateOf(store)).agentNotes?.unattached, 'A general remark.');
  });

  it('unattached notes carry over', async () => {
    const { store } = await notesStore('n-carry.md');
    store.ingestAgentNotes('General one.');
    await store.endNotesRound();
    assert.equal((await stateOf(store)).agentNotes?.unattached, 'General one.');
    store.ingestAgentNotes('General two.');
    assert.equal((await stateOf(store)).agentNotes?.unattached, 'General one.\n\nGeneral two.');
  });

  it('late write is ingested before the round ends', async () => {
    const { store, notes, a } = await notesStore('n-late.md');
    await writeText(notes, 'Comment 1: early');
    await store.settleNotes();
    assert.equal(await noteOf(store, a), 'Comment 1: early');
    await writeText(notes, 'Comment 1: late');
    await store.endNotesRound();
    assert.equal(await noteOf(store, a), 'Comment 1: late');
    assert.equal(await exists(notes), false);
  });

  it('the same words count as new in the next round', async () => {
    const { store, a } = await notesStore('n-next.md');
    store.ingestAgentNotes('Comment 1: same words');
    store.dismissAgentNote(a);
    await store.endNotesRound();
    store.ingestAgentNotes('Comment 1: same words');
    assert.equal(await noteOf(store, a), 'Comment 1: same words');
  });

  it('unreadable notes file is logged', async () => {
    const { store, notes, lines } = await notesStore('n-unreadable.md');
    await vscode.workspace.fs.createDirectory(notes);
    await store.settleNotes();
    assert.ok(lines.some((line) => line.includes(notes.fsPath)), `expected a log line, got ${lines.join(' | ')}`);
    await store.endNotesRound();
    await vscode.workspace.fs.delete(notes, { recursive: true });
  });

  it('global storage has no notes path', async () => {
    const config = vscode.workspace.getConfiguration('markdownReview');
    await config.update('storageLocation', 'global', vscode.ConfigurationTarget.Workspace);
    try {
      const target = workspaceUri('n-global.md');
      await writeText(target, '# g\n');
      const store = ReviewStore.for(stubContext().context, target, stubOutput([]));
      store.addComment(comment('g1'));
      store.snapshotBaseline('plain', ['g1']);
      const notes = workspaceUri(REVIEWS_DIR, 'n-global.md.notes.md');
      await writeText(notes, 'Comment 1: hello');
      await store.ensureLoaded();
      await store.settleNotes();
      assert.equal(store.notesPromptPath(), undefined);
      assert.equal(await noteOf(store, 'g1'), undefined);
    } finally {
      await config.update('storageLocation', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('leaves an unreadable sidecar untouched when the backup cannot be written', async () => {
    const name = 'n-nobackup.md';
    const target = workspaceUri(name);
    await writeText(target, `# ${name}\n\nthe anchored sentence, with words on either side.\n`);
    const sidecar = workspaceUri(REVIEWS_DIR, `${name}.json`);
    const garbage = '{ this is not json';
    await writeText(sidecar, garbage);
    await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR, `${name}.json.bak`));
    await writeText(workspaceUri(REVIEWS_DIR, `${name}.notes.md`), 'Comment 1: hello');

    const store = ReviewStore.for(stubContext().context, target, stubOutput([]));
    const state = await store.ensureLoaded();
    await store.flush();
    await writeText(workspaceUri(REVIEWS_DIR, `${name}.notes.md`), 'Comment 1: hello again');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await store.flush();

    assert.equal(await readText(sidecar), garbage, 'the sidecar bytes must be unchanged');
    assert.equal(state.agentNotes, undefined);
    assert.equal((await store.ensureLoaded()).agentNotes, undefined);
  });

  it('ingests before the snapshot', async () => {
    const name = 'n-prompt';
    const markdown = '# Notes\n\nthe anchored sentence, with words on either side.\n';
    const target = workspaceUri('docs', `${name}.md`);
    const sidecar = workspaceUri(REVIEWS_DIR, `docs__${name}.md.json`);
    const notes = workspaceUri(REVIEWS_DIR, `docs__${name}.md.notes.md`);
    const doc = renderPlainText(markdown);
    const anchored = createAnchor({
      selectedText: 'the anchored sentence',
      offset: doc.text.indexOf('the anchored sentence'),
      doc,
    });
    if (!anchored.ok) throw new Error(`createAnchor rejected: ${anchored.reason}`);
    const review: ReviewFile = {
      version: 1,
      targetPath: `docs/${name}.md`,
      comments: [
        { ...comment(`${name}-1`), anchor: anchored.anchor },
        { ...comment(`${name}-2`), anchor: anchored.anchor },
      ],
      promptOrder: [`${name}-2`, `${name}-1`],
    };
    await vscode.workspace.fs.createDirectory(workspaceUri('docs'));
    await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR));
    await writeText(target, markdown);
    await writeText(sidecar, `${JSON.stringify(review, null, 2)}\n`);
    await writeText(notes, 'Comment 1: second-by-old-order');

    await vscode.env.clipboard.writeText('sentinel');
    await vscode.commands.executeCommand('markdownReview.copyPrompt', target);

    await waitFor(
      async () => (await vscode.env.clipboard.readText()) !== 'sentinel',
      'the prompt to be copied',
    );
    const prompt = await vscode.env.clipboard.readText();
    assert.ok(prompt.includes(`.reviews/docs__${name}.md.notes.md`), prompt);
    await waitFor(async () => !(await exists(notes)), 'the notes file to be removed');
    await waitFor(async () => {
      const saved = JSON.parse(await readSettledText(sidecar)) as ReviewFile;
      return saved.baselineText !== undefined && saved.comments.find((c) => c.id === `${name}-2`)?.agentNote?.text === 'Comment 1: second-by-old-order';
    }, 'the note to attach by the old prompt order');
  });

  it('global storage keeps the old sentence', async () => {
    const config = vscode.workspace.getConfiguration('markdownReview');
    await config.update('storageLocation', 'global', vscode.ConfigurationTarget.Workspace);
    try {
      const name = 'n-prompt-global';
      const markdown = '# Notes\n\nthe anchored sentence, with words on either side.\n';
      const target = workspaceUri('docs', `${name}.md`);
      await vscode.workspace.fs.createDirectory(workspaceUri('docs'));
      await writeText(target, markdown);
      const doc = renderPlainText(markdown);
      const anchored = createAnchor({
        selectedText: 'the anchored sentence',
        offset: doc.text.indexOf('the anchored sentence'),
        doc,
      });
      if (!anchored.ok) throw new Error(`createAnchor rejected: ${anchored.reason}`);
      const review: ReviewFile = {
        version: 1,
        targetPath: `docs/${name}.md`,
        comments: [{ ...comment(`${name}-1`), anchor: anchored.anchor }],
      };
      // The running extension's own globalStorageUri, not the stub context's `GLOBAL_STORAGE_DIR`.
      const reviews = vscode.Uri.joinPath(
        vscode.Uri.file(GLOBAL_STORAGE_DIR),
        '..',
        'user-data',
        'User',
        'globalStorage',
        'sabhahithworks.markdown-review-pane',
        'reviews',
      );
      await vscode.workspace.fs.createDirectory(reviews);
      await writeText(
        vscode.Uri.joinPath(reviews, globalSidecarFileName(target.fsPath)),
        `${JSON.stringify(review, null, 2)}\n`,
      );

      await vscode.env.clipboard.writeText('sentinel');
      await vscode.commands.executeCommand('markdownReview.copyPrompt', target);
      await waitFor(
        async () => (await vscode.env.clipboard.readText()) !== 'sentinel',
        'the prompt to be copied',
      );
      const prompt = await vscode.env.clipboard.readText();
      assert.ok(prompt.includes('tell me instead of guessing'), prompt);
      assert.ok(!prompt.includes('.notes.md'), prompt);
    } finally {
      await config.update('storageLocation', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });
});
