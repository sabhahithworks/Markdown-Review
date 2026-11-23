/**
 * The commenting loop, end to end, minus VS Code (Plan 03 §2–§5).
 *
 * This is the path a real comment takes: the user selects rendered text, the webview maps it into
 * anchor space, the host builds an `Anchor`, and later `locate` finds it again and the webview maps
 * the result back onto the DOM. Every step here is the production function; only the VS Code
 * plumbing between them is simulated.
 *
 * It is worth having as one test because each half can be individually correct and still disagree —
 * which is precisely the failure this phase was designed to make impossible.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAnchor } from '../../src/anchor/create.js';
import { locate } from '../../src/anchor/locate.js';
import { CONFIDENCE } from '../../src/anchor/types.js';
import { renderPlainText } from '../../src/render/plaintext.js';
import { renderMarkdown } from '../../src/render/renderer.js';
import { domRangeFor, offsetAt, resetBlockMaps, textOfRange } from '../src/anchorSpace.js';

function mount(source: string): HTMLElement {
  document.body.innerHTML = '<main id="content"></main>';
  const root = document.getElementById('content');
  if (!root) throw new Error('missing #content');
  root.innerHTML = renderMarkdown(source).html;
  return root;
}

/** Selects `needle` in the rendered DOM, the way a user dragging over it would. */
function selectText(root: HTMLElement, needle: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const index = (node.nodeValue ?? '').indexOf(needle);
    if (index !== -1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      return range;
    }
    node = walker.nextNode();
  }
  throw new Error(`no text node containing ${JSON.stringify(needle)}`);
}

/** The webview half: a DOM range becomes the payload posted to the host. */
function capture(root: HTMLElement, range: Range): { selectedText: string; offset: number } {
  return {
    selectedText: textOfRange(range, root),
    offset: offsetAt(range.startContainer, range.startOffset) ?? -1,
  };
}

beforeEach(() => {
  resetBlockMaps();
});

const SOURCE = [
  '---',
  'title: Auth spec',
  '---',
  '',
  '# Authentication',
  '',
  'The service verifies **every** token before granting access to the vault.',
  '',
  'See ![the flow diagram](flow.png) for the handshake.',
  '',
  '| Field | Type |',
  '|---|---|',
  '| subject | string |',
  '',
  '- tight item one',
  '  - nested item',
  '',
  '```ts',
  'export function verify(token: string): Claims {',
  '  return decode(token);',
  '}',
  '```',
  '',
].join('\n');

describe('select → anchor → locate → highlight', () => {
  it.each([
    ['prose spanning inline emphasis', 'every'],
    ['a whole sentence', 'verifies'],
    // Not the alt text itself — that is not a DOM text node, so no drag can select it. The point is
    // that text *after* an image still lands correctly, which only works if the walk counts the alt
    // characters the way `inlineText` does.
    ['text following an image', 'for the handshake'],
    ['a table cell', 'subject'],
    ['a tight list item', 'tight item one'],
    ['a nested list item', 'nested item'],
    ['code inside a fence', 'return decode(token);'],
    ['a heading', 'Authentication'],
  ])('round-trips %s', (_label, needle) => {
    const root = mount(SOURCE);
    const doc = renderPlainText(SOURCE);

    // 1. The webview maps the selection into anchor space.
    const range = selectText(root, needle);
    const { selectedText, offset } = capture(root, range);
    expect(selectedText).toBe(needle);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(doc.text.slice(offset, offset + needle.length)).toBe(needle);

    // 2. The host turns it into a durable anchor.
    const created = createAnchor({ selectedText, offset, doc, hintLine: 0 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.anchor.exact).toBe(needle);

    // 3. Later, the host locates it again — with full confidence, since nothing changed.
    const found = locate(created.anchor, doc);
    expect(found).not.toBeNull();
    if (!found) return;
    expect(found.confidence).toBe(CONFIDENCE.EXACT_WITH_CONTEXT);
    expect(doc.text.slice(found.start, found.end)).toBe(needle);

    // 4. The webview maps the located span back onto the DOM.
    const highlight = domRangeFor(root, found.start, found.end);
    expect(highlight?.toString()).toBe(needle);
  });

  it('counts image alt text when mapping a position after an image', () => {
    // The divergence that makes a `textContent` walk wrong: anchor space contains "the flow
    // diagram", the DOM does not, so a walk that skips it lands 16 characters early.
    const root = mount(SOURCE);
    const doc = renderPlainText(SOURCE);
    const { offset } = capture(root, selectText(root, 'for the handshake'));

    expect(doc.text).toContain('See the flow diagram for the handshake.');
    expect(offset).toBe(doc.text.indexOf('for the handshake'));
  });

  it('still finds the passage after the document is edited around it', () => {
    const root = mount(SOURCE);
    const doc = renderPlainText(SOURCE);

    const { selectedText, offset } = capture(root, selectText(root, 'before granting access'));
    const created = createAnchor({ selectedText, offset, doc, hintLine: 0 });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // An agent prepends two paragraphs, shifting every offset in the document.
    const edited = `# Preface\n\nSome new opening prose here.\n\n${SOURCE}`;
    const editedDoc = renderPlainText(edited);

    const found = locate(created.anchor, editedDoc);
    expect(found).not.toBeNull();
    if (!found) return;
    expect(editedDoc.text.slice(found.start, found.end)).toBe('before granting access');

    // And the relocated span maps onto the re-rendered DOM.
    const editedRoot = mount(edited);
    expect(domRangeFor(editedRoot, found.start, found.end)?.toString()).toBe(
      'before granting access',
    );
  });

  it('rejects a selection shorter than the minimum without inventing an anchor', () => {
    const root = mount(SOURCE);
    const doc = renderPlainText(SOURCE);
    const range = selectText(root, 'Th');

    const created = createAnchor({ ...capture(root, range), doc, hintLine: 0 });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.reason).toBe('too-short');
  });

  it('anchors from hintLine alone when the webview could not map the selection', () => {
    // The `offset: -1` fallback path (Plan 03 §2). The anchor is still usable: `locate` recovers an
    // exact position from the text itself.
    const doc = renderPlainText(SOURCE);
    const created = createAnchor({
      selectedText: 'return decode(token);',
      offset: -1,
      doc,
      hintLine: 19,
    });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = locate(created.anchor, doc);
    expect(found).not.toBeNull();
    if (found) expect(doc.text.slice(found.start, found.end)).toBe('return decode(token);');
  });
});

describe('alert round trip (release-expansion D31)', () => {
  const RICH = readFileSync(resolve(process.cwd(), 'docs/fixtures/rich-blocks.md'), 'utf8');

  it.each([
    ['an alert body', 'Notes carry extra context for the reader.'],
    ['the second paragraph of an alert', 'Second paragraph of a caution.'],
    ['an alert inside a tight list item', 'A note inside a tight list item.'],
  ])('round-trips %s', (_label, needle) => {
    const root = mount(RICH);
    const doc = renderPlainText(RICH);
    const { selectedText, offset } = capture(root, selectText(root, needle));

    expect(selectedText).toBe(needle);
    expect(doc.text.slice(offset, offset + needle.length)).toBe(needle);
  });

  it('keeps the alert title out of the block text', () => {
    const root = mount(RICH);
    const doc = renderPlainText(RICH);
    expect(doc.text).not.toContain('Read this first');
    expect(root.querySelector('.mr-alert-title[data-no-anchor]')).not.toBeNull();
  });
});
