/**
 * Activation and command registration.
 *
 * Activation is lazy: inferred from `contributes.commands` (PRD §9), so nothing runs until the user
 * asks for it. There is no `onStartupFinished`.
 *
 * The manifest declares exactly one `activationEvents` entry —
 * `onWebviewPanel:markdownReview.panel` (D24). Inference covers commands, and a command is the only
 * entry point the *user* initiates; restoring a webview panel after a window reload is the one that
 * VS Code initiates. The serializer below is registered at runtime, so without that declaration
 * nothing in the manifest tells VS Code to wake us for a restore, and a reloaded pane comes back
 * with its tab and no contents. The event fires only when a panel of that view type is actually
 * being restored — which means the user already had one open — so a fresh window still loads
 * nothing.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { clearAddressed, clearAll } from './commands/clearComments.js';
import { copyPrompt } from './commands/copyPrompt.js';
import { resolveTarget } from './commands/resolveTarget.js';
import { registerBaselineProvider } from './detect/baselineDocuments.js';
import { ReviewPanel } from './panel/ReviewPanel.js';
import { REVIEW_VIEW_TYPE, isPanelState } from './panel/messages.js';
import { registerIndicators } from './status/indicators.js';
import { ReviewIndex } from './status/reviewIndex.js';
import { ReviewStore } from './store/ReviewStore.js';


export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Markdown Review');
  const index = new ReviewIndex(output);
  index.scan().catch((error: unknown) => {
    output.appendLine(`[index] scan failed: ${error instanceof Error ? error.message : String(error)}`);
  });

  context.subscriptions.push(
    output,
    index,
    registerIndicators(index),

    // Serves the read-only `markdown-review:` documents behind the rewrite banner's diff. Registered
    // at activation rather than on demand: after a window reload VS Code re-requests content for a
    // restored diff editor before anything else runs.
    registerBaselineProvider(context, output),

    vscode.commands.registerCommand('markdownReview.open', (arg?: unknown) => {
      openReviewPane(context, output, arg);
    }),

    vscode.commands.registerCommand('markdownReview.copyPrompt', (arg?: unknown) => {
      void copyPrompt(context, output, arg);
    }),

    vscode.commands.registerCommand('markdownReview.clearAddressed', (arg?: unknown) => {
      void clearAddressed(context, output, arg);
    }),

    vscode.commands.registerCommand('markdownReview.clearAll', (arg?: unknown) => {
      void clearAll(context, output, arg);
    }),

    vscode.window.registerWebviewPanelSerializer(REVIEW_VIEW_TYPE, {
      deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Thenable<void> {
        // Proves activation *and* the serializer ran, which is otherwise only inferable from the
        // output channel merely existing (D23).
        output.appendLine('[extension] deserializing a review panel');
        if (!isPanelState(state)) {
          // Nothing identifies which file this panel belonged to, and guessing would attach it to
          // the wrong document. Closing is the honest outcome.
          panel.dispose();
          return Promise.resolve();
        }
        // The restored path goes through the same validation as a command argument (H32). The
        // state comes from the webview's own `setState`, so this is defence in depth rather than a
        // live hole — but it was the one path into `ReviewPanel` that skipped `resolveTarget`.
        const restored = resolveTarget(vscode.Uri.file(state.targetPath));
        if (!restored.ok) {
          output.appendLine(`[extension] not reviving ${state.targetPath}: ${restored.reason}`);
          panel.dispose();
          return Promise.resolve();
        }
        ReviewPanel.revive(context, panel, restored.target, output);
        return Promise.resolve();
      },
    }),

    // Where a sidecar lives is resolved once per store, from `storageLocation` and the workspace
    // folder list (H29). Both can change while the window is open, and a store that keeps writing
    // to the previous answer is a split brain the user is never told about.
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('markdownReview.storageLocation')) return;
      void resettleStores('a storageLocation change', output);
    }),

    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void resettleStores('a workspace folder change', output);
    }),

    // A rename moves the file out from under its sidecar, which is named after the old path (H30).
    // Without this the review is only recoverable through the "Locate file…" action on an *open*
    // pane — so renaming with no pane open silently stranded it.
    vscode.workspace.onDidRenameFiles((event) => {
      void handleRenames(context, output, event.files);
    }),
  );
}

/** Drops the store registry, then hands every open panel a freshly-resolved store (H29). */
async function resettleStores(reason: string, output: vscode.OutputChannel): Promise<void> {
  await ReviewStore.resettle(reason, output);
  ReviewPanel.reattachStores();
}

/**
 * Migrates any review whose target was renamed, and re-points an open pane at the new file.
 *
 * Only files that actually have a review are touched: `ReviewStore.relink` would otherwise create
 * an empty sidecar for every markdown file the user ever renames.
 */
async function handleRenames(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
): Promise<void> {
  for (const { oldUri, newUri } of files) {
    if (!resolveTarget(oldUri).ok || !resolveTarget(newUri).ok) continue;

    const existing = ReviewStore.for(context, oldUri, output);
    const review = await existing.ensureLoaded();
    if (review.comments.length === 0) continue;

    const result = await ReviewStore.relink(context, oldUri, newUri, output);
    if (!result.ok) {
      void vscode.window.showWarningMessage(
        `Markdown Review could not move the comments for ${path.basename(oldUri.fsPath)} to its new name. They are still in the old review file.`,
      );
      continue;
    }

    output.appendLine(`[extension] moved ${String(result.moved)} comment(s) to ${newUri.fsPath}`);
    ReviewPanel.retarget(context, oldUri, newUri, output);
  }
}

export function deactivate(): Thenable<void> {
  // Panels and channels are all on `context.subscriptions`. Stores are not: they outlive their
  // panels on purpose, and a debounced sidecar write may still be pending, so flushing here is the
  // last chance to not lose a comment the user just typed.
  return ReviewStore.disposeAll();
}

function openReviewPane(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
): void {
  const resolved = resolveTarget(arg);
  if (!resolved.ok) {
    void vscode.window.showErrorMessage(resolved.detail);
    return;
  }

  ReviewPanel.createOrShow(context, resolved.target, output);
}
