/**
 * PRD §7's format, asserted rather than eyeballed.
 *
 * The golden case is the PRD's own worked example, imported from `fixtures/reviewLoop.ts` so the
 * integration spec can later assert the *clipboard* against the identical string. Everything else
 * here covers the rules PRD §7 states in prose (truncation, heading phrasing) and the cases it does
 * not mention at all but that the card UI produces routinely (multi-line bodies, fenced code).
 */

import { describe, expect, it } from 'vitest';
import type { Locator } from '../anchor/locate.js';
import type { Located } from '../anchor/types.js';
import { buildPrompt } from '../prompt/buildPrompt.js';
import {
  AUTH_ANCHORS,
  AUTH_BODIES,
  AUTH_EXPECTED_PROMPT,
  AUTH_MARKDOWN,
  AUTH_TARGET_PATH,
} from './fixtures/reviewLoop.js';
import { anchorOn, anchorOnNth, docOf, makeComment, makeReviewFile } from './helpers.js';

/** A paragraph of exactly `length` characters, for the truncation boundary. */
function docWithParagraph(text: string) {
  return docOf(`Intro.\n\n${text}\n`);
}

/** Always fails to locate — the unlocatable-but-open case, unreachable through the real cascade. */
const nowhere: Locator = () => null;

describe('buildPrompt — the PRD §7 golden example', () => {
  it('reproduces the PRD example byte for byte', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile(
      [
        makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { body: AUTH_BODIES.retries }),
        makeComment(anchorOn(doc, AUTH_ANCHORS.parallel), { body: AUTH_BODIES.parallel }),
        makeComment(anchorOn(doc, AUTH_ANCHORS.heading), { body: AUTH_BODIES.heading }),
      ],
      { targetPath: AUTH_TARGET_PATH },
    );

    const { prompt, count } = buildPrompt(review, doc);

    expect(prompt).toBe(AUTH_EXPECTED_PROMPT);
    expect(count).toBe(3);
  });

  it('order lists ids in prompt order', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile(
      [
        makeComment(anchorOn(doc, AUTH_ANCHORS.heading), { id: 'h' }),
        makeComment(anchorOn(doc, AUTH_ANCHORS.parallel), { id: 'p' }),
        makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { id: 'r' }),
      ],
      { targetPath: AUTH_TARGET_PATH },
    );

    expect(buildPrompt(review, doc).order).toEqual(['r', 'p', 'h']);
  });

  it('numbers in document order however the comments were added', () => {
    const doc = docOf(AUTH_MARKDOWN);
    // Reverse of document order, which is what adding comments bottom-up produces.
    const review = makeReviewFile(
      [
        makeComment(anchorOn(doc, AUTH_ANCHORS.heading), { body: AUTH_BODIES.heading }),
        makeComment(anchorOn(doc, AUTH_ANCHORS.parallel), { body: AUTH_BODIES.parallel }),
        makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { body: AUTH_BODIES.retries }),
      ],
      { targetPath: AUTH_TARGET_PATH },
    );

    expect(buildPrompt(review, doc).prompt).toBe(AUTH_EXPECTED_PROMPT);
  });

  it('leaves the review untouched', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([makeComment(anchorOn(doc, AUTH_ANCHORS.retries))]);
    const before = structuredClone(review);

    buildPrompt(review, doc);

    expect(review).toEqual(before);
  });
});

