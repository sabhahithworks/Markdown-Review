/**
 * `resolveTarget` and `toUri` (Phase 6, H32).
 *
 * Every command starts here, and the file had no tests at all — including the `toUri` branch that
 * existed for cross-extension invocations and could never have worked. It imports `vscode`, so it
 * belongs in the extension host rather than in vitest.
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { resolveTarget, toUri } from '../../../commands/resolveTarget.js';
import { workspaceUri } from './context.js';
import { describe, it } from './harness.js';

describe('toUri', () => {
  it('passes a real Uri straight through', () => {
    const uri = workspaceUri('notes.md');
    assert.equal(toUri(uri), uri);
  });

  it('rebuilds a URI-shaped object from another extension', () => {
    // The case the branch exists for: an object that *is* a URI but whose prototype did not
    // survive the hop. `String(arg)` on this yields "[object Object]", which is what the previous
    // implementation fed to `Uri.parse(…, true)` — so it threw, every time.
    const shaped = { scheme: 'file', fsPath: '/tmp/from-another-extension.md', path: '/tmp/from-another-extension.md' };
    const rebuilt = toUri(shaped);
    assert.ok(rebuilt instanceof vscode.Uri, 'expected a genuine Uri');
    assert.equal(rebuilt.scheme, 'file');
    assert.equal(rebuilt.fsPath, '/tmp/from-another-extension.md');
  });

  it('rebuilds a non-file scheme from its path', () => {
    const rebuilt = toUri({ scheme: 'untitled', path: '/draft.md' });
    assert.equal(rebuilt?.scheme, 'untitled');
  });

  it('declines anything that is not URI-shaped', () => {
    assert.equal(toUri(undefined), undefined);
    assert.equal(toUri('file:///tmp/a.md'), undefined, 'a bare string is not a Uri');
    assert.equal(toUri({}), undefined);
    assert.equal(toUri({ scheme: 'file' }), undefined, 'no location to build from');
    assert.equal(toUri({ fsPath: '/tmp/a.md' }), undefined, 'no scheme');
  });
});

describe('resolveTarget', () => {
  it('accepts a markdown file on disk', () => {
    const result = resolveTarget(workspaceUri('target.md'));
    assert.equal(result.ok, true);
  });

  it('rejects a non-file scheme with the save-first wording', () => {
    const result = resolveTarget(vscode.Uri.parse('untitled:Untitled-1'));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'not-a-file');
    assert.match(result.detail, /Save this document first/);
  });

  it('rejects a file that is not markdown, naming the extension it saw', () => {
    const result = resolveTarget(workspaceUri('notes.txt'));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'not-markdown');
    assert.match(result.detail, /\.txt/);
  });

  it('accepts every extension the menus can surface', () => {
    for (const name of ['a.md', 'b.markdown', 'c.mdown', 'd.mkd', 'e.mdx']) {
      assert.equal(resolveTarget(workspaceUri(name)).ok, true, name);
    }
  });

  it('falls back to no-target when there is no argument and no editor', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const result = resolveTarget(undefined);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'no-target');
  });
});
