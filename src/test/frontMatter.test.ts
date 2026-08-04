import { describe, expect, it } from 'vitest';
import { splitFrontMatter, stripBom } from '../render/frontMatter.js';

describe('stripBom', () => {
  it('removes a leading BOM and leaves everything else alone', () => {
    expect(stripBom('﻿# Title')).toBe('# Title');
    expect(stripBom('# Title')).toBe('# Title');
    expect(stripBom('# Title﻿')).toBe('# Title﻿');
  });
});

describe('splitFrontMatter', () => {
  it('splits well-formed front matter', () => {
    const source = '---\ntitle: Auth\nowner: platform\n---\n# Heading\n\nBody.\n';
    const result = splitFrontMatter(source);

    expect(result.body).toBe('# Heading\n\nBody.\n');
    expect(result.lineOffset).toBe(4);
    expect(result.frontMatter).toBe('title: Auth\nowner: platform\n');
  });

  it('reports lineOffset such that body line 0 maps to the right source line', () => {
    const source = '---\na: 1\n---\nfirst body line\n';
    const { body, lineOffset } = splitFrontMatter(source);

    // '---', 'a: 1', '---' = 3 lines consumed.
    expect(lineOffset).toBe(3);
    expect(body.split('\n')[0]).toBe('first body line');
    expect(source.split('\n')[0 + lineOffset]).toBe('first body line');
  });

  it('handles empty front matter', () => {
    const result = splitFrontMatter('---\n---\nBody\n');
    expect(result.body).toBe('Body\n');
    expect(result.lineOffset).toBe(2);
    expect(result.frontMatter).toBe('');
  });

  it('strips a BOM before looking for the opening delimiter', () => {
    const result = splitFrontMatter('﻿---\na: 1\n---\nBody\n');
    expect(result.body).toBe('Body\n');
    expect(result.lineOffset).toBe(3);
  });

  it('preserves CRLF in the body', () => {
    const result = splitFrontMatter('---\r\na: 1\r\n---\r\n# Heading\r\n\r\nBody.\r\n');
    expect(result.body).toBe('# Heading\r\n\r\nBody.\r\n');
    expect(result.lineOffset).toBe(3);
  });

  it('tolerates trailing whitespace on the delimiters', () => {
    const result = splitFrontMatter('--- \na: 1\n---\t\nBody\n');
    expect(result.body).toBe('Body\n');
    expect(result.lineOffset).toBe(3);
  });

  it('does NOT strip when there is no closing delimiter', () => {
    // A document opening with a horizontal rule. Stripping here would erase the whole document.
    const source = '---\n\nA thematic break, not front matter.\n\nMore prose.\n';
    const result = splitFrontMatter(source);

    expect(result.body).toBe(source);
    expect(result.lineOffset).toBe(0);
    expect(result.frontMatter).toBeUndefined();
  });

  it('does not treat `...` as a closing delimiter', () => {
    const source = '---\na: 1\n...\nBody\n';
    const result = splitFrontMatter(source);

    expect(result.body).toBe(source);
    expect(result.lineOffset).toBe(0);
  });

  it('does not strip when the delimiter is not on the very first line', () => {
    const source = '\n---\na: 1\n---\nBody\n';
    expect(splitFrontMatter(source).lineOffset).toBe(0);
  });

  it('handles a document that is only front matter', () => {
    const result = splitFrontMatter('---\na: 1\n---\n');
    expect(result.body).toBe('');
    expect(result.lineOffset).toBe(3);
  });

  it('handles the empty document', () => {
    const result = splitFrontMatter('');
    expect(result.body).toBe('');
    expect(result.lineOffset).toBe(0);
  });
});
