import { describe, expect, it } from 'vitest';
import { promptPointerLine } from '../prompt/pointer.js';

describe('promptPointerLine', () => {
  it('the line names the path in backticks and holds no line break', () => {
    const line = promptPointerLine('/w/.reviews/docs__a.md.prompt.md');
    expect(line).toBe('Read the review instructions in `/w/.reviews/docs__a.md.prompt.md` and follow them.');
    expect(line).not.toMatch(/[\r\n]/);
  });

  it('a Windows path is kept verbatim', () => {
    const p = 'C:\\Users\\a b\\.reviews\\x.prompt.md';
    expect(promptPointerLine(p)).toBe(`Read the review instructions in \`${p}\` and follow them.`);
  });

  it('a path with a line break gives no line', () => {
    expect(promptPointerLine('/w/a\nb')).toBeUndefined();
    expect(promptPointerLine('/w/a\rb')).toBeUndefined();
  });
});
