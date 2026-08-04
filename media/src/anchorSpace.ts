/**
 * DOM ⇄ anchor-space mapping (Plan 03 §2, as corrected by §9 C1).
 *
 * **This module does not decide where blocks begin or end.** The host stamps every block element
 * with `data-ap-start` / `data-ap-end` — its exact offsets into `renderPlainText(source).text` —
 * computed by the same `walkSpans` that produced that text. So the only thing left to do here is
 * map *within* one block, and the one thing that must never be reintroduced is a second opinion
 * about block boundaries.
 *
 * Intra-block normalization mirrors `plaintext.ts`'s `inlineText` + `collapse` exactly:
 *
 * - whitespace runs collapse to a single space, and leading/trailing whitespace is trimmed
 * - `<img>` contributes its `alt` text, because `inlineText` recurses into image alt tokens (this
 *   is the divergence a naive `textContent` walk gets wrong)
 * - `<br>` counts as whitespace, because markdown-it's `hardbreak` becomes a space before collapse
 * - inside a code block nothing is collapsed — content is verbatim, minus one trailing newline
 * - a descendant that is itself a block is skipped: it owns its own offsets
 *
 * Every mapping is built as an explicit character-by-character index, so the same structure answers
 * both directions: DOM position → offset (for creating a comment) and offset → DOM range (for
 * highlighting one).
 */

/** One collapsed character's provenance: a DOM range covering the source it came from. */
interface CharSource {
  container: Node;
  start: number;
  end: number;
}

interface BlockMap {
  text: string;
  chars: CharSource[];
}

export interface BlockRef {
  el: HTMLElement;
  start: number;
  end: number;
}

/**
 * Rebuilt per `setContent`, and also after highlighting: highlight.js replaces the text nodes
 * inside a `<pre>`, which would leave cached `CharSource`s pointing at detached nodes.
 */
let cache = new WeakMap<HTMLElement, BlockMap>();

export function resetBlockMaps(): void {
  cache = new WeakMap<HTMLElement, BlockMap>();
}

function isWhitespace(character: string): boolean {
  // Matches `plaintext.ts`'s `collapse`, which is `\s` and deliberately nothing more — ZWSP, ZWJ
  // and ZWNJ are structural and must survive.
  return /\s/.test(character);
}

export function isBlock(node: Node | null | undefined): node is HTMLElement {
  return node instanceof HTMLElement && node.hasAttribute('data-ap-start');
}

/** The block element owning `node`, or `null` if it sits outside anchor space (e.g. front matter). */
export function blockOf(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (isBlock(current)) return current;
    current = current.parentNode;
  }
  return null;
}

export function blockRef(el: HTMLElement): BlockRef {
  return {
    el,
    start: Number(el.getAttribute('data-ap-start')),
    end: Number(el.getAttribute('data-ap-end')),
  };
}

/** Every block in `root`, in document order. */
export function blocksIn(root: ParentNode): BlockRef[] {
  return [...root.querySelectorAll<HTMLElement>('[data-ap-start]')].map(blockRef);
}

/** A code block's content is verbatim; everything else collapses. Mirrors `BlockKind`. */
function isCodeBlock(el: HTMLElement): boolean {
  return el.tagName === 'PRE';
}

function buildBlockMap(el: HTMLElement): BlockMap {
  const cached = cache.get(el);
  if (cached) return cached;

  const chars: CharSource[] = [];
  let text = '';
  const verbatim = isCodeBlock(el);
  /**
   * Where the run of whitespace currently being collapsed began, or `undefined` when the last
   * character was not whitespace — the collapse state machine.
   *
   * It holds the *first* whitespace character's position, not the following character's, so the
   * emitted space maps back to the whitespace it replaced. Attributing it to the next character
   * instead would put two collapsed characters at one DOM position and land every offset taken at a
   * word boundary one character early.
   */
  let pendingSpace: CharSource | undefined;

  const pushChar = (character: string, source: CharSource): void => {
    text += character;
    chars.push(source);
  };

  const takeCharacter = (character: string, source: CharSource): void => {
    if (verbatim) {
      pushChar(character, source);
      return;
    }
    if (isWhitespace(character)) {
      pendingSpace ??= source;
      return;
    }
    // Leading whitespace is dropped rather than emitted, which is the `trim()` half of `collapse`.
    if (pendingSpace && text.length > 0) pushChar(' ', pendingSpace);
    pendingSpace = undefined;
    pushChar(character, source);
  };

  const walk = (node: Node): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const value = child.nodeValue ?? '';
        for (let i = 0; i < value.length; i++) {
          // Surrogate pairs are two UTF-16 code units, and offsets are counted in code units
          // everywhere in this codebase, so iterating by index is correct here.
          takeCharacter(value.charAt(i), { container: child, start: i, end: i + 1 });
        }
        continue;
      }

      if (!(child instanceof Element)) continue;
      // A nested block owns its own offsets; descending would double-count it.
      if (isBlock(child)) continue;

      if (child instanceof HTMLImageElement) {
        // `inlineText` recurses into an image's alt tokens, so alt text *is* anchor space — but it
        // is not a DOM text node, so every alt character maps to the image element itself.
        const index = indexInParent(child);
        const source: CharSource = { container: child.parentNode ?? el, start: index, end: index + 1 };
        for (const character of child.getAttribute('alt') ?? '') takeCharacter(character, source);
        continue;
      }

      if (child instanceof HTMLBRElement) {
        // markdown-it's `hardbreak` contributes a space, which then collapses.
        const index = indexInParent(child);
        takeCharacter(' ', { container: child.parentNode ?? el, start: index, end: index + 1 });
        continue;
      }

      walk(child);
    }
  };

  walk(el);

  if (verbatim) {
    // `plaintext.ts` trims exactly one trailing newline from a fence's content; the rendered
    // `<code>` still carries it.
    if (text.endsWith('\n')) {
      text = text.slice(0, -1);
      chars.pop();
    }
  }

  const map: BlockMap = { text, chars };
  cache.set(el, map);
  return map;
}

