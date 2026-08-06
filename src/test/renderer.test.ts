/**
 * Renderer tests (Plan 02 §4).
 *
 * The highest-value case here is "data-line covers every BlockSpan": it is the only automated check
 * that the rendered DOM and anchor space agree about where things are. Everything else in Phase 2
 * is recoverable; a desync there corrupts every anchor Phase 3 creates.
 *
 * Positions are asserted by *content* (`lines[n] === '# Kitchen Sink'`) rather than by hardcoded
 * numbers, so an edit to the fixture moves the assertion instead of breaking it.
 */

import { describe, expect, it } from 'vitest';
import { createMarkdownIt } from '../render/markdownIt.js';
import { renderPlainText } from '../render/plaintext.js';
import type { ImageResolver } from '../render/renderer.js';
import { createRenderMarkdownIt, renderMarkdown } from '../render/renderer.js';
import { readFixture } from './helpers.js';

const KITCHEN_SINK = readFixture('kitchen-sink.md');
const KITCHEN_SINK_LINES = KITCHEN_SINK.split('\n');

/** Every `data-line` value in a rendered document, in document order. */
function dataLines(html: string): number[] {
  return [...html.matchAll(/data-line="(\d+)"/g)].map((match) => Number(match[1]));
}

/**
 * Every `[data-ap-start, data-ap-end]` pair in a rendered document, in document order. The two
 * attributes are always written together and last, so they are always adjacent in the markup.
 */
