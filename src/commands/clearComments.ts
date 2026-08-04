/**
 * `markdownReview.clearAddressed` and `markdownReview.clearAll` (PRD §6).
 *
 * The extension must never delete a comment automatically (PRD §4). These are the two places it
 * deletes them at all, which is why both are gated behind a modal naming the count and both write a
 * `.json.bak` first — the store abandons the whole operation if that backup cannot be written, and
 * this layer says so rather than reporting a success that did not happen.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  backupFailedMessage,
  clearAddressedConfirm,
  clearAllConfirm,
  clearedMessage,
  nothingToClearMessage,
} from '../panel/notices.js';
import type { ClearResult } from '../store/ReviewStore.js';
import { ReviewStore } from '../store/ReviewStore.js';
import { backupFileName } from '../store/sidecarPath.js';
import { resolveTarget } from './resolveTarget.js';

const CONFIRM = 'Remove';

export async function clearAddressed(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
): Promise<void> {
  await clear(context, output, arg, 'addressed');
}

export async function clearAll(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
): Promise<void> {
  await clear(context, output, arg, 'any');
}

async function clear(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  arg: unknown,
  what: 'addressed' | 'any',
): Promise<void> {
  const resolved = resolveTarget(arg);
  if (!resolved.ok) {
    void vscode.window.showErrorMessage(resolved.detail);
    return;
  }

  const store = ReviewStore.for(context, resolved.target, output);
  const review = await store.ensureLoaded();

  const doomed =
    what === 'addressed'
      ? review.comments.filter((comment) => comment.status === 'addressed')
      : review.comments;

  if (doomed.length === 0) {
    void vscode.window.showInformationMessage(nothingToClearMessage(what, review.targetPath));
    return;
  }

  const question =
    what === 'addressed'
      ? clearAddressedConfirm(doomed.length)
      : clearAllConfirm(doomed.length, review.targetPath);

  // Modal: this is destructive and irreversible from inside the editor, so it should not be
  // dismissible by looking away.
  const choice = await vscode.window.showWarningMessage(question, { modal: true }, CONFIRM);
  if (choice !== CONFIRM) return;

  const result: ClearResult =
    what === 'addressed' ? await store.clearAddressed() : await store.clearAll();

  report(result, what, store);
}

function report(result: ClearResult, what: 'addressed' | 'any', store: ReviewStore): void {
  if (!result.ok) {
    void vscode.window.showWarningMessage(backupFailedMessage());
    return;
  }
  if (result.removed === 0) return;

  const noun = what === 'addressed' ? 'addressed comment' : 'comment';
  void vscode.window.showInformationMessage(
    clearedMessage(result.removed, noun, path.basename(backupFileName(store.sidecarPath))),
  );
}
