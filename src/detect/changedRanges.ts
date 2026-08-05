/**
 * **What changed since the user copied the review prompt** (Plan D17).
 *
 * `baselineText` is snapshotted at the moment the prompt goes on the clipboard, which makes it the
 * only record of what the document looked like when the user asked. Until now it fed one feature —
 * the "this was rewritten" banner. This module turns it into per-comment evidence.
 *
 * The output is a list of ranges **in current-document coordinates**, so a caller can ask "did
 * anything change inside this region?" by intersecting against a `Scope`. Working forwards into the
 * current document is what keeps this implementable: PRD §5 rules out locating an anchor *inside*
 * the baseline, because the baseline is stored as bare plain text with no block map. Nothing here
 * needs one — the block map that matters belongs to the document we just rendered.
 *
 * One diff serves every comment in the file, so the cost is O(document), not O(document × comments).
 *
 * Pure and `vscode`-free (enforced by `eslint.config.mjs`).
 */

import DiffMatchPatch from 'diff-match-patch';
import type { TextRange } from './scope.js';

/**
 * Wall-clock budget for one diff. On expiry diff-match-patch returns a valid but *coarser* diff.
 *
 * Coarser means larger changed ranges, which can only ever over-report — and over-reporting here
 * costs a badge the user glances at and dismisses, where under-reporting recreates the silence that
 * made D17 feel broken. It is a safety valve, not a correctness risk; the same argument
 * `fuzzy.ts::verify` makes for its own timeout.
 */
const DIFF_TIMEOUT_SECONDS = 0.2;

/**
 * Above this, no signal at all.
 *
 * The baseline side is already bounded by `BASELINE_MAX_CHARS` (256 KB, Plan 04 §10 D2), so this
 * only bites when a document has grown by several multiples since the prompt was copied — at which
 * point "what changed near your comment" is not a question worth answering anyway. A hard character
 * cap rather than a pure time budget, so the same inputs give the same answer on every machine
 * (`fuzzy.ts::MAX_BITAP_SCAN_CHARS` makes the same call for the same reason).
 */
export const MAX_DIFF_CHARS = 1024 * 1024;

/**
 * Ranges of the current document that differ from `baseline`, or `null` when the question does not
 * apply — no baseline, an identical document, or either side past {@link MAX_DIFF_CHARS}.
 *
 * `null` is not "nothing changed": it is "no answer", and callers must show no signal rather than a
 * reassuring one. An empty array cannot occur — identical texts return `null` first.
 */
export function changedRanges(baseline: string, current: string): TextRange[] | null {
  if (baseline.length === 0) return null;
  if (baseline === current) return null;
  if (baseline.length > MAX_DIFF_CHARS || current.length > MAX_DIFF_CHARS) return null;

  const dmp = new DiffMatchPatch();
  dmp.Diff_Timeout = DIFF_TIMEOUT_SECONDS;

  // `checklines` — diff line-by-line first, then refine. Anchor space joins blocks with `\n`, so a
  // "line" here is very nearly a block, which is the granularity the answer is wanted at anyway.
  const diffs = dmp.diff_main(baseline, current, true);

  const ranges: TextRange[] = [];
  let cursor = 0;

  for (const [op, text] of diffs) {
    if (op === DiffMatchPatch.DIFF_EQUAL) {
      cursor += text.length;
    } else if (op === DiffMatchPatch.DIFF_INSERT) {
      ranges.push({ start: cursor, end: cursor + text.length });
      cursor += text.length;
    } else {
      // A deletion occupies no space in the current document. It is recorded as the zero-width
      // point where the removed text used to begin; `touches` below treats that point as belonging
      // to the regions on *both* sides of it.
      ranges.push({ start: cursor, end: cursor });
    }
  }

  return merge(ranges);
}

/**
 * Whether any changed range falls inside `scope`.
 *
 * Insertions intersect normally. A zero-width deletion mark reaches **one character either side**,
 * which is not a fudge factor — it is the width of the `\n` joiner between two blocks, and joiners
 * belong to no scope at all (`plaintext.ts`'s block-span invariant).
 *
 * Without that reach, deleting a section's last paragraph flags the *following* section and not the
 * one the text was deleted from: the mark lands on the next block's first character, one past the
 * end of the scope that actually lost content. That is precisely the class of silent miss D17
 * exists to fix. The cost of reaching across is that a deletion at a seam flags both neighbours —
 * correct, since at a seam there is genuinely nothing to say which side the comment was about.
 */
export function touches(ranges: readonly TextRange[] | null, scope: TextRange): boolean {
  if (!ranges) return false;
  return ranges.some((range) =>
    range.start === range.end
      ? range.start >= scope.start - 1 && range.start <= scope.end + 1
      : range.start < scope.end && range.end > scope.start,
  );
}

/** Coalesces overlapping and abutting ranges. Input is already ascending by construction. */
function merge(ranges: readonly TextRange[]): TextRange[] {
  const merged: TextRange[] = [];

  for (const range of ranges) {
    const last = merged[merged.length - 1];
    // Zero-width marks are kept as their own entries: absorbing one into a neighbouring range would
    // lose the "touches both sides" semantics that `touches` gives them.
    if (last && last.start !== last.end && range.start !== range.end && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ start: range.start, end: range.end });
  }

  return merged;
}
