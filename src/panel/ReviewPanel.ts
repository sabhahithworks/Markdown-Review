/**
 * Webview lifecycle for the review pane (Plan 02 §3, §6).
 *
 * One panel per target file, keyed by URI. Phase 3 adds a `ReviewStore` behind this so two panels
 * on the same file share state; the keying decision starts here.
 */

import { randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import * as vscode from 'vscode';
import { createAnchor } from '../anchor/create.js';
import { createLocator } from '../anchor/locate.js';
import type { Comment, Located, PlainTextDoc } from '../anchor/types.js';
import { MAX_ANCHOR_LENGTH, MIN_ANCHOR_LENGTH } from '../anchor/types.js';
import { renderPlainText } from '../render/plaintext.js';
import type { ImageResolver } from '../render/renderer.js';
import { renderMarkdown } from '../render/renderer.js';
import { ReviewStore } from '../store/ReviewStore.js';
import type { HostMessage } from './messages.js';
import { REVIEW_VIEW_TYPE, isWebviewMessage } from './messages.js';

/**
 * PRD §11 requires a warning before rendering a very large file. v1 degrades rather than
 * virtualizing: virtualized rendering would put a second, partial view of the document between the
 * user's selection and anchor space, which is exactly the desync Phase 3 cannot afford.
 */
const TOO_LARGE_BYTES = 2 * 1024 * 1024;

/** Matches Plan 04 §5's interval, so the watcher that supersedes this one feels identical. */
const REFRESH_DEBOUNCE_MS = 400;

const ALLOWED_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * The name attached to new comments: the `markdownReview.author` setting, else the system username
 * (PRD §4). `os.userInfo()` throws when the uid has no passwd entry — some containers — so the
 * fallback keeps comment creation working rather than failing on a cosmetic field.
 */
function authorName(): string {
  const configured = vscode.workspace
    .getConfiguration('markdownReview')
    .get<string>('author', '')
    .trim();
  if (configured.length > 0) return configured;

  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

export class ReviewPanel {
  private static readonly panels = new Map<string, ReviewPanel>();

  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;
  /** The webview script has loaded and posted `ready`; before that, messages are dropped. */
  private ready = false;
  /** Guards against a slow read overwriting the result of a newer one. */
  private renderGeneration = 0;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  /** Set by `renderAnyway`; in-memory only, so a reload re-arms the size guard. */
  private forceRender = false;

  /** Comments for this file. Shared with every other consumer of the same target (PRD §11). */
  private readonly store: ReviewStore;

  /**
   * Anchor space for the content currently in the webview. Every anchor this panel creates or
   * locates is expressed against *this* document, so it is refreshed in lock-step with `setContent`
   * and is `undefined` only before the first successful render.
   */
  private doc: PlainTextDoc | undefined;

  static createOrShow(
    context: vscode.ExtensionContext,
    target: vscode.Uri,
    output: vscode.OutputChannel,
  ): void {
    const existing = ReviewPanel.panels.get(target.toString());
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      REVIEW_VIEW_TYPE,
      path.basename(target.fsPath),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      ReviewPanel.webviewOptions(context, target),
    );

    new ReviewPanel(context, panel, target, output);
  }

  /** Reattaches to a panel restored by the serializer after a window reload. */
  static revive(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    target: vscode.Uri,
    output: vscode.OutputChannel,
  ): void {
    const existing = ReviewPanel.panels.get(target.toString());
    if (existing) {
      // Two panels for one file would be two sources of truth. Keep the live one.
      panel.dispose();
      existing.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    panel.webview.options = ReviewPanel.webviewOptions(context, target);
    new ReviewPanel(context, panel, target, output);
  }

  private static webviewOptions(
    context: vscode.ExtensionContext,
    target: vscode.Uri,
  ): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      enableFindWidget: true,
      // PRD §6: the second root exists so relative images in the markdown resolve. Nothing outside
      // these two trees is reachable from the webview.
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media'),
        vscode.Uri.file(path.dirname(target.fsPath)),
      ],
      // Deliberately no `retainContextWhenHidden` (PRD §6) — the serializer covers reload survival
      // at a fraction of the memory cost.
    };
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly panel: vscode.WebviewPanel,
    private readonly target: vscode.Uri,
    private readonly output: vscode.OutputChannel,
  ) {
    ReviewPanel.panels.set(target.toString(), this);

    this.store = ReviewStore.for(context, target, output);
    // Every state change round-trips through the store, including this panel's own edits, so there
    // is exactly one path from data to view.
    this.store.onDidChange(() => this.postReviewState(), null, this.disposables);

    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-dark.svg'),
    };
    panel.webview.html = this.getHtmlForWebview(panel.webview);

    panel.onDidDispose(() => this.dispose(), null, this.disposables);

    panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        // One of two untrusted-input boundaries in the extension; narrow before use, drop silently
        // on a shape we do not recognise.
        if (!isWebviewMessage(raw)) return;
        switch (raw.type) {
          case 'ready':
            this.ready = true;
            // `targetPath` here is the absolute path the serializer needs to reopen the file — not
            // `ReviewFile.targetPath`, which is workspace-relative (PRD §4). Two different jobs.
            this.post({ type: 'init', targetPath: this.target.fsPath, author: authorName() });
            void this.refresh();
            break;
          case 'renderAnyway':
            this.forceRender = true;
            void this.refresh();
            break;
          case 'openExternal':
            this.openExternal(raw.url);
            break;
          case 'error':
            this.output.appendLine(`[webview] ${raw.message}`);
            break;
          case 'addComment':
            void this.addComment(raw.selectedText, raw.offset, raw.hintLine, raw.body);
            break;
          case 'editComment':
            this.store.updateCommentBody(raw.id, raw.body.trim());
            break;
          case 'deleteComment':
            // A user action, so permitted — only *automatic* deletion is forbidden (PRD §4).
            this.store.deleteComment(raw.id);
            break;
          case 'resolveComment':
            this.store.setStatus(raw.id, 'resolved');
            break;
        }
      },
      null,
      this.disposables,
    );

    // Interim live refresh. Plan 04 §5's changeWatcher (dual-source, store-integrated) supersedes
    // this; deliberately no FileSystemWatcher here, so there is only ever one watch design.
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (event.document.uri.toString() !== this.target.toString()) return;
        this.scheduleRefresh();
      },
      null,
      this.disposables,
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.debounce !== undefined) clearTimeout(this.debounce);
    // Flush, don't dispose: the store outlives this panel and may still be held by the command
    // layer or a panel in another column. `ReviewStore.disposeAll()` on deactivate owns teardown.
    void this.store.flush();
    ReviewPanel.panels.delete(this.target.toString());

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private scheduleRefresh(): void {
    if (this.debounce !== undefined) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private post(message: HostMessage): void {
    if (this.disposed || !this.ready) return;
    void this.panel.webview.postMessage(message);
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    // Nothing would be delivered yet; the `ready` handler runs a refresh of its own, so a change
    // arriving before the script loads is covered without queueing anything here.
    if (!this.ready) return;

    const generation = ++this.renderGeneration;

    let source: string;
    try {
      const read = await this.readSource();
      if (this.disposed || generation !== this.renderGeneration) return;
      if (read === undefined) return; // size guard already reported
      source = read;
    } catch (error) {
      if (this.disposed || generation !== this.renderGeneration) return;
      // PRD §11: keep the pane and the user's data, say what happened. The re-link action arrives
      // in Phase 4; Phase 2 shows the state and stops.
      const reason = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`[panel] cannot read ${this.target.fsPath}: ${reason}`);
      this.post({ type: 'targetUnreadable', reason });
      return;
    }

    const rendered = renderMarkdown(source, { resolveImage: this.makeImageResolver() });
    // Rendering both from the same source string on the same code path is what keeps anchor space
    // honest. Phase 3 consumes `plain`; here it exists to assert the two agree about front matter,
    // which is the only claim that is checkable without a selection.
    const plain = renderPlainText(source);
    if (rendered.lineOffset !== plain.frontMatterLineOffset) {
      this.output.appendLine(
        `[panel] front-matter offset mismatch for ${this.target.fsPath}: ` +
          `renderer ${String(rendered.lineOffset)} vs anchor space ` +
          `${String(plain.frontMatterLineOffset)}`,
      );
    }

    this.doc = plain;

    const message: HostMessage = rendered.frontMatterHtml
      ? { type: 'setContent', html: rendered.html, frontMatterHtml: rendered.frontMatterHtml }
      : { type: 'setContent', html: rendered.html };
    this.post(message);

    // Content and state go out together: posting state against the *previous* content would flash
    // highlights at stale positions.
    await this.store.ensureLoaded();
    if (this.disposed || generation !== this.renderGeneration) return;
    this.postReviewState();
  }

  /**
   * Sends the comments and where each one currently sits.
   *
   * `located` is computed here rather than in the webview because the host already holds the
   * `PlainTextDoc` — and keeping the confidence cascade host-side keeps `diff-match-patch` out of
   * the webview bundle (Plan 03 §9 C2). One locator is built per post and reused across comments,
   * as `createLocator`'s contract intends.
   */
  private postReviewState(): void {
    const review = this.store.getState();
    const located: Record<string, Located | null> = {};

    if (this.doc) {
      const locate = createLocator(this.doc);
      for (const comment of review.comments) located[comment.id] = locate(comment.anchor);
    } else {
      // Nothing rendered yet; the cards still render, without highlights.
      for (const comment of review.comments) located[comment.id] = null;
    }

    this.post({ type: 'reviewState', review, located });
  }

  /**
   * Turns a selection from the webview into a persisted comment (Plan 03 §4).
   *
   * `offset` already arrives in anchor space — the webview reads the enclosing block's
   * `data-ap-start` and adds the intra-block offset — with `-1` as the "could not map" sentinel
   * that `createAnchor` recovers from using `hintLine`.
   */
  private async addComment(
    selectedText: string,
    offset: number,
    hintLine: number,
    body: string,
  ): Promise<void> {
    const doc = this.doc;
    if (!doc) return;

    const result = createAnchor({ selectedText, offset, doc, hintLine });
    if (!result.ok) {
      // The pure layer returns a reason; the wording is the extension layer's job (Plan 01 §4).
      void vscode.window.showWarningMessage(
        result.reason === 'too-short'
          ? `Select at least ${String(MIN_ANCHOR_LENGTH)} characters`
          : `Selection too long to anchor — select under ${String(MAX_ANCHOR_LENGTH)} characters`,
      );
      return;
    }

    const text = body.trim();
    if (text.length === 0) return; // the popover disables submit on empty; belt and braces

    await this.store.ensureLoaded();
    if (this.disposed) return;

    const comment: Comment = {
      id: nanoid(8),
      body: text,
      author: authorName(),
      createdAt: new Date().toISOString(),
      status: 'open',
      anchor: result.anchor,
    };
    this.store.addComment(comment);
  }

  /** Returns the document text, or `undefined` when the size guard fired and reported it. */
  private async readSource(): Promise<string | undefined> {
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === this.target.toString(),
    );

    if (open) {
      // Fresher than disk: an unsaved buffer is what the user is looking at.
      const text = open.getText();
      const size = Buffer.byteLength(text, 'utf8');
      if (!this.forceRender && size > TOO_LARGE_BYTES) {
        this.post({ type: 'tooLarge', sizeBytes: size });
        return undefined;
      }
      return text;
    }

    // `stat` first: reading a multi-hundred-megabyte file just to measure it is the failure the
    // guard exists to prevent.
    const stat = await vscode.workspace.fs.stat(this.target);
    if (!this.forceRender && stat.size > TOO_LARGE_BYTES) {
      this.post({ type: 'tooLarge', sizeBytes: stat.size });
      return undefined;
    }

    const bytes = await vscode.workspace.fs.readFile(this.target);
    return new TextDecoder().decode(bytes);
  }

  /**
   * Maps relative image sources into the webview's resource space.
   *
   * Anything with a scheme (`https:`, `data:`, and Windows drive letters, which match the same
   * pattern) is declined: CSP already permits `https:` and `data:` for images, and a drive letter
   * is outside the target's tree by definition. Anything escaping the tree is declined too and
   * renders broken rather than being granted access.
   *
   * Symlinks are not resolved. One inside the tree pointing outside would pass this check, but
   * `localResourceRoots` still gates the actual load, so the worst case is a broken image. Adding
   * `realpath` here would make the resolver async for no security gain.
   */
  private makeImageResolver(): ImageResolver {
    const targetDir = path.dirname(this.target.fsPath);
    const webview = this.panel.webview;

    return (src) => {
      if (src.startsWith('/') || src.startsWith('//')) return null;
      if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;

      const [pathPart = ''] = src.split(/[?#]/);
      if (pathPart === '') return null;

      // markdown-it percent-encodes the source at parse time; the filesystem wants it decoded.
      let decoded = pathPart;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        // Malformed escape sequence — fall back to the raw form rather than dropping the image.
      }

      const absolute = path.resolve(targetDir, decoded);
      const relative = path.relative(targetDir, absolute);
      if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;

      return webview.asWebviewUri(vscode.Uri.file(absolute)).toString();
    };
  }

  /**
   * Opens a link from the document in the user's browser.
   *
   * The scheme allowlist is load-bearing: without it a crafted link in a reviewed file becomes
   * `openExternal(Uri.parse('command:...'))`, which is arbitrary command execution from file
   * content.
   */
  private openExternal(url: string): void {
    let parsed: vscode.Uri;
    try {
      parsed = vscode.Uri.parse(url, true);
    } catch {
      return;
    }

    if (!ALLOWED_LINK_SCHEMES.has(parsed.scheme)) {
      void vscode.window.showWarningMessage(
        `Markdown Review only opens http, https and mailto links (this one is "${parsed.scheme}:").`,
      );
      return;
    }

    void vscode.env.openExternal(parsed);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.css'),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js'),
    );

    // PRD §6, verbatim. `style-src 'unsafe-inline'` is required by VS Code's own injected theme
    // styles; everything else is locked to the nonce and the webview's resource origin.
    const csp =
      `default-src 'none'; img-src ${webview.cspSource} https: data:; ` +
      `script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; ` +
      `font-src ${webview.cspSource};`;

    // No <title>: the tab label comes from `panel.title`, so no filesystem-derived string is
    // interpolated into this shell and there is nothing here to escape.
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
  <div id="front-matter-root"></div>
  <main id="content"></main>
  <!-- Highlights are absolutely-positioned rectangles over the content, never wrappers around it:
       wrapping would split the text nodes anchor offsets are measured against. -->
  <div id="highlight-overlay" aria-hidden="true"></div>
  <aside id="gutter" aria-label="Comments"></aside>
  <div id="notice" hidden></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

}
