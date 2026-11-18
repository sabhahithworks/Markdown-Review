/**
 * Agent notes in the store (release-expansion N3), against the real file system and watcher.
 */

import * as assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import * as path from 'node:path';
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
import { delay, describe, it, waitFor } from './harness.js';

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

  it('a notes file that could not be deleted is not read again by the next numbering', async () => {
    const { store, notes, a, b } = await notesStore('n-nodelete.md');
    await writeText(notes, 'Comment 1: kept as is.\n\nA general remark.');
    // A folder the process cannot write makes the delete fail while the file stays readable. On
    // Windows the mode bits do not stop it, the delete succeeds, and the assertions below still hold.
    const reviews = path.dirname(notes.fsPath);
    await store.flush();
    await chmod(reviews, 0o555);
    try {
      await store.endNotesRound();
    } finally {
      await chmod(reviews, 0o755);
    }
    if (process.platform !== 'win32') {
      assert.equal(await exists(notes), true, 'the delete must have failed, or this test checks nothing');
    }
    store.snapshotBaseline('plain', [b, a]);
    await store.settleNotes();
    assert.equal(await noteOf(store, a), 'Comment 1: kept as is.');
    assert.equal(await noteOf(store, b), undefined, 'the old note must not move to the new comment 1');
    assert.equal((await stateOf(store)).agentNotes?.unattached, 'A general remark.');
    // The agent appends to the file it could not have emptied: only the new words are read.
    if (await exists(notes)) {
      await writeText(notes, 'Comment 1: kept as is.\n\nA general remark.\n\nComment 1: a new answer.');
      await store.settleNotes();
      assert.equal(await noteOf(store, b), 'Comment 1: a new answer.');
      assert.equal(await noteOf(store, a), 'Comment 1: kept as is.');
      assert.equal((await stateOf(store)).agentNotes?.unattached, 'A general remark.');
      await vscode.workspace.fs.delete(notes);
    }
  });

  it('a notes file that could not be read at round end is not read again by the next numbering', async () => {
    const { store, notes, a, b } = await notesStore('n-noread.md');
    await writeText(notes, 'Comment 1: kept as is.\n\nA general remark.');
    await store.settleNotes();
    // The read at round end fails for a moment (EBUSY, EACCES while the agent holds the file), so
    // nothing is deleted and the file still holds this round's words.
    const internals = store as unknown as { readNotes: () => Promise<unknown> };
    const original = internals.readNotes;
    internals.readNotes = () => Promise.resolve({ kind: 'unreadable' });
    try {
      await store.endNotesRound();
    } finally {
      internals.readNotes = original;
    }
    assert.equal(await exists(notes), true);
    store.snapshotBaseline('plain', [b, a]);
    await store.settleNotes();
    assert.equal(await noteOf(store, a), 'Comment 1: kept as is.');
    assert.equal(await noteOf(store, b), undefined, 'the old note must not move to the new comment 1');
    assert.equal((await stateOf(store)).agentNotes?.unattached, 'A general remark.');
    await vscode.workspace.fs.delete(notes);
  });

  it('a round-end read that fails once is retried and ends the round normally', async () => {
    const { store, notes, a, b } = await notesStore('n-retry.md');
    await writeText(notes, 'Comment 1: kept as is.\n\nA general remark.');
    const internals = store as unknown as { readNotes: () => Promise<unknown> };
    const original = internals.readNotes;
    let calls = 0;
    internals.readNotes = () => {
      calls += 1;
      return calls === 1 ? Promise.resolve({ kind: 'unreadable' }) : original.call(store);
    };
    try {
      await store.endNotesRound();
    } finally {
      internals.readNotes = original;
    }
    assert.equal(await exists(notes), false);
    assert.equal(await noteOf(store, a), 'Comment 1: kept as is.');
    store.snapshotBaseline('plain', [b, a]);
    await store.settleNotes();
    assert.equal(await noteOf(store, b), undefined, 'the old note must not move to the new comment 1');
  });

  it('a round-end read that keeps failing is tried three times and deletes nothing', async () => {
    const { store, notes } = await notesStore('n-noread-empty.md');
    await writeText(notes, 'Comment 1: never read.');
    const internals = store as unknown as { readNotes: () => Promise<unknown> };
    const original = internals.readNotes;
    let calls = 0;
    internals.readNotes = () => {
      calls += 1;
      return Promise.resolve({ kind: 'unreadable' });
    };
    try {
      await store.endNotesRound();
    } finally {
      internals.readNotes = original;
    }
    // The first read and two retries (D-q4), then the stale path with nothing ingested this round.
    assert.equal(calls, 3);
    assert.equal(await exists(notes), true);
    assert.equal((await stateOf(store)).agentNotes, undefined);
    await vscode.workspace.fs.delete(notes);
  });

  it('a read in flight does not land after the round ended', async () => {
    const { store, notes } = await notesStore('n-inflight.md');
    await writeText(notes, 'A general remark.');
    // Holds the first read back until the round has ended, as a watcher-driven read can be.
    const internals = store as unknown as { readNotes: () => Promise<unknown> };
    const original = internals.readNotes.bind(store);
    let calls = 0;
    internals.readNotes = async () => {
      calls += 1;
      const first = calls === 1;
      const result = await original();
      if (first) await delay(300);
      return result;
    };
    await Promise.all([store.settleNotes(), store.endNotesRound()]);
    assert.equal((await stateOf(store)).agentNotes?.unattached, 'A general remark.');
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

  it('agent notes are off until reload when the backup cannot be written', async () => {
    const name = 'n-nobackup-off.md';
    const target = workspaceUri(name);
    await writeText(target, `# ${name}\n\nthe anchored sentence, with words on either side.\n`);
    const sidecar = workspaceUri(REVIEWS_DIR, `${name}.json`);
    await writeText(sidecar, '{ this is not json');
    await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR, `${name}.json.bak`));
    const notes = workspaceUri(REVIEWS_DIR, `${name}.notes.md`);
    await writeText(notes, 'Comment 1: hello');

    const lines: string[] = [];
    const store = ReviewStore.for(stubContext().context, target, stubOutput(lines));
    await store.ensureLoaded();
    assert.ok(lines.some((line) => line.includes('agent notes are off until reload')));
    // Copy prompt settles and ends the round: with notes off, the prompt keeps the old sentence,
    // nothing is read and the notes file is not deleted.
    assert.equal(store.notesPromptPath(), undefined);
    store.addComment(comment('off1'));
    store.snapshotBaseline('plain', ['off1']);
    await store.settleNotes();
    await store.endNotesRound();
    assert.equal(await noteOf(store, 'off1'), undefined);
    assert.equal((await stateOf(store)).agentNotes, undefined);
    assert.equal(await exists(notes), true);
    await store.flush();
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
