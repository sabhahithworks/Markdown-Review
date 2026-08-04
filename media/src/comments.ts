/**
 * Comment cards, anchor highlights and their layout (Plan 03 §5; PRD §6).
 *
 * **Highlights are drawn as an overlay, never by wrapping the range.** `surroundContents` would
 * split text nodes inside the very blocks `anchorSpace.ts` measures, invalidating their character
 * maps and — worse — changing nothing visible while quietly moving every offset taken afterwards.
 * Positioned rectangles from `Range.getClientRects()` leave the content DOM untouched, and handle
 * ranges that cross element boundaries for free.
 */

import type { Comment, Located, ReviewFile } from '../../src/panel/messages.js';
import { UNCERTAIN_BELOW } from '../../src/panel/messages.js';
import { domRangeFor } from './anchorSpace.js';

/** Below this width the margin cannot hold a readable card, so it collapses (PRD §6). */
const NARROW_BREAKPOINT_PX = 700;

/** Vertical breathing room between stacked cards. */
const CARD_GAP_PX = 8;

export interface CommentsOptions {
  root: HTMLElement;
  gutter: HTMLElement;
  overlay: HTMLElement;
  onEdit(id: string, body: string): void;
  onDelete(id: string): void;
  onResolve(id: string): void;
}

export interface CommentsView {
  setState(review: ReviewFile, located: Record<string, Located | null>): void;
  reposition(): void;
}

/**
 * Places cards at their anchors, pushing each one down far enough to clear the previous.
 *
 * Pure and exported so the geometry is testable without a layout engine — jsdom reports every
 * rectangle as zero, so this is the only part of the layout that *can* be asserted.
 */
export function stackTops(desired: number[], heights: number[], gap: number): number[] {
  const tops: number[] = [];
  let floor = Number.NEGATIVE_INFINITY;

  for (const [index, want] of desired.entries()) {
    const top = Math.max(want, floor);
    tops.push(top);
    floor = top + (heights[index] ?? 0) + gap;
  }
  return tops;
}

