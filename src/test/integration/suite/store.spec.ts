/**
 * Sidecar persistence against the real VS Code API (Plan 03 §8, rows 3, 5, 6, 9).
 *
 * Phase 3 verified this half with a scratchpad script and a hand-stubbed `vscode` module, which
 * proves the logic and nothing about the API. Everything here runs inside a real extension host:
 * real `workspace.fs`, real `FileSystemWatcher`, real configuration.
 *
 * `ReviewStore` is imported directly rather than reached through the running extension, so this is
 * a second instance of the class in a second bundle — deliberately. The specs are about the store's
 * contract, not about the extension's copy of it; `activation.spec.ts` covers the extension itself.
 */

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { createAnchor } from '../../../anchor/create.js';
import type { Anchor, Comment, ReviewFile } from '../../../anchor/types.js';
import { renderPlainText } from '../../../render/plaintext.js';
import { ReviewStore } from '../../../store/ReviewStore.js';
import { BASELINE_MAX_CHARS } from '../../../store/reviewFile.js';
import { REVIEWS_DIR } from '../../../store/sidecarPath.js';
import {
  GLOBAL_STORAGE_DIR,
  exists,
  looseUri,
  readSettledText,
  readText,
  stubContext,
  stubOutput,
  workspaceUri,
  writeText,
} from './context.js';
import { describe, it, waitFor } from './harness.js';

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c0000001',
    body: 'needs a second look',
    author: 'integration',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    anchor: {
      exact: 'the anchored sentence',
      prefix: 'before ',
      suffix: ' after',
      hintLine: 2,
      hintOffset: 42,
    },
    ...overrides,
  };
}

/** A fresh store over a document name no other spec uses, so the module-level registry can't leak. */
async function freshStore(name: string): Promise<{
  store: ReviewStore;
  target: vscode.Uri;
  sidecar: vscode.Uri;
  lines: string[];
}> {
  const target = workspaceUri(name);
  await writeText(target, `# ${name}\n\nthe anchored sentence, with words on either side.\n`);

  const lines: string[] = [];
  const store = ReviewStore.for(stubContext().context, target, stubOutput(lines));
  await store.ensureLoaded();

  return {
    store,
    target,
    sidecar: workspaceUri(REVIEWS_DIR, `${name}.json`),
    lines,
  };
}

describe('sidecar placement and serialization', () => {
  it('writes to .reviews/<name>.json, pretty-printed, with a workspace-relative targetPath', async () => {
    const { store, sidecar } = await freshStore('placement.md');

    store.addComment(comment());
    await store.flush();

    assert.ok(await exists(sidecar), `expected a sidecar at ${sidecar.fsPath}`);

    const text = await readText(sidecar);
    assert.ok(text.startsWith('{\n  "version": 1,\n'), 'expected a 2-space pretty-print');
    assert.ok(text.endsWith('}\n'), 'expected a trailing newline');
    assert.ok(text.includes('\n  "comments": ['), 'expected top-level keys at one indent level');

    const parsed = JSON.parse(text) as ReviewFile;
    assert.equal(parsed.targetPath, 'placement.md');
    assert.equal(parsed.comments.length, 1);
    assert.equal(parsed.comments[0]?.body, 'needs a second look');
  });

  it('flattens a nested path with __ and keeps forward slashes in targetPath', async () => {
    const target = workspaceUri('docs', 'specs', 'auth.md');
    await vscode.workspace.fs.createDirectory(workspaceUri('docs', 'specs'));
    await writeText(target, '# auth\n\nthe anchored sentence here.\n');

    const store = ReviewStore.for(stubContext().context, target, stubOutput([]));
    await store.ensureLoaded();
    store.addComment(comment({ id: 'c0000002' }));
    await store.flush();

    // The PRD §4 example, and the case that goes wrong on Windows if `\` is substituted before `/`.
    const sidecar = workspaceUri(REVIEWS_DIR, 'docs__specs__auth.md.json');
    assert.ok(await exists(sidecar), `expected ${sidecar.fsPath}`);

    const parsed = JSON.parse(await readText(sidecar)) as ReviewFile;
    assert.equal(parsed.targetPath, 'docs/specs/auth.md');
  });
});

