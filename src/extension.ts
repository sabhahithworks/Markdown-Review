/**
 * Activation and command registration.
 *
 * Activation is inferred from `contributes.commands` (PRD §9) — there is deliberately no
 * `activationEvents` array and no `onStartupFinished`, so nothing runs until the user asks for it.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { ReviewPanel } from './panel/ReviewPanel.js';
import { REVIEW_VIEW_TYPE, isPanelState } from './panel/messages.js';
import { ReviewStore } from './store/ReviewStore.js';

/**
 * Phases 3–4 implement these. A declared-but-dead command is worse UX than an honest placeholder
 * (Plan 02 §2), so they say what is missing without leaking phase numbers at the user.
 */
const NOT_YET_AVAILABLE =
  'Markdown Review: review comments are not available yet — this arrives with commenting support.';

/**
 * The menu `when` clauses gate the UI by language id, but the command is also reachable from the
 * palette and from other extensions with an arbitrary URI, so the extension validates for itself.
 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx']);

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Markdown Review');

  context.subscriptions.push(
    output,

    vscode.commands.registerCommand('markdownReview.open', (arg?: unknown) => {
      openReviewPane(context, output, arg);
    }),

    placeholder('markdownReview.copyPrompt'),
    placeholder('markdownReview.clearAddressed'),
    placeholder('markdownReview.clearAll'),

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

function placeholder(commandId: string): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, () => {
    void vscode.window.showInformationMessage(NOT_YET_AVAILABLE);
  });
}

/**
 * Normalizes a command argument into a real `Uri`.
 *
 * `instanceof` covers the menu invocations, which are in-process. A URI handed over by another
 * extension can fail `instanceof` while still being one, so a URI-shaped object is re-parsed into a
 * genuine `Uri` — downstream needs the real class for `joinPath` and `asWebviewUri`.
 */
function toUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  if (typeof arg !== 'object' || arg === null) return undefined;
  if (!('scheme' in arg) || !('fsPath' in arg)) return undefined;

  try {
    return vscode.Uri.parse(String(arg), true);
  } catch {
    return undefined;
  }
}

function openReviewPane(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
): void {
  // Explorer and editor-title menus pass the resource as the first argument. (The explorer also
  // passes a second `Uri[]` of the full selection; one pane per invocation, so it is ignored.)
  // From the palette there is no argument at all.
  const target = toUri(arg) ?? vscode.window.activeTextEditor?.document.uri;

  if (!target) {
    void vscode.window.showErrorMessage(
      'Open a Markdown file, or right-click one in the Explorer, to start a review.',
    );
    return;
  }

  if (target.scheme !== 'file') {
    // `localResourceRoots` needs a real directory, and Phase 3's sidecar naming needs a path.
    void vscode.window.showErrorMessage(
      'Markdown Review works on files saved to disk. Save this document first.',
    );
    return;
  }

  const extension = path.extname(target.fsPath).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(extension)) {
    void vscode.window.showErrorMessage(
      `Markdown Review opens Markdown files (this one is "${extension || 'extensionless'}").`,
    );
    return;
  }

  ReviewPanel.createOrShow(context, target, output);
}
