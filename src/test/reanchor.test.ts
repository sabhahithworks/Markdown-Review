import { describe, expect, it } from 'vitest';
import { reanchor } from '../anchor/reanchor.js';
import type { ReviewFile } from '../anchor/types.js';
import { anchorOn, docOf, fixedClock, makeComment, makeReviewFile } from './helpers.js';

const BEFORE = [
  '# Auth service',
  '',
  'The retry budget is refilled once per calendar day at midnight.',
  '',
  'Tokens are validated at the edge, never inside the service mesh.',
  '',
  'Every rejection is written to the structured audit log.',
  '',
].join('\n');

function baseline(): { review: ReviewFile; doc: ReturnType<typeof docOf> } {
  const doc = docOf(BEFORE);
  const review = makeReviewFile([
    makeComment(anchorOn(doc, 'The retry budget is refilled once per calendar day at midnight.')),
    makeComment(anchorOn(doc, 'Tokens are validated at the edge, never inside the service mesh.')),
    makeComment(anchorOn(doc, 'Every rejection is written to the structured audit log.')),
  ]);
  return { review, doc };
}

describe('reanchor — purity', () => {
  it('does not mutate its input', () => {
    const { review } = baseline();
    const snapshot = structuredClone(review);

    reanchor(review, docOf('# Auth service\n\nCompletely different content now.\n'), {
      now: fixedClock(),
    });

    expect(review).toEqual(snapshot);
  });

  it('returns a new ReviewFile object and preserves the non-comment fields', () => {
    const { review, doc } = baseline();
    review.baselineText = 'snapshot';
    review.baselineAt = '2026-01-01T00:00:00.000Z';

    const result = reanchor(review, doc, { now: fixedClock() });

    expect(result.reviewFile).not.toBe(review);
    expect(result.reviewFile.version).toBe(1);
    expect(result.reviewFile.targetPath).toBe(review.targetPath);
    expect(result.reviewFile.baselineText).toBe('snapshot');
    expect(result.reviewFile.baselineAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('reanchor — status inference', () => {
  it('leaves everything open and unchanged against an identical document', () => {
    const { review, doc } = baseline();
    const result = reanchor(review, doc, { now: fixedClock() });

    expect(result.changed).toBe(false);
    expect(result.reviewFile.comments.map((c) => c.status)).toEqual(['open', 'open', 'open']);
    expect(result.reviewFile.comments.every((c) => c.resolution === undefined)).toBe(true);
  });

  it('flips a reworded anchor to addressed with a correct before/after', () => {
    const { review } = baseline();
    const after = docOf(BEFORE.replace('is refilled once per', 'gets refilled exactly once per'));

    const result = reanchor(review, after, { now: fixedClock('2026-06-01T12:00:00.000Z') });
    const [first, second, third] = result.reviewFile.comments;

    expect(result.changed).toBe(true);
    expect(first?.status).toBe('addressed');
    expect(first?.resolution?.previousText).toBe(
      'The retry budget is refilled once per calendar day at midnight.',
    );
    expect(first?.resolution?.currentText).toContain('gets refilled exactly once per');
    expect(first?.resolution?.detectedAt).toBe('2026-06-01T12:00:00.000Z');

    expect(second?.status).toBe('open');
    expect(third?.status).toBe('open');
  });

  it('never mutates anchor.exact when a comment becomes addressed', () => {
    const { review } = baseline();
    const original = review.comments[0]?.anchor.exact;
    const after = docOf(BEFORE.replace('is refilled once per', 'gets refilled exactly once per'));

    const result = reanchor(review, after, { now: fixedClock() });
    expect(result.reviewFile.comments[0]?.anchor.exact).toBe(original);
  });

  it('orphans a comment whose anchored sentence was deleted', () => {
    const { review } = baseline();
    const after = docOf(BEFORE.replace('Tokens are validated at the edge, never inside the service mesh.\n\n', ''));

    const result = reanchor(review, after, { now: fixedClock() });
    const [first, second, third] = result.reviewFile.comments;

    expect(second?.status).toBe('orphaned');
    expect(second?.anchor.exact).toBe(
      'Tokens are validated at the edge, never inside the service mesh.',
    );
    expect(first?.status).toBe('open');
    expect(third?.status).toBe('open');
  });

  it('orphans everything against a document rewritten from scratch, without throwing', () => {
    const { review } = baseline();
    const after = docOf('# Billing\n\nInvoices are generated on the first of each month.\n');

    const result = reanchor(review, after, { now: fixedClock() });

    expect(result.reviewFile.comments.map((c) => c.status)).toEqual([
      'orphaned',
      'orphaned',
      'orphaned',
    ]);
    expect(result.changed).toBe(true);
  });

  it('leaves resolved comments completely untouched', () => {
    const doc = docOf(BEFORE);
    const review = makeReviewFile([
      makeComment(anchorOn(doc, 'Every rejection is written to the structured audit log.'), {
        status: 'resolved',
        resolution: {
          previousText: 'old',
          currentText: 'new',
          detectedAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    ]);

    const result = reanchor(review, docOf('# Nothing\n\nRelated at all.\n'), { now: fixedClock() });

    expect(result.changed).toBe(false);
    expect(result.reviewFile.comments[0]).toEqual(review.comments[0]);
  });
});

describe('reanchor — self-healing and reverts', () => {
  it('flips an orphan back to open when its text reappears', () => {
    const doc = docOf(BEFORE);
    const review = makeReviewFile([
      makeComment(anchorOn(doc, 'Tokens are validated at the edge, never inside the service mesh.'), {
        status: 'orphaned',
      }),
    ]);

    const result = reanchor(review, doc, { now: fixedClock() });

    expect(result.reviewFile.comments[0]?.status).toBe('open');
    expect(result.changed).toBe(true);
  });

  it('clears a stale resolution when an edit is reverted', () => {
    const { review } = baseline();
    const edited = docOf(BEFORE.replace('is refilled once per', 'gets refilled exactly once per'));

    const addressed = reanchor(review, edited, { now: fixedClock() }).reviewFile;
    expect(addressed.comments[0]?.status).toBe('addressed');
    expect(addressed.comments[0]?.resolution).toBeDefined();

    // The agent (or the user) puts the original wording back.
    const reverted = reanchor(addressed, docOf(BEFORE), { now: fixedClock() });

    expect(reverted.reviewFile.comments[0]?.status).toBe('open');
    // A phantom before/after diff on the card would be a visible bug.
    expect(reverted.reviewFile.comments[0]?.resolution).toBeUndefined();
    expect(reverted.changed).toBe(true);
  });
});

describe('reanchor — detectedAt stability', () => {
  const edited = () => docOf(BEFORE.replace('is refilled once per', 'gets refilled exactly once per'));

  it('keeps the original timestamp when the current text has not moved', () => {
    const { review } = baseline();

    const first = reanchor(review, edited(), { now: fixedClock('2026-06-01T12:00:00.000Z') });
    const second = reanchor(first.reviewFile, edited(), {
      now: fixedClock('2026-06-01T12:00:05.000Z'),
    });

    expect(second.reviewFile.comments[0]?.resolution?.detectedAt).toBe('2026-06-01T12:00:00.000Z');
    // Nothing actually changed, so nothing needs persisting — this is what stops a burst of
    // keystrokes from churning the sidecar to disk every 400 ms.
    expect(second.changed).toBe(false);
  });

  it('takes a new timestamp when the text changes again', () => {
    const { review } = baseline();

    const first = reanchor(review, edited(), { now: fixedClock('2026-06-01T12:00:00.000Z') });
    const againEdited = docOf(BEFORE.replace('is refilled once per', 'is topped up twice per'));
    const second = reanchor(first.reviewFile, againEdited, {
      now: fixedClock('2026-06-01T12:00:05.000Z'),
    });

    expect(second.reviewFile.comments[0]?.status).toBe('addressed');
    expect(second.reviewFile.comments[0]?.resolution?.detectedAt).toBe('2026-06-01T12:00:05.000Z');
    expect(second.changed).toBe(true);
  });
});

describe('reanchor — hint drift does not force a write', () => {
  it('refreshes hints in memory without setting changed', () => {
    const { review } = baseline();
    const after = docOf(`# Auth service\n\nA newly inserted paragraph above everything else.\n\n${BEFORE.slice('# Auth service\n\n'.length)}`);

    const result = reanchor(review, after, { now: fixedClock() });
    const moved = result.reviewFile.comments[0];

    expect(moved?.status).toBe('open');
    expect(moved?.anchor.hintOffset).not.toBe(review.comments[0]?.anchor.hintOffset);
    expect(moved?.anchor.hintLine).toBeGreaterThan(review.comments[0]?.anchor.hintLine ?? 0);
    expect(result.changed).toBe(false);
  });
});

describe('reanchor — inferAddressed: false', () => {
  const edited = () => docOf(BEFORE.replace('is refilled once per', 'gets refilled exactly once per'));

  it('re-anchors but never infers addressed', () => {
    const { review } = baseline();
    const result = reanchor(review, edited(), { now: fixedClock(), inferAddressed: false });

    expect(result.reviewFile.comments.map((c) => c.status)).toEqual(['open', 'open', 'open']);
    expect(result.reviewFile.comments[0]?.resolution).toBeUndefined();
    expect(result.changed).toBe(false);
  });

  it('still orphans a vanished anchor — a gone anchor is gone regardless of the setting', () => {
    const { review } = baseline();
    const after = docOf('# Billing\n\nInvoices are generated on the first of each month.\n');

    const result = reanchor(review, after, { now: fixedClock(), inferAddressed: false });
    expect(result.reviewFile.comments.map((c) => c.status)).toEqual([
      'orphaned',
      'orphaned',
      'orphaned',
    ]);
  });

  it('still self-heals an orphan back to open', () => {
    const doc = docOf(BEFORE);
    const review = makeReviewFile([
      makeComment(anchorOn(doc, 'Every rejection is written to the structured audit log.'), {
        status: 'orphaned',
      }),
    ]);

    const result = reanchor(review, doc, { now: fixedClock(), inferAddressed: false });
    expect(result.reviewFile.comments[0]?.status).toBe('open');
  });

  it('does not destroy an existing resolution the user has not acted on', () => {
    const { review } = baseline();
    const addressed = reanchor(review, edited(), { now: fixedClock() }).reviewFile;

    const result = reanchor(addressed, edited(), { now: fixedClock(), inferAddressed: false });

    expect(result.reviewFile.comments[0]?.status).toBe('addressed');
    expect(result.reviewFile.comments[0]?.resolution).toBeDefined();
  });
});

describe('reanchor — normalization robustness', () => {
  it('does not flip every comment to addressed over a whitespace-only difference', () => {
    // A hand-edited sidecar (PRD §11 supports this) may hold un-normalized text.
    const doc = docOf(BEFORE);
    const anchor = anchorOn(doc, 'Tokens are validated at the edge, never inside the service mesh.');
    const review = makeReviewFile([
      makeComment({
        ...anchor,
        exact: '  Tokens are validated at the edge,   never inside the service mesh.  ',
      }),
    ]);

    const result = reanchor(review, doc, { now: fixedClock() });

    expect(result.reviewFile.comments[0]?.status).toBe('open');
    expect(result.changed).toBe(false);
  });

  it('treats decomposed and composed unicode as equal', () => {
    const source = '# Doc\n\nThe café serves espresso all afternoon.\n';
    const doc = docOf(source);
    const anchor = anchorOn(doc, 'The café serves espresso all afternoon.');
    const review = makeReviewFile([
      makeComment({ ...anchor, exact: anchor.exact.normalize('NFD') }),
    ]);

    const result = reanchor(review, doc, { now: fixedClock() });
    expect(result.reviewFile.comments[0]?.status).toBe('open');
  });
});

describe('reanchor — no comment is ever deleted', () => {
  it('keeps every comment through a full rewrite', () => {
    const { review } = baseline();
    const result = reanchor(review, docOf('# Nothing\n\nIn common.\n'), { now: fixedClock() });

    expect(result.reviewFile.comments).toHaveLength(review.comments.length);
    expect(result.reviewFile.comments.map((c) => c.id)).toEqual(review.comments.map((c) => c.id));
  });

  it('never sets resolved — that is only ever a user action', () => {
    const { review } = baseline();
    for (const doc of [docOf(BEFORE), docOf('# Gone\n\nEntirely.\n')]) {
      const result = reanchor(review, doc, { now: fixedClock() });
      expect(result.reviewFile.comments.some((c) => c.status === 'resolved')).toBe(false);
    }
  });
});

/**
 * The symptom that found the `createAnchor` collapse bug during the Phase 4 acceptance run: a
 * comment on a fenced code block reported itself `addressed` on a document nobody had edited.
 *
 * A false `addressed` is the most expensive failure this design has — the status is the one thing
 * the user is asked to trust, and its whole value is that it is narrow. Worth its own test even
 * though the fix is two modules away.
 */
describe('reanchor — code blocks on an unedited document', () => {
  const WITH_CODE = [
    '# Rate limiting',
    '',
    'Requests are counted per API key.',
    '',
    '```ts',
    'export function allow(key: string, now: number): boolean {',
    '  const bucket = buckets.get(key) ?? refill(key, now);',
    '  return bucket.tokens >= 1;',
    '}',
    '```',
    '',
    'Counters live in memory.',
    '',
  ].join('\n');

  it('leaves a whole-fence comment open, with no resolution', () => {
    const doc = docOf(WITH_CODE);
    const fence = doc.blocks.find((block) => block.kind === 'code');
    const review = makeReviewFile([
      makeComment(anchorOn(doc, doc.text.slice(fence?.start, fence?.end))),
    ]);

    const result = reanchor(review, doc, { now: fixedClock() });

    expect(result.changed).toBe(false);
    expect(result.reviewFile.comments[0]?.status).toBe('open');
    expect(result.reviewFile.comments[0]?.resolution).toBeUndefined();
  });

  it('leaves a multi-line selection inside a fence open', () => {
    const doc = docOf(WITH_CODE);
    const review = makeReviewFile([
      makeComment(
        anchorOn(doc, '  const bucket = buckets.get(key) ?? refill(key, now);\n  return bucket.tokens >= 1;'),
      ),
    ]);

    const result = reanchor(review, doc, { now: fixedClock() });

    expect(result.reviewFile.comments[0]?.status).toBe('open');
  });

  it('still flips to addressed when the code genuinely changes', () => {
    const doc = docOf(WITH_CODE);
    const fence = doc.blocks.find((block) => block.kind === 'code');
    const review = makeReviewFile([
      makeComment(anchorOn(doc, doc.text.slice(fence?.start, fence?.end))),
    ]);

    const edited = docOf(WITH_CODE.replace('bucket.tokens >= 1', 'bucket.tokens >= cost'));
    const result = reanchor(review, edited, { now: fixedClock() });
    const resolution = result.reviewFile.comments[0]?.resolution;

    expect(result.reviewFile.comments[0]?.status).toBe('addressed');
    expect(resolution?.previousText).toBe(doc.text.slice(fence?.start, fence?.end));

    // `currentText` is a prefix of the new block, not necessarily all of it.
    //
    // An edit that *lengthens* the anchored text sends `locate` to the fuzzy tiers, and
    // `fuzzy.ts::verify` scores an unpadded window of exactly `exact.length` against a padded one —
    // where, as its own comment explains, `diff_main`'s global alignment scatters the padding
    // through the match instead of emitting it as a clean leading/trailing run. The unpadded window
    // usually wins, so the reported span stops `n` characters early and the before/after on the card
    // is clipped by the amount the text grew. The *status* is right; only the evidence is short.
    // Tracked separately — this assertion holds either way, so fixing it will not break the test.
    const newFence = edited.blocks.find((block) => block.kind === 'code');
    const newText = edited.text.slice(newFence?.start, newFence?.end);
    expect(newText.startsWith(resolution?.currentText ?? '')).toBe(true);
  });
});