describe('comment lifecycle', () => {
  it('round-trips add / edit / resolve / delete through disk', async () => {
    const { store, sidecar } = await freshStore('lifecycle.md');

    const events: ReviewFile[] = [];
    const subscription = store.onDidChange((state) => events.push(state));

    try {
      store.addComment(comment({ id: 'life0001' }));
      await store.flush();
      assert.equal(JSON.parse(await readText(sidecar)).comments.length, 1);

      store.updateCommentBody('life0001', 'reworded');
      await store.flush();
      assert.equal(JSON.parse(await readText(sidecar)).comments[0].body, 'reworded');

      store.setStatus('life0001', 'resolved');
      await store.flush();
      assert.equal(JSON.parse(await readText(sidecar)).comments[0].status, 'resolved');

      store.deleteComment('life0001');
      await store.flush();
      assert.equal(JSON.parse(await readText(sidecar)).comments.length, 0);

      // One notification per mutation: consumers re-render from `onDidChange` and hold no copy of
      // their own, so a missed event is a stale card.
      assert.equal(events.length, 4);
    } finally {
      subscription.dispose();
    }
  });

  it('ignores a delete for an unknown id rather than writing a no-op', async () => {
    const { store } = await freshStore('unknown-delete.md');

    let fired = 0;
    const subscription = store.onDidChange(() => fired++);
    try {
      store.deleteComment('nosuchid');
      assert.equal(fired, 0);
    } finally {
      subscription.dispose();
    }
  });
});

describe('corrupt sidecars (PRD §11)', () => {
  it('backs up unparseable JSON, starts empty, and keeps every original byte', async () => {
    const target = workspaceUri('corrupt.md');
    await writeText(target, '# corrupt\n\nthe anchored sentence here.\n');

    const original = '{ "version": 1, "comments": [ truncated';
    const sidecar = workspaceUri(REVIEWS_DIR, 'corrupt.md.json');
    await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR));
    await writeText(sidecar, original);

    const lines: string[] = [];
    const store = ReviewStore.for(stubContext().context, target, stubOutput(lines));
    const state = await store.ensureLoaded();

    const backup = workspaceUri(REVIEWS_DIR, 'corrupt.md.json.bak');
    assert.ok(await exists(backup), 'expected a .bak alongside the sidecar');
    assert.equal(await readText(backup), original, 'the backup must be byte-identical');
    assert.equal(state.comments.length, 0, 'the review starts empty');
    assert.ok(
      lines.some((line) => line.includes('unparseable')),
      `expected the reason in the output channel, got: ${lines.join(' | ')}`,
    );
  });

  it('explains a future sidecar version distinctly from a corrupt one', async () => {
    const target = workspaceUri('future.md');
    await writeText(target, '# future\n\nthe anchored sentence here.\n');

    const sidecar = workspaceUri(REVIEWS_DIR, 'future.md.json');
    await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR));
    await writeText(sidecar, JSON.stringify({ version: 2, targetPath: 'future.md', comments: [] }));

    const lines: string[] = [];
    const store = ReviewStore.for(stubContext().context, target, stubOutput(lines));
    await store.ensureLoaded();

    assert.ok(await exists(workspaceUri(REVIEWS_DIR, 'future.md.json.bak')));
    assert.ok(
      lines.some((line) => line.includes('unsupported-version')),
      `expected a version-specific reason, got: ${lines.join(' | ')}`,
    );
  });
});

