/**
 * The review loop, driven through the real commands (Plan 04 §8).
 *
 * Everything here runs against the *extension's* copy of the code, not the spec's: comments are
 * seeded by writing the sidecar to disk and then a registered command is executed. That indirection
 * is deliberate and unavoidable — `store.spec.ts` explains why a `ReviewStore` constructed here is a
 * different instance in a different bundle from the running extension's — and it is also exactly how
 * a git-committed sidecar reaches a real user.
 *
 * Every test uses a document of its own. The extension keeps one store per URI for the life of the
 * window and memoizes the sidecar read, so re-seeding a file a previous test already opened would
 * race that store's watcher instead of testing anything.
 *
 * Phase 4a covers the prompt and the baseline. The change-detection scenarios (4a.4, 4a.7) extend
 * this file rather than starting another.
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { createAnchor } from '../../../anchor/create.js';
import type { Anchor, Comment, CommentStatus, ReviewFile } from '../../../anchor/types.js';
import { BASELINE_SCHEME, baselineUri } from '../../../detect/baselineDocuments.js';
import { renderPlainText } from '../../../render/plaintext.js';
import { REVIEWS_DIR } from '../../../store/sidecarPath.js';
import {
  AUTH_ANCHORS,
  AUTH_BODIES,
  AUTH_EXPECTED_PROMPT,
  AUTH_MARKDOWN,
} from '../../fixtures/reviewLoop.js';
import { exists, readSettledText, readText, workspaceUri, writeText } from './context.js';
import { afterEach, delay, describe, it, waitFor } from './harness.js';

interface Seeded {
  target: vscode.Uri;
  sidecar: vscode.Uri;
  read: () => Promise<ReviewFile>;
}

function anchorOn(markdown: string, needle: string): Anchor {
  const doc = renderPlainText(markdown);
  const result = createAnchor({ selectedText: needle, offset: doc.text.indexOf(needle), doc });
  if (!result.ok) throw new Error(`createAnchor rejected ${needle}: ${result.reason}`);
  return result.anchor;
}

/**
 * Writes `docs/<name>.md` and a sidecar the running extension will pick up on its first load.
 *
 * PRD §7's example names `docs/auth.md`, and the golden prompt quotes that path verbatim — which is
 * why the documents live under `docs/` rather than at the workspace root.
 */
async function seedReview(name: string, status: CommentStatus = 'open'): Promise<Seeded> {
  const target = workspaceUri('docs', `${name}.md`);
  const sidecar = workspaceUri(REVIEWS_DIR, `docs__${name}.md.json`);

  await vscode.workspace.fs.createDirectory(workspaceUri('docs'));
  await writeText(target, AUTH_MARKDOWN);

  const comment = (id: string, needle: string, body: string): Comment => ({
    id,
    body,
    author: 'integration',
    createdAt: '2026-01-01T00:00:00.000Z',
    status,
    anchor: anchorOn(AUTH_MARKDOWN, needle),
  });

  const review: ReviewFile = {
    version: 1,
    targetPath: `docs/${name}.md`,
    comments: [
      comment(`${name}-1`, AUTH_ANCHORS.retries, AUTH_BODIES.retries),
      comment(`${name}-2`, AUTH_ANCHORS.parallel, AUTH_BODIES.parallel),
      comment(`${name}-3`, AUTH_ANCHORS.heading, AUTH_BODIES.heading),
    ],
  };

  await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR));
  await writeText(sidecar, `${JSON.stringify(review, null, 2)}\n`);

  return {
    target,
    sidecar,
    // Polled inside `waitFor` while the store is writing, so it must tolerate the rename window
    // (H37) — a throwing predicate aborts the wait instead of being retried.
    read: async () => JSON.parse(await readSettledText(sidecar)) as ReviewFile,
  };
}