function indexInParent(node: Node): number {
  const parent = node.parentNode;
  if (!parent) return 0;
  return [...parent.childNodes].indexOf(node as ChildNode);
}

/**
 * The block's text as anchor space has it. Exported for the consistency check in
 * `verifyBlockMap` and for tests — production code goes through the offset functions.
 */
export function blockText(el: HTMLElement): string {
  return buildBlockMap(el).text;
}

/**
 * Whether this block's mapping agrees with the offsets the host stamped on it.
 *
 * A mismatch means the intra-block walk and `plaintext.ts` have drifted. It is not fatal — the
 * caller reports `offset: -1` and the host falls back to `hintLine` — but it is always a bug, so
 * the webview reports it to the host's output channel rather than failing silently.
 */
export function verifyBlockMap(ref: BlockRef): boolean {
  return buildBlockMap(ref.el).text.length === ref.end - ref.start;
}

/**
 * Resolves a DOM position (as `Range` reports it) to a character index inside `el`'s mapping.
 *
 * Returns the index of the first mapped character at or after the position, so a position sitting
 * in collapsed whitespace lands on the next real character — the same place anchor space puts it.
 */
function indexOfPosition(el: HTMLElement, node: Node, offset: number): number {
  const { chars } = buildBlockMap(el);

  for (let i = 0; i < chars.length; i++) {
    const source = chars[i];
    if (!source) continue;

    if (source.container === node) {
      if (source.start >= offset) return i;
      continue;
    }
    // `container` sits after the position in document order -> this is the first character past it.
    const relation = node.compareDocumentPosition(source.container);
    if ((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return i;
  }
  return chars.length;
}

/** Anchor-space offset of a DOM position, or `null` when it is outside anchor space. */
export function offsetAt(node: Node, offset: number): number | null {
  const el = blockOf(node);
  if (!el) return null;

  const ref = blockRef(el);
  if (!Number.isFinite(ref.start)) return null;

  const { normalizedNode, normalizedOffset } = normalizePosition(node, offset);
  return ref.start + indexOfPosition(el, normalizedNode, normalizedOffset);
}

/**
 * A `Range` boundary may be given as (element, childIndex) rather than (text, charIndex). Resolving
 * it to the deepest equivalent position keeps `indexOfPosition`'s comparisons meaningful.
 */
function normalizePosition(
  node: Node,
  offset: number,
): { normalizedNode: Node; normalizedOffset: number } {
  if (node.nodeType !== Node.ELEMENT_NODE) return { normalizedNode: node, normalizedOffset: offset };

  const child = node.childNodes[offset];
  if (child) return { normalizedNode: child, normalizedOffset: 0 };
  return { normalizedNode: node, normalizedOffset: offset };
}

/**
 * The anchor-space text a `Range` covers.
 *
 * Blocks join with `\n`, except cells of one table row, which join with a space — rules 4 and 6 of
 * the plain-text contract. Reconstructing it here (rather than slicing `doc.text` host-side) means
 * `anchor.exact` still describes the passage the user highlighted even if the offsets are off by a
 * character, and `locate` can recover the position from the text. The reverse is not true.
 */
export function textOfRange(range: Range, root: ParentNode): string {
  const parts: string[] = [];
  let previous: BlockRef | undefined;

  for (const ref of blocksIn(root)) {
    if (!range.intersectsNode(ref.el)) continue;

    const { text } = buildBlockMap(ref.el);
    const piece = text.slice(sliceIndex(ref, range, true), sliceIndex(ref, range, false));
    if (piece.length === 0) continue;

    if (previous) parts.push(sameTableRow(previous.el, ref.el) ? ' ' : '\n');
    parts.push(piece);
    previous = ref;
  }

  return parts.join('');
}

/** Where this block's contribution to the range starts (or ends), as a character index. */
function sliceIndex(ref: BlockRef, range: Range, isStart: boolean): number {
  const node = isStart ? range.startContainer : range.endContainer;
  const offset = isStart ? range.startOffset : range.endOffset;

  if (!ref.el.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node)) {
    // The boundary is outside this block: the range either starts before it or ends after it.
    return isStart ? 0 : buildBlockMap(ref.el).text.length;
  }

  const { normalizedNode, normalizedOffset } = normalizePosition(node, offset);
  return indexOfPosition(ref.el, normalizedNode, normalizedOffset);
}

function sameTableRow(a: Element, b: Element): boolean {
  const row = a.closest('tr');
  return row !== null && row === b.closest('tr');
}

/**
 * The DOM range covering an anchor-space span, for highlighting a located comment.
 *
 * Returns `null` when the span does not land inside any rendered block — which happens legitimately
 * while content and state are momentarily out of step.
 */
export function domRangeFor(root: ParentNode, start: number, end: number): Range | null {
  const blocks = blocksIn(root);
  const first = blocks.find((ref) => start >= ref.start && start < ref.end);
  const last = [...blocks].reverse().find((ref) => end > ref.start && end <= ref.end);
  if (!first || !last) return null;

  const startSource = buildBlockMap(first.el).chars[start - first.start];
  const endChars = buildBlockMap(last.el).chars;
  // `end` is exclusive, so the last covered character is the one before it.
  const endSource = endChars[end - last.start - 1];
  if (!startSource || !endSource) return null;

  const range = document.createRange();
  try {
    range.setStart(startSource.container, startSource.start);
    range.setEnd(endSource.container, endSource.end);
  } catch {
    return null;
  }
  return range;
}
