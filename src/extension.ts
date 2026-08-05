/**
 * Activation and command registration.
 *
 * Activation is inferred from `contributes.commands` (PRD §9) — there is deliberately no
 * `activationEvents` array and no `onStartupFinished`, so nothing runs until the user asks for it.
 */

import * as vscode from 'vscode';
import { clearAddressed, clearAll } from './commands/clearComments.js';
import { copyPrompt } from './commands/copyPrompt.js';
import { resolveTarget } from './commands/resolveTarget.js';
import { registerBaselineProvider } from './detect/baselineDocuments.js';
import { ReviewPanel } from './panel/ReviewPanel.js';
import { REVIEW_VIEW_TYPE, isPanelState } from './panel/messages.js';
import { ReviewStore } from './store/ReviewStore.js';


export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Markdown Review');

  context.subscriptions.push(
    output,

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
        if (!isPanelState(state)) {
          // Nothing identifies which file this panel belonged to, and guessing would attach it to
          // the wrong document. Closing is the honest outcome.
          panel.dispose();
          return Promise.resolve();
        }
        ReviewPanel.revive(context, panel, vscode.Uri.file(state.targetPath), output);
        return Promise.resolve();
      },
    }),
  );
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
