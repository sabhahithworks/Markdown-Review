/**
 * The review pane's browser-side runtime.
 *
 * Runs inside the webview, so it has the DOM and neither node nor `vscode`. It may import **types
 * only** from `src/panel/messages.ts` (plans README, shared conventions).
 *
 * The security-critical ordering is **sanitize → inject → highlight** (PRD §6). The host already
 * renders with `html: false`, but the webview treats incoming HTML as untrusted regardless — the
 * whole point of defence in depth is that it does not depend on the other layer being correct.
 */

import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type {
  CommentStatus,
  HostMessage,
  PanelState,
  WebviewMessage,
} from '../../src/panel/messages.js';
import { resetBlockMaps } from './anchorSpace.js';
import { applyChangeMarks } from './changes.js';
import type { CommentsView } from './comments.js';
import { initComments } from './comments.js';
import type { HeaderView } from './header.js';
import { FILTERABLE, initHeader } from './header.js';
import type { OrphansView } from './orphans.js';
import { initOrphans } from './orphans.js';
import type { SelectionController } from './selection.js';
import { initSelection } from './selection.js';

/**
 * Declared locally rather than pulling in `@types/vscode-webview`: six lines against a dependency,
 * and this way `postMessage` is typed against our own union instead of `unknown`.
 */
declare function acquireVsCodeApi(): {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: PanelState): void;
};

const vscode = acquireVsCodeApi();

/**
 * A curated set rather than `highlight.js/lib/common`: unknown languages fall back to plain `<code>`
 * and cost nothing, and the bundle size is Phase 5's main budget risk.
 */
const LANGUAGES = {
  bash,
  css,
  diff,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
} as const;

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

const contentRoot = requireElement('content');
const frontMatterRoot = requireElement('front-matter-root');
const noticeRoot = requireElement('notice');
const gutterRoot = requireElement('gutter');
const overlayRoot = requireElement('highlight-overlay');
const markerRoot = requireElement('marker-layer');
const headerRoot = requireElement('header');
const orphansRoot = requireElement('orphans');
const announcerRoot = requireElement('announcer');
const emptyStateRoot = requireElement('empty-state');

/** Built on `init`, because the popover shows the author the host will attribute the comment to. */
let comments: CommentsView | undefined;
let header: HeaderView | undefined;
let orphans: OrphansView | undefined;
let selection: SelectionController | undefined;

let targetPath = '';
/** A `data-line` value, not a pixel offset, so it survives a re-render that changes layout. */
let scrollLine: number | undefined;
let scrollFrame = 0;
/** Active status chips, persisted through `setState` so a reload keeps the user's view (PRD §6). */
let filter: CommentStatus[] | undefined;

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`webview shell is missing #${id}`);
  return element;
}

// ---------------------------------------------------------------- error reporting

/**
 * The webview has no usable console (a webview console is invisible unless devtools happen to be
 * open, and `no-console` is on repo-wide), so failures go to the host's output channel instead.
 */
function report(message: string): void {
  vscode.postMessage({ type: 'error', message });
}

/**
 * Speaks a sentence through the pane's live region (H18).
 *
 * Cleared first, then set on the next frame: a screen reader announces a *change* of content, so
 * re-setting the identical string — "Comment resolved." twice in a row — would otherwise be
 * silent the second time.
 */
function announce(message: string): void {
  announcerRoot.textContent = '';
  requestAnimationFrame(() => {
    announcerRoot.textContent = message;
  });
}

window.addEventListener('error', (event) => {
  report(`${event.message} (${event.filename}:${String(event.lineno)})`);
});

window.addEventListener('unhandledrejection', (event) => {
  report(`unhandled rejection: ${String(event.reason)}`);
});

// ---------------------------------------------------------------- state

const restored: unknown = vscode.getState();
if (isPanelStateShape(restored)) {
  targetPath = restored.targetPath;
  scrollLine = restored.scrollLine;
  // Filtered defensively: the local shape check only vouches for `targetPath`, and an unknown
  // status here would hide every comment rather than fail visibly.
  const saved = restored.filter;
  if (Array.isArray(saved)) filter = FILTERABLE.filter((status) => saved.includes(status));
}

/** Local shape check — the guard in `messages.ts` is host-side and not worth bundling for one call. */
function isPanelStateShape(value: unknown): value is PanelState {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['targetPath'] === 'string'
  );
}

function saveState(): void {
  const state: PanelState = { targetPath };
  if (scrollLine !== undefined) state.scrollLine = scrollLine;
  if (filter !== undefined) state.filter = filter;
  vscode.setState(state);
}

// ---------------------------------------------------------------- rendering

