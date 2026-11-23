/**
 * **Anchor space.** This module is the normative definition (Plan 01 §3): every component that
 * touches anchors — the webview's selection capture, `locate`, `reanchor`, Phase 4's baseline
 * diffing — must produce or consume text that follows exactly these rules.
 *
 * `renderPlainText` turns a markdown document into (a) the normalized plain text the user
 * effectively sees, and (b) a list of `BlockSpan`s mapping offsets in that text back to source
 * lines. Anchors live in this space rather than in markdown source because the user selects
 * *rendered* text — `**bold**` reads as `bold` — and inverse-mapping inline syntax would be
 * fragile and unnecessary.
 *
 * **Block-span invariant:** spans are non-empty, ascending, and non-overlapping. Offsets falling
 * between two spans are the `\n` (or `' '`, within a table row) joiners. Empty blocks contribute
 * nothing at all — no span and no joiner. `offsetToSourceLine`'s binary search depends on this.
 * Separators are emitted *before* their content, so `text` never ends with a joiner.
 */

import type MarkdownIt from 'markdown-it';
import type { BlockKind, BlockSpan, PlainTextDoc } from '../anchor/types.js';
import { splitFrontMatter } from './frontMatter.js';
import { createMarkdownIt } from './markdownIt.js';

const md = createMarkdownIt();

/**
 * Collapses every run of whitespace to a single space and trims. This expression is exactly the
 * normalization contract — **do not widen it**.
 *
 * JS `\s` already covers NBSP, the U+2000–200A range, ideographic space and ZWNBSP. Critically it
 * does *not* match ZWSP (U+200B), ZWNJ (U+200C) or ZWJ (U+200D), and it must not: ZWJ is
 * structural inside emoji sequences (👨‍👩‍👧 is three people joined by ZWJ) and in Indic and Arabic
 * joining behavior. Stripping it would change the grapheme the user selected. Bidi control
 * characters pass through verbatim for the same reason.
 */
export function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The full anchor-space normalization for a free-standing string: NFC, then whitespace collapse. */
export function normalizeAnchorText(s: string): string {
  return collapse(s.normalize('NFC'));
}

interface Frame {
  map: readonly [number, number];
  kind: BlockKind;
  headingLevel?: number;
  isCell: boolean;
}

const EMPTY_MAP: readonly [number, number] = [0, 0];

/**
 * The result of {@link walkSpans}: anchor space, plus the provenance needed to tie each block back
 * to the token that produced it.
 */
export interface SpanWalk {
  text: string;
  blocks: BlockSpan[];
  /**
   * Parallel to `blocks`: the index in `tokens` of the token each block was emitted from (an
   * `inline`, `fence` or `code_block`). `renderer.ts` uses it to find the DOM element that will
   * carry the block's offsets; `renderPlainText` ignores it.
   */
  tokenIndex: number[];
}

/**
 * The normative anchor-space walk, over an already-parsed token stream.
 *
 * Extracted from `renderPlainText` so `renderer.ts` can stamp the *same* offsets onto the rendered
 * HTML by calling this function on its own token stream. That is the whole point: block boundaries
 * in the DOM and in anchor space cannot disagree, because there is only one walk. Reimplementing
 * these rules against the DOM — the obvious alternative — diverges on image alt text, table-cell
 * joining and fenced code.
 */