describe('buildPrompt — which comments are included', () => {
  it('includes open comments only', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([
      makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { body: 'included' }),
      makeComment(anchorOn(doc, AUTH_ANCHORS.parallel), { body: 'also included' }),
      makeComment(anchorOn(doc, AUTH_ANCHORS.heading), { body: 'addressed', status: 'addressed' }),
      makeComment(anchorOn(doc, 'Auth service'), { body: 'resolved', status: 'resolved' }),
      makeComment(anchorOn(doc, 'worker pool'), { body: 'orphaned', status: 'orphaned' }),
    ]);

    const { prompt, count } = buildPrompt(review, doc);

    expect(count).toBe(2);
    expect(prompt).toContain('included');
    expect(prompt).not.toContain('addressed');
    expect(prompt).not.toContain('resolved');
    expect(prompt).not.toContain('orphaned');
  });

  it('returns an empty prompt and a zero count when nothing is open', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([
      makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { status: 'resolved' }),
    ]);

    expect(buildPrompt(review, doc)).toEqual({ prompt: '', count: 0, order: [] });
  });

  it('quotes anchor.exact and sorts last when a comment is open but unlocatable', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([
      makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { body: 'first' }),
      makeComment(anchorOn(doc, AUTH_ANCHORS.parallel), { body: 'second' }),
    ]);

    // Only the second anchor fails to locate, so it must fall to the end despite being earlier.
    const locate: Locator = (anchor) =>
      anchor.exact === AUTH_ANCHORS.parallel ? null : { start: 999, end: 1010, confidence: 1 };

    const { prompt } = buildPrompt(review, doc, { locate });

    expect(prompt).toContain(`2. On: "${AUTH_ANCHORS.parallel}"`);
    expect(prompt.indexOf('first')).toBeLessThan(prompt.indexOf('second'));
  });

  it('breaks an offset tie by creation time, then by id', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const anchor = anchorOn(doc, AUTH_ANCHORS.retries);
    const review = makeReviewFile([
      makeComment(anchor, { id: 'zzz', body: 'same time, later id', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeComment(anchor, { id: 'aaa', body: 'same time, earlier id', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeComment(anchor, { id: 'mmm', body: 'earliest', createdAt: '2025-01-01T00:00:00.000Z' }),
    ]);

    const { prompt } = buildPrompt(review, doc);

    expect(prompt.indexOf('earliest')).toBeLessThan(prompt.indexOf('same time, earlier id'));
    expect(prompt.indexOf('same time, earlier id')).toBeLessThan(prompt.indexOf('same time, later id'));
  });
});

describe('buildPrompt — quote truncation (PRD §7: over 100 chars)', () => {
  function quoteFor(text: string): string {
    const doc = docWithParagraph(text);
    const review = makeReviewFile([makeComment(anchorOn(doc, text))]);
    const line = buildPrompt(review, doc).prompt.split('\n').find((l) => l.startsWith('1. On:'));
    if (!line) throw new Error('no quote line in prompt');
    // Up to the closing quote, so a location hint after it (D1) is not part of the quote.
    return line.slice('1. On: "'.length, line.lastIndexOf('"'));
  }

  it('leaves 99 and 100 characters untouched', () => {
    const ninetyNine = 'x'.repeat(99);
    const hundred = 'y'.repeat(100);

    expect(quoteFor(ninetyNine)).toBe(ninetyNine);
    expect(quoteFor(hundred)).toBe(hundred);
  });

  it('truncates 101 characters with a middle ellipsis, keeping both ends', () => {
    const text = `${'a'.repeat(50)}${'b'.repeat(51)}`;
    const quote = quoteFor(text);

    expect(quote).not.toBe(text);
    expect(quote.length).toBeLessThanOrEqual(100);
    expect(quote).toContain(' … ');
    expect(quote.startsWith('a'.repeat(48))).toBe(true);
    expect(quote.endsWith('b'.repeat(48))).toBe(true);
  });

  it('never splits a surrogate pair at either cut', () => {
    // U+1D400 occupies two code units. One straddles the head cut at 48, the other the tail cut at
    // 53, so a naive slice would emit a lone surrogate at both ends.
    const text = `${'a'.repeat(47)}\u{1D400}${'b'.repeat(3)}\u{1D400}${'c'.repeat(47)}`;
    expect(text.length).toBe(101);

    const quote = quoteFor(text);

    expect(quote.length).toBeLessThanOrEqual(100);
    // A lone surrogate makes this throw URIError; well-formed text never does.
    expect(() => encodeURIComponent(quote)).not.toThrow();
  });
});

describe('buildPrompt — heading phrasing (PRD §7)', () => {
  it('rebuilds the hash markers from the heading level', () => {
    const one = docOf('# Top level\n\nBody text here.\n');
    const six = docOf('###### Deep heading\n\nBody text here.\n');

    const promptOne = buildPrompt(
      makeReviewFile([makeComment(anchorOn(one, 'Top level'))]),
      one,
    ).prompt;
    const promptSix = buildPrompt(
      makeReviewFile([makeComment(anchorOn(six, 'Deep heading'))]),
      six,
    ).prompt;

    expect(promptOne).toContain('On the section "# Top level"');
    expect(promptSix).toContain('On the section "###### Deep heading"');
  });

  it('names the whole section when the anchor covers only part of a heading', () => {
    // Inverted by D17. This asserted the plain phrasing on the reasoning that "half a heading is
    // not a section" — but the anchor that produced D17 was a heading selected without its manual
    // `2. ` numbering, which is the ordinary gesture, and nobody selects three words of a heading
    // to talk about only those three words. The quote names the whole heading rather than the
    // fragment, or the instruction would be worse than the one it replaced.
    const doc = docOf('## Error handling and retries\n\nBody text here.\n');
    const review = makeReviewFile([makeComment(anchorOn(doc, 'and retries'))]);

    const { prompt } = buildPrompt(review, doc);

    expect(prompt).toContain('On the section "## Error handling and retries"');
  });

  it('still uses the plain phrasing when the anchor runs out of the heading', () => {
    // The boundary of that widening: once the selection crosses into the prose below, it is no
    // longer a claim about the section.
    const doc = docOf('## Error handling\n\nBody text here.\n');
    const review = makeReviewFile([makeComment(anchorOn(doc, 'handling\nBody text'))]);

    const { prompt } = buildPrompt(review, doc);

    expect(prompt).toContain('On: "handling Body text"');
    expect(prompt).not.toContain('On the section');
  });

  it('uses the plain phrasing for a non-heading block the anchor happens to cover exactly', () => {
    // Proves the check is on `kind`, not merely on the span matching a block.
    const doc = docOf('# Title\n\nExactly this paragraph.\n');
    const review = makeReviewFile([makeComment(anchorOn(doc, 'Exactly this paragraph.'))]);

    const { prompt } = buildPrompt(review, doc);

    expect(prompt).toContain('On: "Exactly this paragraph."');
    expect(prompt).not.toContain('On the section');
  });
});

describe('buildPrompt — comment bodies', () => {
  function promptWithBody(body: string): string {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { body })]);
    return buildPrompt(review, doc).prompt;
  }

  it('prefixes every line of a multi-line body, blank lines included', () => {
    expect(promptWithBody('First line.\n\nThird line.')).toContain(
      '   > First line.\n   >\n   > Third line.',
    );
  });

  it('normalizes CRLF and strips trailing newlines', () => {
    expect(promptWithBody('First.\r\nSecond.\r\n\r\n')).toContain('   > First.\n   > Second.\n');
    expect(promptWithBody('First.\r\nSecond.\r\n\r\n')).not.toContain('   >\n\n');
  });
});

