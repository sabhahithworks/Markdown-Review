/**
 * Change marks: which blocks the agent changed since the review prompt was copied (D28, D30).
 *
 * The host does the diff and sends whole-block anchor-space spans; this module only intersects them
 * with the `data-ap-start` / `data-ap-end` offsets the renderer stamped (L-block-offsets-single-
 * source). It never sees the baseline text (L-baseline-stays-on-host).
 *
 * A mark has two halves. The block element gets `data-mr-changed` and an `aria-description`, which
 * is the state for assistive technology and what the overlay pass looks for. The visible half is a
 * `div.mr-change-bar` in `#highlight-overlay`, drawn by `comments.ts` from the block's measured
 * rectangle in the same pass that draws highlights. Nothing is added to the document's flow, so no
 * block changes height and no card moves; and the bar is not a `::before` on the block, because
 * `pre` and `table` scroll horizontally and would clip or carry it away.
 */

import type { ChangeSpan, ChangeState } from '../../src/panel/messages.js';
import { blocksIn } from './anchorSpace.js';

export const CHANGED_ATTRIBUTE = 'data-mr-changed';
export const CHANGED_DESCRIPTION = 'changed since the prompt was copied';

/** How far left of its block a bar sits, into the gutter (CV2's expected decision). */
const CHANGE_BAR_OFFSET_PX = 8;

/**
 * Re-marks `root` from `changes` and returns how many blocks are marked.
 *
 * Every mark a previous pass set is cleared first, so a move to `unchanged`, `no-baseline` or
 * `too-large` leaves nothing behind. `undefined` — the harness, or a host older than the field —
 * and any state this build does not know are treated as `no-baseline`: nothing is marked.
 */
export function applyChangeMarks(root: HTMLElement, changes: ChangeState | undefined): number {
  for (const element of root.querySelectorAll<HTMLElement>(`[${CHANGED_ATTRIBUTE}]`)) {
    element.removeAttribute(CHANGED_ATTRIBUTE);
    element.removeAttribute('aria-description');
  }

  if (changes?.state !== 'changed' || !Array.isArray(changes.blocks)) return 0;

  const spans = [...changes.blocks].sort((a, b) => a.start - b.start);
  if (spans.length === 0) return 0;

  // Two pointers. `blocksIn` is document order, which is ascending, non-overlapping offsets (a
  // nested list item starts after its parent item's own text ends), and the spans are sorted above.
  let cursor = 0;
  let marked = 0;
  for (const block of blocksIn(root)) {
    while (cursor < spans.length && (spans[cursor]?.end ?? 0) < block.start) cursor++;

    // A block can meet more than one span; the first one at or after it may also end exactly where
    // the block begins without touching it.
    let hit = false;
    for (let i = cursor; i < spans.length; i++) {
      const span = spans[i];
      if (!span || span.start > block.end) break;
      if (intersects(block, span)) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;

    block.el.setAttribute(CHANGED_ATTRIBUTE, '');
    block.el.setAttribute('aria-description', CHANGED_DESCRIPTION);
    marked++;
  }
  return marked;
}

/**
 * Half-open `[start, end)` overlap. An empty side (an empty block, or a span made of one) counts as
 * a point, inclusive at both ends, so it can still meet the block or span it sits in.
 */
function intersects(a: ChangeSpan, b: ChangeSpan): boolean {
  if (a.start === a.end) return a.start >= b.start && a.start <= b.end;
  if (b.start === b.end) return b.start >= a.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}

/**
 * The rectangles to draw bars against, one per marked block, measured now.
 *
 * Two kinds of block need more than their own bounding box:
 *
 * - A table cell. Each `th`/`td` is its own block, so a changed row would otherwise grow a bar
 *   inside the table beside every cell. The bar takes the row's vertical extent and the table's
 *   left edge — the table is the scroll container, so its left edge stays put while the row
 *   scrolls under it — and a row is drawn once however many of its cells changed.
 * - A list item with a nested list. Its box includes the nested items, which carry their own
 *   offsets and their own marks, so the bar stops where the first nested block begins.
 */
export function changeBarRects(root: ParentNode): DOMRect[] {
  const rects: DOMRect[] = [];
  const rows = new Set<Element>();

  for (const element of root.querySelectorAll<HTMLElement>(`[${CHANGED_ATTRIBUTE}]`)) {
    if (element.tagName === 'TD' || element.tagName === 'TH') {
      const row = element.closest('tr');
      const table = element.closest('table');
      if (row && table) {
        if (rows.has(row)) continue;
        rows.add(row);
        const rowRect = row.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        rects.push(new DOMRect(tableRect.left, rowRect.top, rowRect.width, rowRect.height));
        continue;
      }
    }

    let rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      const before = element.previousElementSibling;
      if (before?.classList.contains('mr-mermaid')) rect = before.getBoundingClientRect();
    }
    const nested = element.querySelector('[data-ap-start]');
    if (nested) {
      const height = Math.max(0, nested.getBoundingClientRect().top - rect.top);
      rects.push(new DOMRect(rect.left, rect.top, rect.width, height));
      continue;
    }
    rects.push(rect);
  }
  return rects;
}

/**
 * A bar beside `rect`, positioned against `origin` the way `buildHighlight` positions a highlight.
 * Its width and colour come from `.mr-change-bar`; its left edge is clamped so it never leaves the
 * overlay.
 */
export function buildChangeBar(rect: DOMRect, origin: { top: number; left: number }): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'mr-change-bar';
  bar.style.top = `${String(rect.top - origin.top)}px`;
  bar.style.left = `${String(Math.max(0, rect.left - origin.left - CHANGE_BAR_OFFSET_PX))}px`;
  bar.style.height = `${String(rect.height)}px`;
  return bar;
}
