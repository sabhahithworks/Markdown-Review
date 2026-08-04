/**
 * The "review the diff" view behind the rewrite banner (PRD §11).
 *
 * **Both sides are rendered plain text.** Plan 04 §6 originally diffed the stored `baselineText`
 * against the file on disk, but the baseline *is* plain text while the file is Markdown source —
 * `renderPlainText` strips `#`, `**`, list markers and table pipes and collapses whitespace, so
 * every single line would differ and the diff would be noise (Plan 04 §9 D1). Rendering the current
 * side the same way makes the comparison show what the agent actually changed about the prose the
 * user reviewed, which is the question the banner asks.
 *
 * Read-only follows from the scheme having no `FileSystemProvider`: VS Code cannot write it back.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import { readTarget } from '../panel/readTarget.js';
import { renderPlainText } from '../render/plaintext.js';
import { ReviewStore } from '../store/ReviewStore.js';

export const BASELINE_SCHEME = 'markdown-review';

export type BaselineSide = 'baseline' | 'current';

/**
 * `markdown-review:/<side>/<percent-encoded fsPath>`.
 *
 * The target rides in the path and nowhere else. After a window reload VS Code re-requests content
 * for a restored diff editor with no memory of who registered what, so the provider has to answer
 * from the URI alone. Encoding the path keeps a Windows `C:\…` from being read as a scheme.
 */
export function baselineUri(target: vscode.Uri, side: BaselineSide): vscode.Uri {
  return vscode.Uri.from({
    scheme: BASELINE_SCHEME,
    path: `/${side}/${encodeURIComponent(target.fsPath)}`,
  });
}

function parseBaselineUri(uri: vscode.Uri): { side: BaselineSide; target: vscode.Uri } | undefined {
  const match = /^\/(baseline|current)\/(.+)$/.exec(uri.path);
  if (!match) return undefined;

  const [, side, encoded] = match;
  if (side === undefined || encoded === undefined) return undefined;

  try {
    return { side: side as BaselineSide, target: vscode.Uri.file(decodeURIComponent(encoded)) };
  } catch {
    return undefined;
  }
}

/** The title VS Code shows on the diff tab. The default would be two percent-encoded URIs. */
export function diffTitle(target: vscode.Uri): string {
  return `${path.basename(target.fsPath)} — review baseline ↔ now (rendered text)`;
}

export function registerBaselineProvider(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): vscode.Disposable {
  const emitter = new vscode.EventEmitter<vscode.Uri>();
  /** Targets we have served, so the `current` side can be invalidated as the user keeps editing. */
  const served = new Set<string>();

  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: emitter.event,

    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const parsed = parseBaselineUri(uri);
      if (!parsed) {
        output.appendLine(`[baseline] unrecognised uri: ${uri.toString()}`);
        return '';
      }

      const { side, target } = parsed;
      served.add(target.fsPath);

      if (side === 'baseline') {
        const review = await ReviewStore.for(context, target, output).ensureLoaded();
        return (
          review.baselineText ??
          'No baseline was recorded for this file.\n\nA baseline is captured when you copy the review prompt.\n'
        );
      }

      const read = await readTarget(target, { force: true });
      if (!read.ok) {
        // Returned as content rather than thrown: the diff editor renders this, where throwing
        // produces an opaque error toast and an empty pane.
        const detail = read.reason === 'too-large' ? `${String(read.sizeBytes)} bytes` : read.detail;
        return `This file could not be read (${detail}).\n`;
      }
      return renderPlainText(read.text).text;
    },
  };

  const registration = vscode.workspace.registerTextDocumentContentProvider(
    BASELINE_SCHEME,
    provider,
  );

  // Keep the `current` side live while a diff is open; the baseline side only ever changes through
  // `snapshotBaseline`, which means copying a prompt, which is not something to watch for.
  const watching = vscode.workspace.onDidChangeTextDocument((event) => {
    if (!served.has(event.document.uri.fsPath)) return;
    emitter.fire(baselineUri(event.document.uri, 'current'));
  });

  return {
    dispose(): void {
      watching.dispose();
      registration.dispose();
      emitter.dispose();
    },
  };
}

/** Opens baseline ↔ current for `target` as a read-only diff. */
export async function showRewriteDiff(target: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand(
    'vscode.diff',
    baselineUri(target, 'baseline'),
    baselineUri(target, 'current'),
    diffTitle(target),
    { preview: true },
  );
}