export function initComments(options: CommentsOptions): CommentsView {
  let comments: Comment[] = [];
  let located: Record<string, Located | null> = {};
  /** Card element per comment id, for the positioning pass. */
  const cards = new Map<string, HTMLElement>();
  let expanded: string | undefined;
  /**
   * Every drawn highlight's box, in **overlay-relative** coordinates, for hover hit-testing.
   *
   * The overlay is `pointer-events: none` — it has to be, or it would swallow the text selection
   * the whole feature depends on — so hovering a *span* is detected by testing the pointer against
   * these rather than by listening on the highlight elements.
   *
   * Overlay-relative rather than viewport-relative so scrolling does not invalidate them: the
   * overlay scrolls with the content, so these boxes are scroll-invariant and the pointer is
   * converted into the same space at hit-test time.
   */
  let hotspots: Array<{ id: string; top: number; left: number; right: number; bottom: number }> =
    [];
  let active: string | undefined;

  function setActive(id: string | undefined): void {
    if (id === active) return;
    active = id;

    for (const [commentId, card] of cards) {
      card.classList.toggle('mr-card-active', commentId === id);
    }
    for (const mark of options.overlay.querySelectorAll('.mr-highlight')) {
      mark.classList.toggle('mr-highlight-active', mark.getAttribute('data-comment-id') === id);
    }
  }

  function isNarrow(): boolean {
    return options.root.clientWidth > 0 && window.innerWidth < NARROW_BREAKPOINT_PX;
  }

  function setState(review: ReviewFile, next: Record<string, Located | null>): void {
    comments = review.comments;
    located = next;
    render();
  }

  function render(): void {
    cards.clear();
    options.gutter.replaceChildren();
    options.overlay.replaceChildren();

    const live = comments.filter((comment) => comment.status !== 'resolved');
    const resolved = comments.filter((comment) => comment.status === 'resolved');

    // Document order, so stacking never reorders the conversation. Comments whose anchor is gone
    // sort last — they have no position to sort by.
    const ordered = [...live].sort((a, b) => anchorStart(a) - anchorStart(b));

    for (const comment of ordered) {
      const card = buildCard(comment, options, () => toggleExpanded(comment.id));
      card.addEventListener('mouseenter', () => {
        setActive(comment.id);
      });
      card.addEventListener('mouseleave', () => {
        setActive(undefined);
      });
      card.addEventListener('focus', () => {
        setActive(comment.id);
      });
      cards.set(comment.id, card);
      options.gutter.append(card);
    }

    if (resolved.length > 0) options.gutter.append(buildResolvedGroup(resolved, options));

    reposition();
  }

  function anchorStart(comment: Comment): number {
    return located[comment.id]?.start ?? Number.MAX_SAFE_INTEGER;
  }

  function toggleExpanded(id: string): void {
    expanded = expanded === id ? undefined : id;
    reposition();
  }

  /**
   * Redraws highlights and re-places cards. Called on every state change and whenever layout may
   * have moved underneath them — a resize, a font change, an image finishing loading.
   */
  function reposition(): void {
    options.overlay.replaceChildren();
    const narrow = isNarrow();
    document.body.classList.toggle('mr-narrow', narrow);

    const overlayOrigin = originOf(options.overlay);
    const gutterOrigin = originOf(options.gutter);
    const placed: Array<{ card: HTMLElement; top: number }> = [];
    hotspots = [];

    for (const comment of comments) {
      const card = cards.get(comment.id);
      const position = located[comment.id];
      if (!position) {
        card?.classList.add('mr-card-orphaned');
        continue;
      }

      const range = domRangeFor(options.root, position.start, position.end);
      if (!range) continue;

      const rects = [...range.getClientRects()];
      const uncertain = position.confidence < UNCERTAIN_BELOW;

      for (const rect of rects) {
        options.overlay.append(buildHighlight(comment.id, rect, overlayOrigin, uncertain));
        hotspots.push({
          id: comment.id,
          top: rect.top - overlayOrigin.top,
          left: rect.left - overlayOrigin.left,
          right: rect.right - overlayOrigin.left,
          bottom: rect.bottom - overlayOrigin.top,
        });
      }

      const first = rects[0];
      if (!first) continue;

      if (narrow) {
        options.overlay.append(
          buildMarker(comment, first, overlayOrigin, () => toggleExpanded(comment.id)),
        );
      }
      if (card) placed.push({ card, top: first.top - gutterOrigin.top });
    }

    if (narrow) {
      // The margin is gone; only the expanded card is shown, anchored to its marker.
      for (const [id, card] of cards) card.hidden = id !== expanded;
      return;
    }

    for (const card of cards.values()) card.hidden = false;

    const tops = stackTops(
      placed.map((entry) => entry.top),
      placed.map((entry) => entry.card.offsetHeight),
      CARD_GAP_PX,
    );
    for (const [index, entry] of placed.entries()) {
      entry.card.style.top = `${String(tops[index] ?? entry.top)}px`;
    }
  }

  // Layout-affecting changes that are not state changes still have to move the overlay. The
  // observer is also what drives the < 700 px collapse (PRD §6).
  const observer = new ResizeObserver(() => {
    reposition();
  });
  observer.observe(options.root);
  // Deliberately no scroll listener: the overlay and gutter scroll with the content, and every
  // position above is measured against them, so scrolling cannot move anything out of alignment.
  // Rebuilding the overlay on each scroll event would be pure churn on a long document.

  options.root.addEventListener('mousemove', (event) => {
    const origin = originOf(options.overlay);
    const x = event.clientX - origin.left;
    const y = event.clientY - origin.top;
    const hit = hotspots.find(
      (box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom,
    );
    setActive(hit?.id);
  });
  options.root.addEventListener('mouseleave', () => {
    setActive(undefined);
  });

  return { setState, reposition };
}

// ---------------------------------------------------------------- elements

/**
 * Positions are expressed relative to the container they are placed in, not to the page.
 *
 * Both the overlay and the gutter scroll with the content, so measuring against their own client
 * rects means there is no scroll offset to add — and nothing to get wrong when the pane is scrolled,
 * zoomed, or padded differently by a theme.
 */
interface Origin {
  top: number;
  left: number;
}

function originOf(container: HTMLElement): Origin {
  const rect = container.getBoundingClientRect();
  return { top: rect.top, left: rect.left };
}

function buildHighlight(id: string, rect: DOMRect, origin: Origin, uncertain: boolean): HTMLElement {
  const mark = document.createElement('div');
  mark.className = uncertain ? 'mr-highlight mr-highlight-uncertain' : 'mr-highlight';
  mark.dataset['commentId'] = id;
  mark.style.top = `${String(rect.top - origin.top)}px`;
  mark.style.left = `${String(rect.left - origin.left)}px`;
  mark.style.width = `${String(rect.width)}px`;
  mark.style.height = `${String(rect.height)}px`;
  return mark;
}

function buildMarker(
  comment: Comment,
  rect: DOMRect,
  origin: Origin,
  onClick: () => void,
): HTMLElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'mr-marker';
  marker.textContent = '💬';
  marker.setAttribute('aria-label', `Comment by ${comment.author}`);
  marker.style.top = `${String(rect.top - origin.top)}px`;
  marker.style.left = `${String(rect.right - origin.left + 2)}px`;
  marker.addEventListener('click', onClick);
  return marker;
}

