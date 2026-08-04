/**
 * `fuzzy.ts` is tested against hand-written plain strings — no markdown, no fixtures — because the
 * two landmines it exists to solve are about string search, not about documents.
 */

import { describe, expect, it } from 'vitest';
import { MATCH_MAX_BITS, MAX_BITAP_SCAN_CHARS, buildProbes, fuzzyFind } from '../anchor/fuzzy.js';
import { mulberry32 } from './helpers.js';

const NEAR_HINT = { threshold: 0.4, matchDistance: 1000 };

/** Mirrors locate.ts's tier 4: proximity made negligible across the whole document. */
function wholeDocument(text: string) {
  return { loc: 0, threshold: 0.3, matchDistance: Math.max(1000, Math.ceil(text.length / 0.01)) };
}

describe('buildProbes', () => {
  it('uses the whole anchor when it fits the bitap pattern limit', () => {
    const exact = 'a'.repeat(MATCH_MAX_BITS);
    expect(buildProbes(exact)).toEqual([{ text: exact, offset: 0 }]);
  });

  it('switches to three probes one character past the limit', () => {
    const probes = buildProbes('abcdefghij'.repeat(4)); // 40 chars
    expect(probes).toHaveLength(3);
    for (const probe of probes) {
      expect(probe.text.length).toBeLessThanOrEqual(MATCH_MAX_BITS);
    }
  });

  it('takes head, middle and tail slices of the anchor', () => {
    const exact = 'X'.repeat(50) + 'MIDDLE' + 'Y'.repeat(50);
    const probes = buildProbes(exact);

    expect(probes[0]?.offset).toBe(0);
    expect(probes[2]?.offset).toBe(exact.length - MATCH_MAX_BITS);
    expect(probes[1]?.text).toContain('MIDDLE');
  });

  it('never splits a surrogate pair', () => {
    const exact = '👨‍👩‍👧'.repeat(20);
    for (const probe of buildProbes(exact)) {
      expect(probe.text).toBe(probe.text.normalize('NFC'));
      expect([...probe.text].join('')).toBe(probe.text);
      expect(/[\uD800-\uDBFF]$/.test(probe.text)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(probe.text)).toBe(false);
    }
  });
});

describe('fuzzyFind — basics', () => {
  const text = 'The quick brown fox jumps over the lazy dog near the river bank at dawn.';

  it('finds an exact substring', () => {
    const at = text.indexOf('brown fox jumps');
    const match = fuzzyFind(text, 'brown fox jumps', { loc: at, ...NEAR_HINT });
    expect(match).toEqual({ start: at, end: at + 'brown fox jumps'.length, score: 0 });
  });

  it('finds a lightly reworded substring and reports the real boundaries', () => {
    const match = fuzzyFind(text, 'quick brown cat jumps', {
      loc: text.indexOf('quick'),
      ...NEAR_HINT,
    });
    expect(match).not.toBeNull();
    expect(text.slice(match?.start, match?.end)).toContain('brown fox jumps');
    expect(match?.score).toBeGreaterThan(0);
    expect(match?.score).toBeLessThanOrEqual(NEAR_HINT.threshold);
  });

  it('returns null when nothing is close enough', () => {
    expect(
      fuzzyFind(text, 'completely unrelated sentence here', { loc: 0, ...NEAR_HINT }),
    ).toBeNull();
  });

  it('returns null for empty inputs rather than throwing', () => {
    expect(fuzzyFind('', 'anything', { loc: 0, ...NEAR_HINT })).toBeNull();
    expect(fuzzyFind(text, '', { loc: 0, ...NEAR_HINT })).toBeNull();
  });

  it('reports the true match length when the edit was an insertion', () => {
    const haystack = 'alpha beta gamma delta epsilon zeta eta theta';
    const match = fuzzyFind(haystack, 'beta gamma delta', { loc: 6, ...NEAR_HINT });
    expect(haystack.slice(match?.start, match?.end)).toBe('beta gamma delta');
  });
});