/**
 * `data-*` attributes already survive DOMPurify's default `ALLOW_DATA_ATTR`, but naming the ones
 * this codebase depends on documents that they are load-bearing, not incidental. Losing
 * `data-ap-start` / `data-ap-end` would silently disable anchoring.
 */
const SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style'],
  ADD_ATTR: ['data-line', 'data-no-anchor', 'data-ap-start', 'data-ap-end'],
};

function setContent(html: string, frontMatterHtml: string | undefined): void {
  hideNotice();

  const clean = DOMPurify.sanitize(html, SANITIZE_OPTIONS);
  contentRoot.innerHTML = clean;

  frontMatterRoot.innerHTML = frontMatterHtml
    ? DOMPurify.sanitize(frontMatterHtml, SANITIZE_OPTIONS)
    : '';

  highlightAll();
  // After highlighting, not before: highlight.js replaces the text nodes inside every `<pre>`, and
  // a map built against the old ones would point at detached nodes.
  resetBlockMaps();
  restoreScroll();
  // After `restoreScroll`, so the measured tops describe where the content actually settled.
  rebuildLineIndex();
  comments?.reposition();
}

function highlightAll(): void {
  for (const element of contentRoot.querySelectorAll('pre > code[class*="language-"]')) {
    if (!(element instanceof HTMLElement)) continue;
    const language = /language-([\w+#-]+)/.exec(element.className)?.[1];
    // Gate on a registered language so an unknown tag falls back to plain text rather than paying
    // for highlight.js's autodetect, which is both slow and frequently wrong.
    if (language && hljs.getLanguage(language)) {
      hljs.highlightElement(element);
    }
  }
}

// ---------------------------------------------------------------- commenting

/**
 * Wires selection capture and the card gutter together. Deferred until `init` because the popover
 * shows the author the host will attribute new comments to, and only the host knows it (it comes
 * from `markdownReview.author` or the system username).
 */
function startCommenting(author: string): CommentsView {
  selection = initSelection({
    root: contentRoot,
    author,
    onSubmit: ({ selectedText, offset, hintLine, body }) => {
      announce('Comment added.');
      vscode.postMessage({ type: 'addComment', selectedText, offset, hintLine, body });
    },
    onReanchor: ({ id, selectedText, offset, hintLine }) => {
      announce('Comment re-anchored to the selected text.');
      vscode.postMessage({ type: 'reanchorComment', id, selectedText, offset, hintLine });
    },
    onArmChange: (id) => orphans?.setArmed(id),
    onWarning: report,
  });

  orphans = initOrphans({
    root: orphansRoot,
    announce,
    onDelete: (id) => {
      vscode.postMessage({ type: 'deleteComment', id });
    },
    onReanchor: (id) => selection?.armReanchor(id),
    onCancelReanchor: () => selection?.disarm(),
  });

  header = initHeader({
    root: headerRoot,
    onCopyPrompt: () => {
      vscode.postMessage({ type: 'copyPrompt' });
    },
    onClearAddressed: () => {
      vscode.postMessage({ type: 'clearAddressed' });
    },
    onClearAll: () => {
      vscode.postMessage({ type: 'clearAll' });
    },
    onFilterChange: (statuses) => {
      filter = statuses;
      saveState();
      comments?.setFilter(statuses);
      // The orphan section filters on the same chips (H23).
      orphans?.setFilter(statuses);
      announce(
        statuses.length === FILTERABLE.length
          ? 'Showing all comments.'
          : `Showing ${statuses.join(', ')} comments.`,
      );
    },
  });

  // A filter restored from a previous session applies before the first state arrives, so the pane
  // does not flash every comment and then hide half of them.
  if (filter) {
    header.setFilter(filter);
    orphans.setFilter(filter);
  }

  return initComments({
    root: contentRoot,
    gutter: gutterRoot,
    overlay: overlayRoot,
    markerLayer: markerRoot,
    announce,
    onEdit: (id, body) => {
      vscode.postMessage({ type: 'editComment', id, body });
    },
    onDelete: (id) => {
      vscode.postMessage({ type: 'deleteComment', id });
    },
    onResolve: (id) => {
      vscode.postMessage({ type: 'resolveComment', id });
    },
    onReopen: (id) => {
      vscode.postMessage({ type: 'reopenComment', id });
    },
  });
}

// ---------------------------------------------------------------- notices

function hideNotice(): void {
  noticeRoot.hidden = true;
  noticeRoot.replaceChildren();
}

/** Built with `createElement`/`textContent`, never `innerHTML` — the habit matters more than the case. */
function showNotice(heading: string, body: string, ...actions: { label: string; run: () => void }[]): void {
  const title = document.createElement('h2');
  title.textContent = heading;

  const text = document.createElement('p');
  text.textContent = body;

  noticeRoot.replaceChildren(title, text);

  let firstButton: HTMLButtonElement | undefined;
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    noticeRoot.append(button);
    firstButton ??= button;
  }

  noticeRoot.hidden = false;
  // A document being rewritten under the user, or its file becoming unreadable, was announced to
  // nobody (H18). `role="alert"` is set at build time rather than in the shell so it fires on
  // *this* content; moving focus to the recovery action makes the notice actionable by keyboard
  // without hunting for it.
  noticeRoot.setAttribute('role', 'alert');
  firstButton?.focus();
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

// ---------------------------------------------------------------- scrolling

/**
 * `[data-line]` elements with their document-relative tops, rebuilt once per render (H26).
 *
 * `currentScrollLine` used to walk every `[data-line]` element calling `getBoundingClientRect()`
 * until one intersected the viewport — a forced layout, proportional to the document, on every
 * animation frame while scrolling. Positions only move when the content or the layout does, so
 * they are measured once and searched.
 */
let lineIndex: Array<{ bottom: number; line: number }> = [];

/** Page coordinates — the window is the scroller, so these are scroll-invariant. */
function rebuildLineIndex(): void {
  const next: Array<{ bottom: number; line: number }> = [];
  for (const element of contentRoot.querySelectorAll('[data-line]')) {
    const line = Number(element.getAttribute('data-line'));
    if (!Number.isFinite(line)) continue;
    next.push({ bottom: element.getBoundingClientRect().bottom + window.scrollY, line });
  }
  lineIndex = next;
}

function currentScrollLine(): number | undefined {
  // The topmost block still intersecting the viewport. Anchoring to a `data-line` rather than a
  // pixel offset means the position survives a re-render that changes layout.
  //
  // The original walked every element calling `getBoundingClientRect()` until one intersected,
  // every frame; this searches the memo instead and touches layout only through `scrollY`.
  if (lineIndex.length === 0) return undefined;
  const fold = window.scrollY;

  // First entry whose bottom is still below the fold. Ascending by construction, so binary search.
  let low = 0;
  let high = lineIndex.length - 1;
  let found: number | undefined;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = lineIndex[mid];
    if (!entry) break;
    if (entry.bottom > fold) {
      found = entry.line;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return found;
}

function restoreScroll(): void {
  if (scrollLine === undefined) return;

  let best: Element | undefined;
  for (const element of contentRoot.querySelectorAll('[data-line]')) {
    const line = Number(element.getAttribute('data-line'));
    if (Number.isFinite(line) && line <= scrollLine) best = element;
    else break;
  }
  best?.scrollIntoView({ block: 'start' });
}

window.addEventListener(
  'scroll',
  () => {
    if (scrollFrame !== 0) return;
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      scrollLine = currentScrollLine();
      saveState();
    });
  },
  { passive: true },
);

// ---------------------------------------------------------------- links

document.addEventListener('click', (event) => {
  const target = event.target;
  const anchor = target instanceof Element ? target.closest('a') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;

  // The webview must never navigate (PRD §6). Every link is handled here or not at all.
  event.preventDefault();

  const href = anchor.getAttribute('href') ?? '';

  if (href.startsWith('#')) {
    let id = href.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Malformed escape — fall back to the raw fragment.
    }
    const smooth = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
    document
      .getElementById(id)
      ?.scrollIntoView(smooth ? { behavior: 'smooth', block: 'start' } : { block: 'start' });
    return;
  }

  if (/^(?:https?:|mailto:)/i.test(href)) {
    vscode.postMessage({ type: 'openExternal', url: href });
  }

  // Relative document links are deliberately inert: a `file:` URI must not reach `openExternal`,
  // and "open the sibling file in its own review pane" is a feature, not a Phase 2 side effect.
});

