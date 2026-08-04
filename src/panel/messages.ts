/**
 * The extension ⇄ webview message contract (Plan 02 §5 — contract owner).
 *
 * This file is compiled into **both** bundles, so it must stay types-plus-guards only: no `vscode`,
 * no node, no DOM. ESLint enforces the `vscode` half; `tsconfig.webview.json` compiles it a second
 * time with `types: []` to enforce the rest.
 *
 * Phases 3 and 4 extend these unions with their own members (Plans 03 §6, 04 §6) and extend
 * `PanelState`. They add cases; they do not restructure.
 */

import type { CommentStatus, Located, ReviewFile } from '../anchor/types.js';

/**
 * Re-exported so `media/src` imports only from this module (plans README: webview code never
 * reaches into `src/` except for the message contract). `anchor/types.ts` is types and constants
 * with no node, vscode or DOM dependency, so it bundles into the webview for free.
 */
export type { Anchor, Comment, CommentStatus, Located, ReviewFile } from '../anchor/types.js';
export { MAX_ANCHOR_LENGTH, MIN_ANCHOR_LENGTH, UNCERTAIN_BELOW } from '../anchor/types.js';

/** Webview view type. Shared by `createWebviewPanel` and the serializer registration. */
export const REVIEW_VIEW_TYPE = 'markdownReview.panel';

/** extension -> webview */
export type HostMessage =
  /**
   * Sent once per `ready`. The webview needs `targetPath` to write its own `setState`, and a
   * document that fails the size guard never receives `setContent` — so identity cannot ride along
   * with the content.
   */
  | { type: 'init'; targetPath: string; author: string }
  | { type: 'setContent'; html: string; frontMatterHtml?: string }
  | { type: 'tooLarge'; sizeBytes: number }
  /**
   * The target file could not be read (deleted, renamed, permissions). PRD §11 requires keeping
   * the pane and the user's data rather than closing; the re-link action arrives in Phase 4.
   */
  | { type: 'targetUnreadable'; reason: string }
  /**
   * The comments for this file, plus where each one currently sits in anchor space (Plan 03 §6).
   *
   * `located` is computed **host-side** — it already holds the `PlainTextDoc`, and keeping the
   * confidence cascade out of the webview keeps `diff-match-patch` out of that bundle (Plan 03 §9
   * C2). A `null` entry means the anchor could not be found; the comment is orphaned. The webview's
   * only job is mapping these offsets onto the DOM via `data-ap-start`.
   */
  | { type: 'reviewState'; review: ReviewFile; located: Record<string, Located | null> };

/** webview -> extension */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openExternal'; url: string }
  | { type: 'renderAnyway' }
  /**
   * The webview has no console (`no-console` is global, and a webview console is invisible unless
   * devtools happen to be open), so it reports failures to the host, which logs them to the
   * "Markdown Review" output channel.
   */
  | { type: 'error'; message: string }
  /**
   * A new comment on the current selection (Plan 03 §4). `offset` is already in anchor space —
   * the webview reads it from the enclosing block's `data-ap-start` and adds the intra-block
   * offset. `-1` means the mapping failed, and the host falls back to `hintLine`.
   */
  | { type: 'addComment'; selectedText: string; offset: number; hintLine: number; body: string }
  | { type: 'editComment'; id: string; body: string }
  | { type: 'deleteComment'; id: string }
  | { type: 'resolveComment'; id: string };

/**
 * Serializer state, and what the webview writes via `setState`. `scrollLine` is a `data-line`
 * value, not a pixel offset, so it survives a re-render that changes layout.
 */
export interface PanelState {
  targetPath: string;
  scrollLine?: number;
  /** Active status filter chips. Written from Phase 3, read by Phase 4's header bar (PRD §6). */
  filter?: CommentStatus[];
}

const STATUSES: readonly string[] = ['open', 'addressed', 'orphaned', 'resolved'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrows untrusted input from `onDidReceiveMessage`. The conventions allow unvalidated shapes only
 * at I/O boundaries narrowed by a guard, and this is one of two such boundaries in the extension.
 */
export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!isRecord(value)) return false;
  switch (value['type']) {
    case 'ready':
    case 'renderAnyway':
      return true;
    case 'openExternal':
      return typeof value['url'] === 'string';
    case 'error':
      return typeof value['message'] === 'string';
    case 'addComment':
      return (
        typeof value['selectedText'] === 'string' &&
        typeof value['body'] === 'string' &&
        // `-1` is the documented "could not map" sentinel, so negatives beyond it are still
        // rejected — but the *value* check belongs to `createAnchor`, not to this shape guard.
        isFiniteNumber(value['offset']) &&
        isFiniteNumber(value['hintLine'])
      );
    case 'editComment':
      return typeof value['id'] === 'string' && typeof value['body'] === 'string';
    case 'deleteComment':
    case 'resolveComment':
      return typeof value['id'] === 'string';
    default:
      return false;
  }
}

/** `NaN` and `Infinity` pass `typeof x === 'number'` and would corrupt every offset they touch. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Narrows the opaque state handed back by `deserializeWebviewPanel` and `getState()`. */
export function isPanelState(value: unknown): value is PanelState {
  if (!isRecord(value)) return false;
  if (typeof value['targetPath'] !== 'string') return false;

  const scrollLine = value['scrollLine'];
  if (scrollLine !== undefined && typeof scrollLine !== 'number') return false;

  const filter = value['filter'];
  if (filter !== undefined) {
    if (!Array.isArray(filter)) return false;
    if (!filter.every((entry) => typeof entry === 'string' && STATUSES.includes(entry))) {
      return false;
    }
  }
  return true;
}
