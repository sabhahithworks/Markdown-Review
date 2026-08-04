/**
 * HTML rendering for the review pane (Plan 02 §4 — contract owner for markdown-it configuration,
 * `data-line` injection, front-matter presentation and image-URI rewriting).
 *
 * **No `vscode` import.** Everything host-specific arrives through an injected callback, which is
 * why `resolveImage` exists rather than a direct `webview.asWebviewUri` call. ESLint enforces this.
 *
 * **Why there is no `{ ok } | { !ok }` result union.** The conventions require discriminated unions
 * at pure-module boundaries *for expected failures*. markdown-it has no expected-failure mode on
 * arbitrary text — every string renders — and the sibling contract owner `renderPlainText` returns
 * a bare object for the same reason. Do not "fix" this toward the convention.
 *
 * ## The consistency invariant
 *
 * This module and `plaintext.ts` hold **separate** `createMarkdownIt()` instances. They stay in
 * anchor-space agreement because:
 *
 * 1. Both call `splitFrontMatter` on an NFC-normalized source and parse the identical `body`.
 * 2. Every mutation here is attribute-only (the core rule) or render-time-only (`renderer.rules.*`,
 *    which `md.parse` never consults). Neither can change the token stream.
 * 3. A fence's `data-line` is `map[0] + 1`, matching `plaintext.ts`'s `BlockSpan.sourceLineStart`.
 *
 * `src/test/renderer.test.ts` R6 enforces (2) and R7 enforces (3). If R7 fails, the DOM and anchor
 * space have desynced and Phase 3's `hintLine` lookups are silently wrong — do not weaken it.
 */

import type MarkdownIt from 'markdown-it';
import { splitFrontMatter } from './frontMatter.js';
import { createMarkdownIt } from './markdownIt.js';

/**
 * Maps a markdown image `src` to a webview-safe URI, or returns `null` to leave the original
 * untouched (which renders broken — the deliberate outcome for anything outside the target file's
 * directory tree, rather than granting access to it).
 */
export type ImageResolver = (src: string) => string | null;

export interface RenderOptions {
  resolveImage?: ImageResolver;
}

export interface RenderedDoc {
  /** Body HTML. Block elements carry `data-line` in on-disk, 0-based line numbers. */
  html: string;
  /** The collapsed front-matter block. Absent when the document had no front matter. */
  frontMatterHtml?: string;
  /** Always equals `renderPlainText(source).frontMatterLineOffset` for the same source. */
  lineOffset: number;
}

/**
 * Per-document state. It rides on `env` rather than a closure because the markdown-it instance is a
 * module singleton reused across documents — a captured `lineOffset` would leak from one render
 * into the next. R10 is the regression test.
 */
interface RenderEnv {
  lineOffset: number;
  resolveImage: ImageResolver | undefined;
  /** Heading-slug dedupe counters, per render, so ids do not accumulate suffixes across calls. */
  slugs: Map<string, number>;
}

/** Module-private, so nothing else can collide with the slot or read it by accident. */
const ENV_SLOT = Symbol('markdownReview.renderEnv');

const FALLBACK_ENV: RenderEnv = { lineOffset: 0, resolveImage: undefined, slugs: new Map() };

function isRenderEnv(value: unknown): value is RenderEnv {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['lineOffset'] === 'number'
  );
}

function readEnv(env: MarkdownIt.Env | undefined): RenderEnv {
  const slot = env?.[ENV_SLOT];
  return isRenderEnv(slot) ? slot : FALLBACK_ENV;
}

/**
 * Builds a configured instance. Exported only as a test seam (R6 compares this instance's token
 * stream against a bare `createMarkdownIt()`); production uses the module singleton below.
 */
