/**
 * Relocating every comment in a file against a freshly rendered document, and inferring which ones
 * the agent addressed.
 *
 * This module is the only code allowed to set `addressed` or `orphaned`. It never sets `resolved`
 * (that is always a user action, PRD §8) and it never deletes a comment (PRD §4).
 *
 * **Pure.** It builds a new `ReviewFile` and never mutates its input, so Phase 4's store can use
 * reference equality as a cheap change check and tests can assert the input was untouched.
 */

import { normalizeAnchorText, offsetToSourceLine } from '../render/plaintext.js';
import { createLocator } from './locate.js';
import type { Anchor, Comment, PlainTextDoc, ReanchorResult, ReviewFile } from './types.js';

export interface ReanchorOptions {
  /** injectable clock, so `detectedAt` is deterministic under test */
  now?: () => string;
  /**
   * When false, comments are still relocated and still orphaned, but `open` is never flipped to
   * `addressed`. This is the `markdownReview.autoDetectResolution: false` setting (Plan 04 §5) —
   * positions must keep tracking edits even when the user does not want status inference, and a
   * vanished anchor is vanished regardless of the setting.
   */
  inferAddressed?: boolean;
}

export function reanchor(
  reviewFile: ReviewFile,
  newDoc: PlainTextDoc,
  options: ReanchorOptions = {},
): ReanchorResult {
  const now = options.now ?? (() => new Date().toISOString());
  const inferAddressed = options.inferAddressed ?? true;
  const locate = createLocator(newDoc);

  let changed = false;
  const comments = reviewFile.comments.map((comment) => {
    // `resolved` is terminal and is never re-evaluated (PRD §4).
    if (comment.status === 'resolved') return comment;
    // A whole-document comment has no anchor to locate (release-expansion D26).
    if (comment.anchor === undefined) return comment;

    const next = relocate(comment, newDoc, locate, now, inferAddressed);
    if (next.status !== comment.status || !resolutionEquals(next.resolution, comment.resolution)) {
      changed = true;
    }
    return next;
  });

  return { reviewFile: { ...reviewFile, comments }, changed };
}

function relocate(
  comment: Comment,
  doc: PlainTextDoc,
  locate: (anchor: Anchor) => { start: number; end: number } | null,
  now: () => string,
  inferAddressed: boolean,
): Comment {
  const base = comment.anchor;
  if (base === undefined) return comment;
  const found = locate(base);

  if (!found) {
    // Orphaned. The anchor is left exactly as it was — its `exact` is the record of what the user
    // commented on, and Phase 4's orphan section quotes it.
    return withStatus(comment, 'orphaned', base, comment.resolution);
  }

  // Hints are refreshed on every pass but deliberately do not count as a change; see the doc
  // comment on `ReanchorResult.changed`.
  const anchor: Anchor = {
    ...base,
    hintOffset: found.start,
    hintLine: offsetToSourceLine(doc, found.start),
  };

  const currentText = doc.text.slice(found.start, found.end);

  if (!inferAddressed) {
    // Re-anchor and self-heal an orphan, but do not infer anything about the text, and do not
    // destroy a `resolution` the user has not acted on yet.
    const status = comment.status === 'orphaned' ? 'open' : comment.status;
    return withStatus(comment, status, anchor, comment.resolution);
  }

  // Compare in normalized anchor space rather than with a raw `!==`. Both sides *should* already
  // be normalized, but a sidecar written by an older build — or hand-edited by the user, which
  // PRD §11 explicitly supports — may not be, and a whitespace-only difference would otherwise
  // flip every comment in the file to `addressed` at once.
  if (normalizeAnchorText(currentText) === normalizeAnchorText(base.exact)) {
    // Unchanged. This also self-heals an orphan whose text reappeared after a restructure.
    // Clearing `resolution` matters: a reverted edit would otherwise keep rendering a phantom
    // before/after diff on the card.
    return withStatus(comment, 'open', anchor, undefined);
  }

  // Changed. `anchor.exact` is never mutated — the before/after display and any later "Looks good"
  // need the original.
  const previous = comment.resolution;
  const alreadyDetected =
    comment.status === 'addressed' &&
    previous !== undefined &&
    normalizeAnchorText(previous.currentText) === normalizeAnchorText(currentText);

  return withStatus(comment, 'addressed', anchor, {
    previousText: base.exact,
    currentText,
    // Keeping the original timestamp when nothing actually moved is what stops every 400 ms
    // debounce tick from rewriting `detectedAt`, flipping `changed`, and churning the sidecar to
    // disk during a burst of typing.
    detectedAt: alreadyDetected && previous ? previous.detectedAt : now(),
  });
}

function withStatus(
  comment: Comment,
  status: Comment['status'],
  anchor: Anchor,
  resolution: Comment['resolution'],
): Comment {
  const next: Comment = { ...comment, status, anchor };
  if (resolution === undefined) {
    delete next.resolution;
  } else {
    next.resolution = resolution;
  }
  return next;
}

function resolutionEquals(a: Comment['resolution'], b: Comment['resolution']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.previousText === b.previousText &&
    a.currentText === b.currentText &&
    a.detectedAt === b.detectedAt
  );
}
