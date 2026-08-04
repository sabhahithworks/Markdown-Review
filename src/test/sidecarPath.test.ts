/**
 * Sidecar naming (Plan 03 §3).
 *
 * The Windows case is the reason this module exists separately from `ReviewStore`: it is flagged in
 * the PRD and in CLAUDE.md as a likely bug source, and it is invisible when the whole suite runs on
 * macOS or Linux. Asserting it here makes the platform bug reproducible everywhere.
 */

import { describe, expect, it } from 'vitest';
import {
  REVIEWS_DIR,
  backupFileName,
  globalSidecarFileName,
  sidecarFileName,
  toTargetPath,
} from '../store/sidecarPath.js';

describe('sidecarFileName', () => {
  it('flattens the PRD §4 example', () => {
    expect(sidecarFileName('docs/specs/auth.md')).toBe('docs__specs__auth.md.json');
  });

  it('handles a file at the workspace root', () => {
    expect(sidecarFileName('README.md')).toBe('README.md.json');
  });

  it('normalizes Windows separators before substituting', () => {
    // The landmine: substituting `/` first would leave the backslashes in place, so the same
    // document would get a different sidecar on Windows than on macOS.
    expect(sidecarFileName('docs\\specs\\auth.md')).toBe('docs__specs__auth.md.json');
    expect(sidecarFileName('docs\\specs\\auth.md')).toBe(sidecarFileName('docs/specs/auth.md'));
  });

  it('handles a path that mixes separators', () => {
    expect(sidecarFileName('docs\\specs/auth.md')).toBe('docs__specs__auth.md.json');
  });

  it('strips a leading ./', () => {
    expect(sidecarFileName('./notes.md')).toBe('notes.md.json');
  });
});

describe('toTargetPath', () => {
  it('produces the forward-slash spelling stored in ReviewFile.targetPath', () => {
    expect(toTargetPath('docs\\specs\\auth.md')).toBe('docs/specs/auth.md');
    expect(toTargetPath('docs/specs/auth.md')).toBe('docs/specs/auth.md');
  });

  it('is idempotent', () => {
    expect(toTargetPath(toTargetPath('a\\b\\c.md'))).toBe('a/b/c.md');
  });
});

describe('globalSidecarFileName', () => {
  it('is stable for the same absolute path', () => {
    expect(globalSidecarFileName('/home/u/notes.md')).toBe(globalSidecarFileName('/home/u/notes.md'));
  });

  it('differs for different paths and leaks no directory names', () => {
    const a = globalSidecarFileName('/home/u/notes.md');
    const b = globalSidecarFileName('/home/u/other.md');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}\.json$/);
    expect(a).not.toContain('notes');
  });
});

describe('backupFileName', () => {
  it('appends .bak to the sidecar name (PRD §11)', () => {
    expect(backupFileName('docs__auth.md.json')).toBe('docs__auth.md.json.bak');
  });
});

describe('REVIEWS_DIR', () => {
  it('is the PRD §4 directory', () => {
    expect(REVIEWS_DIR).toBe('.reviews');
  });
});
