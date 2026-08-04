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
import type { HostMessage, PanelState, WebviewMessage } from '../../src/panel/messages.js';
import { resetBlockMaps } from './anchorSpace.js';
import type { CommentsView } from './comments.js';
import { initComments } from './comments.js';
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

/** Built on `init`, because the popover shows the author the host will attribute the comment to. */
let comments: CommentsView | undefined;

let targetPath = '';
/** A `data-line` value, not a pixel offset, so it survives a re-render that changes layout. */
let scrollLine: number | undefined;
let scrollFrame = 0;

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
  const state: PanelState = scrollLine === undefined ? { targetPath } : { targetPath, scrollLine };
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
  initSelection({
    root: contentRoot,
    author,
    onSubmit: ({ selectedText, offset, hintLine, body }) => {
      vscode.postMessage({ type: 'addComment', selectedText, offset, hintLine, body });
    },
    onWarning: report,
  });

  return initComments({
    root: contentRoot,
    gutter: gutterRoot,
    overlay: overlayRoot,
    onEdit: (id, body) => {
      vscode.postMessage({ type: 'editComment', id, body });
    },
    onDelete: (id) => {
      vscode.postMessage({ type: 'deleteComment', id });
    },
    onResolve: (id) => {
      vscode.postMessage({ type: 'resolveComment', id });
    },
  });
}

// ---------------------------------------------------------------- notices

function hideNotice(): void {
  noticeRoot.hidden = true;
  noticeRoot.replaceChildren();
}

/** Built with `createElement`/`textContent`, never `innerHTML` — the habit matters more than the case. */
function showNotice(heading: string, body: string, action?: { label: string; run: () => void }): void {
  const title = document.createElement('h2');
  title.textContent = heading;

  const text = document.createElement('p');
  text.textContent = body;

  noticeRoot.replaceChildren(title, text);

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', action.run);
    noticeRoot.append(button);
  }

  noticeRoot.hidden = false;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

// ---------------------------------------------------------------- scrolling

function currentScrollLine(): number | undefined {
  // The topmost block still intersecting the viewport. Anchoring to a `data-line` rather than a
  // pixel offset means the position survives a re-render that changes layout.
  for (const element of contentRoot.querySelectorAll('[data-line]')) {
    if (element.getBoundingClientRect().bottom > 0) {
      const line = Number(element.getAttribute('data-line'));
      return Number.isFinite(line) ? line : undefined;
    }
  }
  return undefined;
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
      comments?.setState(message.review, message.located);
      break;

    case 'setContent':
      setContent(message.html, message.frontMatterHtml);
      break;

    case 'tooLarge':
      contentRoot.replaceChildren();
      frontMatterRoot.replaceChildren();
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
      showNotice(
        'This file could not be read',
        `It may have been moved, renamed or deleted. The pane is still open, and nothing has been lost. (${message.reason})`,
      );
      break;
  }
});

vscode.postMessage({ type: 'ready' });
