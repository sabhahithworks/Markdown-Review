/**
 * What moved since the review prompt was copied (D17).
 *
 * Two things are being pinned here. First, that ranges come back in *current-document* coordinates
 * — the whole approach depends on never having to locate anything inside the baseline, which has no
 * block map. Second, the deletion semantics: a deletion occupies no space in the current document,
 * so where it gets attributed is a decision rather than a fact, and getting it wrong reintroduces
 * the silent miss the feature exists to remove.
 */

import { describe, expect, it } from 'vitest';
import { MAX_DIFF_CHARS, changedRanges, touches } from '../detect/changedRanges.js';
import type { TextRange } from '../detect/scope.js';

/** The range of `needle` in `text` — assertions read as prose rather than as offsets. */
function at(text: string, needle: string): TextRange {
  const start = text.indexOf(needle);
  if (start === -1) throw new Error(`at: ${JSON.stringify(needle)} not found`);
  return { start, end: start + needle.length };
}

describe('changedRanges — when there is no answer', () => {
  it('returns null for identical documents', () => {
    expect(changedRanges('alpha\nbeta', 'alpha\nbeta')).toBe(null);
  });

  it('returns null when no baseline was ever captured', () => {
    expect(changedRanges('', 'alpha\nbeta')).toBe(null);
  });

  it('returns null past the size cap rather than spending the time', () => {
    const huge = 'x'.repeat(MAX_DIFF_CHARS + 1);

    expect(changedRanges('alpha', huge)).toBe(null);
    expect(changedRanges(huge, 'alpha')).toBe(null);
  });

  it('never returns an empty array — "no changes" is null, and null is not reassurance', () => {
    expect(changedRanges('alpha', 'alpha')).toBe(null);
    expect(changedRanges('alpha', 'alphabet')).not.toHaveLength(0);
  });
});

describe('changedRanges — coordinates', () => {
  it('reports an insertion where it lands in the *current* document', () => {
    const baseline = 'alpha\ngamma';
    const current = 'alpha\nbeta\ngamma';

    const ranges = changedRanges(baseline, current);

    expect(ranges).not.toBe(null);
    expect(touches(ranges, at(current, 'beta'))).toBe(true);
    expect(touches(ranges, at(current, 'alpha'))).toBe(false);
  });

  it('reports a replacement against the text that replaced it', () => {
    const baseline = 'alpha\nbeta\ngamma';
    const current = 'alpha\nBETA REWRITTEN\ngamma';

    const ranges = changedRanges(baseline, current);

    expect(touches(ranges, at(current, 'BETA REWRITTEN'))).toBe(true);
    expect(touches(ranges, at(current, 'gamma'))).toBe(false);
  });

  it('leaves untouched blocks alone when the change is elsewhere', () => {
    const baseline = 'alpha\nbeta\ngamma\ndelta';
    const current = 'alpha\nbeta\ngamma CHANGED\ndelta';

    const ranges = changedRanges(baseline, current);

    expect(touches(ranges, at(current, 'alpha'))).toBe(false);
    expect(touches(ranges, at(current, 'beta'))).toBe(false);
    expect(touches(ranges, at(current, 'delta'))).toBe(false);
  });
});

describe('changedRanges — deletions', () => {
  it('flags both blocks either side of deleted text', () => {
    // A deletion occupies no space in the current document, so its mark lands on the seam. At a
    // seam there is nothing to say which side the comment was about, so both are flagged.
    const baseline = 'alpha\nbeta\ngamma';
    const current = 'alpha\ngamma';

    const ranges = changedRanges(baseline, current);

    expect(touches(ranges, at(current, 'alpha'))).toBe(true);
    expect(touches(ranges, at(current, 'gamma'))).toBe(true);
  });

  it('flags the section that *lost* content, not just the one after it', () => {
    // The regression this guards: without the joiner-width reach, the mark lands one character past
    // the end of the scope that actually lost a paragraph, and only the next section is flagged —
    // which is the same silent miss D17 exists to fix.
    const baseline = 'Alpha\npara one\npara two\nBeta\nbeta prose';
    const current = 'Alpha\npara one\nBeta\nbeta prose';

    const ranges = changedRanges(baseline, current);
    const alphaSection = { start: 0, end: current.indexOf('\nBeta') };

    expect(touches(ranges, alphaSection)).toBe(true);
  });

  it('does not flag a distant block when something is deleted', () => {
    const baseline = 'alpha\nbeta\ngamma\ndelta\nepsilon';
    const current = 'alpha\nbeta\ngamma\nepsilon';

    const ranges = changedRanges(baseline, current);

    expect(touches(ranges, at(current, 'alpha'))).toBe(false);
    expect(touches(ranges, at(current, 'beta'))).toBe(false);
  });
});

describe('touches', () => {
  const ranges: TextRange[] = [{ start: 10, end: 20 }];

  it('is false for a null answer — no baseline means no claim', () => {
    expect(touches(null, { start: 0, end: 100 })).toBe(false);
  });

  it('is false for a scope entirely before the change', () => {
    expect(touches(ranges, { start: 0, end: 10 })).toBe(false);
  });

  it('is false for a scope entirely after the change', () => {
    expect(touches(ranges, { start: 20, end: 30 })).toBe(false);
  });

  it('is true for a scope overlapping the change at either edge', () => {
    expect(touches(ranges, { start: 0, end: 11 })).toBe(true);
    expect(touches(ranges, { start: 19, end: 30 })).toBe(true);
  });

  it('is true for a scope containing the change entirely', () => {
    expect(touches(ranges, { start: 0, end: 100 })).toBe(true);
  });
});

describe('changedRanges — a wholesale rewrite', () => {
  it('flags everything without crashing', () => {
    const baseline = 'alpha\nbeta\ngamma';
    const current = 'entirely different prose\nwith nothing in common';

    const ranges = changedRanges(baseline, current);

    expect(ranges).not.toBe(null);
    expect(touches(ranges, { start: 0, end: current.length })).toBe(true);
  });

  it('handles a baseline whose content was emptied to nothing', () => {
    expect(touches(changedRanges('alpha\nbeta', ''), { start: 0, end: 0 })).toBe(true);
  });
});
