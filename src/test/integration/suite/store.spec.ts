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
import type { Comment, ReviewFile } from '../../../anchor/types.js';
import { ReviewStore } from '../../../store/ReviewStore.js';
import { REVIEWS_DIR } from '../../../store/sidecarPath.js';
import {
  GLOBAL_STORAGE_DIR,
  exists,
  looseUri,
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
