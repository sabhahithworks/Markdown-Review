/**
 * Sidecar validation (Plan 03 §3).
 *
 * The sidecar is a file the PRD invites the user to hand-edit, so these tests are mostly hostile
 * input. The governing rule (PRD §11) is *fail soft, never silently drop data*: a bad file is
 * rejected wholesale so the caller can back up every byte, rather than partially resurrected.
 */

import { describe, expect, it } from 'vitest';
import type { Comment, ReviewFile } from '../anchor/types.js';
import {
  SIDECAR_VERSION,
  emptyReviewFile,
  isComment,
  isReviewFile,
  parseReviewFile,
  serializeReviewFile,
} from '../store/reviewFile.js';

const ANCHOR = { exact: 'hello', prefix: 'a', suffix: 'b', hintLine: 3, hintOffset: 12 };

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'abc12345',
    body: 'needs work',
    author: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    anchor: { ...ANCHOR },
    ...overrides,
  };
}

function review(overrides: Partial<ReviewFile> = {}): ReviewFile {
  return { version: 1, targetPath: 'docs/a.md', comments: [comment()], ...overrides };
}

describe('parseReviewFile — happy path', () => {
  it('round-trips what serializeReviewFile writes', () => {
    const original = review({ baselineText: 'text', baselineAt: '2026-01-02T00:00:00.000Z' });
    const result = parseReviewFile(serializeReviewFile(original));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.review).toEqual(original);
  });

  it('accepts a comment carrying a resolution', () => {
    const withResolution = review({
      comments: [
        comment({
          status: 'addressed',
          resolution: { previousText: 'a', currentText: 'b', detectedAt: '2026-01-03T00:00:00Z' },
        }),
      ],
    });
    expect(parseReviewFile(serializeReviewFile(withResolution)).ok).toBe(true);
  });

  it('accepts a sidecar with promptOrder', () => {
    const withOrder = review({ promptOrder: ['b', 'a'] });
    const result = parseReviewFile(serializeReviewFile(withOrder));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.review.promptOrder).toEqual(['b', 'a']);
  });

  it('accepts an empty comment list', () => {
    expect(parseReviewFile(serializeReviewFile(emptyReviewFile('a.md'))).ok).toBe(true);
  });
});

describe('parseReviewFile — rejection reasons', () => {
  it('reports unparseable JSON', () => {
    const result = parseReviewFile('{ "version": 1, ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unparseable');
  });

  it('reports an empty file as unparseable', () => {
    const result = parseReviewFile('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unparseable');
  });

  it('reports a future version distinctly, so the message can say so', () => {
    // PRD §11: version skew must be refused and explained, never silently dropped.
    const result = parseReviewFile(JSON.stringify({ ...review(), version: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-version');
      expect(result.detail).toContain('2');
    }
  });

  it.each([
    ['a JSON array', '[]'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
    ['a missing version', JSON.stringify({ targetPath: 'a.md', comments: [] })],
    ['a non-string targetPath', JSON.stringify({ version: 1, targetPath: 7, comments: [] })],
    ['comments as an object', JSON.stringify({ version: 1, targetPath: 'a.md', comments: {} })],
    ['a non-string baselineText', JSON.stringify({ ...review(), baselineText: 5 })],
  ])('rejects %s as invalid shape', (_label, raw) => {
    const result = parseReviewFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-shape');
  });

  it('rejects the whole file when a single comment is malformed', () => {
    // Deliberate: dropping just the bad entry would discard the user's data silently. The caller
    // backs the file up instead.
    const raw = JSON.stringify({
      version: 1,
      targetPath: 'a.md',
      comments: [comment(), { id: 'x', body: 'no anchor' }],
    });
    const result = parseReviewFile(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-shape');
  });

  it('rejects a malformed promptOrder', () => {
    for (const promptOrder of [[1], 'a']) {
      const raw = JSON.stringify({ version: 1, targetPath: 'a.md', comments: [], promptOrder });
      const result = parseReviewFile(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid-shape');
    }
  });

  it('rejects duplicate comment ids', () => {
    const raw = JSON.stringify({
      version: 1,
      targetPath: 'a.md',
      comments: [comment({ id: 'same' }), comment({ id: 'same' })],
    });
    expect(parseReviewFile(raw).ok).toBe(false);
  });
});

describe('isComment', () => {
  it('accepts a well-formed comment', () => {
    expect(isComment(comment())).toBe(true);
  });

  it.each([
    ['an unknown status', comment({ status: 'wontfix' as Comment['status'] })],
    ['an empty id', comment({ id: '' })],
    ['a missing anchor', { ...comment(), anchor: undefined }],
    ['a NaN hintOffset', { ...comment(), anchor: { ...ANCHOR, hintOffset: Number.NaN } }],
    ['an Infinity hintLine', { ...comment(), anchor: { ...ANCHOR, hintLine: Number.POSITIVE_INFINITY } }],
    ['a numeric body', comment({ body: 3 as unknown as string })],
    ['a malformed resolution', { ...comment(), resolution: { previousText: 'a' } }],
  ])('rejects %s', (_label, value) => {
    expect(isComment(value)).toBe(false);
  });
});

describe('serializeReviewFile', () => {
  it('pretty-prints with a 2-space indent and a trailing newline', () => {
    // PRD §4 requires the sidecar be human-readable and hand-editable.
    const text = serializeReviewFile(emptyReviewFile('a.md'));
    expect(text).toBe('{\n  "version": 1,\n  "targetPath": "a.md",\n  "comments": []\n}\n');
  });
});

describe('isReviewFile', () => {
  it('pins the version this build writes', () => {
    expect(SIDECAR_VERSION).toBe(1);
    expect(isReviewFile(review())).toBe(true);
    expect(isReviewFile({ ...review(), version: 2 })).toBe(false);
  });
});
