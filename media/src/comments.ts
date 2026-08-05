/**
 * Comment cards, anchor highlights and their layout (Plan 03 §5; PRD §6).
 *
 * **Highlights are drawn as an overlay, never by wrapping the range.** `surroundContents` would
 * split text nodes inside the very blocks `anchorSpace.ts` measures, invalidating their character
 * maps and — worse — changing nothing visible while quietly moving every offset taken afterwards.
 * Positioned rectangles from `Range.getClientRects()` leave the content DOM untouched, and handle
 * ranges that cross element boundaries for free.
 */

import type { Comment, CommentStatus, Located, ReviewSummary } from '../../src/panel/messages.js';
import { UNCERTAIN_BELOW, truncateQuote } from '../../src/panel/messages.js';
import { domRangeFor } from './anchorSpace.js';
import { FILTERABLE } from './header.js';

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
  /** Also "Looks good" on an addressed card — the same terminal `resolved` either way. */
  onResolve(id: string): void;
  /** The user rejects an `addressed` inference (PRD §8). */
  onReopen(id: string): void;
}

export interface CommentsView {
  setState(
    review: ReviewSummary,
    located: Record<string, Located | null>,
    sectionChanged: readonly string[],
  ): void;
  setFilter(statuses: readonly CommentStatus[]): void;
  reposition(): void;
}

/** Before/after text is truncated to keep a reworded paragraph from filling the gutter. */
const DIFF_QUOTE_LENGTH = 160;

/**
 * Whether a comment belongs in the orphan section rather than the gutter.
 *
 * **Position decides, not status.** A gutter card is placed by its anchor's rectangle, so a comment
 * with no position has nothing to be placed against — it would keep `position: absolute` with no
 * `top`, land at the container origin, and pile up on every other one (Plan 04 §9 D6).
 *
 * Status alone is not enough, because the two can disagree: `applyReanchor` is what sets
 * `orphaned`, and it runs on a re-render, while `postReviewState` also fires on any store change.
 * An externally hand-edited sidecar (PRD §11 invites one) therefore reaches the webview saying
 * `open` with an anchor that cannot be found, and that is exactly the case this predicate catches.
 *
 * `resolved` is exempt: it is terminal and never re-anchored, so an unlocatable resolved comment is
 * normal and belongs in the collapsed group, not in a triage list asking the user to act on it.
 */
function belongsInOrphans(comment: Comment, located: Record<string, Located | null>): boolean {
  if (comment.status === 'resolved') return false;
  return comment.status === 'orphaned' || !located[comment.id];
}

/**
 * Places cards at their anchors, pushing each one down far enough to clear the previous.
 *
 * Pure and exported so the geometry is testable without a layout engine — jsdom reports every
 * rectangle as zero, so this is the only part of the layout that *can* be asserted.
 */
