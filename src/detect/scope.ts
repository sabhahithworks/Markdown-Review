/**
 * **What region of the document is a comment actually about?** (Plan D17.)
 *
 * `anchor.exact` does two jobs, and they only coincide sometimes. It is the *reference* — the
 * passage the user pointed at, which is what gets highlighted and quoted — and it is also the
 * *evidence* for `addressed`, on the assumption that the fix lands inside it. That assumption holds
 * for "this sentence is wrong". It fails for every comment whose anchor merely *labels* the thing to
 * fix: a heading ("this section needs work"), a list's intro line ("this is incomplete"), any
 * sentence followed by "add a caveat after this".
 *
 * This module answers the second question separately from the first. It never changes what
 * `addressed` means — `reanchor.ts` remains the only code that sets a status — it just gives the
 * callers that need a *region* one shared definition of one.
 *
 * Two callers, deliberately the same function:
 *
 *  - `buildPrompt` phrases a heading anchor as `On the section "## …"`, a claim about scope.
 *  - The change signal compares that region against the review baseline.
 *
 * They were different rules before D17 — the prompt promised the agent a section while the detector
 * watched only the heading line — which is precisely the mismatch that made a rewritten section
 * register as "nothing happened".
 *
 * Pure and `vscode`-free (enforced by `eslint.config.mjs`).
 */

import type { BlockSpan, PlainTextDoc } from '../anchor/types.js';
import { blockIndexAt } from '../render/plaintext.js';

export type ScopeKind = 'section' | 'block';

export interface Scope {
  /** inclusive start offset into `PlainTextDoc.text` */
  start: number;
  /** exclusive end offset */
  end: number;
  kind: ScopeKind;
  /**
   * The heading's own span, when `kind === 'section'`. Always starts at `start`, but ends where the
   * heading text does rather than where the section does — `buildPrompt` quotes it, so that a
   * comment on half a heading still names the whole section it refers to.
   */
  heading?: TextRange;
  /** the heading's level, when `kind === 'section'` and `walkSpans` recorded one */
  headingLevel?: number;
}

/**
 * Anything with a range: `Located`, a `BlockSpan`, or a bare pair.
 *
 * Named `TextRange` rather than `Range` because the webview's lib has a DOM `Range`, and these
 * types travel next to each other in the message contract.
 */
export interface TextRange {
  start: number;
  /** exclusive */
  end: number;
}

/**
 * A heading whose level `walkSpans` failed to record is treated as the *deepest* level, so its
 * section ends at the very next heading of any level.
 *
 * That would be a `walkSpans` bug rather than a document the user can write, so the only real
 * decision is which way to fail. The narrowest reading is the safe one here: this range decides
 * whether to tell the user their section changed, and an over-wide section reports changes that had
 * nothing to do with their comment. `buildPrompt` keeps its own `?? 1` fallback for the *display*
 * of the `#` markers, which is cosmetic and unrelated.
 */
const DEEPEST_HEADING_LEVEL = 6;

/**
 * The region of `doc` a comment located at `found` is about, or `null` when there is none.
 *
 * - Entirely inside one `heading` block → the **section**: that heading through to the next heading
 *   of the same or a higher level, or the end of the document.
 * - Otherwise → the **block(s)** the anchor covers, unioned.
 *
 * Note the asymmetry: an anchor covering *part* of a heading still yields the section. Selecting a
 * heading without its list marker or its manual `2. ` numbering is entirely natural — it is how the
 * comment that produced D17 was made — and nobody selects three words of a heading to talk about
 * only those three words. An anchor that starts in a heading and runs on into the prose below is a
 * different matter, and falls through to block scope: it is no longer a claim about the section.
 */
export function scopeOf(doc: PlainTextDoc, found: TextRange): Scope | null {
  const { blocks } = doc;
  if (blocks.length === 0) return null;

  // Anchors are at least MIN_ANCHOR_LENGTH, but a hand-edited sidecar can produce anything, and a
  // zero-width range would otherwise intersect no block at all.
  const start = Math.max(0, Math.min(found.start, doc.text.length));
  const end = Math.max(start + 1, Math.min(found.end, doc.text.length));

  const firstIndex = blockIndexAt(doc, start);
  if (firstIndex === -1) return null;

  let lastIndex = firstIndex;
  while (lastIndex + 1 < blocks.length) {
    const next = blocks[lastIndex + 1];
    if (!next || next.start >= end) break;
    lastIndex += 1;
  }

  const first = blocks[firstIndex];
  const last = blocks[lastIndex];
  if (!first || !last) return null;

  if (firstIndex === lastIndex && first.kind === 'heading' && within(first, start, end)) {
    return sectionFrom(doc, firstIndex, first);
  }

  return { start: first.start, end: last.end, kind: 'block' };
}

/**
 * The nearest `heading` block before the block containing `offset`, or `null` when there is none.
 *
 * With `maxLevel`, only headings of a strictly higher level (`headingLevel < maxLevel`) qualify, which
 * is how a heading asks for its parent. A heading whose level was not recorded never qualifies then.
 */
export function enclosingHeading(
  doc: PlainTextDoc,
  offset: number,
  maxLevel?: number,
): BlockSpan | null {
  const index = blockIndexAt(doc, offset);
  if (index === -1) return null;

  for (let i = index - 1; i >= 0; i--) {
    const block = doc.blocks[i];
    if (block?.kind !== 'heading') continue;
    if (maxLevel !== undefined && !((block.headingLevel ?? Infinity) < maxLevel)) continue;
    return block;
  }
  return null;
}

/** The section a heading opens: itself, plus everything up to the next heading of `level <= its`. */
function sectionFrom(doc: PlainTextDoc, headingIndex: number, heading: BlockSpan): Scope {
  const level = heading.headingLevel ?? DEEPEST_HEADING_LEVEL;

  // Ends at the last *block* before the next peer heading rather than at that heading's start, so
  // the scope never includes the `\n` joiner sitting between them. Joiners are emitted by
  // `walkSpans` and belong to no block; a scope that swallowed one would overlap its neighbour.
  let end = heading.end;
  for (let i = headingIndex + 1; i < doc.blocks.length; i++) {
    const block = doc.blocks[i];
    if (!block) continue;
    if (block.kind === 'heading' && (block.headingLevel ?? DEEPEST_HEADING_LEVEL) <= level) break;
    end = block.end;
  }

  const scope: Scope = {
    start: heading.start,
    end,
    kind: 'section',
    heading: { start: heading.start, end: heading.end },
  };
  if (heading.headingLevel !== undefined) scope.headingLevel = heading.headingLevel;
  return scope;
}

function within(block: BlockSpan, start: number, end: number): boolean {
  return start >= block.start && end <= block.end;
}
