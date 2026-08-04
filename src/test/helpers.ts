/**
 * Test helpers. The point of these is offset assertions: nobody can eyeball-verify
 * `expect(start).toBe(147)`, so tests locate positions by the text they contain instead.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAnchor } from '../anchor/create.js';
import type { Anchor, Comment, PlainTextDoc, ReviewFile } from '../anchor/types.js';
import { renderPlainText } from '../render/plaintext.js';

/**
 * Offset of `needle` in `doc.text`.
 *
 * Throws when the needle is absent *or* appears more than once. The non-unique check is
 * deliberate: a fixture edit that accidentally duplicates a phrase would otherwise silently move
 * every test that used it onto a different occurrence.
 */
export function offsetOf(doc: PlainTextDoc, needle: string): number {
  const first = doc.text.indexOf(needle);
  if (first === -1) {
    throw new Error(`offsetOf: ${JSON.stringify(needle)} not found in document text`);
  }
  const second = doc.text.indexOf(needle, first + 1);
  if (second !== -1) {
    throw new Error(
      `offsetOf: ${JSON.stringify(needle)} appears more than once (at ${first} and ${second}); ` +
        'pick a unique phrase or use offsetOfNth',
    );
  }
  return first;
}

/** Offset of the `n`-th (0-based) occurrence of `needle`, for tests that need a repeated phrase. */
export function offsetOfNth(doc: PlainTextDoc, needle: string, n: number): number {
  let index = -1;
  for (let i = 0; i <= n; i++) {
    index = doc.text.indexOf(needle, index + 1);
    if (index === -1) {
      throw new Error(`offsetOfNth: ${JSON.stringify(needle)} has fewer than ${n + 1} occurrences`);
    }
  }
  return index;
}

/** Builds an anchor on the unique occurrence of `needle`. Throws if `createAnchor` rejects it. */
export function anchorOn(doc: PlainTextDoc, needle: string): Anchor {
  const result = createAnchor({ selectedText: needle, offset: offsetOf(doc, needle), doc });
  if (!result.ok) {
    throw new Error(`anchorOn: createAnchor rejected ${JSON.stringify(needle)} (${result.reason})`);
  }
  return result.anchor;
}

/** Builds an anchor on the `n`-th occurrence of a repeated phrase. */
export function anchorOnNth(doc: PlainTextDoc, needle: string, n: number): Anchor {
  const result = createAnchor({ selectedText: needle, offset: offsetOfNth(doc, needle, n), doc });
  if (!result.ok) {
    throw new Error(`anchorOnNth: createAnchor rejected ${JSON.stringify(needle)}`);
  }
  return result.anchor;
}

/** Shorthand for `renderPlainText`, so tests read as `docOf(md)`. */
export function docOf(markdown: string): PlainTextDoc {
  return renderPlainText(markdown);
}

/**
 * Loads a committed fixture from `docs/fixtures/`. They live there, not under `src/test/`, because
 * Plan 02 §8 uses the same documents for its manual CSP and theming passes — one artifact for both
 * phases beats two that drift apart. Resolved from the vitest root rather than `import.meta.url`,
 * which the CommonJS build target does not allow.
 */
export function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'docs', 'fixtures', name), 'utf8');
}

let commentSeq = 0;

/** A `Comment` with sensible defaults; override anything the test cares about. */
export function makeComment(anchor: Anchor, overrides: Partial<Comment> = {}): Comment {
  commentSeq += 1;
  return {
    id: `c${String(commentSeq).padStart(3, '0')}`,
    body: 'test comment',
    author: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    anchor,
    ...overrides,
  };
}

export function makeReviewFile(comments: Comment[], overrides: Partial<ReviewFile> = {}): ReviewFile {
  return {
    version: 1,
    targetPath: 'docs/test.md',
    comments,
    ...overrides,
  };
}

/** A fixed clock for `reanchor`, so `detectedAt` is deterministic. */
export function fixedClock(iso = '2026-06-01T12:00:00.000Z'): () => string {
  return () => iso;
}

/**
 * Seeded PRNG. The performance corpus must be byte-identical from run to run — a corpus that
 * varies gives a timing distribution that varies, which *is* the flakiness we are trying to avoid.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
