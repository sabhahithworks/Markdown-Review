/**
 * The status bar item and Explorer badge, against the real VS Code API.
 *
 * VS Code cannot read either back, so each test builds its own `ReviewIndex` and indicators from
 * source (a separate `ReviewStore` static from the extension's) and reads `item.text` and
 * `provider.provideFileDecoration`.
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { Comment, CommentStatus, ReviewFile } from '../../../anchor/types.js';
import { registerIndicators } from '../../../status/indicators.js';
import { MAX_INDEXED_SIDECARS, ReviewIndex } from '../../../status/reviewIndex.js';
import { REVIEWS_DIR } from '../../../store/sidecarPath.js';
import { looseUri, stubOutput, workspaceUri, writeText } from './context.js';
import { afterEach, describe, it, waitFor } from './harness.js';

function comment(id: string, status: CommentStatus): Comment {
  return {
    id,
    body: 'needs a second look',
    author: 'integration',
    createdAt: '2026-01-01T00:00:00.000Z',
    status,
    anchor: { exact: 'the anchored sentence', prefix: 'before ', suffix: ' after', hintLine: 2, hintOffset: 42 },
  };
}

function sidecarText(targetPath: string, statuses: CommentStatus[]): string {
  const comments = statuses.map((status, i) => comment(`ind${String(i).padStart(5, '0')}`, status));
  return `${JSON.stringify({ version: 1, targetPath, comments }, null, 2)}\n`;
}

async function clearReviews(): Promise<void> {
  try {
    await vscode.workspace.fs.delete(workspaceUri(REVIEWS_DIR), { recursive: true });
  } catch (error) {
    // The directory may not exist yet; anything else is a real failure.
    if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) throw error;
  }
  await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR));
}

const disposables: { dispose(): unknown }[] = [];

function build(cap?: number): {
  index: ReviewIndex;
  indicators: ReturnType<typeof registerIndicators>;
  lines: string[];
  events: vscode.EventEmitter<{ target: vscode.Uri; review: ReviewFile }>;
} {
  const lines: string[] = [];
  const events = new vscode.EventEmitter<{
    target: vscode.Uri;
    review: ReviewFile;
  }>();
  const index = new ReviewIndex(stubOutput(lines), events.event, cap);
  const indicators = registerIndicators(index);
  disposables.push(index, indicators, events);
  return { index, indicators, lines, events };
}

async function showMarkdown(uri: vscode.Uri): Promise<void> {
  await writeText(uri, '# doc\n\nthe anchored sentence here.\n');
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

describe('status bar item and Explorer badge', () => {
  afterEach(async () => {
    for (const disposable of disposables.splice(0)) disposable.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('no sidecars', async () => {
    await clearReviews();
    const target = workspaceUri('ind-none.md');
    await showMarkdown(target);
    const { index, indicators } = build();
    await index.scan();
    assert.equal(index.countsFor(target), undefined);
    assert.equal(indicators.provider.provideFileDecoration(target), undefined);
    assert.equal(indicators.item.text, '');
  });

  it('reads counts from a sidecar', async () => {
    await clearReviews();
    const target = workspaceUri('ind-counts.md');
    await showMarkdown(target);
    await writeText(workspaceUri(REVIEWS_DIR, 'ind-counts.md.json'), sidecarText('ind-counts.md', ['open', 'open', 'addressed']));
    const { index, indicators } = build();
    await index.scan();
    assert.equal(indicators.item.text, '$(comment) 2 open · 1 to confirm');
    assert.equal(indicators.provider.provideFileDecoration(target)?.badge, '3');
    assert.equal(indicators.provider.provideFileDecoration(target)?.propagate, false);
  });

  it('targetPath from JSON', async () => {
    await clearReviews();
    await vscode.workspace.fs.createDirectory(workspaceUri('sub'));
    const target = workspaceUri('sub', 'a__b.md');
    await writeText(target, '# x\n');
    await writeText(workspaceUri(REVIEWS_DIR, 'sub__a__b.md.json'), sidecarText('sub/a__b.md', ['open']));
    const { index, indicators } = build();
    await index.scan();
    assert.equal(indicators.provider.provideFileDecoration(target)?.badge, '1');
  });

  it('skips a corrupt sidecar', async () => {
    await clearReviews();
    const good = workspaceUri('ind-good.md');
    await writeText(workspaceUri(REVIEWS_DIR, 'ind-bad.md.json'), '{ not json');
    await writeText(workspaceUri(REVIEWS_DIR, 'ind-good.md.json'), sidecarText('ind-good.md', ['orphaned']));
    const { index, lines } = build();
    await index.scan();
    assert.equal(index.countsFor(good)?.orphaned, 1);
    assert.ok(
      lines.some((line) => line.startsWith('[index] ') && line.includes('ind-bad.md.json') && line.includes('unparseable')),
      `expected a skip line, got: ${lines.join(' | ')}`,
    );
  });

  it('external sidecar write updates counts', async () => {
    await clearReviews();
    const target = workspaceUri('ind-ext.md');
    await showMarkdown(target);
    const { index, indicators } = build();
    await index.scan();
    await writeText(workspaceUri(REVIEWS_DIR, 'ind-ext.md.json'), sidecarText('ind-ext.md', ['open']));
    await waitFor(() => indicators.item.text === '$(comment) 1 open', 'the watcher to pick up a new sidecar');
    await writeText(workspaceUri(REVIEWS_DIR, 'ind-ext.md.json'), sidecarText('ind-ext.md', ['open', 'orphaned']));
    await waitFor(
      () => indicators.item.text === '$(comment) 1 open · 1 needs re-link',
      'the watcher to pick up an edited sidecar',
    );
  });

  it('keeps last counts on an invalid edit', async () => {
    await clearReviews();
    const target = workspaceUri('ind-keep.md');
    await showMarkdown(target);
    const sidecar = workspaceUri(REVIEWS_DIR, 'ind-keep.md.json');
    await writeText(sidecar, sidecarText('ind-keep.md', ['open', 'open']));
    const { index, indicators, lines } = build();
    await index.scan();
    assert.equal(indicators.item.text, '$(comment) 2 open');
    await writeText(sidecar, '{ "version": 1, ');
    await waitFor(() => lines.some((line) => line.includes('keeping the last counts')), 'the invalid edit to be logged');
    assert.equal(indicators.item.text, '$(comment) 2 open');
    assert.equal(index.countsFor(target)?.open, 2);
  });

  it('store change updates counts', async () => {
    await clearReviews();
    const target = workspaceUri('ind-store.md');
    await showMarkdown(target);
    const { index, indicators, events } = build();
    await index.scan();
    events.fire({
      target,
      review: { version: 1, targetPath: 'ind-store.md', comments: [comment('st000001', 'addressed')] },
    });
    assert.equal(indicators.item.text, '$(comment) 1 to confirm');
  });

  it('global-storage review appears once loaded', async () => {
    await clearReviews();
    const target = looseUri('ind-global.md');
    await showMarkdown(target);
    const { index, indicators, events } = build();
    await index.scan();
    assert.equal(index.countsFor(target), undefined);
    events.fire({
      target,
      review: { version: 1, targetPath: target.fsPath, comments: [comment('gl000001', 'open')] },
    });
    assert.equal(indicators.provider.provideFileDecoration(target)?.badge, '1');
    assert.equal(indicators.item.text, '$(comment) 1 open');
  });

  it('keeps the item while the pane has focus', async () => {
    await clearReviews();
    const target = workspaceUri('ind-focus.md');
    await showMarkdown(target);
    await writeText(workspaceUri(REVIEWS_DIR, 'ind-focus.md.json'), sidecarText('ind-focus.md', ['open']));
    const { index, indicators } = build();
    await index.scan();
    assert.equal(indicators.item.text, '$(comment) 1 open');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(() => vscode.window.activeTextEditor === undefined, 'the editors to close');
    assert.equal(indicators.item.text, '$(comment) 1 open');
  });

  it('MAX_INDEXED_SIDECARS', async () => {
    assert.equal(MAX_INDEXED_SIDECARS, 2000);
    await clearReviews();
    for (const name of ['cap-a', 'cap-b', 'cap-c']) {
      await writeText(workspaceUri(REVIEWS_DIR, `${name}.md.json`), sidecarText(`${name}.md`, ['open']));
    }
    const { index, lines } = build(2);
    await index.scan();
    assert.ok(
      lines.some((line) => line.includes('indexed 2 of 3 reviews')),
      `expected the cap line, got: ${lines.join(' | ')}`,
    );
  });

  it('markdownReview.open is the item command, with the target URI', async () => {
    await clearReviews();
    const target = workspaceUri('ind-cmd.md');
    await showMarkdown(target);
    await writeText(workspaceUri(REVIEWS_DIR, 'ind-cmd.md.json'), sidecarText('ind-cmd.md', ['open']));
    const { index, indicators } = build();
    await index.scan();
    const command = indicators.item.command;
    assert.ok(typeof command === 'object');
    assert.equal(command.command, 'markdownReview.open');
    const argument = command.arguments?.[0] as vscode.Uri;
    assert.equal(argument.toString(), target.toString());
  });
});