describe('fuzzyFind — landmine 1: patterns longer than Match_MaxBits', () => {
  // 200 characters, three thirds that can each be damaged independently.
  const anchor =
    'The authentication service validates every incoming bearer token against the issuer key set ' +
    'before it forwards the request onward, and it records a structured audit entry for each ' +
    'decision it makes there.';

  const prefix = 'Some preamble sentence that sits before the anchor. ';
  const suffix = ' And a trailing sentence that follows the anchor closely.';

  it('the anchor is long enough to trigger the probe path', () => {
    expect(anchor.length).toBeGreaterThan(MATCH_MAX_BITS);
    expect(buildProbes(anchor)).toHaveLength(3);
  });

  // Damage each probe's own span in turn. A single head probe — Plan 01's original design — would
  // orphan the `head` case, which is also the single most common real edit: a reworded sentence
  // opening.
  const labels = ['head', 'middle', 'tail'] as const;
  for (const [index, label] of labels.entries()) {
    it(`locates the anchor when the ${label} probe's span is reworded away`, () => {
      const probe = buildProbes(anchor)[index];
      expect(probe).toBeDefined();
      if (!probe) return;

      const from = probe.offset;
      const to = from + probe.text.length;
      const damaged =
        anchor.slice(0, from) +
        'a reworded passage goes right here.'.slice(0, to - from) +
        anchor.slice(to);
      const haystack = prefix + damaged + suffix;

      // That probe is genuinely gone; only the other two can find this anchor.
      expect(haystack).not.toContain(probe.text);

      const match = fuzzyFind(haystack, anchor, { loc: prefix.length, ...NEAR_HINT });

      expect(match).not.toBeNull();
      expect(match?.start).toBeGreaterThanOrEqual(prefix.length - 8);
      expect(match?.start).toBeLessThanOrEqual(prefix.length + 8);
    });
  }

  it('does not throw "Pattern too long" at the 32/33 branch boundary', () => {
    for (const length of [MATCH_MAX_BITS - 1, MATCH_MAX_BITS, MATCH_MAX_BITS + 1]) {
      const exact = 'abcdefghijklmnopqrstuvwxyz0123456789'.slice(0, length);
      const haystack = `lead in ${exact} trail out`;
      expect(() => fuzzyFind(haystack, exact, { loc: 8, ...NEAR_HINT })).not.toThrow();
      expect(fuzzyFind(haystack, exact, { loc: 8, ...NEAR_HINT })?.start).toBe(8);
    }
  });

  it('handles a maximum-length (500 char) anchor', () => {
    const long = 'word '.repeat(100).trim(); // 499 chars
    const haystack = `${prefix}${long.replace('word word word', 'word other word')}${suffix}`;
    expect(() => fuzzyFind(haystack, long, { loc: prefix.length, ...NEAR_HINT })).not.toThrow();
  });
});

describe('fuzzyFind — landmine 2: whole-document search', () => {
  /** Builds a filler corpus of roughly `size` characters, deterministically. */
  function filler(size: number, seed: number): string {
    const random = mulberry32(seed);
    const words = ['system', 'request', 'handler', 'record', 'value', 'buffer', 'segment', 'index'];
    const out: string[] = [];
    let length = 0;
    while (length < size) {
      const word = words[Math.floor(random() * words.length)] ?? 'word';
      out.push(word);
      length += word.length + 1;
      if (out.length % 12 === 0) out.push('\n');
    }
    return out.join(' ');
  }

  const anchor = 'The retry budget is refilled once per calendar day at midnight UTC.';

  it('finds an edited anchor 20 KB away from its hint (the tier-4 regression guard)', () => {
    // With Match_Distance left at tier 3's 1000, a *flawless* match at offset 301 already scores
    // 0.301 and is rejected — so this test fails against the PRD as originally written.
    const edited = 'The retry budget gets refilled once per calendar day at midnight UTC.';
    const text = `${filler(20_000, 1)} ${edited} ${filler(2_000, 2)}`;

    const nearHint = fuzzyFind(text, anchor, { loc: 0, ...NEAR_HINT });
    expect(nearHint).toBeNull(); // tier 3 cannot reach it

    const anywhere = fuzzyFind(text, anchor, wholeDocument(text));
    expect(anywhere).not.toBeNull();
    expect(text.slice(anywhere?.start, anywhere?.end)).toContain('retry budget');
  });

  it('stays fast on a 600 KB document (past the literal-scan guard)', () => {
    const text = `${filler(600_000, 3)} ${anchor} tail`;
    expect(text.length).toBeGreaterThan(MAX_BITAP_SCAN_CHARS);

    const startedAt = performance.now();
    const match = fuzzyFind(text, anchor, wholeDocument(text));
    const elapsed = performance.now() - startedAt;

    expect(match).not.toBeNull();
    expect(text.slice(match?.start, match?.end)).toContain('retry budget');
    expect(elapsed).toBeLessThan(100);
  });

  it('returns null instead of hanging when no 32-char run survived on a large document', () => {
    // Above the guard, tier 4 needs at least one intact 32-character run. This anchor has none.
    const text = `${filler(600_000, 4)} The budget for retries refills daily at UTC midnight. tail`;

    const startedAt = performance.now();
    const match = fuzzyFind(text, anchor, wholeDocument(text));
    const elapsed = performance.now() - startedAt;

    expect(match).toBeNull();
    expect(elapsed).toBeLessThan(200);
  });
});

describe('fuzzyFind — determinism', () => {
  it('prefers the candidate nearest the hint when scores tie', () => {
    const unit = 'the value is stored in the primary cache layer. ';
    const text = unit.repeat(6);
    const anchor = 'value is stored in the primary cache';

    const early = fuzzyFind(text, anchor, { loc: 0, ...NEAR_HINT });
    const late = fuzzyFind(text, anchor, { loc: unit.length * 4, ...NEAR_HINT });

    expect(early?.start).toBeLessThan(late?.start ?? Infinity);
  });

  it('gives the same answer on repeated calls', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    const first = fuzzyFind(text, 'gamma delta epsilon', { loc: 10, ...NEAR_HINT });
    const second = fuzzyFind(text, 'gamma delta epsilon', { loc: 10, ...NEAR_HINT });
    expect(first).toEqual(second);
  });
});