function anchorSpans(html: string): [number, number][] {
  return [...html.matchAll(/data-ap-start="(\d+)" data-ap-end="(\d+)"/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
}

/** The `data-line` of the first element matching `pattern`, which must capture the number. */
function firstDataLine(html: string, pattern: RegExp): number {
  const match = pattern.exec(html);
  if (!match?.[1]) throw new Error(`no match for ${pattern.source}`);
  return Number(match[1]);
}

describe('R1 — data-line points at real, on-disk line numbers', () => {
  const { html, lineOffset } = renderMarkdown(KITCHEN_SINK);

  it('reports the front-matter offset', () => {
    // The fixture opens with a 4-line YAML block between two `---` delimiters.
    expect(lineOffset).toBe(5);
  });

  it('keeps every value inside the file', () => {
    for (const line of dataLines(html)) {
      expect(line).toBeGreaterThanOrEqual(0);
      expect(line).toBeLessThan(KITCHEN_SINK_LINES.length);
    }
  });

  it.each([
    ['the h1', /<h1[^>]*data-line="(\d+)"/, '# Kitchen Sink'],
    ['the first h2', /<h2[^>]*data-line="(\d+)"/, '## Prose and inline formatting'],
    ['the table', /<table data-line="(\d+)"/, '| Field | Type | Required | Notes |'],
    ['the horizontal rule', /<hr data-line="(\d+)"/, '---'],
  ])('anchors %s at its own source line', (_label, pattern, expected) => {
    expect(KITCHEN_SINK_LINES[firstDataLine(html, pattern)]).toBe(expected);
  });

  it('anchors a fence at its first content line, not the ``` marker', () => {
    const line = firstDataLine(html, /<pre data-line="(\d+)"[^>]*><code class="language-ts"/);
    expect(KITCHEN_SINK_LINES[line]).toBe(
      'export function verify(token: string, keys: KeySet): Claims {',
    );
    // The marker line sits immediately above. Asserting it explicitly documents the carve-out.
    expect(KITCHEN_SINK_LINES[line - 1]).toBe('```ts');
  });

  it('anchors indented code at its own first line', () => {
    const line = firstDataLine(html, /<pre data-line="(\d+)"[^>]*><code>plain indented/);
    expect(KITCHEN_SINK_LINES[line]).toBe('    plain indented block');
  });
});

describe('R2 — front-matter offset agrees with anchor space', () => {
  it.each([
    ['the kitchen-sink fixture', KITCHEN_SINK],
    ['a document with no front matter', '# Title\n\nBody text.\n'],
    ['a document that is only front matter', '---\na: 1\n---\n'],
    // `splitFrontMatter` deliberately strips nothing when the closing delimiter is missing —
    // the alternative erases the document. The renderer must inherit that, not re-decide it.
    ['unterminated front matter', '---\na: 1\n\n# Still here\n'],
    ['a CRLF document', '---\r\na: 1\r\n---\r\n\r\n# Title\r\n'],
  ])('matches renderPlainText for %s', (_label, source) => {
    expect(renderMarkdown(source).lineOffset).toBe(renderPlainText(source).frontMatterLineOffset);
  });

  it('leaves an unterminated block in the body', () => {
    const { html, frontMatterHtml } = renderMarkdown('---\na: 1\n\n# Still here\n');
    expect(frontMatterHtml).toBeUndefined();
    expect(html).toContain('Still here');
  });
});

describe('R3 — image rewriting', () => {
  function renderWith(markdown: string, resolveImage: ImageResolver) {
    return renderMarkdown(markdown, { resolveImage }).html;
  }

  it('passes relative sources to the resolver and applies the result', () => {
    const seen: string[] = [];
    const html = renderWith('![alt](./diagram.png)', (src) => {
      seen.push(src);
      return 'vscode-webview://host/diagram.png';
    });
    expect(seen).toEqual(['./diagram.png']);
    expect(html).toContain('src="vscode-webview://host/diagram.png"');
  });

  it('leaves the source untouched when the resolver declines', () => {
    // The deliberate outcome for anything escaping the target's directory tree: broken image,
    // never a granted resource root.
    const html = renderWith('![alt](../../escape.png)', () => null);
    expect(html).toContain('src="../../escape.png"');
  });

  it('neutralizes remote sources without consulting the resolver (H6)', () => {
    // PRD §2/§13: no network calls, ever. A remote image URL in reviewed content must not become
    // an outbound request — the element keeps its alt (anchor space is untouched), the URL moves
    // to `title`, and the class lets the stylesheet render it as a reference.
    const seen: string[] = [];
    const html = renderWith('![a](https://example.com/x.png)', (src) => {
      seen.push(src);
      return null;
    });
    expect(seen).toEqual([]);
    expect(html).not.toContain('src="https://example.com/x.png"');
    expect(html).toContain('src=""');
    expect(html).toContain('title="https://example.com/x.png"');
    expect(html).toContain('class="mr-remote-image"');
    expect(html).toContain('alt="a"');
  });

  it('neutralizes http and protocol-relative sources too (H6)', () => {
    expect(renderWith('![a](http://example.com/x.png)', () => null)).toContain('src=""');
    expect(renderWith('![a](//example.com/x.png)', () => null)).toContain('src=""');
  });

  it('still consults the resolver for data URIs, and honours a null', () => {
    // The renderer classifies only remote schemes (H6); everything else stays the host resolver's
    // job, where `vscode` is legal. Here we only prove a `null` verdict is respected verbatim.
    const html = renderWith('![b](data:image/gif;base64,R0lGOD)', () => null);
    expect(html).toContain('src="data:image/gif;base64,R0lGOD"');
  });

  it('hands the resolver the percent-encoded source markdown-it produced', () => {
    // Decoding before touching disk is the host's responsibility; pinning the encoded form here is
    // what makes that division of labour visible.
    const seen: string[] = [];
    renderWith('![alt](<./my image.png>)\n\n![alt](./café.png)', (src) => {
      seen.push(src);
      return null;
    });
    expect(seen).toEqual(['./my%20image.png', './caf%C3%A9.png']);
  });

  it('still derives alt text from nested tokens', () => {
    const html = renderWith('![*Emphasised* alt text](./flow.png)', () => null);
    expect(html).toContain('alt="Emphasised alt text"');
  });

  it('works with no resolver at all', () => {
    expect(renderMarkdown('![alt](./x.png)').html).toContain('src="./x.png"');
  });
});

describe('R4 — injection attempts are inert', () => {
  const { html } = renderMarkdown(KITCHEN_SINK);

  // The fixture's injection section survives as *escaped text*, so the raw substrings `onerror=`
  // and `javascript:` are legitimately present in the output. What must not exist is any of it in
  // element or attribute position — which is what these patterns test.
  it('emits no live script element', () => {
    expect(html).not.toMatch(/<script/i);
  });

  it('emits no event-handler attribute on any element', () => {
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
  });

  it('escapes raw HTML from the source', () => {
    expect(html).toContain("&lt;script&gt;alert('xss')&lt;/script&gt;");
    expect(html).toContain('&lt;img src=x onerror=');
  });

  it('refuses a javascript: link', () => {
    // markdown-it's own `validateLink` rejects it, so it never becomes an href and degrades to
    // literal text instead.
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain("[Click me](javascript:alert('xss'))");
  });

  it('marks outbound links noopener', () => {
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('R5 — fence escaping and shape', () => {
  it('escapes content that tries to close its own element', () => {
    const { html } = renderMarkdown('```\n</code></pre><script>alert(1)</script>\n```\n');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;');
  });

  it('puts data-line on <pre> and the language class on <code>', () => {
    const { html } = renderMarkdown('```ts\nconst x = 1;\n```\n');
    expect(html).toMatch(/<pre data-line="1"[^>]*><code class="language-ts">/);
  });

  it('omits the class for an untagged fence', () => {
    const { html } = renderMarkdown('```\nplain\n```\n');
    expect(html).toContain('<code>plain');
    expect(html).not.toContain('class="language-');
  });

  it('uses only the first info word', () => {
    const { html } = renderMarkdown('```ts {highlight=1}\nconst x = 1;\n```\n');
    expect(html).toContain('class="language-ts"');
  });

  it.each([
    ['a quote-and-tag payload', '"><script'],
    ['a space-separated attribute', 'ts"onload="alert(1)'],
    ['an over-long identifier', 'a'.repeat(25)],
  ])('drops %s rather than escaping it into a class', (_label, info) => {
    const { html } = renderMarkdown('```' + info + '\nx\n```\n');
    expect(html).not.toContain('class="language-');
    expect(html).not.toContain('onload');
  });
});

describe('R6 — the renderer instance does not change tokenization', () => {
  it('produces a token stream identical to the plain factory, apart from added attributes', () => {
    const body = KITCHEN_SINK_LINES.slice(5).join('\n');
    const decorated = createRenderMarkdownIt().parse(body, {});
    const plain = createMarkdownIt().parse(body, {});

    expect(decorated).toHaveLength(plain.length);

    for (const [i, base] of plain.entries()) {
      const under = decorated[i];
      expect(under).toBeDefined();
      if (!under) continue;

      // Everything anchor space is derived from must be byte-identical. `attrs` is the only field
      // allowed to differ, and only by `data-line` / `id` / the `data-ap-*` offset pair.
      expect({
        type: under.type,
        tag: under.tag,
        nesting: under.nesting,
        level: under.level,
        map: under.map,
        content: under.content,
        info: under.info,
        markup: under.markup,
        hidden: under.hidden,
        children: under.children?.length ?? null,
      }).toEqual({
        type: base.type,
        tag: base.tag,
        nesting: base.nesting,
        level: base.level,
        map: base.map,
        content: base.content,
        info: base.info,
        markup: base.markup,
        hidden: base.hidden,
        children: base.children?.length ?? null,
      });

      const added = (under.attrs ?? []).filter(
        ([name]) => !(base.attrs ?? []).some(([baseName]) => baseName === name),
      );
      for (const [name] of added) {
        expect(['data-line', 'id', 'data-ap-start', 'data-ap-end']).toContain(name);
      }
    }
  });
});

describe('R7 — data-line covers every block in anchor space', () => {
  /**
   * If this fails, the rendered DOM and `renderPlainText` disagree about where a block starts, and
   * Phase 3's `hintLine` -> `BlockSpan` lookup will silently miss. Fix the renderer; do not relax
   * the assertion.
   */
  it.each([
    ['the kitchen-sink fixture', KITCHEN_SINK],
    ['a document with no front matter', '# A\n\ntext\n\n```js\ncode\n```\n\n- a\n- b\n'],
    ['nested lists and tables', '| a | b |\n|---|---|\n| 1 | 2 |\n\n- x\n  - y\n    - z\n'],
    ['consecutive fences', '```js\na\n```\n\n```py\nb\n```\n\n```\nc\n```\n'],
  ])('covers every BlockSpan.sourceLineStart in %s', (_label, source) => {
    const doc = renderPlainText(source);
    const rendered = new Set(dataLines(renderMarkdown(source).html));

    const missing = doc.blocks
      .map((block) => block.sourceLineStart)
      .filter((line) => !rendered.has(line));

    expect(missing).toEqual([]);
  });
});

describe('R13 — data-ap-* carries every anchor-space offset into the DOM', () => {
  /**
   * The Phase 3 replacement for "the webview rebuilds anchor space from the DOM" (Plan 03 §9 C1).
   * The webview reads these attributes instead of re-deriving block boundaries, so if the stamped
   * pairs stop matching `renderPlainText`'s spans exactly, every anchor created against a stamped
   * block lands at the wrong offset. Fix the renderer; do not relax the assertion.
   */
  it.each([
    ['the kitchen-sink fixture', KITCHEN_SINK],
    ['a document with no front matter', '# A\n\ntext\n\n```js\ncode\n```\n\n- a\n- b\n'],
    ['nested lists and tables', '| a | b |\n|---|---|\n| 1 | 2 |\n\n- x\n  - y\n    - z\n'],
    ['consecutive fences', '```js\na\n```\n\n```py\nb\n```\n\n```\nc\n```\n'],
    ['images, whose alt text is in anchor space but not in the DOM', '![a diagram](d.png) after\n'],
  ])('stamps exactly the BlockSpan offsets of %s, in document order', (_label, source) => {
    const doc = renderPlainText(source);
    const stamped = anchorSpans(renderMarkdown(source).html);

    expect(stamped).toEqual(doc.blocks.map((block) => [block.start, block.end]));
  });

  it('puts a tight list item’s offsets on its <li>, not its hidden <p>', () => {
    // The carrier walk-back exists for exactly this: `renderToken` emits nothing for a hidden
    // token, so offsets stamped on a tight `paragraph_open` would never reach the DOM.
    const { html } = renderMarkdown('- alpha\n- beta\n');
    const doc = renderPlainText('- alpha\n- beta\n');

    expect(anchorSpans(html)).toEqual(doc.blocks.map((block) => [block.start, block.end]));
    expect(/<li[^>]*data-ap-start=/.test(html)).toBe(true);
  });

  it('survives the hand-built fence rule', () => {
    // `renderer.rules.fence` builds its markup by hand, so it forwards attributes explicitly and is
    // the one place a new attribute can silently go missing.
    const source = '```js\nconst x = 1;\n```\n';
    const doc = renderPlainText(source);
    const { html } = renderMarkdown(source);

    expect(anchorSpans(html)).toEqual(doc.blocks.map((block) => [block.start, block.end]));
    expect(html).toMatch(/<pre[^>]*data-ap-start="\d+" data-ap-end="\d+"/);
  });

  it('leaves front matter unstamped', () => {
    const { frontMatterHtml } = renderMarkdown(KITCHEN_SINK);
    expect(frontMatterHtml).not.toContain('data-ap-start');
  });
});

describe('R14 — every span gets its own carrier element', () => {
  it('stamps as many elements as there are blocks', () => {
    // `stampAnchorSpace` skips a carrier that is already stamped rather than overwriting it, so a
    // collision shows up here as a shortfall instead of as a wrong offset in production.
    for (const source of [
      KITCHEN_SINK,
      '- tight\n- list\n',
      '- loose\n\n- list\n',
      '> quoted\n>\n> > deeper\n',
      '| a | b |\n|---|---|\n| 1 | 2 |\n',
      '- outer\n  - inner\n    - deepest\n',
    ]) {
      expect(anchorSpans(renderMarkdown(source).html)).toHaveLength(
        renderPlainText(source).blocks.length,
      );
    }
  });
});

describe('R8 — front matter is shown but excluded from anchor space', () => {
  const { frontMatterHtml } = renderMarkdown(KITCHEN_SINK);

  it('renders a collapsed, non-anchorable block', () => {
    expect(frontMatterHtml).toBeDefined();
    expect(frontMatterHtml).toContain('<details class="front-matter" data-no-anchor="true">');
    expect(frontMatterHtml).toContain('owner: platform-team');
    expect(frontMatterHtml).not.toContain('data-line');
  });

  it('escapes the YAML rather than parsing it', () => {
    const { frontMatterHtml: escaped } = renderMarkdown('---\nx: "<b>&</b>"\n---\n\nbody\n');
    expect(escaped).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
    expect(escaped).not.toContain('<b>');
  });

  it('keeps the same content out of the anchor text', () => {
    // The pair is the point: it is visible in the pane and absent from anchor space.
    expect(renderPlainText(KITCHEN_SINK).text).not.toContain('owner: platform-team');
  });
});

describe('R9 — CRLF documents produce the same line numbers', () => {
  it('is unaffected by line endings', () => {
    const crlf = KITCHEN_SINK.replace(/\n/g, '\r\n');
    expect(dataLines(renderMarkdown(crlf).html)).toEqual(dataLines(renderMarkdown(KITCHEN_SINK).html));
  });
});

describe('R10 — per-document state does not leak between renders', () => {
  it('keeps line offsets independent', () => {
    const withFrontMatter = KITCHEN_SINK;
    const without = '# Other\n\nbody\n';

    const first = dataLines(renderMarkdown(withFrontMatter).html);
    renderMarkdown(without);
    const second = dataLines(renderMarkdown(withFrontMatter).html);

    // A `lineOffset` captured in a factory closure instead of `env` would drift here.
    expect(second).toEqual(first);
  });

  it('does not accumulate heading-slug suffixes across renders', () => {
    const source = '# Title\n\n## Title\n';
    const first = renderMarkdown(source).html;
    const second = renderMarkdown(source).html;
    expect(second).toBe(first);
    expect(first).toContain('id="title"');
    expect(first).toContain('id="title-1"');
  });

  it('generates a usable slug for a heading with no word characters', () => {
    expect(renderMarkdown('# ???\n').html).toContain('id="section"');
  });
});

describe('R11 — degenerate documents', () => {
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   \n\n  \n'],
    ['a single ---', '---\n'],
    ['front matter only', '---\ntitle: x\n---\n'],
  ])('survives %s', (_label, source) => {
    expect(() => renderMarkdown(source)).not.toThrow();
    expect(renderMarkdown(source).lineOffset).toBe(renderPlainText(source).frontMatterLineOffset);
  });

  it('returns empty html for an empty document', () => {
    const result = renderMarkdown('');
    expect(result.html).toBe('');
    expect(result.frontMatterHtml).toBeUndefined();
    expect(result.lineOffset).toBe(0);
  });

  it('returns only the front-matter block for a front-matter-only document', () => {
    const result = renderMarkdown('---\ntitle: x\n---\n');
    expect(result.html.trim()).toBe('');
    expect(result.frontMatterHtml).toContain('title: x');
    expect(renderPlainText('---\ntitle: x\n---\n').blocks).toHaveLength(0);
  });
});

describe('R12 — tight-list paragraphs stay covered', () => {
  it('has a visible element on every hidden paragraph line', () => {
    // markdown-it marks tight-list `paragraph_open` tokens hidden, so their attributes are never
    // emitted. Anchor space still resolves because `list_item_open` carries the same line. That is
    // a property of markdown-it's token structure, not a guarantee — assert it so an upgrade that
    // changes it fails here instead of silently breaking hint lookups inside lists.
    const body = KITCHEN_SINK_LINES.slice(5).join('\n');
    const hidden = createRenderMarkdownIt()
      .parse(body, {})
      .filter((token) => token.hidden && token.map)
      .map((token) => (token.map?.[0] ?? 0) + 5);

    expect(hidden.length).toBeGreaterThan(0);

    const rendered = new Set(dataLines(renderMarkdown(KITCHEN_SINK).html));
    expect(hidden.filter((line) => !rendered.has(line))).toEqual([]);
  });
});
