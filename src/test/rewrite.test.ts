/**
 * When the "document was rewritten" banner fires (PRD §11).
 *
 * The interesting cases are all about *not* firing: a banner that cries wolf on a single deleted
 * sentence, or re-appears on every keystroke after the damage is done, is one the user learns to
 * dismiss without reading.
 */

import { describe, expect, it } from 'vitest';
import type { Comment, CommentStatus, ReviewFile } from '../anchor/types.js';
import { detectRewrite } from '../detect/rewrite.js';

const BASELINE = 'the document as it stood when the prompt was copied';

function comment(id: string, status: CommentStatus): Comment {
  return {
    id,
    body: `comment ${id}`,
    author: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    status,
    anchor: { exact: `anchor ${id}`, prefix: '', suffix: '', hintLine: 0, hintOffset: 0 },
  };
}

function review(statuses: Record<string, CommentStatus>, baselineText = BASELINE): ReviewFile {
  const file: ReviewFile = {
    version: 1,
    targetPath: 'docs/auth.md',
    comments: Object.entries(statuses).map(([id, status]) => comment(id, status)),
  };
  return baselineText.length > 0 ? { ...file, baselineText } : file;
}

describe('detectRewrite', () => {
  it('fires when every previously-located comment is lost in one pass', () => {
    const before = review({ a: 'open', b: 'open' });
    const after = review({ a: 'orphaned', b: 'orphaned' });

    expect(detectRewrite(before, after)).toEqual({ rewritten: true, orphaned: 2 });
  });

  it('counts an addressed comment as a candidate — it was located too', () => {
    const before = review({ a: 'open', b: 'addressed', c: 'open' });
    const after = review({ a: 'orphaned', b: 'orphaned', c: 'orphaned' });

    expect(detectRewrite(before, after)).toEqual({ rewritten: true, orphaned: 3 });
  });

  it('ignores resolved comments entirely, since they are terminal', () => {
    const before = review({ a: 'open', b: 'open', c: 'resolved' });
    const after = review({ a: 'orphaned', b: 'orphaned', c: 'resolved' });

    expect(detectRewrite(before, after)).toEqual({ rewritten: true, orphaned: 2 });
  });

  it('does not fire for a single lost comment', () => {
    const before = review({ a: 'open' });
    const after = review({ a: 'orphaned' });

    // One deleted sentence is ordinary editing; the orphan section already covers it.
    expect(detectRewrite(before, after)).toEqual({ rewritten: false, orphaned: 0 });
  });

  it('does not fire when a comment survived', () => {
    const before = review({ a: 'open', b: 'open', c: 'open' });
    const after = review({ a: 'orphaned', b: 'orphaned', c: 'open' });

    expect(detectRewrite(before, after).rewritten).toBe(false);
  });

  it('does not fire without a baseline to diff against', () => {
    const before = review({ a: 'open', b: 'open' }, '');
    const after = review({ a: 'orphaned', b: 'orphaned' }, '');

    expect(detectRewrite(before, after).rewritten).toBe(false);
  });

  it('treats an empty-string baseline as no baseline', () => {
    const before = review({ a: 'open', b: 'open' });
    const after: ReviewFile = { ...review({ a: 'orphaned', b: 'orphaned' }), baselineText: '' };

    expect(detectRewrite(before, after).rewritten).toBe(false);
  });

  it('does not re-arm on a document that was already wrecked', () => {
    // The pass that did the damage already fired. Every later pass sees orphan → orphan, and there
    // are no candidates left, so the banner stays gone until something is located again.
    const before = review({ a: 'orphaned', b: 'orphaned' });
    const after = review({ a: 'orphaned', b: 'orphaned' });

    expect(detectRewrite(before, after)).toEqual({ rewritten: false, orphaned: 0 });
  });

  it('does not fire when only one comment was still located', () => {
    const before = review({ a: 'open', b: 'orphaned', c: 'orphaned' });
    const after = review({ a: 'orphaned', b: 'orphaned', c: 'orphaned' });

    // Three orphans in `after`, but only one of them was lost *now*.
    expect(detectRewrite(before, after).rewritten).toBe(false);
  });

  it('does not fire on an empty review', () => {
    expect(detectRewrite(review({}), review({})).rewritten).toBe(false);
  });

  it('matches comments by id, not by position', () => {
    const before = review({ a: 'open', b: 'open' });
    const after: ReviewFile = {
      ...before,
      comments: [comment('b', 'orphaned'), comment('a', 'orphaned')],
    };

    expect(detectRewrite(before, after)).toEqual({ rewritten: true, orphaned: 2 });
  });

  it('does not fire when a candidate vanished from the file rather than orphaning', () => {
    // A comment the user deleted mid-pass is not evidence of a rewrite.
    const before = review({ a: 'open', b: 'open' });
    const after = review({ a: 'orphaned' });

    expect(detectRewrite(before, after).rewritten).toBe(false);
  });
});
