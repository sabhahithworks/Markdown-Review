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
import type { PlainTextDoc } from '../anchor/types.js';
import {
  MAX_DIFF_CHARS,
  changeStateOf,
  changedBlockRanges,
  changedRanges,
  touches,
} from '../detect/changedRanges.js';
import type { TextRange } from '../detect/scope.js';
import { renderPlainText } from '../render/plaintext.js';

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

/**
 * The change view (D28): whole blocks, from `doc.blocks`, merged when adjacent.
 *
 * Every case renders real markdown, so the spans are checked against the block map the webview's
 * `data-ap-start`/`data-ap-end` come from rather than against hand-written offsets.
 */
describe('changedBlockRanges', () => {
  /** Baseline and current documents, and the block spans the diff between them marks. */
  function marks(before: string, after: string): { doc: PlainTextDoc; spans: TextRange[] } {
    const baseline = renderPlainText(before).text;
    const doc = renderPlainText(after);
    const ranges = changedRanges(baseline, doc.text);
    if (!ranges) throw new Error('marks: expected a diff');
    return { doc, spans: changedBlockRanges(doc, ranges) };
  }

  /** The span from the start of `from`'s block to the end of `to`'s, by block index. */
  function blockSpan(doc: PlainTextDoc, from: number, to = from): TextRange {
    const first = doc.blocks[from];
    const last = doc.blocks[to];
    if (!first || !last) throw new Error('blockSpan: no such block');
    return { start: first.start, end: last.end };
  }

  it('marks the edited paragraph only', () => {
    const { doc, spans } = marks(
      'Alpha para one.\n\nBeta para two here.\n\nGamma para three.\n',
      'Alpha para one.\n\nBeta para TWO EDITED here.\n\nGamma para three.\n',
    );

    expect(spans).toEqual([blockSpan(doc, 1)]);
    expect(spans).toEqual([at(doc.text, 'Beta para TWO EDITED here.')]);
  });

  it('merges adjacent changed blocks', () => {
    const { doc, spans } = marks(
      '# Title\n\nAlpha para one.\n\nBeta para two.\n\nGamma para three.\n\nDelta para four.\n\nEpsilon five.\n',
      '# Title\n\nAlpha para one.\n\nBeta para TWO.\n\nGamma para THREE.\n\nDelta para four.\n\nEpsilon FIVE five.\n',
    );

    // Beta and Gamma are neighbours, so they merge — joiner included. Epsilon is not, so it stays
    // its own span, and the untouched blocks between them stay out.
    expect(spans).toEqual([blockSpan(doc, 2, 3), blockSpan(doc, 5)]);
  });

  it('a deletion marks its neighbours', () => {
    const { doc, spans } = marks(
      'Alpha one.\n\nBeta two.\n\nGamma three.\n\nDelta four.\n',
      'Alpha one.\n\nGamma three.\n\nDelta four.\n',
    );

    // The deleted paragraph has no block of its own any more; its mark sits on the seam, and
    // `touches`' joiner-width reach flags both survivors either side — merged, since they are now
    // adjacent. Delta is past the reach.
    expect(spans).toEqual([blockSpan(doc, 0, 1)]);
  });

  it('empty ranges give no spans', () => {
    const doc = renderPlainText('Alpha one.\n\nBeta two.\n');

    expect(changedBlockRanges(doc, [])).toEqual([]);
  });

  it('accepts ranges in any order', () => {
    const doc = renderPlainText('Alpha one.\n\nBeta two.\n\nGamma three.\n');
    const gamma = at(doc.text, 'three');
    const alpha = at(doc.text, 'one');

    expect(changedBlockRanges(doc, [gamma, alpha])).toEqual([blockSpan(doc, 0), blockSpan(doc, 2)]);
  });
});

describe('changeStateOf', () => {
  it('too-large', () => {
    const doc = renderPlainText('Alpha one.\n');
    const huge = 'x'.repeat(MAX_DIFF_CHARS + 1);

    expect(changeStateOf(huge, doc, null)).toEqual({ state: 'too-large' });
    // The cap decides, not whatever ranges a caller happened to pass.
    expect(changeStateOf(huge, doc, [{ start: 0, end: 1 }])).toEqual({ state: 'too-large' });
  });

  it('changeStateOf maps each state', () => {
    const before = 'Alpha one.\n\nBeta two here.\n\nGamma three.\n';
    const baseline = renderPlainText(before).text;
    const same = renderPlainText(before);
    const edited = renderPlainText('Alpha one.\n\nBeta TWO here.\n\nGamma three.\n');
    const beta = edited.blocks[1];
    if (!beta) throw new Error('expected three blocks');

    expect(changeStateOf(undefined, same, null)).toEqual({ state: 'no-baseline' });
    expect(changeStateOf(baseline, same, null)).toEqual({ state: 'unchanged' });
    expect(changeStateOf(baseline, edited, changedRanges(baseline, edited.text))).toEqual({
      state: 'changed',
      blocks: [{ start: beta.start, end: beta.end }],
    });
  });

  it('never reads a missing diff as "no changes"', () => {
    const baseline = renderPlainText('Alpha one.\n').text;
    const edited = renderPlainText('Alpha ONE.\n');

    // A `null` that reaches the last case is "no answer", reported as too-large, not unchanged.
    expect(changeStateOf(baseline, edited, null)).toEqual({ state: 'too-large' });
    // An empty baseline cannot be diffed against; it is no baseline, not a misleading too-large.
    expect(changeStateOf('', edited, null)).toEqual({ state: 'no-baseline' });
  });
});
