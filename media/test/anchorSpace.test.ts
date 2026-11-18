/**
 * DOM ⇄ anchor-space mapping (Plan 03 §2 / §9 C1).
 *
 * The governing assertion is the round-trip: render a document to HTML *and* to anchor space with
 * the host's own code, put the HTML in a real DOM, and check that walking the DOM reproduces the
 * exact substring anchor space says each block holds. That is the property the whole commenting
 * feature rests on — an anchor created against a wrong offset points at the wrong prose forever.
 *
 * The three cases called out in Plan 03 §9 C1 as *guaranteed* divergences for a naive `textContent`
 * walk — image alt text, table-cell joining, fenced code — each get a dedicated test, because they
 * are exactly the ones a refactor would quietly break.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { renderPlainText } from '../../src/render/plaintext.js';
import { renderMarkdown } from '../../src/render/renderer.js';
import {
  blockText,
  blocksIn,
  domRangeFor,
  offsetAt,
  resetBlockMaps,
  textOfRange,
  verifyBlockMap,
} from '../src/anchorSpace.js';

/** Renders `source` into the test document exactly as the webview would, minus sanitization. */
function mount(source: string): { root: HTMLElement; text: string } {
  document.body.innerHTML = '<main id="content"></main>';
  const root = document.getElementById('content');
  if (!root) throw new Error('missing #content');
  root.innerHTML = renderMarkdown(source).html;
  return { root, text: renderPlainText(source).text };
}

/** The first text node whose content contains `needle`. */
function textNodeWith(root: ParentNode, needle: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.nodeValue ?? '').includes(needle)) return node as Text;
    node = walker.nextNode();
  }
  throw new Error(`no text node containing ${JSON.stringify(needle)}`);
}

beforeEach(() => {
  resetBlockMaps();
});

describe('block mapping agrees with anchor space', () => {
  const documents: Array<readonly [string, string]> = [
    ['paragraphs and headings', '# Title\n\nFirst para.\n\nSecond   para  here.\n'],
    ['soft-wrapped prose', 'A line\nwrapped   across\nthree lines.\n\nNext block.\n'],
    ['inline emphasis and links', 'A **bold** word and [a link](https://x.test) inline.\n'],
    ['inline code', 'Call `fn(a,   b)` to start.\n'],
    ['a table', '| Name | Type |\n|---|---|\n| id | string |\n'],
    ['tight lists', '- outer\n  - inner\n- second\n'],
    ['loose lists', '- one\n\n- two\n'],
    ['blockquotes', '> quoted\n>\n> > deeply quoted\n'],
    ['a fenced code block', '```js\nconst x = 1;\n    indented\n\n```\n'],
    ['an indented code block', 'Text.\n\n    plain indented\n    second line\n'],
    ['images with alt text', 'See ![a wide diagram](d.png) here.\n'],
    ['an image alone in a block', '![solo alt text](d.png)\n'],
    ['hard breaks', 'first line  \nsecond line\n'],
    ['task lists', '- [ ] todo item\n- [x] done item\n'],
    ['front matter', '---\ntitle: x\n---\n\n# After\n\nBody text.\n'],
    ['entities and escapes', 'A &amp; B \\* C\n'],
    ['unicode', 'Emoji 👨‍👩‍👧 and café naïve\n'],
  ];

  it.each(documents)('reproduces every block of %s', (_label, source) => {
    const { root, text } = mount(source);
    const refs = blocksIn(root);
    const doc = renderPlainText(source);

    // Guard against a vacuous pass: a selector that matched nothing would satisfy the loop below.
    expect(refs).toHaveLength(doc.blocks.length);

    for (const ref of refs) {
      expect(blockText(ref.el)).toBe(text.slice(ref.start, ref.end));
      expect(verifyBlockMap(ref)).toBe(true);
    }
  });
});

describe('the three known divergences of a naive textContent walk', () => {
  it('includes image alt text, which contributes no DOM text node', () => {
    const source = 'See ![a wide diagram](d.png) here.\n';
    const { root, text } = mount(source);
    const [ref] = blocksIn(root);
    if (!ref) throw new Error('no block');

    expect(text).toContain('a wide diagram');
    expect(blockText(ref.el)).toBe(text);
    // The naive walk this guards against.
    expect(ref.el.textContent).not.toContain('a wide diagram');
  });

  it('keeps table cells as separate blocks joined by a space, not a newline', () => {
    const source = '| Name | Type |\n|---|---|\n| id | string |\n';
    const { root, text } = mount(source);

    expect(text).toBe('Name Type\nid string');
    expect(blocksIn(root).map((ref) => blockText(ref.el))).toEqual([
      'Name',
      'Type',
      'id',
      'string',
    ]);
  });

  it('keeps fenced code verbatim, trailing newline trimmed', () => {
    const source = '```js\nconst x = 1;\n    indented\n\n```\n';
    const { root, text } = mount(source);
    const [ref] = blocksIn(root);
    if (!ref) throw new Error('no block');

    expect(blockText(ref.el)).toBe('const x = 1;\n    indented\n');
    expect(blockText(ref.el)).toBe(text.slice(ref.start, ref.end));
  });
});

