/**
 * The review prompt (PRD §7 owns the format; Plan 04 §3 operationalizes it).
 *
 * This is the whole product in one function: the user's comments become prose an agent can act on,
 * and the agent is never asked to write structured data or follow a schema. Everything that would
 * normally require cooperation from the model — which comment is which, what changed, what is still
 * open — stays the extension's bookkeeping. That is what makes it agent-agnostic, so this file must
 * not grow instructions asking the agent to emit markers, ids or replies.
 *
 * Pure and `vscode`-free (enforced by `eslint.config.mjs`): it takes a document and a review and
 * returns a string, which is what makes the PRD's format assertable byte-for-byte in vitest rather
 * than by pasting into an agent and squinting.
 */

import type { Locator } from '../anchor/locate.js';
import { createLocator } from '../anchor/locate.js';
import { truncateQuote } from '../anchor/text.js';
import type { Comment, Located, PlainTextDoc, ReviewFile } from '../anchor/types.js';
import type { Scope } from '../detect/scope.js';
import { enclosingHeading, scopeOf } from '../detect/scope.js';
import { blockAt, collapse, offsetToSourceLine } from '../render/plaintext.js';

export interface PromptResult {
  /** Empty when `count` is 0 — the command layer says "no open comments" rather than copying this. */
  prompt: string;
  count: number;
  /** Comment ids in prompt order; number = index + 1. Empty when `count` is 0. */
  order: string[];
}

export interface BuildPromptOptions {
  /**
   * Reuses a locator the caller already built for `doc`. Also the seam that lets a test force the
   * unlocatable-but-open case, which is otherwise unreachable through the public API.
   */
  locate?: Locator;
}

/** A comment paired with where it currently sits, so ordering and quoting agree on one answer. */
interface Entry {
  comment: Comment;
  found: Located | null;
}

export function buildPrompt(
  review: ReviewFile,
  doc: PlainTextDoc,
  options: BuildPromptOptions = {},
): PromptResult {
  // Open only. `addressed` would ask the agent to redo work it already did; `orphaned` would quote
  // text that is no longer in the document, sending it hunting for something that cannot be found;
  // `resolved` is terminal (PRD §4).
  const open = review.comments.filter(
    (comment) => comment.status === 'open' && comment.anchor !== undefined,
  );
  if (open.length === 0) return { prompt: '', count: 0, order: [] };

  const locate = options.locate ?? createLocator(doc);
  const entries: Entry[] = open.map((comment) => ({ comment, found: comment.anchor ? locate(comment.anchor) : null }));
  entries.sort(byDocumentOrder);

  const header =
    `I've left review comments on \`${review.targetPath}\`. Please revise the document to address them.\n` +
    `\n` +
    `Edit the file directly. Don't add annotations, comments, or replies — just make the changes.\n` +
    `If you disagree with a comment or need clarification, tell me instead of guessing.\n`;

  const items = entries.map(
    (entry, index) =>
      `${String(index + 1)}. ${describeAnchor(entry, doc)}\n${quoteBody(entry.comment.body)}\n`,
  );

  // Every part already ends in a newline, so joining with one more produces the blank separator
  // lines PRD §7 shows — and leaves exactly one trailing newline at the end.
  return {
    prompt: [header, ...items].join('\n'),
    count: entries.length,
    order: entries.map((entry) => entry.comment.id),
  };
}

/**
 * Document order, then creation time, then id.
 *
 * The tiebreaks are not decoration. Two comments on the same sentence share a start offset, and
 * unlocatable ones all share the sentinel, so without them the numbering would depend on `sort`'s
 * stability and the golden test would be asserting an implementation detail of the engine.
 */
function byDocumentOrder(a: Entry, b: Entry): number {
  const offsetDelta = anchorStart(a) - anchorStart(b);
  if (offsetDelta !== 0) return offsetDelta;

  const timeDelta = createdAt(a.comment) - createdAt(b.comment);
  if (timeDelta !== 0) return timeDelta;

  return a.comment.id < b.comment.id ? -1 : a.comment.id > b.comment.id ? 1 : 0;
}

/** Unlocatable sorts last: it is the one entry whose position in the document is unknown. */
function anchorStart(entry: Entry): number {
  return entry.found?.start ?? Number.MAX_SAFE_INTEGER;
}