// ---------------------------------------------------------------- host messages

/**
 * True while a notice has replaced the document (`tooLarge`, `targetUnreadable`). With no content
 * there are no rectangles, so gutter cards would pile at the origin — and while the target is
 * unreadable, the orphan section's **Re-anchor** competes with the notice's **Locate file…** and
 * wins on discoverability, which is exactly how the B4 acceptance step went untested twice
 * (§10 D22 / H7). While gone, the comment views are emptied; the data is untouched host-side.
 */
let documentGone = false;
/** The last review state, so the notice cases can re-apply it with `documentGone` flipped. */
let lastReviewState: Extract<HostMessage, { type: 'reviewState' }> | undefined;

/**
 * The first-run hint (H20).
 *
 * The pane's whole loop — select, comment, copy the prompt — was undiscoverable from a cold start:
 * with no comments the header hides itself, so a new user saw a rendered document and nothing
 * else. Shown only while the review is genuinely empty, dismissable for the session, and never
 * shown again once the pane is carrying a comment.
 */
let emptyStateDismissed = false;

function paintEmptyState(isEmpty: boolean): void {
  if (!isEmpty || emptyStateDismissed || documentGone) {
    emptyStateRoot.hidden = true;
    emptyStateRoot.replaceChildren();
    return;
  }
  if (!emptyStateRoot.hidden) return; // already up; do not rebuild under the user

  const title = document.createElement('p');
  title.className = 'mr-empty-title';
  title.textContent = 'Select any text to leave a comment';

  const body = document.createElement('p');
  body.className = 'mr-empty-body';
  body.textContent =
    'Then use Copy review prompt to hand your comments to any AI agent. It edits the file as ordinary prose — this pane works out which comments were addressed.';

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'mr-button-secondary';
  dismiss.textContent = 'Got it';
  dismiss.addEventListener('click', () => {
    emptyStateDismissed = true;
    paintEmptyState(true);
  });

  emptyStateRoot.replaceChildren(title, body, dismiss);
  emptyStateRoot.hidden = false;
}

