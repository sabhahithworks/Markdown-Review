/**
 * PRD §5: `reanchor` of 50 comments on a 5 MB document must complete in under 500 ms.
 *
 * Skipped with `PERF=0`. It runs by default locally because a regression here is silent — the
 * cascade degrades into "orphan everything", which is fast and useless, so this file asserts the
 * status split as well as the clock.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { reanchor } from '../anchor/reanchor.js';
import type { PlainTextDoc, ReviewFile } from '../anchor/types.js';
import { renderPlainText } from '../render/plaintext.js';
import { anchorOn, fixedClock, makeComment, makeReviewFile, mulberry32 } from './helpers.js';

const ENABLED = process.env['PERF'] !== '0';
const TARGET_BYTES = 5 * 1024 * 1024;
const COMMENT_COUNT = 50;
const EDITED_COUNT = 10;
const BUDGET_MS = 500;

/** One ~2 KB unit of realistic markdown: heading, prose, nested list, fenced code, table. */
function unit(index: number, random: () => number, sentinel?: string): string {
  const words = [
    'request', 'handler', 'buffer', 'segment', 'registry', 'transport', 'checkpoint',
    'validator', 'scheduler', 'partition', 'namespace', 'descriptor', 'boundary', 'listener',
  ];
  const pick = () => words[Math.floor(random() * words.length)] ?? 'value';
  const sentence = (n: number) =>
    `The ${pick()} ${pick()} ${Array.from({ length: n }, pick).join(' ')} before the ${pick()} completes.`;

  return [
    `## Section ${String(index)}`,
    '',
    sentinel ?? sentence(8),
    '',
    `${sentence(10)} ${sentence(9)}`,
    '',
    `- ${sentence(4)}`,
    `  - ${sentence(3)}`,
    `- ${sentence(5)}`,
    '',
    '```ts',
    `export function ${pick()}${String(index)}(input: string): string {`,
    `  const ${pick()} = input.trim();`,
    `  return ${pick()};`,
    '}',
    '```',
    '',
    '| Field | Type | Notes |',
    '|---|---|---|',
    `| \`${pick()}\` | string | ${sentence(3)} |`,
    `| \`${pick()}\` | number | ${sentence(3)} |`,
    '',
    `> ${sentence(6)}`,
    '',
  ].join('\n');
}

/** The unique sentence anchored by comment `n`. Long enough to exercise the multi-probe path. */
function sentinelFor(n: number): string {
  return `Checkpoint ${String(n)}: the retry budget for partition ${String(n)} is refilled once per calendar day at midnight UTC by the scheduler.`;
}

/** The reworded version of sentinel `n` — a light edit, the kind an agent actually makes. */
function editedSentinelFor(n: number): string {
  return `Checkpoint ${String(n)}: the retry budget for partition ${String(n)} gets topped up exactly once per calendar day at midnight UTC by the scheduler.`;
}

interface Corpus {
  before: string;
  after: string;
  /** indices of the sentinels that were reworded */
  edited: Set<number>;
}

function buildCorpus(): Corpus {
  const random = mulberry32(0x5eed);
  const sections: string[] = ['# Performance corpus', ''];

  // Spread the sentinels evenly through the document rather than clustering them at the front.
  const unitsPerSentinel = 6;
  let sentinelsPlaced = 0;
  let index = 0;

  while (sections.join('\n').length < TARGET_BYTES) {
    const placeSentinel = index % unitsPerSentinel === 0 && sentinelsPlaced < COMMENT_COUNT;
    sections.push(unit(index, random, placeSentinel ? sentinelFor(sentinelsPlaced) : undefined));
    if (placeSentinel) sentinelsPlaced += 1;
    index += 1;
  }

  if (sentinelsPlaced < COMMENT_COUNT) {
    throw new Error(`corpus too small: placed only ${String(sentinelsPlaced)} sentinels`);
  }

  const before = sections.join('\n');

  // Reword every fifth sentinel, giving exactly EDITED_COUNT edits.
  const edited = new Set<number>();
  let after = before;
  for (let n = 0; n < COMMENT_COUNT; n += COMMENT_COUNT / EDITED_COUNT) {
    edited.add(n);
    after = after.replace(sentinelFor(n), editedSentinelFor(n));
  }

  return { before, after, edited };
}

describe.skipIf(!ENABLED)('performance — PRD §5 budget', () => {
  let beforeDoc: PlainTextDoc;
  let afterDoc: PlainTextDoc;
  let review: ReviewFile;
  let corpus: Corpus;

  beforeAll(() => {
    corpus = buildCorpus();

    const renderStarted = performance.now();
    beforeDoc = renderPlainText(corpus.before);
    const renderMs = performance.now() - renderStarted;

    afterDoc = renderPlainText(corpus.after);

    review = makeReviewFile(
      Array.from({ length: COMMENT_COUNT }, (_, n) => makeComment(anchorOn(beforeDoc, sentinelFor(n)))),
    );

    // Recorded, not asserted: `renderPlainText` dominates `reanchor` by an order of magnitude, and
    // Phase 2 should size its 2 MB render guard (PRD §11) from real numbers rather than a guess.
    console.log(
      `[perf] corpus ${(corpus.before.length / 1024 / 1024).toFixed(2)} MB source, ` +
        `${(beforeDoc.text.length / 1024 / 1024).toFixed(2)} MB anchor space, ` +
        `${String(beforeDoc.blocks.length)} blocks; renderPlainText ${renderMs.toFixed(0)} ms`,
    );
  });

  it('builds a corpus of the size PRD §5 specifies', () => {
    expect(corpus.before.length).toBeGreaterThanOrEqual(TARGET_BYTES);
    expect(review.comments).toHaveLength(COMMENT_COUNT);
    expect(corpus.edited.size).toBe(EDITED_COUNT);
  });

  it(`re-anchors ${String(COMMENT_COUNT)} comments in under ${String(BUDGET_MS)} ms`, () => {
    const now = fixedClock();

    // One discarded warm-up, then the median of three: a single timing is a coin flip on a busy
    // machine, and the median is stable without being generous.
    reanchor(review, afterDoc, { now });

    const timings: number[] = [];
    let last = reanchor(review, afterDoc, { now });
    for (let run = 0; run < 3; run++) {
      const startedAt = performance.now();
      last = reanchor(review, afterDoc, { now });
      timings.push(performance.now() - startedAt);
    }

    const median = [...timings].sort((a, b) => a - b)[1] ?? Infinity;
    console.log(`[perf] reanchor runs ${timings.map((t) => t.toFixed(0)).join('/')} ms, median ${median.toFixed(0)} ms`);

    // Correctness first: a cascade that orphans everything would sail through the time budget.
    const counts = { open: 0, addressed: 0, orphaned: 0, resolved: 0 };
    for (const comment of last.reviewFile.comments) counts[comment.status] += 1;

    expect(counts).toEqual({
      open: COMMENT_COUNT - EDITED_COUNT,
      addressed: EDITED_COUNT,
      orphaned: 0,
      resolved: 0,
    });
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it('re-anchors an unchanged 5 MB document well inside the budget', () => {
    const startedAt = performance.now();
    const result = reanchor(review, beforeDoc, { now: fixedClock() });
    const elapsed = performance.now() - startedAt;

    console.log(`[perf] reanchor (no edits) ${elapsed.toFixed(0)} ms`);
    expect(result.changed).toBe(false);
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