/** A hand-edited sidecar (PRD §11 supports one) can carry an unparseable date; it sorts last. */
function createdAt(comment: Comment): number {
  const parsed = Date.parse(comment.createdAt);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/**
 * The `On: "…"` / `On the section "…"` line.
 *
 * Quotes the text as it stands *now* when the anchor can be located, and falls back to
 * `anchor.exact` when it cannot — the latter is what the user actually commented on, and a stale
 * quote beats no quote at all.
 */
function describeAnchor(entry: Entry, doc: PlainTextDoc): string {
  const scope = entry.found ? scopeOf(doc, entry.found) : null;

  // A section quote names the *whole* heading, even when the anchor covered only part of it. Saying
  // `On the section "### nested"` because the user did not select the first word would be a worse
  // instruction than the one this replaced — and `scopeOf` deliberately treats a partial heading as
  // a claim about the section (see its doc comment, and D17).
  const raw =
    scope?.kind === 'section' && scope.heading
      ? doc.text.slice(scope.heading.start, scope.heading.end)
      : entry.found
        ? doc.text.slice(entry.found.start, entry.found.end)
        : (entry.comment.anchor?.exact ?? '');

  // Collapse before truncating: fenced code is preserved verbatim in anchor space, so a code anchor
  // carries real newlines that would break this single-line form. Only the *quote* is collapsed —
  // `anchor.exact` is the durable record of what was selected and is never rewritten.
  const title = truncateQuote(collapse(raw));

  if (scope?.kind === 'section') {
    // The `#` markers are markdown syntax, so they are absent from anchor space and have to be
    // rebuilt. A heading missing its level would be a `walkSpans` bug, and the count of hashes is
    // cosmetic next to getting the "On the section" phrasing right — so fall back rather than skip.
    return `On the section "${'#'.repeat(scope.headingLevel ?? 1)} ${title}"${locationHint(entry, doc, scope)}`;
  }
  return `On: "${title}"${locationHint(entry, doc, scope)}`;
}

/** True when `needle` occurs at least twice in `haystack`, exact and case-sensitive. */
function occursTwice(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const first = haystack.indexOf(needle);
  if (first === -1) return false;
  return haystack.indexOf(needle, first + 1) !== -1;
}

/**
 * The stretch of `raw` that `collapse` turns into its first `length` characters.
 *
 * The truncated head is measured in the collapsed quote, but fenced code keeps its whitespace
 * verbatim in anchor space, so the same visible head spans more raw characters. Cutting `raw` at
 * `length` would test a shorter, likelier-to-repeat prefix than the one the agent is shown.
 */
function rawHead(raw: string, length: number): string {
  let at = 0;
  while (at < raw.length && /\s/.test(raw.charAt(at))) at++;
  const start = at;
  let counted = 0;
  while (at < raw.length && counted < length) {
    if (/\s/.test(raw.charAt(at))) {
      while (at < raw.length && /\s/.test(raw.charAt(at))) at++;
    } else {
      at++;
    }
    counted++;
  }
  return raw.slice(start, at);
}

/**
 * The ` (under "<heading>", line N)` suffix, or `''` when the quote is unambiguous (D1).
 *
 * Added only when the quote would match more than one place for an agent grepping the file, so a
 * unique quote keeps its bare form. An unlocatable comment has no known position and gets none.
 */
function locationHint(entry: Entry, doc: PlainTextDoc, scope: Scope | null): string {
  const found = entry.found;
  if (!found) return '';

  const sectionHeading = scope?.kind === 'section' ? scope.heading : undefined;

  let ambiguous: boolean;
  let anchorOffset: number;
  let parent: ReturnType<typeof enclosingHeading>;
  let occurrence = '';

  if (sectionHeading) {
    const own = collapse(doc.text.slice(sectionHeading.start, sectionHeading.end));
    ambiguous = doc.blocks.some(
      (block) =>
        block.kind === 'heading' &&
        block.start !== sectionHeading.start &&
        collapse(doc.text.slice(block.start, block.end)) === own,
    );
    anchorOffset = sectionHeading.start;
    parent = enclosingHeading(doc, sectionHeading.start, scope?.headingLevel);
  } else {
    const raw = doc.text.slice(found.start, found.end);
    const collapsed = collapse(raw);
    const title = truncateQuote(collapsed);
    ambiguous = occursTwice(doc.text, raw);
    if (!ambiguous && title !== collapsed) {
      const headLength = title.indexOf(' … ');
      if (headLength > 0) ambiguous = occursTwice(doc.text, rawHead(raw, headLength));
    }
    anchorOffset = found.start;
    parent = enclosingHeading(doc, found.start);

    const block = blockAt(doc, found.start);
    if (block && raw.length > 0) {
      const blockText = doc.text.slice(block.start, block.end);
      const relative = found.start - block.start;
      let total = 0;
      let before = 0;
      for (let at = blockText.indexOf(raw); at !== -1; at = blockText.indexOf(raw, at + 1)) {
        total += 1;
        if (at < relative) before += 1;
      }
      if (total >= 2) {
        const where = block.kind === 'code' ? 'code block' : 'paragraph';
        occurrence = `, occurrence ${String(before + 1)} of ${String(total)} in this ${where}`;
        ambiguous = true;
      }
    }
  }

  if (!ambiguous) return '';

  const sourceLine = offsetToSourceLine(doc, anchorOffset);
  if (sourceLine < 0) return '';
  const line = `line ${String(sourceLine + 1)}`;

  const under = parent
    ? `under "${'#'.repeat(parent.headingLevel ?? 1)} ${truncateQuote(collapse(doc.text.slice(parent.start, parent.end)))}", `
    : '';
  return ` (${under}${line}${occurrence})`;
}

/**
 * The comment body as a markdown blockquote, three spaces in (PRD §7).
 *
 * PRD §7 shows only single-line bodies, but the card is a textarea so multi-line ones are routine.
 * Every line gets the `> ` — indenting continuation lines without it renders, in any agent that
 * reads the prompt as markdown, as a quote followed by loose paragraphs at ambiguous nesting, and
 * collapsing to one line would destroy a bulleted list of three separate concerns.
 */
function quoteBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => {
      const text = line.trimEnd();
      return text.length === 0 ? '   >' : `   > ${text}`;
    })
    .join('\n');
}
