/**
 * H9 — the singleton registries (`ReviewStore.stores`, `ReviewPanel.panels`) must treat two
 * casings of one path as one file on case-insensitive filesystems, or the one-source-of-truth
 * guarantee (PRD §11) silently becomes two stores writing one sidecar.
 */

import { describe, expect, it } from 'vitest';
import { registryKey } from '../store/registryKey.js';

describe('registryKey (H9)', () => {
  it('case-folds on macOS', () => {
    expect(registryKey('file:///Users/me/Docs/A.md', 'darwin')).toBe(
      registryKey('file:///users/me/docs/a.md', 'darwin'),
    );
  });

  it('case-folds on Windows', () => {
    expect(registryKey('file:///c%3A/Docs/A.md', 'win32')).toBe(
      registryKey('file:///C%3A/docs/a.md', 'win32'),
    );
  });

  it('keeps Linux exact — two casings genuinely are two files there', () => {
    expect(registryKey('file:///home/me/A.md', 'linux')).not.toBe(
      registryKey('file:///home/me/a.md', 'linux'),
    );
  });

  it('is the identity for an already-lowercase key on every platform', () => {
    const uri = 'file:///home/me/notes.md';
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(registryKey(uri, platform)).toBe(uri);
    }
  });
});