describe('copy review prompt (PRD §7)', () => {
  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('puts the PRD §7 prompt with the notes sentence on the clipboard and snapshots the baseline', async () => {
    const { target, sidecar, read } = await seedReview('auth');
    const oldSentence = 'If you disagree with a comment or need clarification, tell me instead of guessing.\n';
    const newSentence =
      "If you disagree with a comment or need clarification, write that in plain words in `.reviews/docs__auth.md.notes.md` instead of guessing, and mention the comment's number.\n";
    const expected = AUTH_EXPECTED_PROMPT.replace(oldSentence, newSentence);
    assert.notEqual(expected, AUTH_EXPECTED_PROMPT, 'the notes sentence replace must match');
    await vscode.env.clipboard.writeText('sentinel — must be overwritten');

    await vscode.commands.executeCommand('markdownReview.copyPrompt', target);

    await waitFor(
      async () => (await vscode.env.clipboard.readText()) === expected,
      'the clipboard to hold the PRD §7 prompt with the notes sentence',
    );

    // The sidecar write is debounced behind the clipboard write, so the baseline lands second.
    await waitFor(
      async () => (await exists(sidecar)) && (await read()).baselineText !== undefined,
      'the baseline to be snapshotted',
    );

    const saved = await read();
    assert.equal(
      saved.baselineText,
      renderPlainText(AUTH_MARKDOWN).text,
      'the baseline must be the rendered plain text at the moment of the copy',
    );
    assert.ok(saved.baselineAt, 'expected a baselineAt timestamp');
    assert.ok(
      !Number.isNaN(Date.parse(saved.baselineAt)),
      `baselineAt should be an ISO timestamp, got ${String(saved.baselineAt)}`,
    );
    // Copying a prompt is a read of the document, not a status change.
    assert.deepEqual(
      saved.comments.map((comment) => comment.status),
      ['open', 'open', 'open'],
    );
  });

  it('copies nothing and takes no baseline when every comment is resolved', async () => {
    const { target, read } = await seedReview('auth-resolved', 'resolved');

    const sentinel = 'sentinel — nothing should overwrite this';
    await vscode.env.clipboard.writeText(sentinel);

    await vscode.commands.executeCommand('markdownReview.copyPrompt', target);

    assert.equal(
      await vscode.env.clipboard.readText(),
      sentinel,
      'a review with nothing open must not touch the clipboard',
    );
    assert.equal(
      (await read()).baselineText,
      undefined,
      'no prompt was copied, so there is nothing to diff against later',
    );
  });
});

/** The agent's edit: one anchor reworded, one deleted outright, one left alone. */
const AGENT_EDITED = `# Auth service

The client retries failed requests up to five times before giving up.

## Error handling

Errors surface as structured problem documents.
`;

/**
 * Long enough for the 400 ms coalescer plus a re-anchor pass and a debounced sidecar write.
 *
 * Only for assertions whose expected outcome is "nothing changed" — there is no transition to
 * `waitFor`, so the alternative is asserting immediately and passing before the pass has even run.
 */
const CHANGE_SETTLE_MS = 900;

/** Statuses by comment id, so an assertion does not depend on array order. */
async function statuses(read: () => Promise<ReviewFile>): Promise<Record<string, CommentStatus>> {
  const review = await read();
  return Object.fromEntries(review.comments.map((comment) => [comment.id, comment.status]));
}

