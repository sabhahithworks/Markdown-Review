/**
 * What region a comment is about (D17).
 *
 * The load-bearing case is the *partial* heading: the comment that produced D17 selected a heading
 * without its manual `2. ` numbering, and the old exact-span-equality rule therefore treated it as
 * a comment about 52 characters of text rather than about a section. Everything else here exists to
 * pin the boundaries of that widening, because "an anchor near a heading means the whole section"
 * is exactly the kind of rule that quietly swallows the rest of the document.
 */

import { describe, expect, it } from 'vitest';
import type { BlockSpan, PlainTextDoc } from '../anchor/types.js';
import type { TextRange } from '../detect/scope.js';
import { scopeOf } from '../detect/scope.js';
import { docOf, offsetOf } from './helpers.js';

const DOC = `# Title

Intro paragraph, before any section.

## Alpha

First paragraph of alpha.

Second paragraph of alpha.

### Alpha nested

Nested prose under alpha.

## Beta

| Field | Notes |
| --- | --- |
| sub | subject identifier |

- first list item
- second list item

\`\`\`ts
const answer = 42;
\`\`\`

## Omega`;

const doc = docOf(DOC);

/** The range of `needle`. */
function at(needle: string): TextRange {
  const start = offsetOf(doc, needle);
  return { start, end: start + needle.length };
}

/**
 * The range of the first `length` characters of `needle` — for anchors that cover only part of a
 * block, where the block's own text is not unique enough to find on its own.
 */
function head(needle: string, length: number): TextRange {
  const start = offsetOf(doc, needle);
  return { start, end: start + length };
}

/** The text a scope covers, so assertions read as prose rather than as offsets. */
function textOf(scope: TextRange | null, source: PlainTextDoc = doc): string {
  if (!scope) throw new Error('expected a scope');
  return source.text.slice(scope.start, scope.end);
}

/** `## Alpha`'s heading text, which "Alpha nested" would otherwise make ambiguous. */
const ALPHA_HEADING = head('Alpha\nFirst paragraph', 'Alpha'.length);

describe('scopeOf — headings', () => {
  it('treats an anchor covering a whole heading as its section', () => {
    const scope = scopeOf(doc, at('Alpha nested'));

    expect(scope?.kind).toBe('section');
    expect(scope?.headingLevel).toBe(3);
    expect(textOf(scope)).toBe('Alpha nested\nNested prose under alpha.');
  });

  it('treats a *partial* heading as its section — the D17 case', () => {
    // Six characters of a twelve-character heading. Selecting a heading without its leading
    // numbering or marker is the natural gesture, and it must not demote the comment to text scope.
    const scope = scopeOf(doc, at('nested'));

    expect(scope?.kind).toBe('section');
    expect(scope?.headingLevel).toBe(3);
    expect(textOf(scope)).toBe('Alpha nested\nNested prose under alpha.');
  });

  it('runs a section through its own sub-headings, stopping at the next peer', () => {
    const scope = scopeOf(doc, ALPHA_HEADING);

    expect(scope?.kind).toBe('section');
    expect(scope?.headingLevel).toBe(2);
    // `### Alpha nested` is inside `## Alpha`; `## Beta` ends it.
    expect(textOf(scope)).toContain('Alpha nested');
    expect(textOf(scope)).toContain('Nested prose under alpha.');
    expect(textOf(scope)).not.toContain('subject identifier');
  });

  it('ends a section at the last block, never on a joiner', () => {
    const scope = scopeOf(doc, ALPHA_HEADING);

    expect(textOf(scope).endsWith('Nested prose under alpha.')).toBe(true);
  });

  it('runs the last section to the end of the document', () => {
    const scope = scopeOf(doc, at('Omega'));

    expect(scope?.kind).toBe('section');
    expect(scope?.end).toBe(doc.text.length);
    expect(textOf(scope)).toBe('Omega');
  });

  it('falls back to block scope when the anchor leaves the heading', () => {
    // Spanning the joiner from the heading into the prose below is no longer a claim about scope.
    // The union stops at the `Field` header *cell*, not the whole row: cells are their own blocks.
    const scope = scopeOf(doc, at('Beta\nField'));

    expect(scope?.kind).toBe('block');
    expect(textOf(scope)).toBe('Beta\nField');
  });

  it('ends an unlevelled heading at the very next heading of any level', () => {
    // A missing `headingLevel` would be a `walkSpans` bug. The narrowest reading is the safe one:
    // an over-wide section reports changes that had nothing to do with the comment.
    const blocks: BlockSpan[] = doc.blocks.map((block) => {
      const isAlpha = block.kind === 'heading' && doc.text.slice(block.start, block.end) === 'Alpha';
      if (!isAlpha) return block;
      return {
        start: block.start,
        end: block.end,
        sourceLineStart: block.sourceLineStart,
        sourceLineEnd: block.sourceLineEnd,
        kind: block.kind,
      };
    });
    const patched: PlainTextDoc = { ...doc, blocks };

    const scope = scopeOf(patched, ALPHA_HEADING);

    expect(scope?.kind).toBe('section');
    expect(scope?.headingLevel).toBeUndefined();
    // Stops at `### Alpha nested` rather than running on to `## Beta`.
    expect(textOf(scope, patched)).toBe(
      'Alpha\nFirst paragraph of alpha.\nSecond paragraph of alpha.',
    );
  });
});

describe('scopeOf — blocks', () => {
  it('scopes an anchor inside a paragraph to that paragraph', () => {
    const scope = scopeOf(doc, at('First paragraph of alpha'));

    expect(scope?.kind).toBe('block');
    expect(textOf(scope)).toBe('First paragraph of alpha.');
  });

  it('unions the blocks an anchor spans', () => {
    const scope = scopeOf(doc, at('alpha.\nSecond paragraph'));

    expect(scope?.kind).toBe('block');
    expect(textOf(scope)).toBe('First paragraph of alpha.\nSecond paragraph of alpha.');
  });

  it('scopes a table cell to the cell, not the table', () => {
    const scope = scopeOf(doc, at('subject identifier'));

    expect(scope?.kind).toBe('block');
    expect(textOf(scope)).toBe('subject identifier');
  });

  it('scopes a list item to the item', () => {
    const scope = scopeOf(doc, at('second list item'));

    expect(scope?.kind).toBe('block');
    expect(textOf(scope)).toBe('second list item');
  });

  it('scopes an anchor inside a fence to the whole fence', () => {
    const scope = scopeOf(doc, at('answer = 42'));

    expect(scope?.kind).toBe('block');
    expect(textOf(scope)).toBe('const answer = 42;');
  });
});

describe('scopeOf — degenerate input', () => {
  it('returns null for a document with no blocks', () => {
    expect(scopeOf({ text: '', blocks: [], frontMatterLineOffset: 0 }, { start: 0, end: 3 })).toBe(
      null,
    );
  });

  it('returns null when the range starts past the last block', () => {
    expect(scopeOf(doc, { start: doc.text.length + 50, end: doc.text.length + 60 })).toBe(null);
  });

  it('handles a zero-width range, which a hand-edited sidecar can produce', () => {
    const start = offsetOf(doc, 'Intro paragraph');
    const scope = scopeOf(doc, { start, end: start });

    expect(textOf(scope)).toBe('Intro paragraph, before any section.');
  });

  it('clamps a range that runs past the end of the document', () => {
    const start = offsetOf(doc, 'Omega');
    const scope = scopeOf(doc, { start, end: doc.text.length + 999 });

    expect(scope?.end).toBe(doc.text.length);
  });
});