export { belongsInOrphans };

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
  /**
   * Ids of open comments whose region changed since the baseline (D17). Not a status — it never
   * reaches `filter`, and the header still counts these as `open`, because they are.
   */
  let sectionChanged = new Set<string>();
  /** Statuses currently shown. Everything, until the header says otherwise. */
  let filter: CommentStatus[] = [...FILTERABLE];
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

  function setState(
    review: ReviewSummary,
    next: Record<string, Located | null>,
    nextSectionChanged: readonly string[],
  ): void {
    located = next;
    sectionChanged = new Set(nextSectionChanged);
    // The gutter takes only what it can place. `orphans.ts` takes the rest.
    comments = review.comments.filter((comment) => !belongsInOrphans(comment, next));
    render();
  }

  function setFilter(next: readonly CommentStatus[]): void {
    filter = [...next];
    render();
  }

  function render(): void {
    cards.clear();
    options.gutter.replaceChildren();
    options.overlay.replaceChildren();

    const shown = comments.filter((comment) => filter.includes(comment.status));
    const live = shown.filter((comment) => comment.status !== 'resolved');
    const resolved = shown.filter((comment) => comment.status === 'resolved');

    // Document order, so stacking never reorders the conversation. Comments whose anchor is gone
    // sort last — they have no position to sort by.
    const ordered = [...live].sort((a, b) => anchorStart(a) - anchorStart(b));

    for (const comment of ordered) {
      const card = buildCard(comment, options, () => toggleExpanded(comment.id), {
        sectionChanged: sectionChanged.has(comment.id),
      });
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
      // Filtered out, or orphaned and therefore living in `#orphans` instead. Either way there is
      // no card to place and no highlight to draw.
      if (!card) continue;

      const position = located[comment.id];
      if (!position) continue;

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
      placed.push({ card, top: first.top - gutterOrigin.top });
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
  //
  // The work is deferred to the next frame rather than done in the callback, because `reposition`
  // mutates layout — it toggles `body.mr-narrow` and sets every card's `top` — and mutating layout
  // from inside a resize notification is what produces "ResizeObserver loop completed with
  // undelivered notifications". That is not a silent warning here: `webview.ts` forwards every
  // `window.error` to the host's output channel, so crossing the 700 px breakpoint would file a
  // spurious error report every time. Deferring also coalesces the burst of notifications a drag
  // produces into one overlay rebuild per frame.
  let repositionFrame = 0;
  const observer = new ResizeObserver(() => {
    if (repositionFrame !== 0) return;
    repositionFrame = window.requestAnimationFrame(() => {
      repositionFrame = 0;
      reposition();
    });
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

  return { setState, setFilter, reposition };
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

/** Per-card facts that are derived rather than stored, so they do not live on `Comment`. */
interface CardSignals {
  /** The comment's region differs from the review baseline, though its own anchor does not (D17). */
  sectionChanged: boolean;
}

function buildCard(
  comment: Comment,
  options: CommentsOptions,
  onToggle: () => void,
  signals: CardSignals,
): HTMLElement {
  const card = document.createElement('article');
  card.className = `mr-card mr-card-${comment.status}`;
  if (signals.sectionChanged) card.classList.add('mr-card-nearby');
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

  if (comment.status === 'addressed') header.append(badge('addressed'));

  const body = document.createElement('p');
  body.className = 'mr-card-body';
  body.textContent = comment.body;

  card.append(header, body);

  // `addressed` is a suggestion the user confirms (PRD §8), so the evidence for it has to be on the
  // card: without the before/after, "Looks good" is a button asking the user to trust an inference
  // they cannot see.
  const diff = buildDiff(comment);
  if (diff) card.append(diff);

  // Deliberately a sentence rather than a before/after. The region is a whole section, which does
  // not truncate into a diff honestly, and the pane is already showing the section a few inches to
  // the left — pointing at it beats paraphrasing it badly (D17).
  if (signals.sectionChanged) card.append(sectionNote());

  card.append(buildMenu(comment, options, card, body, signals));
  card.addEventListener('click', onToggle);
  return card;
}

function buildDiff(comment: Comment): HTMLElement | undefined {
  const resolution = comment.resolution;
  if (comment.status !== 'addressed' || !resolution) return undefined;

  const wrapper = document.createElement('div');
  wrapper.className = 'mr-diff';

  const before = document.createElement('del');
  before.className = 'mr-diff-before';
  before.textContent = truncateQuote(resolution.previousText, DIFF_QUOTE_LENGTH);

  const after = document.createElement('ins');
  after.className = 'mr-diff-after';
  after.textContent = truncateQuote(resolution.currentText, DIFF_QUOTE_LENGTH);

  wrapper.append(before, after);
  return wrapper;
}

/**
 * The D17 note. Phrased as an observation the user judges, not a claim about their comment.
 *
 * The note is a fact — the text differs from the snapshot taken when the prompt was copied. "Your
 * comment was addressed" would be a guess, and it is the guess the extension is deliberately not
 * making here: `addressed` keeps meaning that the anchored text itself changed.
 *
 * **The wording has to be true at both scopes (§10 D19).** `scopeOf` returns `'section' | 'block'`,
 * but that kind never crosses the message channel — `sectionChanged` is a bare `string[]` of ids,
 * kept narrow on purpose (§10 D3). So the earlier "This section changed" overstated the region
 * every time the scope was a block: one paragraph, one list item, one fence. For a note whose whole
 * value is being precise enough to judge, overstating is the wrong direction to be imprecise in.
 * "The text around this" is accurate at either scope and costs nothing on the wire.
 */
export function sectionNote(): HTMLElement {
  const note = document.createElement('p');
  note.className = 'mr-card-note';
  note.textContent = 'The text around this changed since you copied the prompt';
  return note;
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
  signals: CardSignals,
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

  if (comment.status === 'addressed') {
    // "Looks good" rather than "Resolve" (PRD §8): the user is confirming an inference the
    // extension made, not making a judgement from scratch. Same terminal status either way.
    actions.append(
      action('Looks good', `Accept the change and resolve ${comment.author}'s comment`, () => {
        options.onResolve(comment.id);
      }),
      action('Reopen', `Reject the change and reopen ${comment.author}'s comment`, () => {
        options.onReopen(comment.id);
      }),
    );
    return actions;
  }

  if (comment.status !== 'resolved') {
    // "Looks good" when there is something to confirm, matching the addressed card. The user is
    // still accepting a suggestion the extension volunteered, just a weaker one; "Resolve" would
    // read as an unprompted judgement and lose the connection to the note directly above it.
    const label = signals.sectionChanged ? 'Looks good' : 'Resolve';
    actions.append(
      action(label, `Resolve comment by ${comment.author}`, () => {
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
    // `resolved` is terminal and never re-anchored, so there is no signal to carry here.
    group.append(buildCard(comment, options, () => undefined, { sectionChanged: false }));
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