describe('change detection (PRD §8)', () => {
  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('infers addressed, orphaned and open from a direct write to disk', async () => {
    const { target, read } = await seedReview('detect-disk');
    await vscode.commands.executeCommand('markdownReview.open', target);

    // No editor is open on this file, so only the FileSystemWatcher can see this — which is the
    // whole reason PRD §8 requires a second source.
    await writeText(target, AGENT_EDITED);

    await waitFor(async () => {
      const byId = await statuses(read);
      return (
        byId['detect-disk-1'] === 'addressed' &&
        byId['detect-disk-2'] === 'orphaned' &&
        byId['detect-disk-3'] === 'open'
      );
    }, 'the agent edit to be detected');

    const review = await read();
    const addressed = review.comments.find((comment) => comment.id === 'detect-disk-1');
    assert.equal(addressed?.resolution?.previousText, AUTH_ANCHORS.retries);
    assert.equal(
      addressed?.resolution?.currentText,
      'retries failed requests up to five times',
      'the before/after must carry what the agent actually wrote',
    );
    assert.equal(
      addressed?.anchor?.exact,
      AUTH_ANCHORS.retries,
      'anchor.exact is the durable record and must survive the flip',
    );
  });

  it('detects a direct write to disk for a target whose name holds glob characters', async () => {
    const { target, read } = await seedReview('detect [draft]');
    await vscode.commands.executeCommand('markdownReview.open', target);
    // A first edit, seen by whichever pass comes first: written straight after the open, it is
    // picked up by the pane's first render, so on its own it would pass with the watcher broken.
    await writeText(target, AUTH_MARKDOWN.replace('up to three times', 'up to five times'));
    await waitFor(
      async () => (await statuses(read))['detect [draft]-1'] === 'addressed',
      'the first render to have run',
    );

    // The pane has rendered, and no editor is open on this file, so only the FileSystemWatcher can
    // see this second edit — which is what this test is about.
    await writeText(target, AGENT_EDITED);

    await waitFor(async () => {
      const byId = await statuses(read);
      return (
        byId['detect [draft]-1'] === 'addressed' &&
        byId['detect [draft]-2'] === 'orphaned' &&
        byId['detect [draft]-3'] === 'open'
      );
    }, 'the agent edit to be detected for a glob-character name');
  });

  it('leaves a heading comment open when only its section body changed (D17)', async () => {
    // The case the first real-agent run found. Comment 3 is anchored on `## Error handling`, so
    // rewriting the prose *under* it — exactly what the comment asked for — leaves `anchor.exact`
    // untouched and infers nothing.
    //
    // That is the correct status, and this test exists to keep it correct: the fix for D17 is a
    // separate, weaker signal computed per render in the panel, never a fourth status and never a
    // widening of what `addressed` claims. If a later change starts flipping this to `addressed`,
    // `addressed` has stopped meaning "the text you selected changed".
    const { target, read } = await seedReview('detect-section');
    await vscode.commands.executeCommand('markdownReview.open', target);

    await writeText(
      target,
      AUTH_MARKDOWN.replace(
        'Errors surface as structured problem documents.',
        'Errors surface as structured problem documents. Requests time out after 30 seconds.',
      ),
    );

    // The other two comments are untouched by this edit, so the only observable transition would be
    // the wrong one. Wait for the pass to have happened, then assert nothing moved.
    await delay(CHANGE_SETTLE_MS);

    const byId = await statuses(read);
    assert.equal(byId['detect-section-3'], 'open', 'a heading anchor must not infer addressed');
    assert.equal(byId['detect-section-1'], 'open');
    assert.equal(byId['detect-section-2'], 'open');

    const heading = (await read()).comments.find((c) => c.id === 'detect-section-3');
    assert.equal(heading?.resolution, undefined, 'nothing was inferred, so there is no before/after');
  });

  it('detects an unsaved editor edit, preferring the buffer over disk', async () => {
    const { target, read } = await seedReview('detect-buffer');

    // Pane first, editor beside it second. Both have to stay visible: a hidden webview is torn down
    // (PRD §6 rules out `retainContextWhenHidden`), so it would never post `ready` and `refresh()`
    // would no-op — and a hidden `TextEditor` cannot be `edit()`ed at all. The pane opens in the
    // *active* column (H35), which with nothing open is column One, so the editor goes to Two.
    await vscode.commands.executeCommand('markdownReview.open', target);
    const document = await vscode.workspace.openTextDocument(target);
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.Two);
    const index = document.getText().indexOf(AUTH_ANCHORS.parallel);
    await editor.edit((builder) => {
      builder.replace(
        new vscode.Range(
          document.positionAt(index),
          document.positionAt(index + AUTH_ANCHORS.parallel.length),
        ),
        // A rewording, not a replacement: the anchor must still be *locatable* so this asserts
        // `addressed`. Swapping the whole phrase out would orphan it and prove nothing about which
        // source the text came from.
        'processes requests in series',
      );
    });
    assert.equal(document.isDirty, true, 'the edit must be unsaved for this test to mean anything');

    await waitFor(
      async () => (await statuses(read))['detect-buffer-2'] === 'addressed',
      'the unsaved edit to be detected',
    );

    // Disk still holds the original, so the status can only have come from the open buffer.
    assert.ok(
      (await readText(target)).includes(AUTH_ANCHORS.parallel),
      'the file on disk should still be untouched',
    );

    await document.save();
  });

  it('coalesces a burst and does not re-stamp detectedAt on a no-op write', async () => {
    const { target, read } = await seedReview('detect-burst');
    await vscode.commands.executeCommand('markdownReview.open', target);

    // Five writes inside one debounce window; PRD §8 asks for one pass, not five.
    for (let i = 0; i < 5; i++) await writeText(target, AGENT_EDITED);

    await waitFor(
      async () => (await statuses(read))['detect-burst-1'] === 'addressed',
      'the burst to settle into one detection',
    );

    const first = (await read()).comments.find((comment) => comment.id === 'detect-burst-1');
    assert.ok(first?.resolution?.detectedAt);

    // Re-writing identical content must not churn the sidecar: `reanchor`'s `alreadyDetected` guard
    // keeps the original timestamp, which is what stops every debounce tick from writing to disk.
    await writeText(target, AGENT_EDITED);
    await delay(900);

    const second = (await read()).comments.find((comment) => comment.id === 'detect-burst-1');
    assert.equal(
      second?.resolution?.detectedAt,
      first.resolution?.detectedAt,
      'an unchanged document must not re-stamp detectedAt',
    );
  });

  it('keeps the sidecar and orphans everything when the document is rewritten', async () => {
    const { target, sidecar, read } = await seedReview('detect-rewrite');
    await vscode.commands.executeCommand('markdownReview.open', target);

    await writeText(target, '# Something else\n\nNone of the original prose survives here.\n');

    await waitFor(async () => {
      const byId = await statuses(read);
      return Object.values(byId).every((status) => status === 'orphaned');
    }, 'every comment to orphan');

    // PRD §11: orphan gracefully. Nothing deleted, nothing quarantined.
    const review = await read();
    assert.equal(review.comments.length, 3, 'a rewrite must never delete a comment');
    assert.equal(
      await exists(workspaceUri(REVIEWS_DIR, `${'docs__detect-rewrite'}.md.json.bak`)),
      false,
      'a rewrite is not corruption; no backup should be written',
    );
    assert.ok(await exists(sidecar));
  });
});

