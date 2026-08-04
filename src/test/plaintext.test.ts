import { describe, expect, it } from 'vitest';
import { collapse, normalizeAnchorText, offsetToSourceLine, renderPlainText } from '../render/plaintext.js';
import { offsetOf } from './helpers.js';

describe('collapse', () => {
  it('collapses whitespace runs and trims', () => {
    expect(collapse('  a \t\n b  ')).toBe('a b');
  });

  it('collapses the exotic spaces JS \\s already covers', () => {
    expect(collapse('a b')).toBe('a b'); // NBSP
    expect(collapse('a b')).toBe('a b'); // EM SPACE
    expect(collapse('a　b')).toBe('a b'); // IDEOGRAPHIC SPACE
    expect(collapse('a﻿b')).toBe('a b'); // ZWNBSP
  });

  it('does NOT touch zero-width joiners — they are structural, not whitespace', () => {
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // 👨‍👩‍👧
    expect(collapse(family)).toBe(family);
    expect(collapse('a​b')).toBe('a​b'); // ZWSP
    expect(collapse('a‌b')).toBe('a‌b'); // ZWNJ
  });

  it('passes bidi controls through verbatim', () => {
    expect(collapse('‫مرحبا‬')).toBe('‫مرحبا‬');
  });
});

describe('normalizeAnchorText', () => {
  it('applies NFC so combining sequences compare equal to their composed form', () => {
    expect(normalizeAnchorText('é')).toBe('é');
    expect(normalizeAnchorText('  café  ')).toBe('café');
  });
});

describe('renderPlainText — blocks and joining', () => {
  it('handles the empty document', () => {
    const doc = renderPlainText('');
    expect(doc).toEqual({ text: '', blocks: [], frontMatterLineOffset: 0 });
  });

  it('handles a document that is only front matter', () => {
    const doc = renderPlainText('---\ntitle: x\n---\n');
    expect(doc.text).toBe('');
    expect(doc.blocks).toEqual([]);
    expect(doc.frontMatterLineOffset).toBe(3);
  });

  it('joins blocks with \\n and leaves no trailing newline', () => {
    const doc = renderPlainText('# Title\n\nFirst para.\n\nSecond para.\n');
    expect(doc.text).toBe('Title\nFirst para.\nSecond para.');
    expect(doc.text.endsWith('\n')).toBe(false);
  });

  it('records heading kind and level', () => {
    const doc = renderPlainText('# One\n\n### Three\n');
    expect(doc.blocks[0]).toMatchObject({ kind: 'heading', headingLevel: 1 });
    expect(doc.blocks[1]).toMatchObject({ kind: 'heading', headingLevel: 3 });
  });

  it('produces non-empty, ascending, non-overlapping spans', () => {
    const doc = renderPlainText(
      '# H\n\nPara one.\n\n- item a\n- item b\n\n> quoted\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n',
    );
    let previousEnd = -1;
    for (const block of doc.blocks) {
      expect(block.end).toBeGreaterThan(block.start);
      expect(block.start).toBeGreaterThan(previousEnd);
      previousEnd = block.end;
    }
    expect(doc.blocks.at(-1)?.end).toBe(doc.text.length);
  });

  it('collapses intra-block whitespace but keeps blocks separate', () => {
    const doc = renderPlainText('A line\nwrapped   across\nthree lines.\n\nNext block.\n');
    expect(doc.text).toBe('A line wrapped across three lines.\nNext block.');
  });
});

describe('renderPlainText — inline content', () => {
  it('renders a link as its label, dropping the URL', () => {
    const doc = renderPlainText('See the [auth guide](https://example.com/auth) for details.\n');
    expect(doc.text).toBe('See the auth guide for details.');
  });

  it('renders inline code verbatim and strips emphasis markers', () => {
    const doc = renderPlainText('Call `doThing()` with **bold** and *italic* and ~~gone~~.\n');
    expect(doc.text).toBe('Call doThing() with bold and italic and gone.');
  });

  it('renders image alt text, including emphasized alt', () => {
    const doc = renderPlainText('Here: ![*fancy* diagram](d.png) end.\n');
    expect(doc.text).toBe('Here: fancy diagram end.');
  });

  it('turns soft and hard breaks into single spaces', () => {
    const doc = renderPlainText('a  \nb\nc\n');
    expect(doc.text).toBe('a b c');
  });

  it('decodes entities and escapes the way the reader sees them', () => {
    const doc = renderPlainText('Text with &amp; entity and \\* escape\n');
    expect(doc.text).toBe('Text with & entity and * escape');
  });

  it('drops the synthetic <input> that markdown-it-task-lists injects', () => {
    const doc = renderPlainText('- [x] done thing\n- [ ] todo thing\n');
    expect(doc.text).not.toContain('<input');
    expect(doc.text).toBe('done thing\ntodo thing');
  });
});

