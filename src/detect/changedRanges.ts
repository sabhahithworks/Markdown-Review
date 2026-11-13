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
import type { ChangeState, PlainTextDoc } from '../anchor/types.js';
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

/**
 * The whole blocks of `doc` that a changed range touches, with adjacent marked blocks merged into
 * one span (D28). Spans come from `doc.blocks` and nothing else (L-block-offsets-single-source), so
 * the webview can intersect them with `data-ap-start`/`data-ap-end` without an opinion of its own.
 *
 * "Touches" is {@link touches}, unchanged: a zero-width deletion reaches one joiner either side, so a
 * deleted paragraph marks both of its surviving neighbours. Over-marking is the safe direction here
 * for the same reason it is in D17.
 *
 * One sweep over ranges ascending by start, with a block cursor that only moves forward: blocks that
 * end before `range.start - 1` can be touched by neither this range nor any later one. Each range
 * then visits only the blocks it reaches plus at most one either side, so the cost is linear in
 * blocks + ranges + marks (L-reanchor-perf).
 */
export function changedBlockRanges(doc: PlainTextDoc, ranges: readonly TextRange[]): TextRange[] {
  const { blocks } = doc;
  if (ranges.length === 0 || blocks.length === 0) return [];

  // `changedRanges` already returns them ascending; the copy keeps this correct for any caller.
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const marked = new Uint8Array(blocks.length);
  let cursor = 0;

  for (const range of sorted) {
    for (let block = blocks[cursor]; block && block.end < range.start - 1; block = blocks[cursor]) {
      cursor++;
    }

    // The furthest a block may start and still be reached: one joiner past a zero-width mark,
    // strictly before the end of an insertion.
    const reach = range.start === range.end ? range.start + 1 : range.end - 1;
    for (let i = cursor; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block || block.start > reach) break;
      if (!marked[i] && touches([range], block)) marked[i] = 1;
    }
  }

  const spans: TextRange[] = [];
  blocks.forEach((block, i) => {
    if (!marked[i]) return;
    const last = spans[spans.length - 1];
    // Adjacent in block order, not in offsets: the joiner between them belongs to the merged span.
    if (last && i > 0 && marked[i - 1]) last.end = block.end;
    else spans.push({ start: block.start, end: block.end });
  });
  return spans;
}

/**
 * The change view's answer for one post (D28): a pure decision over the baseline, the current
 * document and the diff `changedRanges` produced for them.
 *
 * Only `unchanged` reassures. A `null` diff that survives the earlier checks — `changedRanges`
 * refusing to answer for a reason this function did not foresee — is reported as `too-large`, the
 * "no answer" state, never as "no changes".
 *
 * An empty baseline counts as no baseline, as it does for `sectionChanged`: `changedRanges` cannot
 * diff against one, so the alternative would be a misleading `too-large`.
 */
export function changeStateOf(
  baseline: string | undefined,
  doc: PlainTextDoc,
  ranges: readonly TextRange[] | null,
): ChangeState {
  if (!baseline) return { state: 'no-baseline' };
  if (baseline === doc.text) return { state: 'unchanged' };
  if (baseline.length > MAX_DIFF_CHARS || doc.text.length > MAX_DIFF_CHARS) {
    return { state: 'too-large' };
  }
  if (!ranges) return { state: 'too-large' };
  return { state: 'changed', blocks: changedBlockRanges(doc, ranges) };
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
