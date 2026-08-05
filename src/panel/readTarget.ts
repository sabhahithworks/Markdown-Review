/**
 * Reading the target document, as a value rather than an exception (Plan 04 §4a.0).
 *
 * Extracted from `ReviewPanel.readSource()` because Phase 4's `copyPrompt` needs the *same* bytes
 * the pane is showing: it builds its prompt from `renderPlainText(text)`, and if it read the file
 * while the pane was rendering an unsaved buffer, the prompt's numbering would not match the card
 * order the user is looking at. One reader, one answer.
 *
 * `vscode`-facing by necessity (it needs `workspace.textDocuments` and `workspace.fs`), so it is
 * covered by the integration suite rather than vitest. The failure modes are returned as a
 * discriminated union per the plans README convention — the caller decides whether an unreadable
 * target is a notice in the webview or a message box, and those callers differ.
 */

import * as vscode from 'vscode';

/**
 * PRD §11 requires a warning before rendering a very large file. v1 degrades rather than
 * virtualizing: virtualized rendering would put a second, partial view of the document between the
 * user's selection and anchor space, which is exactly the desync Phase 3 cannot afford.
 */
export const TOO_LARGE_BYTES = 2 * 1024 * 1024;

export type ReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'too-large'; sizeBytes: number }
  | { ok: false; reason: 'unreadable'; detail: string };

/**
 * The target's current text: the open editor buffer when there is one, else disk.
 *
 * `force` skips the size guard, which is how `renderAnyway` works — it is deliberately per-call
 * rather than sticky, so the caller owns how long the override lasts.
 */
export async function readTarget(
  target: vscode.Uri,
  options: { force?: boolean } = {},
): Promise<ReadResult> {
  const force = options.force ?? false;

  const open = vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === target.toString(),
  );

  if (open) {
    // Fresher than disk: an unsaved buffer is what the user is looking at.
    const text = open.getText();
    const size = Buffer.byteLength(text, 'utf8');
    if (!force && size > TOO_LARGE_BYTES) return { ok: false, reason: 'too-large', sizeBytes: size };
    return { ok: true, text };
  }

  try {
    // `stat` first: reading a multi-hundred-megabyte file just to measure it is the failure the
    // guard exists to prevent.
    const stat = await vscode.workspace.fs.stat(target);
    if (!force && stat.size > TOO_LARGE_BYTES) {
      return { ok: false, reason: 'too-large', sizeBytes: stat.size };
    }

    const bytes = await vscode.workspace.fs.readFile(target);
    return { ok: true, text: new TextDecoder().decode(bytes) };
  } catch (error) {
    return {
      ok: false,
      reason: 'unreadable',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