describe('data-no-anchor inside a block', () => {
  function mountList(): HTMLElement {
    document.body.innerHTML =
      '<main id="content"><ul><li data-ap-start="0" data-ap-end="4">item' +
      '<div><p data-no-anchor="title">Note</p><p data-ap-start="5" data-ap-end="9">Body</p></div>' +
      '</li></ul></main>';
    const li = document.querySelector('li');
    if (!li) throw new Error('missing li');
    return li;
  }

  it('no-anchor subtree inside a block is skipped', () => {
    expect(blockText(mountList())).toBe('item');
  });

  it('a nested block beside a no-anchor subtree keeps its own text', () => {
    mountList();
    const nested = document.querySelector('p[data-ap-start]');
    if (!(nested instanceof HTMLElement)) throw new Error('missing nested p');
    expect(blockText(nested)).toBe('Body');
  });
});

describe('offsetAt', () => {
  it('maps a position inside a paragraph to its anchor-space offset', () => {
    const source = '# Title\n\nThe quick brown fox.\n';
    const { root, text } = mount(source);
    const node = textNodeWith(root, 'quick');
    const within = (node.nodeValue ?? '').indexOf('quick');

    expect(offsetAt(node, within)).toBe(text.indexOf('quick'));
  });

  it('maps a position inside a table cell', () => {
    const source = '| Name | Type |\n|---|---|\n| id | string |\n';
    const { root, text } = mount(source);
    const node = textNodeWith(root, 'string');

    expect(offsetAt(node, 0)).toBe(text.indexOf('string'));
  });

  it('maps a position inside a fenced block, newlines intact', () => {
    const source = '```js\nalpha\nbeta\n```\n';
    const { root, text } = mount(source);
    const node = textNodeWith(root, 'beta');

    expect(offsetAt(node, (node.nodeValue ?? '').indexOf('beta'))).toBe(text.indexOf('beta'));
  });

  it('maps across soft-wrapped lines, where a newline collapses to one space', () => {
    const source = 'A line\nwrapped   across\nthree lines.\n';
    const { root, text } = mount(source);
    const node = textNodeWith(root, 'across');

    expect(text).toBe('A line wrapped across three lines.');
    expect(offsetAt(node, (node.nodeValue ?? '').indexOf('across'))).toBe(text.indexOf('across'));
  });

  it('returns null outside anchor space', () => {
    document.body.innerHTML = '<div data-no-anchor="true"><p>front matter</p></div>';
    const node = textNodeWith(document.body, 'front matter');
    expect(offsetAt(node, 0)).toBeNull();
  });
});

describe('textOfRange', () => {
  it('returns exactly what anchor space holds for a within-block selection', () => {
    const source = 'The quick brown fox jumps.\n';
    const { root, text } = mount(source);
    const node = textNodeWith(root, 'quick');
    const from = (node.nodeValue ?? '').indexOf('quick');

    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, from + 'quick brown'.length);

    const start = offsetAt(range.startContainer, range.startOffset);
    const end = offsetAt(range.endContainer, range.endOffset);
    expect(textOfRange(range, root)).toBe('quick brown');
    expect(start).not.toBeNull();
    if (start !== null && end !== null) expect(text.slice(start, end)).toBe('quick brown');
  });

  it('joins blocks with a newline, matching rule 6', () => {
    const source = 'First para.\n\nSecond para.\n';
    const { root, text } = mount(source);
    const range = document.createRange();
    range.setStart(textNodeWith(root, 'First'), 0);
    const second = textNodeWith(root, 'Second');
    range.setEnd(second, (second.nodeValue ?? '').length);

    expect(textOfRange(range, root)).toBe('First para.\nSecond para.');
    expect(textOfRange(range, root)).toBe(text);
  });

  it('joins cells of one row with a space, matching rule 4', () => {
    const source = '| Name | Type |\n|---|---|\n| id | string |\n';
    const { root } = mount(source);
    const range = document.createRange();
    range.setStart(textNodeWith(root, 'id'), 0);
    const last = textNodeWith(root, 'string');
    range.setEnd(last, (last.nodeValue ?? '').length);

    expect(textOfRange(range, root)).toBe('id string');
  });
});

describe('domRangeFor', () => {
  it('round-trips a within-block span back to the same text', () => {
    const source = '# Title\n\nThe quick brown fox jumps.\n';
    const { root, text } = mount(source);
    const start = text.indexOf('brown');
    const range = domRangeFor(root, start, start + 'brown fox'.length);

    expect(range).not.toBeNull();
    expect(range?.toString()).toBe('brown fox');
  });

  it('round-trips every word of a document', () => {
    const source = 'Alpha beta gamma.\n\nDelta epsilon.\n';
    const { root, text } = mount(source);

    for (const word of ['Alpha', 'beta', 'gamma', 'Delta', 'epsilon']) {
      const start = text.indexOf(word);
      expect(domRangeFor(root, start, start + word.length)?.toString()).toBe(word);
    }
  });

  it('returns null for a span past the end of the document', () => {
    const { root, text } = mount('Short.\n');
    expect(domRangeFor(root, text.length + 10, text.length + 20)).toBeNull();
  });
});
