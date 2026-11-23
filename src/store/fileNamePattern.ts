import { registryKey } from './registryKey.js';

/**
 * Helpers for watching one file by name with a `RelativePattern`.
 *
 * The name is a glob pattern there: a target named `spec [draft].md` would read `[draft]` as a
 * character class and never match itself. `globSafeName` turns each glob character into `?`, and
 * the handler keeps only the exact name with `isSameFileName`, folded as `registryKey` folds it:
 * on macOS and Windows the watcher matches without case and reports the casing on disk, which an
 * older file may differ in.
 */
export function globSafeName(name: string): string {
  return name.replace(/[[\]{}*?!]/g, '?');
}

export function isSameFileName(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return registryKey(a, platform) === registryKey(b, platform);
}