export function walkSpans(tokens: readonly MarkdownIt.Token[], lineOffset: number): SpanWalk {
  const pieces: string[] = [];
  const blocks: BlockSpan[] = [];
  const tokenIndex: number[] = [];
  let cursor = 0;

  const frames: Frame[] = [];
  let cellsEmittedInRow = 0;

  const top = (): Frame | undefined => frames[frames.length - 1];

  /**
   * Appends one block. The separator is pushed as its own piece *before* the content, which is
   * what makes "blocks joined by \n" and "table cells joined by a space" the same mechanism.
   */
  function emit(
    content: string,
    separator: string,
    meta: {
      kind: BlockKind;
      lineStart: number;
      lineEnd: number;
      headingLevel?: number;
      sourceToken: number;
    },
  ): boolean {
    if (content.length === 0) return false;

    if (pieces.length > 0) {
      pieces.push(separator);
      cursor += separator.length;
    }

    const start = cursor;
    pieces.push(content);
    cursor += content.length;

    const span: BlockSpan = {
      start,
      end: cursor,
      // The one place `lineOffset` is applied, so it cannot be forgotten at a call site.
      sourceLineStart: meta.lineStart + lineOffset,
      sourceLineEnd: meta.lineEnd + lineOffset,
      kind: meta.kind,
    };
    if (meta.headingLevel !== undefined) span.headingLevel = meta.headingLevel;
    blocks.push(span);
    tokenIndex.push(meta.sourceToken);
    return true;
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;

    if (token.nesting === 1) {
      // Push a frame for *every* opening token, inheriting the enclosing map when the token has
      // none. `th_open`/`td_open` carry no map — the line info lives on the enclosing `tr_open` —
      // and pushing unconditionally is also what keeps the stack balanced against every close.
      const inherited = token.map ?? top()?.map ?? EMPTY_MAP;
      const frame: Frame = {
        map: token.map ? [token.map[0], token.map[1]] : inherited,
        kind: token.type === 'heading_open' ? 'heading' : 'text',
        isCell: token.type === 'th_open' || token.type === 'td_open',
      };
      if (token.type === 'heading_open') {
        frame.headingLevel = headingLevelFromTag(token.tag);
      }
      frames.push(frame);

      if (token.type === 'tr_open') cellsEmittedInRow = 0;
      continue;
    }

    if (token.nesting === -1) {
      frames.pop();
      continue;
    }

    switch (token.type) {
      case 'inline': {
        // `token.content` is the raw markdown source; the parsed children are the rendered text.
        const raw = token.children ? inlineText(token.children) : '';
        const content = collapse(raw);
        const frame = top();
        const map = token.map ?? frame?.map ?? EMPTY_MAP;
        const isCell = frame?.isCell ?? false;
        const separator = isCell && cellsEmittedInRow > 0 ? ' ' : '\n';

        const meta: {
          kind: BlockKind;
          lineStart: number;
          lineEnd: number;
          headingLevel?: number;
          sourceToken: number;
        } = {
          kind: frame?.kind ?? 'text',
          lineStart: map[0],
          lineEnd: map[1],
          sourceToken: index,
        };
        if (frame?.headingLevel !== undefined) meta.headingLevel = frame.headingLevel;

        if (emit(content, separator, meta) && isCell) cellsEmittedInRow += 1;
        break;
      }

      case 'fence': {
        // Content is preserved verbatim (PRD §5) — internal newlines and indentation intact.
        const content = trimOneTrailingNewline(token.content);
        const lineStart = (token.map?.[0] ?? 0) + 1; // the first *content* line, not the ``` marker
        emit(content, '\n', {
          kind: 'code',
          lineStart,
          // exclusive end; content spans `countLines + 1` lines
          lineEnd: lineStart + countLines(content) + 1,
          sourceToken: index,
        });
        break;
      }

      case 'code_block': {
        // Indented code: unlike a fence, content starts on the token's own first line.
        const content = trimOneTrailingNewline(token.content);
        const lineStart = token.map?.[0] ?? 0;
        emit(content, '\n', {
          kind: 'code',
          lineStart,
          lineEnd: token.map?.[1] ?? lineStart + countLines(content),
          sourceToken: index,
        });
        break;
      }

      default:
        // `hr`, and any self-closing token with no user-visible text, contribute nothing.
        break;
    }
  }

  return { text: pieces.join(''), blocks, tokenIndex };
}

export function renderPlainText(markdown: string): PlainTextDoc {
  const { body, lineOffset } = splitFrontMatter(markdown.normalize('NFC'));
  const { text, blocks } = walkSpans(md.parse(body, {}), lineOffset);
  return { text, blocks, frontMatterLineOffset: lineOffset };
}

/**
 * The visible label of a `footnote_ref` token: `[1]`, or `[1:1]` for the second reference to the
 * same note. Shared by anchor space and the HTML renderer so the two cannot disagree.
 */
