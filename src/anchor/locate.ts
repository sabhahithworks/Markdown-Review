/**
 * The confidence cascade (PRD §5). Given an `Anchor` and a freshly rendered document, find where
 * the anchored passage now lives — and say how sure we are.
 *
 * The confidence value is not decoration: anything below `UNCERTAIN_BELOW` must be surfaced in the
 * UI as "position uncertain" rather than drawn as a confident highlight, so a tier reporting a
 * confidence it did not earn is a user-visible bug.
 */

import DiffMatchPatch from 'diff-match-patch';
import { fuzzyFindWith } from './fuzzy.js';
import { CONFIDENCE, type Anchor, type Located, type PlainTextDoc } from './types.js';

const TIER3_THRESHOLD = 0.4;
const TIER3_MATCH_DISTANCE = 1000;
const TIER4_THRESHOLD = 0.3;

/**
 * Tier 4 is a *whole document* search, so where the anchor used to be should not matter at all.
 * diff-match-patch has no switch for that — the proximity term `|match_loc − expected_loc| /
 * Match_Distance` is always part of the score — so we make it negligible instead: at the furthest
 * possible point in the document it may consume at most this much of the score budget.
 *
 * Setting `Match_Distance` to merely the document length is not enough, and the arithmetic is easy
 * to get wrong: a flawless match at the far end of an N-character document would then score
 * `N/N = 1.0` and be rejected out of hand.
 */
const WHOLE_DOCUMENT_PROXIMITY_BUDGET = 0.01;

export type Locator = (anchor: Anchor) => Located | null;

/**
 * Builds a locator bound to one document, with the diff-match-patch engine hoisted out of the
 * per-anchor path. `reanchor` builds one of these and reuses it across every comment in the file
 * rather than allocating an engine per comment.
 */
export function createLocator(doc: PlainTextDoc): Locator {
  const dmp = new DiffMatchPatch();
  const { text } = doc;

  return (anchor: Anchor): Located | null => {
    const { exact, prefix, suffix, hintOffset } = anchor;
    if (exact.length === 0 || text.length === 0) return null;

    // --- Tier 1: exact match with its surrounding context -------------------------------------
    //
    // Skipped when there is no context at all. Otherwise an anchor at a document edge matches a
    // bare `exact` and reports 1.0 — the "full context matched" confidence — which is precisely
    // what the UI reads to decide whether to warn. One-sided context is legitimately stronger than
    // none, so the tier still runs when only one side is empty.
    if (prefix.length > 0 || suffix.length > 0) {
      const needle = prefix + exact + suffix;
      const at = nearestOccurrence(text, needle, hintOffset - prefix.length);
      if (at !== -1) {
        return located(at + prefix.length, exact.length, CONFIDENCE.EXACT_WITH_CONTEXT);
      }
    }

    // --- Tier 2: exact match, no context ------------------------------------------------------
    const first = text.indexOf(exact);
    if (first !== -1) {
      if (text.indexOf(exact, first + 1) === -1) {
        return located(first, exact.length, CONFIDENCE.EXACT_UNIQUE);
      }
      const nearest = nearestOccurrence(text, exact, hintOffset);
      return located(nearest === -1 ? first : nearest, exact.length, CONFIDENCE.EXACT_NEAREST);
    }

    // --- Tier 3: fuzzy, near the hint ---------------------------------------------------------
    const nearHint = fuzzyFindWith(dmp, text, exact, {
      loc: hintOffset,
      threshold: TIER3_THRESHOLD,
      matchDistance: TIER3_MATCH_DISTANCE,
    });
    if (nearHint) {
      return { start: nearHint.start, end: nearHint.end, confidence: CONFIDENCE.FUZZY_NEAR_HINT };
    }

    // --- Tier 4: fuzzy, whole document --------------------------------------------------------
    //
    // `matchDistance` must dwarf the document; see PRD §5 for why inheriting tier 3's 1000 would
    // confine a "whole document" search to the first ~300 characters.
    const anywhere = fuzzyFindWith(dmp, text, exact, {
      loc: 0,
      threshold: TIER4_THRESHOLD,
      matchDistance: Math.max(
        TIER3_MATCH_DISTANCE,
        Math.ceil(text.length / WHOLE_DOCUMENT_PROXIMITY_BUDGET),
      ),
    });
    if (anywhere) {
      return { start: anywhere.start, end: anywhere.end, confidence: CONFIDENCE.FUZZY_DOCUMENT };
    }

    // --- Tier 5: gone. The caller marks the comment `orphaned`; it is never deleted. -----------
    return null;
  };
}

/** One-shot locate. Prefer `createLocator` when relocating more than one anchor in a document. */
export function locate(anchor: Anchor, doc: PlainTextDoc): Located | null {
  return createLocator(doc)(anchor);
}

function located(start: number, length: number, confidence: number): Located {
  return { start, end: start + length, confidence };
}

/**
 * Index of the occurrence of `needle` nearest to `hint`, or `-1`.
 *
 * The nearest occurrence is always one of two: the first one starting at or after `hint`, and the
 * last one starting at or before it. Finding those two directly avoids scanning the whole document
 * — which matters, because on an unedited 5 MB file this is the hot path for every comment. Ties
 * break to the earlier occurrence, so the result is deterministic.
 */
function nearestOccurrence(text: string, needle: string, hint: number): number {
  const from = Math.max(0, Math.min(hint, text.length));

  const after = text.indexOf(needle, from);
  const before = text.lastIndexOf(needle, from);

  if (after === -1) return before;
  if (before === -1) return after;
  return after - from < from - before ? after : before;
}
