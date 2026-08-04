/**
 * `markdownReview.copyPrompt` — the handoff to the agent (PRD §7).
 *
 * This is the moment the product's loop begins: the open comments become prose on the clipboard,
 * and the rendered text is snapshotted as the baseline that "the document was rewritten" is later
 * judged against. Both halves have to happen together, which is why they live in one command rather
 * than in the panel and a listener.
 */

import * as vscode from 'vscode';
import { renderPlainText } from '../render/plaintext.js';
import { noOpenCommentsMessage, promptCopiedMessage } from '../panel/notices.js';
import { readTarget } from '../panel/readTarget.js';
import { buildPrompt } from '../prompt/buildPrompt.js';
import { ReviewStore } from '../store/ReviewStore.js';
import { resolveTarget } from './resolveTarget.js';

export async function copyPrompt(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
): Promise<void> {
  const resolved = resolveTarget(arg);
  if (!resolved.ok) {
    void vscode.window.showErrorMessage(resolved.detail);
    return;
  }
  const { target } = resolved;

  const store = ReviewStore.for(context, target, output);
  const review = await store.ensureLoaded();

  // Bail before touching the document when nothing could possibly be open. `resolved` is terminal,
  // but anything else can become `open` in the re-anchor below — an orphan whose text reappeared
  // does exactly that — so only an entirely resolved (or empty) review can be answered this early.
  if (!review.comments.some((comment) => comment.status !== 'resolved')) {
    void vscode.window.showInformationMessage(noOpenCommentsMessage(review.targetPath));
    return;
  }

  // `force`: the size guard exists to keep a partial, virtualized *render* from desyncing anchor
  // space (PRD §11). Nothing is rendered here, and a file that already carries comments has already
  // been through the pane's guard, so refusing now would only break the workflow on the large
  // documents it matters most for.
  const read = await readTarget(target, { force: true });
  if (!read.ok) {
    // `force` makes `too-large` unreachable, so in practice this is a deleted, renamed or
    // unreadable file. Say so and stop; nothing has been copied and no baseline was taken.
    const detail = read.reason === 'too-large' ? `${String(read.sizeBytes)} bytes` : read.detail;
    output.appendLine(`[copyPrompt] cannot read ${target.fsPath}: ${detail}`);
    void vscode.window.showErrorMessage(
      `Markdown Review could not read ${review.targetPath}. Your comments have not been changed.`,
    );
    return;
  }

  const doc = renderPlainText(read.text);

  // Bring statuses up to date first: with no pane open since the agent's last edit, the sidecar can
  // still say `open` for a comment whose text is gone, and asking the agent to revise a sentence
  // that no longer exists is worse than not asking at all.
  store.applyReanchor(doc);

  const { prompt, count } = buildPrompt(store.getState(), doc);
  if (count === 0) {
    void vscode.window.showInformationMessage(noOpenCommentsMessage(review.targetPath));
    return;
  }

  await vscode.env.clipboard.writeText(prompt);
  // PRD §7: the baseline is whatever the document said at the moment the prompt was copied — after
  // the write, so a clipboard failure does not leave a baseline for a prompt nobody received.
  store.snapshotBaseline(doc.text);

  void vscode.window.showInformationMessage(promptCopiedMessage(count, review.targetPath));
}