function buildCard(
  comment: Comment,
  options: CommentsOptions,
  onToggle: () => void,
): HTMLElement {
  const card = document.createElement('article');
  card.className = `mr-card mr-card-${comment.status}`;
  card.dataset['commentId'] = comment.id;
  card.tabIndex = 0;

  const header = document.createElement('header');
  header.className = 'mr-card-header';

  const author = document.createElement('span');
  author.className = 'mr-card-author';
  author.textContent = comment.author;

  const time = document.createElement('time');
  time.className = 'mr-card-time';
  time.dateTime = comment.createdAt;
  time.textContent = relativeTime(comment.createdAt);

  header.append(author, time);

  if (comment.status === 'orphaned') header.append(badge('anchor lost'));

  const body = document.createElement('p');
  body.className = 'mr-card-body';
  body.textContent = comment.body;

  card.append(header, body, buildMenu(comment, options, card, body));
  card.addEventListener('click', onToggle);
  return card;
}

function badge(label: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'mr-badge';
  element.textContent = label;
  return element;
}

/**
 * The kebab menu. *Delete* is offered because a user deleting their own comment is an explicit
 * action — only *automatic* deletion is forbidden (PRD §4).
 */
function buildMenu(
  comment: Comment,
  options: CommentsOptions,
  card: HTMLElement,
  body: HTMLElement,
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'mr-card-actions';

  const edit = action('Edit', `Edit comment by ${comment.author}`, () => {
    startEditing(comment, options, card, body);
  });

  const remove = action('Delete', `Delete comment by ${comment.author}`, () => {
    options.onDelete(comment.id);
  });

  actions.append(edit, remove);

  if (comment.status !== 'resolved') {
    actions.append(
      action('Resolve', `Resolve comment by ${comment.author}`, () => {
        options.onResolve(comment.id);
      }),
    );
  }
  return actions;
}

function action(label: string, ariaLabel: string, run: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mr-card-action';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', (event) => {
    event.stopPropagation(); // the card itself toggles on click
    run();
  });
  return button;
}

function startEditing(
  comment: Comment,
  options: CommentsOptions,
  card: HTMLElement,
  body: HTMLElement,
): void {
  if (card.querySelector('.mr-card-editor')) return;

  const editor = document.createElement('textarea');
  editor.className = 'mr-card-editor';
  editor.value = comment.body;
  editor.rows = 3;
  editor.setAttribute('aria-label', 'Edit comment text');

  const finish = (save: boolean): void => {
    const next = editor.value.trim();
    editor.remove();
    body.hidden = false;
    if (save && next.length > 0 && next !== comment.body) options.onEdit(comment.id, next);
  };

  editor.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      finish(true);
    }
  });
  editor.addEventListener('blur', () => {
    finish(true);
  });
  editor.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  body.hidden = true;
  body.after(editor);
  editor.focus();
}

function buildResolvedGroup(resolved: Comment[], options: CommentsOptions): HTMLElement {
  const group = document.createElement('details');
  group.className = 'mr-resolved-group';

  const summary = document.createElement('summary');
  summary.textContent = `Resolved (${String(resolved.length)})`;
  group.append(summary);

  for (const comment of resolved) {
    group.append(buildCard(comment, options, () => undefined));
  }
  return group;
}

const UNITS: Array<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60_000],
  ['month', 30 * 24 * 60 * 60_000],
  ['day', 24 * 60 * 60_000],
  ['hour', 60 * 60_000],
  ['minute', 60_000],
];

/** "3 minutes ago". Falls back to the raw timestamp if it cannot be parsed (hand-edited sidecar). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;

  const elapsed = now - then;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) return format.format(-Math.round(elapsed / size), unit);
  }
  return format.format(0, 'second');
}
