import { describe, expect, it } from 'vitest';
import { createMarkdownIt } from '../render/markdownIt.js';

describe('createMarkdownIt', () => {
  const md = createMarkdownIt();

  it('pins the options the rest of the system depends on', () => {
    expect(md.options.html).toBe(false);
    expect(md.options.linkify).toBe(true);
    expect(md.options.typographer).toBe(false);
  });

  it('does not render raw HTML', () => {
    const html = md.render('<script>alert(1)</script>\n');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('leaves quotes and dashes untouched (typographer off)', () => {
    // Typographer would turn these into curly quotes and an em dash, silently changing the text
    // the user selected. Assert on the token stream: that is what anchor space is built from.
    const tokens = md.parse('He said "hello" -- then left.\n', {});
    const inline = tokens.find((t) => t.type === 'inline');

    expect(inline?.children?.[0]?.content).toBe('He said "hello" -- then left.');
    expect(md.render('He said "hello" -- then left.\n')).toContain('--');
  });

  it('linkifies bare URLs', () => {
    expect(md.render('See https://example.com now\n')).toContain('href="https://example.com"');
  });

  it('renders GFM tables and strikethrough from the default preset', () => {
    const html = md.render('| A | B |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<table>');
    expect(md.render('~~gone~~\n')).toContain('<s>');
  });

  it('renders task lists as non-interactive checkboxes', () => {
    const html = md.render('- [x] done\n- [ ] todo\n');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled');
  });
});
