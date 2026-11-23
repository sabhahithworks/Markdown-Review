import { describe, expect, it } from 'vitest';
import { promptPointerLine } from '../prompt/pointer.js';

describe('promptPointerLine', () => {
  it('the line names the path in single quotes and holds no line break', () => {
    const line = promptPointerLine('/w/.reviews/docs__a.md.prompt.md');
    expect(line).toBe("Read the review instructions in '/w/.reviews/docs__a.md.prompt.md' and follow them.");
    expect(line).not.toMatch(/[\r\n]/);
  });

  it('a Windows path is kept verbatim', () => {
    const p = 'C:\\Users\\a b\\.reviews\\x.prompt.md';
    expect(promptPointerLine(p)).toBe(`Read the review instructions in '${p}' and follow them.`);
  });

  it('a path with a line break gives no line', () => {
    expect(promptPointerLine('/w/a\nb')).toBeUndefined();
    expect(promptPointerLine('/w/a\rb')).toBeUndefined();
  });

  it('a path with a shell substitution is quoted, not run', () => {
    const p = '/w/docs/$(touch x).md.prompt.md';
    const line = promptPointerLine(p);
    expect(line).toBe(`Read the review instructions in '${p}' and follow them.`);
    expect(line).not.toContain('`');
  });

  it('a path that could leave the quotes gives no line', () => {
    expect(promptPointerLine("/w/a'b.md")).toBeUndefined();
    // PowerShell takes all four typographic single quotes as a quote (D-q17).
    expect(promptPointerLine('/w/a\u2018b.md')).toBeUndefined();
    expect(promptPointerLine('/w/a\u2019b.md')).toBeUndefined();
    expect(promptPointerLine('/w/a\u201ab.md')).toBeUndefined();
    expect(promptPointerLine('/w/a\u201bb.md')).toBeUndefined();
    expect(promptPointerLine('/w/a&b.md')).toBeUndefined();
    expect(promptPointerLine('/w/a|b.md')).toBeUndefined();
    expect(promptPointerLine('/w/a<b.md')).toBeUndefined();
    expect(promptPointerLine('/w/a>b.md')).toBeUndefined();
    expect(promptPointerLine('/w/a^b.md')).toBeUndefined();
    expect(promptPointerLine('/w/a%b.md')).toBeUndefined();
  });
});
