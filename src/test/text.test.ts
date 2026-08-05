/**
 * H8 — `snapToWordEnd`, the repair for `fuzzy.verify`'s under-reported span end. When anchored
 * text grows, the verify window stops short by the growth and the span ends mid-word, which the
 * addressed card renders as corrupted text ("…so they do no").
 */

import { describe, expect, it } from 'vitest';
import { snapToWordEnd } from '../anchor/text.js';

describe('snapToWordEnd (H8)', () => {
  const text = 'Counters live in memory, so they do nothing durable.';

  it('extends a mid-word end to the end of that word', () => {
    const midWord = text.indexOf('nothing') + 2; // "…do no|thing…" — the D21 clip, exactly
    const snapped = snapToWordEnd(text, midWord, 32);
    expect(text.slice(0, snapped).endsWith('do nothing')).toBe(true);
  });

  it('returns the index unchanged on a word boundary', () => {
    const boundary = text.indexOf(',');
    expect(snapToWordEnd(text, boundary, 32)).toBe(boundary);
    const afterSpace = text.indexOf('live');
    expect(snapToWordEnd(text, afterSpace, 32)).toBe(afterSpace);
  });

  it('returns the index unchanged at the edges', () => {
    expect(snapToWordEnd(text, 0, 32)).toBe(0);
    expect(snapToWordEnd(text, text.length, 32)).toBe(text.length);
  });

  it('gives up rather than clip at a different mid-word point', () => {
    const long = `start ${'x'.repeat(100)} end`;
    const inside = 10; // inside the x-run
    expect(snapToWordEnd(long, inside, 8)).toBe(inside);
  });

  it('runs to the end of the text when the word ends there', () => {
    const tail = 'ends midwo';
    expect(snapToWordEnd(tail, tail.length - 2, 32)).toBe(tail.length);
  });

  it('never splits a surrogate pair while extending', () => {
    const astral = 'see 𝒳𝒴𝒵ab rest';
    const start = astral.indexOf('𝒳') + 2; // between pairs, mid-word
    const snapped = snapToWordEnd(astral, start, 32);
    expect(astral.slice(0, snapped).endsWith('𝒵ab')).toBe(true);
  });

  it('treats combining marks as part of the word', () => {
    const combining = 'cafés end'; // "cafés" with a combining acute
    const snapped = snapToWordEnd(combining, 3, 32); // inside "cafés"
    expect(combining.slice(0, snapped)).toBe('cafés');
  });
});