describe('external edits (the sidecar is a hand-editable file)', () => {
  it('adopts a valid external rewrite and fires onDidChange', async () => {
    const { store, sidecar } = await freshStore('external.md');

    store.addComment(comment({ id: 'ext00001' }));
    await store.flush();

    const handEdited = JSON.stringify(
      {
        version: 1,
        targetPath: 'external.md',
        comments: [comment({ id: 'ext00001', body: 'edited by hand in the JSON' })],
      },
      null,
      2,
    );

    let latest: ReviewFile | undefined;
    const subscription = store.onDidChange((state) => (latest = state));
    try {
      await writeText(sidecar, `${handEdited}\n`);
      await waitFor(
        () => latest?.comments[0]?.body === 'edited by hand in the JSON',
        'the store to pick up an external edit',
      );
    } finally {
      subscription.dispose();
    }
  });

  it('keeps in-memory state and writes no .bak when an external edit is mid-keystroke', async () => {
    // Plan 03 §9: quarantine applies to the *initial* read. Backing up on every transiently-invalid
    // save would litter .bak files while someone is typing in the JSON.
    const { store, sidecar } = await freshStore('midedit.md');

    store.addComment(comment({ id: 'mid00001', body: 'still here' }));
    await store.flush();

    await writeText(sidecar, '{ "version": 1, "comments": [');
    await waitFor(
      () => store.getState().comments[0]?.body === 'still here',
      'the invalid edit to be ignored',
      2000,
    ).catch(() => undefined);

    assert.equal(store.getState().comments[0]?.body, 'still here');
    assert.equal(
      await exists(workspaceUri(REVIEWS_DIR, 'midedit.md.json.bak')),
      false,
      'a transient hand-edit must not be quarantined',
    );
  });

  it('does not re-fire for the echo of its own write', async () => {
    const { store } = await freshStore('echo.md');

    store.addComment(comment({ id: 'echo0001' }));
    await store.flush();

    let fired = 0;
    const subscription = store.onDidChange(() => fired++);
    try {
      store.updateCommentBody('echo0001', 'second write');
      // One synchronous event from `commit`, then the disk write. The watcher fires afterwards and
      // must recognise the bytes as its own.
      await store.flush();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      assert.equal(fired, 1, 'the watcher echoed our own write back as an external change');
    } finally {
      subscription.dispose();
    }
  });
});

