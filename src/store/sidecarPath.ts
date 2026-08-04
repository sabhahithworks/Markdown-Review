/**
 * Sidecar file naming (Plan 03 §3 — contract owner).
 *
 * Pure and `vscode`-free so the naming rules — the part with a known landmine in them — are
 * testable under plain Node. The `vscode`-facing half lives in `ReviewStore.ts`.
 *
 * **The landmine (PRD §11, flagged in CLAUDE.md):** the substitution must run on a path that has
 * already been normalized to forward slashes. `path.relative` yields `docs\specs\auth.md` on
 * Windows, and substituting `/` first would leave the backslashes untouched — so the same document
 * would get two different sidecars depending on the host OS, and neither would be portable.
 */

import { createHash } from 'node:crypto';

/** Directory holding sidecars in `workspace` storage mode, relative to the workspace folder. */
export const REVIEWS_DIR = '.reviews';

/**
 * Normalizes a relative path to the form stored in `ReviewFile.targetPath`: forward slashes, no
 * leading `./`. This is the canonical spelling of a target — everything else derives from it.
 */
export function toTargetPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * `docs/specs/auth.md` -> `docs__specs__auth.md.json` (PRD §4).
 *
 * Takes a *workspace-relative* path. Separator normalization happens first, and deliberately
 * inside this function rather than at its call sites, so there is exactly one place the ordering
 * can be got wrong.
 */
export function sidecarFileName(relativePath: string): string {
  return `${toTargetPath(relativePath).replace(/\//g, '__')}.json`;
}

/**
 * The globalStorage filename for a target with no workspace folder (PRD §11), keyed by a hash of
 * the absolute path.
 *
 * A hash rather than a flattened path because an absolute path carries a drive letter or a `/home`
 * prefix that would make the name unwieldy and leak the user's directory layout into a filename.
 * Truncated to 16 hex chars: this namespaces one user's local files, and it is not a security
 * boundary.
 */
export function globalSidecarFileName(absolutePath: string): string {
  return `${createHash('sha256').update(absolutePath).digest('hex').slice(0, 16)}.json`;
}

/** The backup written before a corrupt or unmigratable sidecar is replaced (PRD §11). */
export function backupFileName(sidecarName: string): string {
  return `${sidecarName}.bak`;
}