describe('buildPrompt — format invariants', () => {
  it('keeps a fenced-code anchor on one line', () => {
    const doc = docOf('Intro.\n\n```\nline one\nline two\n```\n');
    const fence = doc.blocks.find((block) => block.kind === 'code');
    if (!fence) throw new Error('fixture has no code block');

    // Fence content is preserved verbatim in anchor space, so the raw slice contains a newline.
    expect(doc.text.slice(fence.start, fence.end)).toContain('\n');

    const located: Located = { start: fence.start, end: fence.end, confidence: 1 };
    const review = makeReviewFile([makeComment(anchorOn(doc, 'Intro.'))]);

    const { prompt } = buildPrompt(review, doc, { locate: () => located });

    expect(prompt).toContain('1. On: "line one line two"');
  });

  it('ends with exactly one newline and has no trailing whitespace on any line', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile(
      [
        makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { body: 'One.  ' }),
        makeComment(anchorOn(doc, AUTH_ANCHORS.heading), { body: 'Two.' }),
      ],
      { targetPath: AUTH_TARGET_PATH },
    );

    const { prompt } = buildPrompt(review, doc);

    expect(prompt.endsWith('\n')).toBe(true);
    expect(prompt.endsWith('\n\n')).toBe(false);
    for (const line of prompt.split('\n')) expect(line).toBe(line.trimEnd());
  });

  it('interpolates a nested workspace-relative path into the first line', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([makeComment(anchorOn(doc, AUTH_ANCHORS.retries))], {
      targetPath: 'docs/specs/deeply/nested.md',
    });

    expect(buildPrompt(review, doc).prompt.startsWith(
      "I've left review comments on `docs/specs/deeply/nested.md`.",
    )).toBe(true);
  });

  it('does not ask the agent for structured output', () => {
    // The core design principle: the agent edits prose and never maintains bookkeeping. A future
    // edit that adds "reply with", "JSON" or a marker convention should fail here first.
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([makeComment(anchorOn(doc, AUTH_ANCHORS.retries))]);

    const { prompt } = buildPrompt(review, doc);

    expect(prompt).toContain("Don't add annotations, comments, or replies");
    expect(prompt.toLowerCase()).not.toContain('json');
  });

  it('reuses an injected locator instead of building its own', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([makeComment(anchorOn(doc, AUTH_ANCHORS.retries))]);

    let calls = 0;
    const locate: Locator = (anchor) => {
      calls += 1;
      return { start: 0, end: anchor.exact.length, confidence: 1 };
    };

    buildPrompt(review, doc, { locate });

    expect(calls).toBe(1);
  });

  it('still emits every open comment when none of them can be located', () => {
    const doc = docOf(AUTH_MARKDOWN);
    const review = makeReviewFile([
      makeComment(anchorOn(doc, AUTH_ANCHORS.retries), { body: 'one' }),
      makeComment(anchorOn(doc, AUTH_ANCHORS.parallel), { body: 'two' }),
    ]);

    const { prompt, count } = buildPrompt(review, doc, { locate: nowhere });

    expect(count).toBe(2);
    expect(prompt).toContain('1. On:');
    expect(prompt).toContain('2. On:');
  });
});