export function createRenderMarkdownIt(): MarkdownIt.MarkdownIt {
  const md = createMarkdownIt();
  const { escapeHtml } = md.utils;

  md.core.ruler.push('markdown_review_data_line', (state: MarkdownIt.StateCore): void => {
    const env = readEnv(state.env);

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (!token?.map) continue;
      // Closing tokens carry no attributes of their own; `inline` tokens are unwrapped by
      // `renderInline`, so an attribute there would never reach the DOM.
      if (token.nesting === -1 || token.type === 'inline') continue;

      // A fence's BlockSpan starts at `map[0] + 1` in plaintext.ts — the first *content* line, not
      // the ``` marker. `data-line` must agree, or Phase 3's hintLine -> BlockSpan lookup misses
      // every fenced block in the document. Indented `code_block` needs no adjustment: plaintext
      // anchors it at `map[0]`, on the token's own first line.
      const line = (token.type === 'fence' ? token.map[0] + 1 : token.map[0]) + env.lineOffset;
      token.attrSet('data-line', String(line));

      if (token.type === 'heading_open') {
        // markdown-it emits no heading ids, so in-document `#fragment` links would have nothing to
        // scroll to (Plan 02 §5 promises they work). `markdown-it-anchor` is not an approved
        // dependency, and this is a dozen lines.
        token.attrSet('id', uniqueSlug(inlineTextOf(state.tokens[i + 1]), env.slugs));
      }
    }
  });

  /**
   * Overridden rather than left to the default rule for two reasons: the default puts token
   * attributes on `<code>` while indented code blocks put them on `<pre>` (two different
   * `[data-line]` ancestor shapes for the same conceptual block), and highlight.js expects exactly
   * `<pre><code class="language-x">`. Highlighting itself happens webview-side, so the host stays
   * free of DOM-shaped concerns.
   */
  md.renderer.rules.fence = (tokens, idx): string => {
    const token = tokens[idx];
    if (!token) return '';

    const info = token.info.trim().split(/\s+/)[0] ?? '';
    // Anything that is not a plain language identifier is dropped rather than escaped: an info
    // string like `"><script` has no business reaching a class attribute at all.
    const lang = /^[\w+#-]{1,24}$/.test(info) ? info : '';

    // Set by the core rule above as a decimal string; `attrGet` is typed `string | number | null`.
    const line = token.attrGet('data-line');
    const lineAttr = line === null ? '' : ` data-line="${escapeHtml(String(line))}"`;
    const classAttr = lang ? ` class="${escapeHtml(String(md.options.langPrefix) + lang)}"` : '';

    return `<pre${lineAttr}><code${classAttr}>${escapeHtml(token.content)}</code></pre>\n`;
  };

  const baseImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, options, env, self): string => {
    const token = tokens[idx];
    const resolve = readEnv(env).resolveImage;
    const src = token?.attrGet('src');

    if (token && resolve && typeof src === 'string') {
      const mapped = resolve(src);
      if (mapped !== null) token.attrSet('src', mapped);
    }

    // Delegate so `alt` is still built from the nested alt tokens (markdown-it's own kludge for
    // the CommonMark alt-text rule); re-implementing it here would be a second source of truth.
    return baseImage
      ? baseImage(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  // Rendered content is untrusted and opens in the user's browser; `noopener` is the minimum.
  const baseLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self): string => {
    tokens[idx]?.attrSet('rel', 'noopener noreferrer');
    return baseLinkOpen
      ? baseLinkOpen(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  return md;
}

const md = createRenderMarkdownIt();
const escapeHtml = md.utils.escapeHtml;

export function renderMarkdown(source: string, options: RenderOptions = {}): RenderedDoc {
  // The same NFC step `renderPlainText` applies. Both must see byte-identical input or their line
  // maps can diverge on decomposed characters.
  const split = splitFrontMatter(source.normalize('NFC'));

  const env: MarkdownIt.Env = {
    [ENV_SLOT]: {
      lineOffset: split.lineOffset,
      resolveImage: options.resolveImage,
      slugs: new Map<string, number>(),
    } satisfies RenderEnv,
  };

  const result: RenderedDoc = {
    html: md.render(split.body, env),
    lineOffset: split.lineOffset,
  };

  if (split.frontMatter !== undefined) {
    result.frontMatterHtml = renderFrontMatter(split.frontMatter);
  }

  return result;
}

/**
 * Front matter is shown, never parsed as markdown, and carries **no `data-line`**.
 *
 * `data-no-anchor` is a forward hook for Phase 3 (Plan 03 §2): selections inside this block must
 * never become anchors, because front matter is excluded from anchor space by construction. The
 * panel also injects it outside `<main id="content">`, so there are two independent guarantees —
 * no `[data-line]` ancestor exists here, and this attribute is an explicit reject.
 */
function renderFrontMatter(frontMatter: string): string {
  return (
    '<details class="front-matter" data-no-anchor="true">' +
    '<summary>Front matter</summary>' +
    `<pre><code>${escapeHtml(frontMatter)}</code></pre>` +
    '</details>'
  );
}

/** Concatenates an inline token's rendered text — the same idea as `plaintext.ts`'s `inlineText`. */
function inlineTextOf(token: MarkdownIt.Token | undefined): string {
  if (!token?.children) return token?.content ?? '';
  let out = '';
  for (const child of token.children) {
    if (child.type === 'text' || child.type === 'text_special' || child.type === 'code_inline') {
      out += child.content;
    }
  }
  return out;
}

/**
 * A GitHub-shaped heading slug, deduped per render. Not exported: the slug format is an internal
 * detail of in-document links, and nothing outside this module should depend on it.
 */
function uniqueSlug(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';

  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${String(count)}`;
}
