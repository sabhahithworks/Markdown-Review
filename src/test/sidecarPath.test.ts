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
  notesFileName,
  notesPromptPath,
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

/**
 * The compensating pass for the Windows verification PRD §12 asks for and Plan 05 §9 could not
 * perform — no Windows machine was available for 0.1.0. These drive the naming rules with the
 * path shapes a Windows host produces, so the platform half of the landmine is at least reproducible
 * on the machines we do have.
 *
 * What this cannot reach is stated in Plan 05 §13 E7: real filesystem case-insensitivity,
 * `FileSystemWatcher` timing, and the clipboard.
 */
describe('Windows path shapes (Plan 05 §9)', () => {
  const WINDOWS_RELATIVE = [
    'docs\\specs\\auth.md',
    'docs\\specs\\deeply\\nested\\file.md',
    'My Documents\\design notes.md',
    'docs\\ünïcode\\ᴀuth.md',
    'a\\b\\c\\d\\e\\f\\g.md',
    'README.md',
    '.\\README.md',
  ];

  it('never leaves a separator in the flattened name', () => {
    // The invariant that keeps every sidecar inside `.reviews/`. If a separator survived here, the
    // name would be read as a subdirectory and the write would land somewhere unintended.
    for (const input of WINDOWS_RELATIVE) {
      const name = sidecarFileName(input);
      expect(name, input).not.toContain('/');
      expect(name, input).not.toContain('\\');
      expect(name, input).toMatch(/\.json$/);
    }
  });

  it('agrees with the POSIX spelling of the same path', () => {
    // The whole point: one document, one sidecar name, whichever host produced the relative path.
    for (const input of WINDOWS_RELATIVE) {
      expect(sidecarFileName(input), input).toBe(sidecarFileName(input.replace(/\\/g, '/')));
    }
  });

  it('does not let a `..` segment traverse out of the reviews directory', () => {
    // `path.relative` can produce these in principle. They flatten into ordinary filename text
    // rather than a parent-directory reference, which is what makes the flattening safe.
    expect(sidecarFileName('..\\a.md')).toBe('..__a.md.json');
    expect(sidecarFileName('..\\..\\a.md')).toBe('..__..__a.md.json');
    for (const name of [sidecarFileName('..\\a.md'), sidecarFileName('..\\..\\a.md')]) {
      expect(name.split(/[/\\]/)).toHaveLength(1);
    }
  });

  it('documents the precondition that the path is workspace-relative', () => {
    // Absolute Windows paths are OUT OF CONTRACT, and cannot arise: `resolveSidecar` only calls
    // this when `getWorkspaceFolder(target)` returned a folder, and that API returns a folder only
    // when it *contains* the target — so `path.relative` cannot cross a drive or emit a UNC root.
    //
    // Asserted anyway, because the failure would be Windows-only and remote: a drive letter
    // survives as a `:`, which is illegal in a Windows filename, so the write would fail rather
    // than silently misplace the file. Pinned so that if a future caller ever does pass an
    // absolute path, this test is what explains the error message.
    expect(sidecarFileName('D:\\other\\file.md')).toBe('D:__other__file.md.json');
    expect(sidecarFileName('\\\\server\\share\\a.md')).toBe('____server__share__a.md.json');
  });

  it('hashes absolute Windows paths without leaking the drive or directories', () => {
    // The globalStorage branch is the one that legitimately receives absolute paths, and it hashes
    // them precisely so drive letters and separators never reach a filename.
    const name = globalSidecarFileName('C:\\Users\\me\\notes.md');
    expect(name).toMatch(/^[0-9a-f]{16}\.json$/);
    expect(name).not.toContain('C');
    expect(name).not.toBe(globalSidecarFileName('D:\\Users\\me\\notes.md'));
  });

  it('produces a targetPath that is stable and portable', () => {
    // `ReviewFile.targetPath` is committed to git in the sidecar, so a Windows author and a macOS
    // author working the same repo must write the same string or every sidecar churns on checkout.
    expect(toTargetPath('docs\\specs\\auth.md')).toBe('docs/specs/auth.md');
    expect(toTargetPath('.\\docs\\a.md')).toBe('docs/a.md');
    for (const input of WINDOWS_RELATIVE) {
      expect(toTargetPath(input), input).not.toContain('\\');
    }
  });
});

describe('REVIEWS_DIR', () => {
  it('is the PRD §4 directory', () => {
    expect(REVIEWS_DIR).toBe('.reviews');
  });
});

describe('notes file names', () => {
  it('notesFileName replaces the json suffix', () => {
    expect(notesFileName('docs__specs__auth.md.json')).toBe('docs__specs__auth.md.notes.md');
  });

  it('appends .notes.md when there is no json suffix', () => {
    expect(notesFileName('abc')).toBe('abc.notes.md');
  });

  it('uses forward slashes on Windows', () => {
    expect(notesPromptPath(sidecarFileName('docs\\specs\\auth.md'))).toBe(
      '.reviews/docs__specs__auth.md.notes.md',
    );
  });
});
