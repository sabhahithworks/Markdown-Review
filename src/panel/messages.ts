/**
 * The extension ⇄ webview message contract (Plan 02 §5 — contract owner).
 *
 * This file is compiled into **both** bundles, so it must stay types-plus-guards only: no `vscode`,
 * no node, no DOM. ESLint enforces the `vscode` half; `tsconfig.webview.json` compiles it a second
 * time with `types: []` to enforce the rest.
 *
 * Phases 3 and 4 extend these unions with their own members (Plans 03 §6, 04 §6) and extend
 * `PanelState`. They add cases; they do not restructure.
 */

/** Webview view type. Shared by `createWebviewPanel` and the serializer registration. */
export const REVIEW_VIEW_TYPE = 'markdownReview.panel';

/** extension -> webview */
export type HostMessage =
  /**
   * Sent once per `ready`. The webview needs `targetPath` to write its own `setState`, and a
   * document that fails the size guard never receives `setContent` — so identity cannot ride along
   * with the content.
   */
  | { type: 'init'; targetPath: string }
  | { type: 'setContent'; html: string; frontMatterHtml?: string }
  | { type: 'tooLarge'; sizeBytes: number }
  /**
   * The target file could not be read (deleted, renamed, permissions). PRD §11 requires keeping
   * the pane and the user's data rather than closing; the re-link action arrives in Phase 4.
   */
  | { type: 'targetUnreadable'; reason: string };

/** webview -> extension */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openExternal'; url: string }
  | { type: 'renderAnyway' }
  /**
   * The webview has no console (`no-console` is global, and a webview console is invisible unless
   * devtools happen to be open), so it reports failures to the host, which logs them to the
   * "Markdown Review" output channel.
   */
  | { type: 'error'; message: string };

/**
 * Serializer state, and what the webview writes via `setState`. `scrollLine` is a `data-line`
 * value, not a pixel offset, so it survives a re-render that changes layout.
 */
export interface PanelState {
  targetPath: string;
  scrollLine?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Narrows untrusted input from `onDidReceiveMessage`. The conventions allow unvalidated shapes only
 * at I/O boundaries narrowed by a guard, and this is one of two such boundaries in the extension.
 */
export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!isRecord(value)) return false;
  switch (value['type']) {
    case 'ready':
    case 'renderAnyway':
      return true;
    case 'openExternal':
      return typeof value['url'] === 'string';
    case 'error':
      return typeof value['message'] === 'string';
    default:
      return false;
  }
}

/** Narrows the opaque state handed back by `deserializeWebviewPanel` and `getState()`. */
export function isPanelState(value: unknown): value is PanelState {
  if (!isRecord(value)) return false;
  if (typeof value['targetPath'] !== 'string') return false;
  const scrollLine = value['scrollLine'];
  return scrollLine === undefined || typeof scrollLine === 'number';
}