function applyReviewState(message: Extract<HostMessage, { type: 'reviewState' }>): void {
  paintEmptyState(message.review.comments.length === 0);
  // Order matters, and not cosmetically. `#header` and `#orphans` are both in normal flow
  // *above* `#content`, so showing or resizing either one moves every block below it. Cards and
  // highlights are placed from measured rectangles, so they have to be measured last — updating
  // them first left every highlight offset by the height of whatever appeared above it, which
  // showed up as highlights landing on the wrong line.
  header?.setState(message.review);
  if (documentGone) {
    // The content is gone, but a mark is state on an element: clear it rather than trust that
    // the element went with it.
    applyChangeMarks(contentRoot, undefined);
    orphans?.setState([], {});
    comments?.setState({ ...message.review, comments: [] }, {}, []);
    return;
  }
  orphans?.setState(message.review.comments, message.located, message.sectionChanged);
  // Before the cards: `setState` redraws the overlay, and that pass draws a bar for every block
  // marked here. The marks add nothing to the flow, so measuring after them is still exact.
  applyChangeMarks(contentRoot, message.changes);
  comments?.setState(message.review, message.located, message.sectionChanged);
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data as HostMessage;
  if (typeof message !== 'object' || message === null) return;

  switch (message.type) {
    case 'init':
      targetPath = message.targetPath;
      saveState();
      comments ??= startCommenting(message.author);
      break;

    case 'reviewState':
      lastReviewState = message;
      applyReviewState(message);
      break;

    case 'rewriteDetected':
      showNotice(
        'The document was rewritten',
        `${String(message.orphaned)} comments could not be relocated. Their original text is listed above, and nothing has been deleted.`,
        {
          label: 'Review the diff',
          run: () => {
            vscode.postMessage({ type: 'showRewriteDiff' });
          },
        },
        {
          // The banner otherwise stays until the next render (H7): a user who has taken it in has
          // no way to get it off the screen.
          label: 'Dismiss',
          run: hideNotice,
        },
      );
      break;

    case 'setContent':
      documentGone = false;
      setContent(message.html, message.frontMatterHtml);
      break;

    case 'tooLarge':
      documentGone = true;
      contentRoot.replaceChildren();
      frontMatterRoot.replaceChildren();
      if (lastReviewState) applyReviewState(lastReviewState);
      showNotice(
        'This file is large',
        `Rendering ${formatBytes(message.sizeBytes)} of Markdown may make the pane slow to open and scroll.`,
        {
          label: 'Render anyway',
          run: () => {
            vscode.postMessage({ type: 'renderAnyway' });
          },
        },
      );
      break;

    case 'targetUnreadable':
      // The notice replaces the document (H7): stale content under "this file could not be read"
      // reads as the file still being there, and the orphan section must not offer Re-anchor
      // against text that no longer has a source.
      documentGone = true;
      contentRoot.replaceChildren();
      frontMatterRoot.replaceChildren();
      if (lastReviewState) applyReviewState(lastReviewState);
      showNotice(
        'This file could not be read',
        `It may have been moved, renamed or deleted. The pane is still open, and nothing has been lost. (${message.reason})`,
        {
          // PRD §11's "offer to re-link". The comments survive the file, so this is a way back
          // rather than a dead end.
          label: 'Locate file…',
          run: () => {
            vscode.postMessage({ type: 'relinkTarget' });
          },
        },
      );
      break;
  }
});

vscode.postMessage({ type: 'ready' });