export function footnoteCaption(token: MarkdownIt.Token): string {
  const meta = token.meta as { id: number; subId?: number };
  const subId = meta.subId ?? 0;
  return subId > 0 ? `[${meta.id + 1}:${subId}]` : `[${meta.id + 1}]`;
}

/**
 * Concatenates the rendered text of an inline token's children.
 *
 * Links need no special case: markdown-it puts the label's `text` tokens in the same flat children
 * array and keeps the URL on `link_open.attrs`, so `[auth guide](url)` yields `auth guide` for
 * free. Images do need one — their alt tokens are nested, and their `content` is raw source.
 */
function inlineText(children: readonly MarkdownIt.Token[]): string {
  let out = '';
  for (const child of children) {
    switch (child.type) {
      case 'text':
      case 'text_special':
      case 'code_inline':
        out += child.content;
        break;
      case 'softbreak':
      case 'hardbreak':
        out += ' ';
        break;
      case 'image':
        out += child.children ? inlineText(child.children) : child.content;
        break;
      case 'footnote_ref':
        out += footnoteCaption(child);
        break;
      case 'html_inline':
      case 'html_block':
        // Dropped. `markdown-it-task-lists` injects a synthetic `<input …>` token here even with
        // `html: false`; without this branch every task item leaks raw HTML into anchor space.
        break;
      default:
        // em/strong/link/s open and close tokens carry no text of their own.
        break;
    }
  }
  return out;
}

/**
 * Index of the block containing `offset`.
 *
 * Offsets falling on one of the `\n` joiners belong to no block, and resolve to the block that
 * *follows* — a selection starting on a block boundary is entering that block. Returns `-1` for a
 * document with no blocks, or an offset past the last one.
 *
 * Binary search, because this runs once per comment and a 5 MB document has tens of thousands of
 * blocks. Shared rather than reimplemented: `offsetToSourceLine`, `createAnchor` and
 * `detect/scope.ts` all need exactly this question answered exactly this way.
 */
export function blockIndexAt(doc: PlainTextDoc, offset: number): number {
  const { blocks } = doc;

  let lo = 0;
  let hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const block = blocks[mid];
    if (!block) break;

    if (offset < block.start) hi = mid - 1;
    else if (offset >= block.end) lo = mid + 1;
    else return mid;
  }

  return lo < blocks.length ? lo : -1;
}

/** The block containing `offset`, by the rules of {@link blockIndexAt}. */
export function blockAt(doc: PlainTextDoc, offset: number): BlockSpan | undefined {
  const index = blockIndexAt(doc, offset);
  return index === -1 ? undefined : doc.blocks[index];
}

/**
 * Maps an offset in `doc.text` to a 0-based source line in the original file.
 *
 * Returns `-1` for a document with no blocks. Offsets are clamped into range, so callers do not
 * have to bounds-check a selection that ran past the end of a re-rendered document.
 */
export function offsetToSourceLine(doc: PlainTextDoc, offset: number): number {
  const { blocks, text } = doc;
  if (blocks.length === 0) return -1;

  // `text` never ends with a joiner, so the last character is always inside a block.
  const target = Math.min(Math.max(offset, 0), Math.max(text.length - 1, 0));

  const index = blockIndexAt(doc, target);
  const block = index === -1 ? blocks[blocks.length - 1] : blocks[index];
  if (!block) return -1;

  // Inside a code block a single BlockSpan can cover hundreds of lines, so count the newlines we
  // have passed; without this every offset in a long fence reports the same line.
  if (block.kind === 'code' && target >= block.start && target < block.end) {
    return block.sourceLineStart + countLines(text.slice(block.start, target));
  }
  return block.sourceLineStart;
}

function headingLevelFromTag(tag: string): number | undefined {
  const level = Number.parseInt(tag.slice(1), 10);
  return Number.isFinite(level) ? level : undefined;
}

function trimOneTrailingNewline(s: string): string {
  if (s.endsWith('\r\n')) return s.slice(0, -2);
  if (s.endsWith('\n')) return s.slice(0, -1);
  return s;
}

function countLines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n += 1;
  return n;
}
