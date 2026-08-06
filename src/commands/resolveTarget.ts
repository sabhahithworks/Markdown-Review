/**
 * Turning a command argument into the Markdown file it refers to.
 *
 * Extracted from `openReviewPane` in Phase 4 because every command now needs the same answer, and
 * three copies of "is this a Markdown file on disk?" would drift — the palette can hand any of them
 * an arbitrary URI, so each one validates for itself or none of them is safe.
 *
 * Errors are values: the caller decides whether an unusable argument deserves a message box, since
 * `copyPrompt` invoked with no editor open is a different conversation from `open`.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * The menu `when` clauses gate the UI by language id, but a command is also reachable from the
 * palette and from other extensions with an arbitrary URI.
 */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx']);

export type TargetResult =
  | { ok: true; target: vscode.Uri }
  | { ok: false; reason: 'no-target' | 'not-a-file' | 'not-markdown'; detail: string };

/**
 * Normalizes a command argument into a real `Uri`.
 *
 * `instanceof` covers the menu invocations, which are in-process. A URI handed over by another
 * extension can fail `instanceof` while still being one, so a URI-shaped object is rebuilt into a
 * genuine `Uri` — downstream needs the real class for `joinPath` and `asWebviewUri`.
 *
 * Rebuilt from its own fields rather than from `String(arg)` (H32). A plain object stringifies to
 * `"[object Object]"`, which `Uri.parse(…, true)` throws on — so the cross-extension case this
 * branch exists for could never once have succeeded. Only a `Uri` whose prototype survived would
 * have worked, and that is the `instanceof` case above.
 */
export function toUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) return arg;
  if (typeof arg !== 'object' || arg === null) return undefined;

  const candidate = arg as { scheme?: unknown; fsPath?: unknown; path?: unknown };
  if (typeof candidate.scheme !== 'string') return undefined;

  // `fsPath` is the platform path; `path` is the URI path. Either identifies the file, and a
  // genuine URI-shaped object carries both.
  const location =
    typeof candidate.fsPath === 'string'
      ? candidate.fsPath
      : typeof candidate.path === 'string'
        ? candidate.path
        : undefined;
  if (location === undefined || location.length === 0) return undefined;

  try {
    return candidate.scheme === 'file'
      ? vscode.Uri.file(location)
      : vscode.Uri.from({ scheme: candidate.scheme, path: location });
  } catch {
    return undefined;
  }
}

/**
 * The Markdown file a command should act on: its argument, else the active editor.
 *
 * Explorer and editor-title menus pass the resource as the first argument. (The explorer also passes
 * a second `Uri[]` of the full selection; commands here act on one file, so it is ignored.) From the
 * palette there is no argument at all.
 */
export function resolveTarget(arg: unknown): TargetResult {
  const target = toUri(arg) ?? vscode.window.activeTextEditor?.document.uri;

  if (!target) {
    return {
      ok: false,
      reason: 'no-target',
      detail: 'Open a Markdown file, or right-click one in the Explorer, to start a review.',
    };
  }

  if (target.scheme !== 'file') {
    // `localResourceRoots` needs a real directory, and the sidecar naming needs a path.
    return {
      ok: false,
      reason: 'not-a-file',
      detail: 'Markdown Review works on files saved to disk. Save this document first.',
    };
  }

  const extension = path.extname(target.fsPath).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      reason: 'not-markdown',
      detail: `Markdown Review opens Markdown files (this one is "${extension || 'extensionless'}").`,
    };
  }

  return { ok: true, target };
}
