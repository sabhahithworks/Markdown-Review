/**
 * Noticing that the target document changed (PRD §8).
 *
 * **Two sources, one trigger.** An agent may edit through the editor (which fires
 * `onDidChangeTextDocument`) or write straight to disk with the file not open at all (which fires
 * only a `FileSystemWatcher`). Both are normal, and a save fires *both* — so they feed one
 * coalescer and a save costs one refresh, not two.
 *
 * This module is deliberately only a **trigger**: it reports that something happened and nothing
 * else. The read → render → re-anchor → post pipeline stays in `ReviewPanel.refresh()`, because
 * rendering needs an `ImageResolver` bound to a specific webview (`webview.asWebviewUri`) and so
 * cannot be hoisted anywhere a store or a watcher could reach. Splitting it would mean either two
 * reads per change or two renderings of one document — and Plan 03 §9 C1 spent a release-blocking
 * correction establishing that HTML and anchor space must come from one source string on one path.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { createCoalescer } from './coalesce.js';

/** PRD §8 specifies 400 ms. */
export const CHANGE_DEBOUNCE_MS = 400;

export interface ChangeWatcherOptions {
  target: vscode.Uri;
  /** Debounced and coalesced across both sources. */
  onChanged: () => void;
  /** Not debounced — the pane should say the file is gone at once, not 400 ms later. */
  onDeleted?: () => void;
  /** Not debounced. A delete-then-write (git checkout, some agents' save strategy) lands here. */
  onCreated?: () => void;
  debounceMs?: number;
}

export function createChangeWatcher(options: ChangeWatcherOptions): vscode.Disposable {
  const { target, onChanged, onDeleted, onCreated } = options;
  const key = target.toString();

  const coalescer = createCoalescer(options.debounceMs ?? CHANGE_DEBOUNCE_MS, onChanged);
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== key) return;
      // A dirty-flag or language-mode event carries no content change; re-rendering for one would
      // cost a full re-anchor pass for nothing.
      if (event.contentChanges.length === 0) return;
      coalescer.schedule();
    }),
  );

  // Same construction the sidecar watcher uses, and for the same reason: a bare glob is resolved
  // against the workspace folders, which silently never matches a loose file opened outside one.
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(target.fsPath)),
      path.basename(target.fsPath),
    ),
  );
  disposables.push(watcher);

  disposables.push(watcher.onDidChange(() => coalescer.schedule()));

  disposables.push(
    watcher.onDidCreate(() => {
      onCreated?.();
      // The file came back with content we have not seen; re-read on the usual schedule.
      coalescer.schedule();
    }),
  );

  disposables.push(
    watcher.onDidDelete(() => {
      // Nothing to re-anchor against, and a queued refresh would only report the same failure late.
      coalescer.cancel();
      onDeleted?.();
    }),
  );

  return {
    dispose(): void {
      coalescer.dispose();
      for (const disposable of disposables.splice(0)) disposable.dispose();
    },
  };
}
