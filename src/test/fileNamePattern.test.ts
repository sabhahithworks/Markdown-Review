import { describe, expect, it } from 'vitest';
import { globSafeName, isSameFileName } from '../store/fileNamePattern.js';

describe('globSafeName', () => {
  it('replaces each glob character with ?', () => {
    expect(globSafeName('spec [draft] {x}*?!.md')).toBe('spec ?draft? ?x????.md');
  });

  it('leaves a plain name unchanged', () => {
    expect(globSafeName('plain name.md')).toBe('plain name.md');
  });
});

describe('isSameFileName', () => {
  it('folds case on darwin and win32 only', () => {
    expect(isSameFileName('A.md', 'a.md', 'darwin')).toBe(true);
    expect(isSameFileName('A.md', 'a.md', 'win32')).toBe(true);
    expect(isSameFileName('A.md', 'a.md', 'linux')).toBe(false);
  });

  it('rejects different names', () => {
    expect(isSameFileName('a.md', 'b.md', 'darwin')).toBe(false);
  });
});