describe('the rewrite diff (PRD §11)', () => {
  afterEach(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('serves both sides as rendered plain text, not plain text against Markdown', async () => {
    const { target, read } = await seedReview('diff-sides');

    // The baseline is only captured when the prompt is copied.
    await vscode.commands.executeCommand('markdownReview.copyPrompt', target);
    await waitFor(async () => (await read()).baselineText !== undefined, 'a baseline to exist');

    const rewritten = '## Rewritten\n\nAll **new** prose, with *emphasis* and a `code span`.\n';
    await writeText(target, rewritten);

    const baseline = await vscode.workspace.openTextDocument(baselineUri(target, 'baseline'));
    const current = await vscode.workspace.openTextDocument(baselineUri(target, 'current'));

    assert.equal(
      baseline.getText(),
      renderPlainText(AUTH_MARKDOWN).text,
      'the baseline side is the snapshot taken at copy time',
    );

    // The point of D1: the current side is *rendered*, so the two sides are the same language.
    assert.equal(current.getText(), renderPlainText(rewritten).text);
    assert.ok(
      !current.getText().includes('**') && !current.getText().includes('##'),
      `the current side must not be raw Markdown, got: ${JSON.stringify(current.getText())}`,
    );
    assert.ok(current.getText().includes('All new prose'), 'emphasis markers should be stripped');

    // Read-only: the scheme has a content provider and no file system provider.
    assert.equal(baseline.uri.scheme, BASELINE_SCHEME);
  });

  it('explains itself rather than failing when no baseline was ever captured', async () => {
    const { target } = await seedReview('diff-nobaseline');

    const baseline = await vscode.workspace.openTextDocument(baselineUri(target, 'baseline'));

    assert.ok(
      baseline.getText().includes('No baseline was recorded'),
      'an absent baseline should read as an explanation, not an empty pane',
    );
  });
});