describe('renderPlainText — lists, blockquotes, tables', () => {
  it('keeps tight-list items (their paragraph tokens are hidden but real)', () => {
    const doc = renderPlainText('Intro:\n\n- one\n- two\n- three\n');
    expect(doc.text).toBe('Intro:\none\ntwo\nthree');
    expect(doc.blocks).toHaveLength(4);
  });

  it('handles nested lists and blockquotes', () => {
    const doc = renderPlainText('- outer\n  - inner\n\n> quoted\n>\n> > deeply quoted\n');
    expect(doc.text).toBe('outer\ninner\nquoted\ndeeply quoted');
  });

  it('makes each table cell its own block but one line per row', () => {
    const doc = renderPlainText('| Name | Type |\n|---|---|\n| id | string |\n');
    expect(doc.text).toBe('Name Type\nid string');

    const cells = doc.blocks.map((b) => doc.text.slice(b.start, b.end));
    expect(cells).toEqual(['Name', 'Type', 'id', 'string']);
  });

  it('skips empty table cells without breaking the row', () => {
    const doc = renderPlainText('| A | B | C |\n|---|---|---|\n| 1 |  | 3 |\n');
    expect(doc.text).toBe('A B C\n1 3');
  });
});

describe('renderPlainText — code', () => {
  it('preserves fenced code verbatim, trimming exactly one trailing newline', () => {
    const doc = renderPlainText('```js\nconst x = 1;\n    indented\n\n```\n');
    expect(doc.text).toBe('const x = 1;\n    indented\n');
    expect(doc.blocks[0]?.kind).toBe('code');
  });

  it('preserves indented code blocks verbatim', () => {
    const doc = renderPlainText('Intro:\n\n    indented code\n    line two\n');
    expect(doc.text).toBe('Intro:\nindented code\nline two');
    expect(doc.blocks[1]?.kind).toBe('code');
  });

  it('does not collapse whitespace inside code', () => {
    const doc = renderPlainText('```\na    b\n```\n');
    expect(doc.text).toBe('a    b');
  });
});

describe('renderPlainText — front matter and source lines', () => {
  it('adds stripped front-matter lines back into every source line number', () => {
    const withFm = renderPlainText('---\ntitle: x\nowner: y\n---\n# Heading\n\nBody.\n');
    const without = renderPlainText('# Heading\n\nBody.\n');

    expect(withFm.text).toBe(without.text);
    expect(withFm.frontMatterLineOffset).toBe(4);
    expect(withFm.blocks[0]?.sourceLineStart).toBe(4);
    expect(without.blocks[0]?.sourceLineStart).toBe(0);
  });

  it('does not strip an unterminated `---` (it is a horizontal rule)', () => {
    const doc = renderPlainText('---\n\nStill here.\n');
    expect(doc.text).toBe('Still here.');
    expect(doc.frontMatterLineOffset).toBe(0);
  });

  it('reports source lines that match the original file', () => {
    const source = '# Title\n\nFirst para.\n\nSecond para.\n';
    const doc = renderPlainText(source);
    const lines = source.split('\n');

    for (const block of doc.blocks) {
      const blockText = doc.text.slice(block.start, block.end);
      expect(lines[block.sourceLineStart]).toContain(blockText);
    }
  });
});

describe('offsetToSourceLine', () => {
  const source = [
    '# Title', // 0
    '', // 1
    'Intro paragraph.', // 2
    '', // 3
    '```js', // 4
    'const a = 1;', // 5
    'const b = 2;', // 6
    'const c = 3;', // 7
    '```', // 8
    '', // 9
    'Closing paragraph.', // 10
    '',
  ].join('\n');
  const doc = renderPlainText(source);

  it('maps the first and last character of a block', () => {
    const start = offsetOf(doc, 'Intro paragraph.');
    expect(offsetToSourceLine(doc, start)).toBe(2);
    expect(offsetToSourceLine(doc, start + 'Intro paragraph.'.length - 1)).toBe(2);
  });

  it('counts newlines inside a code block instead of reporting one line for all of it', () => {
    expect(offsetToSourceLine(doc, offsetOf(doc, 'const a = 1;'))).toBe(5);
    expect(offsetToSourceLine(doc, offsetOf(doc, 'const b = 2;'))).toBe(6);
    expect(offsetToSourceLine(doc, offsetOf(doc, 'const c = 3;'))).toBe(7);
  });

  it('maps a joiner offset to the following block — a selection there is entering that block', () => {
    const introStart = offsetOf(doc, 'Intro paragraph.');
    expect(doc.text[introStart - 1]).toBe('\n');
    expect(offsetToSourceLine(doc, introStart - 1)).toBe(2);
  });

  it('clamps offsets past the end of the document', () => {
    expect(offsetToSourceLine(doc, doc.text.length + 1000)).toBe(10);
    expect(offsetToSourceLine(doc, -5)).toBe(0);
  });

  it('returns -1 for a document with no blocks', () => {
    expect(offsetToSourceLine(renderPlainText(''), 0)).toBe(-1);
  });
});

describe('renderPlainText — unicode', () => {
  it('survives emoji, CJK, combining marks and RTL', () => {
    const doc = renderPlainText('The 家族 👨‍👩‍👧 met café owners and مرحبا readers.\n');
    expect(doc.text).toBe('The 家族 👨‍👩‍👧 met café owners and مرحبا readers.');
  });

  it('normalizes decomposed input to NFC once, at the top', () => {
    const doc = renderPlainText('café society\n');
    expect(doc.text).toBe('café society');
  });
});

describe('renderPlainText — idempotence', () => {
  it('re-rendering a document’s own plain text is stable', () => {
    const once = renderPlainText('# Title\n\nSome **bold** prose here.\n\n- a\n- b\n');
    const twice = renderPlainText(once.text);
    expect(renderPlainText(twice.text).text).toBe(twice.text);
  });
});
