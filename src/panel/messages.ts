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

import type { ChangeState, CommentStatus, Located, ReviewFile } from '../anchor/types.js';

/**
 * Re-exported so `media/src` imports only from this module (plans README: webview code never
 * reaches into `src/` except for the message contract). `anchor/types.ts` is types and constants
 * with no node, vscode or DOM dependency, so it bundles into the webview for free.
 */
export type {
  AgentNote,
  Anchor,
  ChangeSpan,
  ChangeState,
  Comment,
  CommentStatus,
  Located,
  ReviewFile,
} from '../anchor/types.js';
export {
  isDocumentComment,
  MAX_ANCHOR_LENGTH,
  MIN_ANCHOR_LENGTH,
  UNCERTAIN_BELOW,
} from '../anchor/types.js';
/** PRD §7's quote truncation. Re-exported because addressed cards quote text webview-side too. */
export { MAX_QUOTE_LENGTH, truncateQuote } from '../anchor/text.js';
export { countByStatus } from '../anchor/counts.js';

/**
 * A `ReviewFile` without the diff baseline.
 *
 * `baselineText` is a whole-document snapshot — up to `BASELINE_MAX_CHARS` — and `reviewState` is
 * posted on *every* state change, so shipping it would push a quarter of a megabyte across the
 * webview channel each time a status flips. The webview never renders it (the rewrite diff is opened
 * host-side), so it is stripped at the boundary, and this type makes forgetting a compile error.
 */
export type ReviewSummary = Omit<ReviewFile, 'baselineText' | 'agentNotes'> & {
  agentNotes?: { unattached: string; cut: boolean; receivedAt: string };
};

/**
 * Drops the baseline on its way to the webview.
 *
 * Written out field by field rather than by rest-destructuring so that adding a *required* field to
 * `ReviewFile` fails to compile here until someone decides whether the webview should see it.
 */
export function toReviewSummary(review: ReviewFile): ReviewSummary {
  return {
    version: review.version,
    targetPath: review.targetPath,
    comments: review.comments,
    baselineAt: review.baselineAt,
    ...(review.promptOrder ? { promptOrder: [...review.promptOrder] } : {}),
    ...(review.agentNotes
      ? {
          agentNotes: {
            unattached: review.agentNotes.unattached,
            cut: review.agentNotes.cut,
            receivedAt: review.agentNotes.receivedAt,
          },
        }
      : {}),
  };
}

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
   *
   * `sectionChanged` lists the ids of `open` comments whose *region* differs from the review
   * baseline even though their own anchored text does not (D17) — a heading comment whose section
   * the agent rewrote, say. It is a weaker claim than `addressed` on purpose and is never a status:
   * nothing is inferred, nothing is persisted, and the user confirms with "Looks good". Sent as a
   * sparse array because the common case is empty and this message goes out on every state change.
   *
   * `changes` is the change view (D28): which whole blocks differ from the baseline, or why that
   * cannot be said. Only block-aligned spans cross — the baseline text never does — and it is not
   * gated on `autoDetectResolution` (D29), because it is a plain diff rather than an inference.
   */
  | {
      type: 'reviewState';
      review: ReviewSummary;
      located: Record<string, Located | null>;
      sectionChanged: string[];
      changes: ChangeState;
    }
  /**
   * A single re-anchor pass lost every comment that was previously located, and a baseline exists
   * (PRD §11). Evaluated host-side because only the host knows the state *before* the pass.
   *
   * An event, not a state: the next `setContent` clears the notice it renders into, so it fires on
   * the transition rather than re-appearing on every later render of an already-wrecked document.
   * The durable, actionable UI for this is the orphan section.
   */
  | { type: 'rewriteDetected'; orphaned: number };

/** Where "Send to…" puts the review prompt. */
export type SendTarget = 'chat' | 'terminal';

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
  /** A comment on the document as a whole: no selection, so no anchor. */
  | { type: 'addDocumentComment'; body: string }
  | { type: 'editComment'; id: string; body: string }
  | { type: 'deleteComment'; id: string }
  /** Also the "Looks good" button on an addressed card — same host action, different label. */
  | { type: 'resolveComment'; id: string }
  /** The user disagrees with an inference: `addressed` back to `open` (PRD §8). */
  | { type: 'reopenComment'; id: string }
  /**
   * Re-attach an orphan to a fresh selection (PRD §6). Carries the selection rather than arming a
   * mode host-side, so the "pick some text" state lives entirely in the webview and cannot be left
   * stuck by a reload. The payload mirrors `addComment` so both go through the same validation.
   */
  | { type: 'reanchorComment'; id: string; selectedText: string; offset: number; hintLine: number }
  /** Header actions. The palette commands are the same code paths. */
  | { type: 'copyPrompt' }
  | { type: 'sendPrompt'; target: SendTarget }
  | { type: 'clearAddressed' }
  | { type: 'clearAll' }
  /** The rewrite banner's action: open baseline ↔ current as a diff (PRD §11). */
  | { type: 'showRewriteDiff' }
  /** "Locate file…" on the unreadable notice: point this review at a file that still exists. */
  | { type: 'relinkTarget' }
  /** Dismisses one comment's agent note, or with no id the notes that name no comment. */
  | { type: 'dismissAgentNote'; id?: string };

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
    case 'showRewriteDiff':
    case 'relinkTarget':
    case 'copyPrompt':
    case 'clearAddressed':
    case 'clearAll':
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
    case 'sendPrompt':
      return value['target'] === 'chat' || value['target'] === 'terminal';
    case 'dismissAgentNote':
      return value['id'] === undefined || typeof value['id'] === 'string';
    case 'addDocumentComment':
      return typeof value['body'] === 'string';
    case 'editComment':
      return typeof value['id'] === 'string' && typeof value['body'] === 'string';
    case 'deleteComment':
    case 'resolveComment':
    case 'reopenComment':
      return typeof value['id'] === 'string';
    case 'reanchorComment':
      return (
        typeof value['id'] === 'string' &&
        typeof value['selectedText'] === 'string' &&
        isFiniteNumber(value['offset']) &&
        isFiniteNumber(value['hintLine'])
      );
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
