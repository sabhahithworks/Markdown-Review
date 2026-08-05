/**
 * The key both singleton registries (`ReviewStore.stores`, `ReviewPanel.panels`) use for a target
 * URI (H9).
 *
 * On case-insensitive filesystems (macOS, Windows) `A.md` and `a.md` are one file; keying on the
 * raw `uri.toString()` would hand out two stores and two panels writing one sidecar, silently
 * breaking the one-source-of-truth guarantee (PRD §11). Case-folding only on those platforms keeps
 * Linux exact, where two casings genuinely are two files.
 *
 * Folding the key does not touch the URI itself — the first casing opened still names the panel
 * title and the sidecar file.
 */
export function registryKey(uriString: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' || platform === 'win32' ? uriString.toLowerCase() : uriString;
}