describe('storage location', () => {
  it('falls back to globalStorage for a file outside every workspace folder', async () => {
    const target = looseUri('loose.md');
    await writeText(target, '# loose\n\nthe anchored sentence here.\n');

    const stub = stubContext();
    const store = ReviewStore.for(stub.context, target, stubOutput([]));
    await store.ensureLoaded();
    store.addComment(comment({ id: 'loose001' }));
    await store.flush();

    const reviews = vscode.Uri.joinPath(vscode.Uri.file(GLOBAL_STORAGE_DIR), 'reviews');
    const entries = await vscode.workspace.fs.readDirectory(reviews);
    const names = entries.map(([name]) => name).filter((name) => name.endsWith('.json'));

    assert.equal(names.length, 1, `expected one hashed sidecar, got ${names.join(', ')}`);
    assert.match(names[0] ?? '', /^[0-9a-f]{16}\.json$/, 'the name must not leak directory names');

    const parsed = JSON.parse(await readText(vscode.Uri.joinPath(reviews, names[0] ?? ''))) as ReviewFile;
    // No workspace root to be relative to, so the basename is the only honest answer.
    assert.equal(parsed.targetPath, 'loose.md');

    // PRD §11: warn once per machine, not once per file.
    assert.equal(stub.memory.get('markdownReview.looseFileWarningShown'), true);
  });

  it('honours markdownReview.storageLocation = global for a workspace file', async () => {
    const config = vscode.workspace.getConfiguration('markdownReview');
    await config.update('storageLocation', 'global', vscode.ConfigurationTarget.Workspace);

    try {
      const target = workspaceUri('private.md');
      await writeText(target, '# private\n\nthe anchored sentence here.\n');

      const store = ReviewStore.for(stubContext().context, target, stubOutput([]));
      await store.ensureLoaded();
      store.addComment(comment({ id: 'priv0001' }));
      await store.flush();

      assert.equal(
        await exists(workspaceUri(REVIEWS_DIR, 'private.md.json')),
        false,
        'global mode must not write into the workspace',
      );

      // Only the storage *location* changed: the file is still in a workspace, so `targetPath`
      // stays workspace-relative.
      const reviews = vscode.Uri.joinPath(vscode.Uri.file(GLOBAL_STORAGE_DIR), 'reviews');
      const entries = await vscode.workspace.fs.readDirectory(reviews);
      const bodies = await Promise.all(
        entries
          .filter(([name]) => name.endsWith('.json'))
          .map(([name]) => readText(vscode.Uri.joinPath(reviews, name))),
      );
      const mine = bodies.map((body) => JSON.parse(body) as ReviewFile).find((file) => file.targetPath === 'private.md');
      assert.ok(mine, `expected a sidecar with targetPath "private.md" under ${reviews.fsPath}`);
    } finally {
      await config.update('storageLocation', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });
});

// --------------------------------------------------------------- Phase 4 store extensions

const DETECT_MARKDOWN = `# Detect

The client retries failed requests up to three times before giving up.

It processes requests in parallel across the worker pool.
`;

/** A store over a document of our own, with real anchors built by the real `createAnchor`. */
async function storeOn(
  name: string,
  markdown: string,
): Promise<{
  store: ReviewStore;
  target: vscode.Uri;
  sidecar: vscode.Uri;
  lines: string[];
  anchorOn: (needle: string) => Anchor;
}> {
  const target = workspaceUri(name);
  await writeText(target, markdown);

  const lines: string[] = [];
  const store = ReviewStore.for(stubContext().context, target, stubOutput(lines));
  await store.ensureLoaded();

  const doc = renderPlainText(markdown);
  return {
    store,
    target,
    sidecar: workspaceUri(REVIEWS_DIR, `${name}.json`),
    lines,
    anchorOn: (needle) => {
      const result = createAnchor({ selectedText: needle, offset: doc.text.indexOf(needle), doc });
      if (!result.ok) throw new Error(`createAnchor rejected ${needle}: ${result.reason}`);
      return result.anchor;
    },
  };
}

async function readSidecar(sidecar: vscode.Uri): Promise<ReviewFile> {
  // `readSettledText`, because these run against a store that may be mid-rename (H37).
  return JSON.parse(await readSettledText(sidecar)) as ReviewFile;
}

describe('baseline snapshots (PRD §7)', () => {
  it('persists the rendered text, a timestamp and the prompt order', async () => {
    const { store, sidecar } = await storeOn('baseline.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'base0001' }));

    store.snapshotBaseline('the rendered plain text', ['base0001'], () => '2026-08-04T10:00:00.000Z');
    await store.flush();

    const parsed = await readSidecar(sidecar);
    assert.equal(parsed.baselineText, 'the rendered plain text');
    assert.equal(parsed.baselineAt, '2026-08-04T10:00:00.000Z');
    assert.deepEqual(parsed.promptOrder, ['base0001']);
  });

  it('snapshotBaseline notifies when promptOrder changes', async () => {
    const { store } = await storeOn('baseline-notify.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'note0001' }));

    let notified = 0;
    const subscription = store.onDidChange(() => (notified += 1));
    try {
      store.snapshotBaseline('text', ['note0001']);
    } finally {
      subscription.dispose();
    }

    assert.equal(notified, 1);
    assert.deepEqual(store.getState().promptOrder, ['note0001']);
  });

  it('re-copy with same order notifies', async () => {
    const { store } = await storeOn('baseline-recopy.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'same0001' }));
    store.snapshotBaseline('text', ['same0001']);

    let notified = 0;
    const subscription = store.onDidChange(() => (notified += 1));
    try {
      store.snapshotBaseline('text', ['same0001']);
    } finally {
      subscription.dispose();
    }

    assert.equal(notified, 1);
    assert.deepEqual(store.getState().promptOrder, ['same0001']);
  });

  it('second copy replaces promptOrder', async () => {
    const { store, sidecar } = await storeOn('baseline-replace.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'repl0001' }));
    store.addComment(comment({ id: 'repl0002' }));
    store.snapshotBaseline('text', ['repl0001', 'repl0002']);

    let notified = 0;
    const subscription = store.onDidChange(() => (notified += 1));
    try {
      store.snapshotBaseline('text', ['repl0002']);
      await store.flush();
    } finally {
      subscription.dispose();
    }

    assert.equal(notified, 1);
    assert.deepEqual((await readSidecar(sidecar)).promptOrder, ['repl0002']);
  });

  it('clears the baseline over the limit', async () => {
    const { store, sidecar, lines } = await storeOn('baseline-huge.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'huge0001' }));

    store.snapshotBaseline('small', ['huge0001']);
    store.snapshotBaseline('x'.repeat(BASELINE_MAX_CHARS + 1), ['huge0001']);
    await store.flush();

    const parsed = await readSidecar(sidecar);
    assert.equal(parsed.baselineText, undefined, 'an oversized baseline must not be stored');
    assert.equal(parsed.baselineAt, undefined);
    assert.deepEqual(parsed.promptOrder, ['huge0001']);
    assert.ok(
      lines.some((line) => line.includes('over the') && line.includes('baseline limit')),
      `expected a skip explanation in the output channel, got: ${lines.join(' | ')}`,
    );
  });
});

describe('applyReanchor', () => {
  it('infers addressed with a before/after and persists it', async () => {
    const { store, target, sidecar, anchorOn } = await storeOn('reanchor-addressed.md', DETECT_MARKDOWN);
    store.addComment(
      comment({ id: 'addr0001', anchor: anchorOn('retries failed requests up to three times') }),
    );
    await store.flush();

    const edited = DETECT_MARKDOWN.replace(
      'retries failed requests up to three times',
      'retries failed requests up to five times',
    );
    await writeText(target, edited);

    const changed = store.applyReanchor(renderPlainText(edited));
    await store.flush();

    assert.equal(changed, true);
    const [addressed] = (await readSidecar(sidecar)).comments;
    assert.equal(addressed?.status, 'addressed');
    assert.equal(addressed?.resolution?.previousText, 'retries failed requests up to three times');
    assert.equal(addressed?.resolution?.currentText, 'retries failed requests up to five times');
    // The original selection is the durable record and must survive for the before/after.
    assert.equal(addressed?.anchor.exact, 'retries failed requests up to three times');
  });

  it('orphans an anchor whose text is gone, and reports no change when nothing moved', async () => {
    const { store, sidecar, anchorOn } = await storeOn('reanchor-orphan.md', DETECT_MARKDOWN);
    store.addComment(
      comment({ id: 'orph0001', anchor: anchorOn('processes requests in parallel') }),
    );
    await store.flush();

    // Re-anchoring against the unchanged document must be a no-op, not a write.
    assert.equal(store.applyReanchor(renderPlainText(DETECT_MARKDOWN)), false);

    const gutted = '# Detect\n\nSomething else entirely now.\n';
    assert.equal(store.applyReanchor(renderPlainText(gutted)), true);
    await store.flush();

    assert.equal((await readSidecar(sidecar)).comments[0]?.status, 'orphaned');
  });

  it('honours autoDetectResolution: false — no addressed, but still orphans (Plan 04 §9 D12)', async () => {
    const { store, sidecar, anchorOn } = await storeOn('reanchor-setting.md', DETECT_MARKDOWN);
    store.addComment(
      comment({ id: 'setg0001', anchor: anchorOn('retries failed requests up to three times') }),
    );
    store.addComment(
      comment({ id: 'setg0002', anchor: anchorOn('processes requests in parallel') }),
    );
    await store.flush();

    const config = vscode.workspace.getConfiguration('markdownReview');
    await config.update('autoDetectResolution', false, vscode.ConfigurationTarget.Workspace);
    try {
      // First anchor reworded, second deleted outright.
      const edited = `# Detect

The client retries failed requests up to five times before giving up.
`;
      store.applyReanchor(renderPlainText(edited));
      await store.flush();

      const parsed = await readSidecar(sidecar);
      const byId = new Map(parsed.comments.map((entry) => [entry.id, entry]));
      assert.equal(byId.get('setg0001')?.status, 'open', 'must not infer addressed when disabled');
      assert.equal(byId.get('setg0001')?.resolution, undefined);
      assert.equal(byId.get('setg0002')?.status, 'orphaned', 'a gone anchor orphans regardless');
    } finally {
      await config.update('autoDetectResolution', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });

  it('refuses to run before the sidecar has been read', async () => {
    const target = workspaceUri('reanchor-unloaded.md');
    await writeText(target, DETECT_MARKDOWN);
    const lines: string[] = [];
    const store = ReviewStore.for(stubContext().context, target, stubOutput(lines));

    // Deliberately no ensureLoaded: relocating a placeholder would persist it over real comments.
    assert.equal(store.applyReanchor(renderPlainText(DETECT_MARKDOWN)), false);
    assert.ok(lines.some((line) => line.includes('applyReanchor before ensureLoaded')));
  });
});

describe('reattach (manual re-anchor, PRD §6)', () => {
  it('returns an orphan to open on a new anchor, keeping its identity and dropping any resolution', async () => {
    const { store, sidecar, anchorOn } = await storeOn('reattach.md', DETECT_MARKDOWN);
    store.addComment(
      comment({
        id: 'reat0001',
        body: 'still the same concern',
        createdAt: '2026-02-02T00:00:00.000Z',
        status: 'orphaned',
        resolution: {
          previousText: 'gone text',
          currentText: 'other text',
          detectedAt: '2026-03-03T00:00:00.000Z',
        },
      }),
    );

    store.reattach('reat0001', anchorOn('processes requests in parallel'));
    await store.flush();

    const [reattached] = (await readSidecar(sidecar)).comments;
    assert.equal(reattached?.status, 'open');
    assert.equal(reattached?.id, 'reat0001');
    assert.equal(reattached?.body, 'still the same concern');
    assert.equal(reattached?.createdAt, '2026-02-02T00:00:00.000Z');
    assert.equal(reattached?.anchor.exact, 'processes requests in parallel');
    assert.equal(reattached?.resolution, undefined, 'a stale before/after would render as a phantom diff');
  });
});

describe('bulk clears (PRD §6)', () => {
  it('clearAddressed backs up first and removes only addressed comments', async () => {
    const { store, sidecar } = await storeOn('clear-addressed.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'keep0001', status: 'open' }));
    store.addComment(comment({ id: 'drop0001', status: 'addressed' }));
    store.addComment(comment({ id: 'drop0002', status: 'addressed' }));
    store.addComment(comment({ id: 'keep0002', status: 'resolved' }));
    await store.flush();

    const result = await store.clearAddressed();

    assert.deepEqual(result, { ok: true, removed: 2 });
    const remaining = (await readSidecar(sidecar)).comments.map((entry) => entry.id);
    assert.deepEqual(remaining, ['keep0001', 'keep0002']);

    // The whole justification for a destructive user action is that it is recoverable.
    const backup = workspaceUri(REVIEWS_DIR, 'clear-addressed.md.json.bak');
    assert.ok(await exists(backup), 'expected a .bak before the clear');
    assert.equal((await readSidecar(backup)).comments.length, 4);
  });

  it('clearAll empties the comments and drops the baseline, leaving the file alone', async () => {
    const { store, target, sidecar } = await storeOn('clear-all.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'gone0001' }));
    store.snapshotBaseline('the baseline text', ['gone0001']);
    await store.flush();

    const result = await store.clearAll();

    assert.deepEqual(result, { ok: true, removed: 1 });
    const parsed = await readSidecar(sidecar);
    assert.deepEqual(parsed.comments, []);
    // A baseline with nothing left to relocate would arm the rewrite banner against an empty review.
    assert.equal(parsed.baselineText, undefined);
    assert.ok(await exists(target), 'clearing comments must never touch the document');
  });

  it('reports a zero-count clear without writing a backup', async () => {
    const { store } = await storeOn('clear-empty.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'open0001', status: 'open' }));
    await store.flush();

    assert.deepEqual(await store.clearAddressed(), { ok: true, removed: 0 });
    assert.equal(
      await exists(workspaceUri(REVIEWS_DIR, 'clear-empty.md.json.bak')),
      false,
      'nothing was removed, so nothing needed backing up',
    );
  });

  it('removes nothing when the backup cannot be written', async () => {
    const { store, sidecar } = await storeOn('clear-nobackup.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'safe0001', status: 'addressed' }));
    await store.flush();

    // A directory where the .bak file wants to go: writeFile fails, so the clear must abandon.
    await vscode.workspace.fs.createDirectory(
      workspaceUri(REVIEWS_DIR, 'clear-nobackup.md.json.bak'),
    );

    const result = await store.clearAddressed();

    assert.deepEqual(result, { ok: false, reason: 'backup-failed' });
    assert.equal((await readSidecar(sidecar)).comments.length, 1, 'the comment must survive');
  });
});

describe('relink (PRD §11 — target renamed or deleted)', () => {
  it('migrates comments and the baseline to the new file, emptying the old sidecar', async () => {
    const { store, target } = await storeOn('relink-from.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'move0001', body: 'still relevant' }));
    store.addComment(comment({ id: 'move0002', body: 'also relevant' }));
    store.snapshotBaseline('the baseline text', ['move0001', 'move0002']);
    await store.flush();

    const renamed = workspaceUri('relink-to.md');
    await writeText(renamed, DETECT_MARKDOWN);

    const result = await ReviewStore.relink(
      stubContext().context,
      target,
      renamed,
      stubOutput([]),
    );

    assert.deepEqual(result, { ok: true, moved: 2 });

    const destination = JSON.parse(
      await readText(workspaceUri(REVIEWS_DIR, 'relink-to.md.json')),
    ) as ReviewFile;
    assert.deepEqual(
      destination.comments.map((entry) => entry.id),
      ['move0001', 'move0002'],
    );
    assert.equal(destination.targetPath, 'relink-to.md');
    assert.equal(destination.baselineText, 'the baseline text');
    // Anchors ride across untouched; the next re-anchor decides whether they still fit.
    assert.equal(destination.comments[0]?.anchor.exact, 'the anchored sentence');

    // PRD §11: the old sidecar is emptied, never deleted — the comments now live elsewhere.
    const origin = JSON.parse(
      await readText(workspaceUri(REVIEWS_DIR, 'relink-from.md.json')),
    ) as ReviewFile;
    assert.deepEqual(origin.comments, []);
  });

  it('relink maps promptOrder through renamed ids', async () => {
    const { store, target } = await storeOn('relink-order-from.md', DETECT_MARKDOWN);
    store.addComment(comment({ id: 'dup00001' }));
    store.addComment(comment({ id: 'uniq0001' }));
    store.snapshotBaseline('the baseline text', ['uniq0001', 'dup00001']);
    await store.flush();

    const renamed = workspaceUri('relink-order-to.md');
    await writeText(renamed, DETECT_MARKDOWN);
    const { store: destination } = await storeOn('relink-order-to.md', DETECT_MARKDOWN);
    destination.addComment(comment({ id: 'dup00001' }));
    await destination.flush();

    const result = await ReviewStore.relink(
      stubContext().context,
      target,
      renamed,
      stubOutput([]),
    );

    assert.deepEqual(result, { ok: true, moved: 2 });
    const saved = JSON.parse(
      await readText(workspaceUri(REVIEWS_DIR, 'relink-order-to.md.json')),
    ) as ReviewFile;
    const ids = saved.comments.map((entry) => entry.id);
    const reminted = ids[1];
    assert.ok(reminted !== undefined && reminted !== 'dup00001');
    assert.deepEqual(ids, ['dup00001', reminted, 'uniq0001']);
    assert.deepEqual(saved.promptOrder, ['uniq0001', reminted]);
  });

  it('refuses to re-link a file onto itself', async () => {
    const { target } = await storeOn('relink-same.md', DETECT_MARKDOWN);

    assert.deepEqual(
      await ReviewStore.relink(stubContext().context, target, target, stubOutput([])),
      { ok: false, reason: 'same-file' },
    );
  });
});

describe('teardown', () => {
  it('flushes pending writes on disposeAll, so a comment typed at shutdown survives', async () => {
    const name = 'shutdown.md';
    const { store, sidecar } = await freshStore(name);

    store.addComment(comment({ id: 'shut0001', body: 'typed just before quitting' }));
    // Deliberately no flush: the debounce is still pending, which is the case `deactivate()` exists
    // to cover.
    await ReviewStore.disposeAll();

    assert.ok(await exists(sidecar), `expected ${path.basename(sidecar.fsPath)} to have been written`);
    const parsed = JSON.parse(await readText(sidecar)) as ReviewFile;
    assert.equal(parsed.comments[0]?.body, 'typed just before quitting');
  });
});
