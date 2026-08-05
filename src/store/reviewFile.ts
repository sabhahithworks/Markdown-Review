/**
 * Sidecar validation and serialization (Plan 03 §3 — contract owner).
 *
 * Pure and `vscode`-free. The sidecar is one of the two untrusted-input boundaries in the
 * extension (the other is `panel/messages.ts`): it is a file on disk the PRD explicitly invites the
 * user to hand-edit, so everything read from it is `unknown` until a guard here narrows it.
 *
 * Errors are values, per the plans README — a bad sidecar is an *expected* failure, and the
 * extension layer turns it into a backup plus a warning rather than an exception.
 */

import type { Anchor, Comment, CommentStatus, ReviewFile } from '../anchor/types.js';

/** The only `version` this build writes, and the only one it reads without migrating. */
export const SIDECAR_VERSION = 1;

/** Two-space indent: PRD §4 requires the sidecar be human-readable and hand-editable. */
const INDENT = 2;

/**
 * The largest rendered plain text that will be stored as `baselineText` (Plan 04 §9 D2).
 *
 * PRD §4 puts the whole snapshot in the sidecar, which makes the sidecar as large as the document —
 * on a 2 MB target (legal: it is under the render guard) that is a multi-megabyte JSON string,
 * rewritten on every later save and committed to git. That contradicts the same section's
 * "human-readable" promise and PRD §11's "shareable through git".
 *
 * Above this, the baseline is skipped: the rewrite banner is unavailable for that file and nothing
 * else changes. Orphan triage, status inference and the prompt itself never read the baseline —
 * `anchor.exact` is the per-comment comparison basis (PRD §5), not this.
 */
export const BASELINE_MAX_CHARS = 256 * 1024;

const STATUSES: readonly CommentStatus[] = ['open', 'addressed', 'orphaned', 'resolved'];

export type ParseFailure =
  /** Not JSON at all — truncated write, merge conflict markers, editor crash. */
  | { ok: false; reason: 'unparseable'; detail: string }
  /** Parsed, but does not describe a `ReviewFile`. */
  | { ok: false; reason: 'invalid-shape'; detail: string }
  /** A `version` this build does not understand. Refuse and explain; never silently drop (PRD §11). */
  | { ok: false; reason: 'unsupported-version'; detail: string };

export type ParseResult = { ok: true; review: ReviewFile } | ParseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Rejects `NaN` and `Infinity`, which survive `typeof x === 'number'` and poison offset maths. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isAnchor(value: unknown): value is Anchor {
  if (!isRecord(value)) return false;
  return (
    isString(value['exact']) &&
    isString(value['prefix']) &&
    isString(value['suffix']) &&
    isFiniteNumber(value['hintLine']) &&
    isFiniteNumber(value['hintOffset'])
  );
}

export function isComment(value: unknown): value is Comment {
  if (!isRecord(value)) return false;
  if (!isString(value['id']) || value['id'].length === 0) return false;
  if (!isString(value['body'])) return false;
  if (!isString(value['author'])) return false;
  if (!isString(value['createdAt'])) return false;
  if (!STATUSES.includes(value['status'] as CommentStatus)) return false;
  if (!isAnchor(value['anchor'])) return false;

  const resolution = value['resolution'];
  if (resolution !== undefined) {
    if (!isRecord(resolution)) return false;
    if (
      !isString(resolution['previousText']) ||
      !isString(resolution['currentText']) ||
      !isString(resolution['detectedAt'])
    ) {
      return false;
    }
  }
  return true;
}

export function isReviewFile(value: unknown): value is ReviewFile {
  if (!isRecord(value)) return false;
  if (value['version'] !== SIDECAR_VERSION) return false;
  if (!isString(value['targetPath'])) return false;
  if (!Array.isArray(value['comments']) || !value['comments'].every(isComment)) return false;

  const baselineText = value['baselineText'];
  const baselineAt = value['baselineAt'];
  if (baselineText !== undefined && !isString(baselineText)) return false;
  if (baselineAt !== undefined && !isString(baselineAt)) return false;

  // Duplicate ids would make `updateCommentBody`/`deleteComment` ambiguous, and only a hand-edit
  // can produce them.
  const ids = new Set((value['comments'] as Comment[]).map((comment) => comment.id));
  return ids.size === value['comments'].length;
}

export function emptyReviewFile(targetPath: string): ReviewFile {
  return { version: SIDECAR_VERSION, targetPath, comments: [] };
}

export function serializeReviewFile(review: ReviewFile): string {
  return `${JSON.stringify(review, null, INDENT)}\n`;
}

/**
 * Narrows the contents of a sidecar file.
 *
 * Validation is whole-file: a single malformed comment fails the parse rather than being dropped
 * from an otherwise-good result. That is deliberate (Plan 03 §3) — a partial resurrection would
 * silently discard the user's data, while a failure preserves every byte in the `.bak`.
 */
export function parseReviewFile(raw: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: 'unparseable', detail: error instanceof Error ? error.message : String(error) };
  }

  if (isRecord(value) && isFiniteNumber(value['version']) && value['version'] !== SIDECAR_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-version',
      detail: `sidecar version ${String(value['version'])}, this build understands ${String(SIDECAR_VERSION)}`,
    };
  }

  if (!isReviewFile(value)) {
    return { ok: false, reason: 'invalid-shape', detail: 'not a valid review file' };
  }

  return { ok: true, review: value };
}
