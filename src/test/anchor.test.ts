/**
 * `createAnchor` and the `locate` confidence cascade.
 *
 * Every row of the PRD §5 required test matrix is covered here or in `reanchor.test.ts`; each is
 * named after the row it satisfies.
 */

import { describe, expect, it } from 'vitest';
import { createAnchor } from '../anchor/create.js';
import { locate } from '../anchor/locate.js';
import {
  CONFIDENCE,
  MAX_ANCHOR_LENGTH,
  MIN_ANCHOR_LENGTH,
  UNCERTAIN_BELOW,
  type Anchor,
} from '../anchor/types.js';
import { renderPlainText } from '../render/plaintext.js';
import { anchorOn, anchorOnNth, docOf, offsetOf, offsetOfNth, readFixture } from './helpers.js';

const KITCHEN_SINK = readFixture('kitchen-sink.md');

describe('createAnchor — validation', () => {
  const doc = docOf('Some reasonably long paragraph of prose to anchor into.\n');

  it('rejects selections shorter than the minimum', () => {
    const result = createAnchor({ selectedText: 'ab', offset: 0, doc });
    expect(result).toEqual({ ok: false, reason: 'too-short' });
    expect(MIN_ANCHOR_LENGTH).toBe(3);
  });

  it('accepts a selection exactly at the minimum', () => {
    expect(createAnchor({ selectedText: 'Som', offset: 0, doc }).ok).toBe(true);
  });

  it('rejects selections longer than the maximum', () => {
    const long = 'x'.repeat(MAX_ANCHOR_LENGTH + 1);
    expect(createAnchor({ selectedText: long, offset: 0, doc })).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });

  it('accepts a selection exactly at the maximum', () => {
    const atLimit = 'x'.repeat(MAX_ANCHOR_LENGTH);
    expect(createAnchor({ selectedText: atLimit, offset: 0, doc }).ok).toBe(true);
  });

  it('measures length after normalization, not before', () => {
    // Whitespace-padded selection normalizes down to 3 characters.
    expect(createAnchor({ selectedText: '  a  b  ', offset: 0, doc }).ok).toBe(true);
  });
});