describe('buildPrompt — repeated quotes (D1)', () => {
  const REPEATED = [
    '# Auth',
    '',
    '## Refresh',
    '',
    'Use the token to refresh the session.',
    '',
    '## Revoke',
    '',
    'Use the token to refresh the session.',
    '',
  ].join('\n');

  function firstLine(prompt: string): string {
    return prompt.split('\n').find((line) => line.startsWith('1. ')) ?? '';
  }

  it('adds heading and line when a quote repeats', () => {
    const doc = docOf(REPEATED);
    const review = makeReviewFile([
      makeComment(anchorOnNth(doc, 'Use the token to refresh the session.', 1)),
    ]);

    expect(firstLine(buildPrompt(review, doc).prompt)).toBe(
      '1. On: "Use the token to refresh the session." (under "## Revoke", line 9)',
    );
  });

  it('leaves a unique quote unchanged', () => {
    const doc = docOf(REPEATED);
    const review = makeReviewFile([makeComment(anchorOn(doc, 'Revoke'))]);

    expect(firstLine(buildPrompt(review, doc).prompt)).toBe('1. On the section "## Revoke"');
  });

  it('gives (line N) alone when no heading precedes the quote', () => {
    const doc = docOf('Same sentence here, twice over.\n\nSame sentence here, twice over.\n');
    const review = makeReviewFile([
      makeComment(anchorOnNth(doc, 'Same sentence here, twice over.', 1)),
    ]);

    expect(firstLine(buildPrompt(review, doc).prompt)).toBe(
      '1. On: "Same sentence here, twice over." (line 3)',
    );
  });

  it('checks the visible head of a truncated quote', () => {
    const head = 'Alpha '.repeat(8).trim();
    const first = `${head} one ${'x'.repeat(150 - head.length - 5)}`;
    const second = `${head} two ${'y'.repeat(150 - head.length - 5)}`;
    expect(first).toHaveLength(150);
    const doc = docOf(`# Top\n\n${first}\n\n${second}\n`);
    const review = makeReviewFile([makeComment(anchorOn(doc, second))]);

    const line = firstLine(buildPrompt(review, doc).prompt);

    expect(line.endsWith('" (under "# Top", line 5)')).toBe(true);
    expect(line).toContain(' … ');
  });

  it('names the parent heading for a repeated section heading', () => {
    const md = '# Auth\n\n## Examples\n\nOne.\n\n# Billing\n\n## Examples\n\nTwo.\n';
    const doc = docOf(md);
    const review = makeReviewFile([makeComment(anchorOnNth(doc, 'Examples', 1))]);

    expect(firstLine(buildPrompt(review, doc).prompt)).toBe(
      '1. On the section "## Examples" (under "# Billing", line 9)',
    );
  });

  it('counts front-matter lines in the reported line', () => {
    const md = '---\ntitle: x\n---\n# Top\n\nRepeat this exact sentence.\n\nRepeat this exact sentence.\n';
    const doc = docOf(md);
    const review = makeReviewFile([
      makeComment(anchorOnNth(doc, 'Repeat this exact sentence.', 1)),
    ]);

    expect(firstLine(buildPrompt(review, doc).prompt)).toBe(
      '1. On: "Repeat this exact sentence." (under "# Top", line 8)',
    );
  });

  it('keeps the bare quote when the comment is unlocatable', () => {
    const doc = docOf(REPEATED);
    const review = makeReviewFile([
      makeComment(anchorOnNth(doc, 'Use the token to refresh the session.', 1)),
    ]);

    const { prompt } = buildPrompt(review, doc, { locate: nowhere });

    expect(firstLine(prompt)).toBe('1. On: "Use the token to refresh the session."');
  });

  it('names occurrence 2 of 3 when copies share a paragraph', () => {
    const doc = docOf('## Auth\n\nrefresh the token. refresh the token. refresh the token.\n');
    const review = makeReviewFile([makeComment(anchorOnNth(doc, 'refresh the token.', 1))]);

    expect(firstLine(buildPrompt(review, doc).prompt)).toBe(
      '1. On: "refresh the token." (under "## Auth", line 3, occurrence 2 of 3 in this paragraph)',
    );
  });

  it('omits the hint for a doc with no blocks', () => {
    const real = docOf('Same sentence here, twice. Same sentence here, twice.\n');
    const doc = { ...real, blocks: [] };
    const found: Located = { start: 0, end: 'Same sentence here, twice.'.length, confidence: 1 };
    const review = makeReviewFile([
      makeComment(anchorOnNth(real, 'Same sentence here, twice.', 0)),
    ]);

    const { prompt } = buildPrompt(review, doc, { locate: () => found });

    expect(firstLine(prompt)).toBe('1. On: "Same sentence here, twice."');
  });

  it('measures a truncated head in raw text when code keeps its whitespace', () => {
    // Fenced code is verbatim in anchor space, so the 48-char visible head of the collapsed quote
    // spans far more than 48 raw characters. Cutting the raw text at 48 leaves `alpha` and spaces,
    // which the second block shares, although the head the agent sees is unique.
    const first = `alpha${' '.repeat(60)}beta-unique-${'u'.repeat(90)}`;
    const second = `alpha${' '.repeat(60)}gamma-other`;
    const doc = docOf(`# Top\n\n\`\`\`\n${first}\n\`\`\`\n\n\`\`\`\n${second}\n\`\`\`\n`);
    const fence = doc.blocks.find((block) => block.kind === 'code');
    if (!fence) throw new Error('fixture has no code block');
    expect(doc.text.slice(fence.start, fence.end)).toBe(first);

    const located: Located = { start: fence.start, end: fence.end, confidence: 1 };
    const review = makeReviewFile([makeComment(anchorOn(doc, 'Top'))]);

    const line = firstLine(buildPrompt(review, doc, { locate: () => located }).prompt);

    expect(line).toContain(' … ');
    expect(line).not.toContain('(under');
    expect(line.endsWith(`${'u'.repeat(48)}"`)).toBe(true);
  });
});
