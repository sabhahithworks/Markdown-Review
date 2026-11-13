/**
 * User-facing wording for panel-level failures.
 *
 * `createAnchor` returns a reason code and deliberately leaves the phrasing to the extension layer
 * (see the note in `anchor/create.ts`). That layer is `ReviewPanel`, which imports `vscode` and so
 * cannot be unit-tested — which is the whole reason these strings live in their own `vscode`-free
 * module: the exact wording is specified in Plan 03 §4, and a specified string deserves a test
 * rather than an acceptance-checklist eyeball.
 *
 * The limits are interpolated rather than spelled out so the message cannot drift from the
 * constants `createAnchor` actually enforces.
 */

import type { CommentStatus, CreateResult } from '../anchor/types.js';
import { MAX_ANCHOR_LENGTH, MIN_ANCHOR_LENGTH } from '../anchor/types.js';

type Rejection = Extract<CreateResult, { ok: false }>['reason'];

export function anchorRejectionMessage(reason: Rejection): string {
  return reason === 'too-short'
    ? `Select at least ${String(MIN_ANCHOR_LENGTH)} characters`
    : `Selection too long to anchor — select under ${String(MAX_ANCHOR_LENGTH)} characters`;
}

/**
 * Confirmation after the review prompt is copied (PRD §7 specifies this sentence).
 *
 * The `@`-mention instruction is the load-bearing half: the prompt names the file in backticks, but
 * an agent still needs the path attached as context to be able to edit it.
 */
export function promptCopiedMessage(count: number, targetPath: string): string {
  const comments = count === 1 ? '1 comment' : `${String(count)} comments`;
  return `${comments} copied. Paste into your agent and @-mention ${targetPath}.`;
}

/** Shown instead of copying when there is nothing to ask for (Plan 04 §4). */
export function noOpenCommentsMessage(targetPath: string): string {
  return `No open comments on ${targetPath}.`;
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Modal confirmations for the two destructive commands (PRD §6).
 *
 * Both name the count, because "remove addressed comments" reads very differently when the answer
 * is 1 than when it is 40, and both say what is *not* affected — the fear when deleting review
 * comments is that the edits go with them.
 */
export function clearAddressedConfirm(count: number): string {
  return `Remove ${plural(count, 'addressed comment')}? Their text changes stay in the document.`;
}

export function clearAllConfirm(count: number, targetPath: string): string {
  return `Remove all ${plural(count, 'comment')} from ${targetPath}? The document itself is not changed.`;
}

/** Confirmation after a clear, naming the backup so the action is visibly recoverable. */
export function clearedMessage(count: number, noun: string, backupName: string): string {
  return `Removed ${plural(count, noun)}. A backup was saved as ${backupName}.`;
}

/** The clear was abandoned because it could not be made undoable. */
export function backupFailedMessage(): string {
  return 'Markdown Review could not write a backup, so nothing was removed.';
}

export function nothingToClearMessage(what: 'addressed' | 'any', targetPath: string): string {
  return what === 'addressed'
    ? `No addressed comments on ${targetPath}.`
    : `No comments on ${targetPath}.`;
}

/** Largest badge count shown as a number; anything above reads `9+`. */
export const BADGE_CAP = 9;

type StatusCounts = Record<CommentStatus, number>;

function needingAction(c: StatusCounts): number {
  return c.open + c.addressed + c.orphaned;
}

/** Status bar label: the non-zero counts after the comment icon, or `null` when nothing needs action. */
export function statusBarText(c: StatusCounts): string | null {
  if (needingAction(c) === 0) return null;
  const parts: string[] = [];
  if (c.open > 0) parts.push(`${String(c.open)} open`);
  if (c.addressed > 0) parts.push(`${String(c.addressed)} to confirm`);
  if (c.orphaned > 0) parts.push(`${String(c.orphaned)} needs re-link`);
  return `$(comment) ${parts.join(' · ')}`;
}

export function statusBarTooltip(c: StatusCounts): string {
  return `${badgeTooltip(c)}\nOpen the review to check for changes.`;
}

/** Badge value for the number of comments needing action; `undefined` at zero. */
export function badgeText(c: StatusCounts): string | undefined {
  const n = needingAction(c);
  if (n === 0) return undefined;
  return n > BADGE_CAP ? `${String(BADGE_CAP)}+` : String(n);
}

export function badgeTooltip(c: StatusCounts): string {
  return `${String(c.open)} open · ${String(c.addressed)} to confirm · ${String(c.orphaned)} needs re-link`;
}