describe('createAnchor — anchor contents', () => {
  const doc = docOf('# Title\n\nThe quick brown fox jumps over the lazy dog by the river.\n');

  it('captures up to 32 characters of context on each side', () => {
    const anchor = anchorOn(doc, 'jumps over');
    expect(anchor.exact).toBe('jumps over');
    expect(anchor.prefix).toBe('Title\nThe quick brown fox ');
    expect(anchor.suffix).toBe(' the lazy dog by the river.');
    expect(anchor.prefix.length).toBeLessThanOrEqual(32);
    expect(anchor.suffix.length).toBeLessThanOrEqual(32);
  });

  it('takes shorter context at document edges', () => {
    const anchor = anchorOn(doc, 'Title');
    expect(anchor.prefix).toBe('');
    expect(anchor.suffix.length).toBeGreaterThan(0);
  });

  it('records hintOffset and hintLine', () => {
    const anchor = anchorOn(doc, 'brown fox');
    expect(anchor.hintOffset).toBe(offsetOf(doc, 'brown fox'));
    expect(anchor.hintLine).toBe(2);
  });

  it('never splits a surrogate pair when slicing context', () => {
    const emoji = docOf(`${'👨‍👩‍👧'.repeat(30)}ANCHOR${'🚀'.repeat(30)}\n`);
    const anchor = anchorOn(emoji, 'ANCHOR');

    for (const side of [anchor.prefix, anchor.suffix]) {
      expect(/[\uD800-\uDBFF]$/.test(side)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(side)).toBe(false);
    }
    // The round trip still locates, which is the point of the snapping.
    expect(locate(anchor, emoji)?.confidence).toBe(CONFIDENCE.EXACT_WITH_CONTEXT);
  });

  it('falls back to hintLine when the caller could not map an offset', () => {
    const multi = docOf('First para.\n\nSecond para.\n\nThird para.\n');
    const result = createAnchor({ selectedText: 'Second para.', offset: -1, doc: multi, hintLine: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchor.hintOffset).toBe(offsetOf(multi, 'Second para.'));
  });
});

describe('locate — tier 1: exact with context (1.0)', () => {
  it('finds a unique passage', () => {
    const doc = docOf('# Doc\n\nThe retry budget refills at midnight.\n\nUnrelated closing line.\n');
    const anchor = anchorOn(doc, 'retry budget refills');

    expect(locate(anchor, doc)).toEqual({
      start: offsetOf(doc, 'retry budget refills'),
      end: offsetOf(doc, 'retry budget refills') + 'retry budget refills'.length,
      confidence: CONFIDENCE.EXACT_WITH_CONTEXT,
    });
  });

  it('disambiguates repeated identical phrases by prefix and suffix', () => {
    const doc = docOf(
      'Alpha section: the value is cached.\n\nBeta section: the value is cached.\n',
    );
    const anchor = anchorOnNth(doc, 'the value is cached', 1);

    const found = locate(anchor, doc);
    expect(found?.confidence).toBe(CONFIDENCE.EXACT_WITH_CONTEXT);
    expect(found?.start).toBe(offsetOfNth(doc, 'the value is cached', 1));
  });

  it('survives content inserted above it (line numbers shift, anchor does not)', () => {
    const paragraph = 'The retry budget refills at midnight every day.';
    const before = docOf(`# Doc\n\nSome existing lead-in text.\n\n${paragraph}\n\nAnd a closing line.\n`);
    const anchor = anchorOn(before, 'retry budget refills');

    const after = docOf(
      `# Doc\n\nA brand new paragraph.\n\nAnd another one.\n\nSome existing lead-in text.\n\n${paragraph}\n\nAnd a closing line.\n`,
    );
    const found = locate(anchor, after);

    // The surrounding context moved with it, so this is still a full-context match.
    expect(found?.confidence).toBe(CONFIDENCE.EXACT_WITH_CONTEXT);
    expect(after.text.slice(found?.start, found?.end)).toBe('retry budget refills');
    expect(found?.start).not.toBe(anchor.hintOffset);
  });

  it('survives insertion above even when the local context is also rewritten (drops to 0.9)', () => {
    const before = docOf('# Doc\n\nThe retry budget refills at midnight.\n');
    const anchor = anchorOn(before, 'retry budget refills at midnight');

    const after = docOf('# Doc\n\nA brand new paragraph.\n\nThe retry budget refills at midnight.\n');
    const found = locate(anchor, after);

    expect(found?.confidence).toBe(CONFIDENCE.EXACT_UNIQUE);
    expect(after.text.slice(found?.start, found?.end)).toBe('retry budget refills at midnight');
  });

  it('holds at 1.0 when the full context itself repeats — context did match', () => {
    const unit = 'Lead in. The value is cached. Trail out.\n\n';
    const doc = docOf(unit.repeat(3));
    const anchor = anchorOnNth(doc, 'The value is cached', 1);

    const found = locate(anchor, doc);
    expect(found?.confidence).toBe(CONFIDENCE.EXACT_WITH_CONTEXT);
    expect(found?.start).toBe(offsetOfNth(doc, 'The value is cached', 1));
  });
});

describe('locate — tier 2: exact only (0.9 / 0.7)', () => {
  it('reports 0.9 for a unique passage whose context changed', () => {
    const before = docOf('Original lead in. The retry budget refills at midnight. Original trail.\n');
    const anchor = anchorOn(before, 'The retry budget refills at midnight');

    const after = docOf('Completely different lead. The retry budget refills at midnight. New trail.\n');
    const found = locate(anchor, after);

    expect(found?.confidence).toBe(CONFIDENCE.EXACT_UNIQUE);
    expect(after.text.slice(found?.start, found?.end)).toBe('The retry budget refills at midnight');
  });

  it('reports 0.9 — not 1.0 — for an anchor with no context at all', () => {
    // A whole-document anchor has empty prefix and suffix. Tier 1 must be skipped, or it would
    // claim "full context matched" for an anchor that has none.
    const doc = docOf('Just one short line.\n');
    const anchor = anchorOn(doc, 'Just one short line.');

    expect(anchor.prefix).toBe('');
    expect(anchor.suffix).toBe('');
    expect(locate(anchor, doc)?.confidence).toBe(CONFIDENCE.EXACT_UNIQUE);
  });

  it('reports 0.7 when the phrase repeats and the context is gone, picking the nearest to the hint', () => {
    const before = docOf(
      'Alpha lead. The value is cached. Alpha trail.\n\nBeta lead. The value is cached. Beta trail.\n',
    );
    const anchor = anchorOnNth(before, 'The value is cached', 1);

    // Rewrite both surrounding contexts so tier 1 cannot fire, leaving two bare occurrences.
    const after = docOf('One. The value is cached. Two.\n\nThree. The value is cached. Four.\n');
    const found = locate(anchor, after);

    expect(found?.confidence).toBe(CONFIDENCE.EXACT_NEAREST);
    expect(found?.start).toBe(offsetOfNth(after, 'The value is cached', 1));
  });
});

describe('locate — tier 3: fuzzy near the hint (0.5)', () => {
  it('locates a lightly reworded sentence', () => {
    const before = docOf('# Doc\n\nThe retry budget is refilled once per calendar day.\n\nTail.\n');
    const anchor = anchorOn(before, 'The retry budget is refilled once per calendar day.');

    const after = docOf('# Doc\n\nThe retry budget gets refilled once per calendar day.\n\nTail.\n');
    const found = locate(anchor, after);

    expect(found?.confidence).toBe(CONFIDENCE.FUZZY_NEAR_HINT);
    expect(after.text.slice(found?.start, found?.end)).toContain('retry budget');
  });

  it('reports a confidence the UI must flag as uncertain', () => {
    expect(CONFIDENCE.FUZZY_NEAR_HINT).toBeGreaterThanOrEqual(UNCERTAIN_BELOW);
    expect(CONFIDENCE.FUZZY_DOCUMENT).toBeLessThan(UNCERTAIN_BELOW);
  });
});

describe('locate — tier 4: fuzzy whole document (0.3)', () => {
  it('finds an edited anchor that also moved far from its hint', () => {
    const filler = Array.from(
      { length: 120 },
      (_, i) => `Filler paragraph number ${String(i)} with enough words to add real distance.`,
    ).join('\n\n');

    const before = docOf(`The retry budget is refilled once per calendar day.\n\n${filler}\n`);
    const anchor = anchorOn(before, 'The retry budget is refilled once per calendar day.');

    // Moved to the very end *and* reworded: tier 1 and 2 fail on the wording, tier 3 on the
    // distance. Only a genuine whole-document pass can find it.
    const after = docOf(`${filler}\n\nThe retry budget gets refilled once per calendar day.\n`);
    const found = locate(anchor, after);

    expect(found?.confidence).toBe(CONFIDENCE.FUZZY_DOCUMENT);
    expect(after.text.slice(found?.start, found?.end)).toContain('retry budget');
  });
});

describe('locate — tier 5: null', () => {
  it('returns null when the anchored sentence was deleted entirely', () => {
    const before = docOf('# Doc\n\nThe retry budget refills at midnight.\n\nAnother line.\n');
    const anchor = anchorOn(before, 'The retry budget refills at midnight.');

    const after = docOf('# Doc\n\nAnother line.\n');
    expect(locate(anchor, after)).toBeNull();
  });

  it('returns null against a document rewritten from scratch, without throwing', () => {
    const before = docOf('# Auth\n\nTokens are validated at the edge of the mesh.\n');
    const anchor = anchorOn(before, 'Tokens are validated at the edge of the mesh.');

    const after = docOf('# Billing\n\nInvoices are generated on the first of the month.\n');
    expect(() => locate(anchor, after)).not.toThrow();
    expect(locate(anchor, after)).toBeNull();
  });

  it('returns null against an empty document', () => {
    const before = docOf('Some prose to anchor into here.\n');
    const anchor = anchorOn(before, 'prose to anchor');
    expect(locate(anchor, docOf(''))).toBeNull();
  });

  it('returns null against a document containing only front matter', () => {
    const before = docOf('Some prose to anchor into here.\n');
    const anchor = anchorOn(before, 'prose to anchor');
    expect(locate(anchor, docOf('---\ntitle: x\n---\n'))).toBeNull();
  });
});

describe('locate — anchors across markdown constructs (kitchen sink)', () => {
  const doc = renderPlainText(KITCHEN_SINK);

  const cases: Array<[string, string]> = [
    ['a markdown link (renders as its label)', 'See the auth guide for the full flow'],
    ['inline code and bold', 'It writes a structured audit entry for each decision'],
    ['a table cell', 'Expiry, seconds since epoch'],
    ['a fenced code block', 'const key = keys.find(header.kid);'],
    ['a heading', 'Nested lists'],
    ['a nested list item', 'Network egress to the token endpoint'],
    ['a task list item', 'Document the rotation procedure'],
    ['a nested blockquote', 'Nested quotes are rendered as a distinct level.'],
    ['image alt text', 'Emphasised alt text'],
    ['CJK text', '認証サービスはすべてのトークンを検証します。'],
    ['an emoji ZWJ sequence', 'a ZWJ sequence: 👨‍👩‍👧'],
    ['RTL text', 'مرحبا بالعالم'],
  ];

  for (const [label, needle] of cases) {
    it(`anchors ${label}`, () => {
      const anchor = anchorOn(doc, needle);
      const found = locate(anchor, doc);

      expect(found?.confidence).toBeGreaterThanOrEqual(CONFIDENCE.EXACT_UNIQUE);
      expect(doc.text.slice(found?.start, found?.end)).toBe(needle);
    });
  }

  it('preserves code content verbatim rather than normalizing it', () => {
    expect(doc.text).toContain('keeps    its    interior    spacing.');
  });

  it('never leaks synthesised markup into anchor space', () => {
    // `markdown-it-task-lists` injects an `<input>` token even with `html: false`. That element is
    // ours, not the author's, so it must not appear in anchor space.
    expect(doc.text).not.toContain('<input');

    // The author's own raw HTML is a different matter: with `html: false` it renders as inert
    // literal text, so the reader sees those characters and they belong in anchor space as text.
    expect(doc.text).toContain("<script>alert('xss')</script>");
    expect(doc.text).toContain('<img src=x onerror="alert(\'xss\')">');
  });

  it('front matter contributes nothing to anchor space but keeps line numbers honest', () => {
    expect(doc.text).not.toContain('platform-team');
    // '---', title, owner, tags, '---' = 5 lines consumed.
    expect(doc.frontMatterLineOffset).toBe(5);

    const heading = doc.blocks[0];
    expect(heading?.sourceLineStart).toBe(6);
    expect(KITCHEN_SINK.split('\n')[6]).toBe('# Kitchen Sink');
  });
});

describe('locate — determinism', () => {
  it('breaks ties to the earlier occurrence', () => {
    const doc = docOf('cached value here. cached value here. cached value here.\n');
    const anchor: Anchor = {
      exact: 'cached value here',
      prefix: '',
      suffix: '',
      hintLine: 0,
      hintOffset: 0,
    };
    expect(locate(anchor, doc)?.start).toBe(0);
  });
});
