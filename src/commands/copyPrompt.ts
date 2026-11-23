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
import {
  noOpenCommentsMessage,
  promptCopiedMessage,
  promptFileFailedMessage,
  promptSentMessage,
  sendFallbackMessage,
} from '../panel/notices.js';
import { readTarget } from '../panel/readTarget.js';
import { buildPrompt } from '../prompt/buildPrompt.js';
import { promptPointerLine } from '../prompt/pointer.js';
import { ReviewStore } from '../store/ReviewStore.js';
import { defaultIo, type PromptIo } from './promptTargets.js';
import { resolveTarget } from './resolveTarget.js';

export type PromptTarget = 'clipboard' | 'chat' | 'terminal';

export async function copyPrompt(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
): Promise<void> {
  await deliverPrompt(context, output, arg, 'clipboard');
}

export async function deliverPrompt(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
  sendTarget: PromptTarget,
  io: PromptIo = defaultIo,
): Promise<void> {
  const resolved = resolveTarget(arg);
  if (!resolved.ok) {
    io.error(resolved.detail);
    return;
  }
  const { target } = resolved;

  const store = ReviewStore.for(context, target, output);
  const review = await store.ensureLoaded();

  // Bail before touching the document when nothing could possibly be open. `resolved` is terminal,
  // but anything else can become `open` in the re-anchor below — an orphan whose text reappeared
  // does exactly that — so only an entirely resolved (or empty) review can be answered this early.
  if (!review.comments.some((comment) => comment.status !== 'resolved')) {
    io.notify(noOpenCommentsMessage(review.targetPath));
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
    io.error(`Markdown Review could not read ${review.targetPath}. Your comments have not been changed.`);
    return;
  }

  const doc = renderPlainText(read.text);

  // Before the re-anchor and the build: a notes file the agent wrote since the last prompt is
  // attached by the previous prompt's order, which this copy is about to replace.
  await store.settleNotes();

  // Bring statuses up to date first: with no pane open since the agent's last edit, the sidecar can
  // still say `open` for a comment whose text is gone, and asking the agent to revise a sentence
  // that no longer exists is worse than not asking at all.
  store.applyReanchor(doc);

  const { prompt, count, order } = buildPrompt(store.getState(), doc, {
    notesPath: store.notesPromptPath(),
  });
  if (count === 0) {
    io.notify(noOpenCommentsMessage(review.targetPath));
    return;
  }

  await vscode.env.clipboard.writeText(prompt);

  // The prompt is on the clipboard before any hand-off, so a refused or failed hand-off is a copy.
  // The terminal gets only a pointer line: the prompt is saved to the prompt file and the line is
  // put on the clipboard for the paste; any failure puts the full prompt back on the clipboard.
  let sent = false;
  let fileFailed = false;
  if (sendTarget === 'chat') {
    try {
      sent = await io.toChat(prompt);
    } catch (error) {
      output.appendLine(`[copyPrompt] sending to ${sendTarget} failed: ${String(error)}`);
    }
  } else if (sendTarget === 'terminal') {
    const file = store.promptFileUri();
    const line = promptPointerLine(file.fsPath);
    if (line === undefined) {
      output.appendLine(`[copyPrompt] the prompt file path holds a line break: ${file.fsPath}`);
      fileFailed = true;
    } else {
      let saved = false;
      try {
        await io.writePromptFile(file, prompt);
        saved = true;
      } catch (error) {
        output.appendLine(`[copyPrompt] could not save the prompt file ${file.fsPath}: ${String(error)}`);
        fileFailed = true;
      }
      if (saved) {
        try {
          await vscode.env.clipboard.writeText(line);
          sent = await io.toTerminal();
        } catch (error) {
          output.appendLine(`[copyPrompt] sending to ${sendTarget} failed: ${String(error)}`);
        }
      }
    }
    if (!sent) await vscode.env.clipboard.writeText(prompt);
  }
  // After the write, so a clipboard failure leaves the notes file for the next attempt; before the
  // snapshot, which replaces the prompt order the notes were matched against.
  await store.endNotesRound();
  // PRD §7: the baseline is whatever the document said at the moment the prompt was copied — after
  // the write, so a clipboard failure does not leave a baseline for a prompt nobody received.
  store.snapshotBaseline(doc.text, order);

  if (sendTarget === 'clipboard') {
    io.notify(promptCopiedMessage(count, review.targetPath));
  } else {
    io.notify(
      sent
        ? promptSentMessage(count, sendTarget)
        : fileFailed
          ? promptFileFailedMessage()
          : sendFallbackMessage(sendTarget),
    );
  }
}
