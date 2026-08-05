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
import type { Comment, Located, PlainTextDoc, ReviewFile } from '../anchor/types.js';
import { showRewriteDiff } from '../detect/baselineDocuments.js';
import { changedRanges, touches } from '../detect/changedRanges.js';
import { createChangeWatcher } from '../detect/changeWatcher.js';
import { detectRewrite } from '../detect/rewrite.js';
import type { TextRange } from '../detect/scope.js';
import { scopeOf } from '../detect/scope.js';
import { renderPlainText } from '../render/plaintext.js';
import type { ImageResolver } from '../render/renderer.js';
import { renderMarkdown } from '../render/renderer.js';
import { ReviewStore } from '../store/ReviewStore.js';
import type { HostMessage } from './messages.js';
import { REVIEW_VIEW_TYPE, isWebviewMessage, toReviewSummary } from './messages.js';
import { anchorRejectionMessage } from './notices.js';
import type { ReadResult } from './readTarget.js';
import { readTarget } from './readTarget.js';

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

  /** Memo for the baseline diff behind the section-change signal; see `changedRanges` below. */
  private changedMemo: { baselineAt: string; text: string; ranges: TextRange[] | null } | undefined;

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
          case 'showRewriteDiff':
            void showRewriteDiff(this.target);
            break;
          case 'relinkTarget':
            void this.relink();
            break;
          case 'reopenComment':
            // The inference was wrong, or the agent's change did not actually address the point.
            // Clearing `resolution` too, so the card stops showing a before/after that no longer
            // describes anything the user agrees happened.
            this.store.reopen(raw.id);
            break;
          case 'reanchorComment':
            this.reanchor(raw.id, raw.selectedText, raw.offset, raw.hintLine);
            break;
          case 'copyPrompt':
            void vscode.commands.executeCommand('markdownReview.copyPrompt', this.target);
            break;
          case 'clearAddressed':
            void vscode.commands.executeCommand('markdownReview.clearAddressed', this.target);
            break;
        }
      },
      null,
      this.disposables,
    );

    // PRD §8: editor edits and direct disk writes both have to land, and a save (which is both)
    // must cost one refresh. The watcher owns the debounce, so there is no second timer here.
    this.disposables.push(
      createChangeWatcher({
        target,
        onChanged: () => void this.refresh(),
        // `refresh()`'s read fails and reports `targetUnreadable`, which is already the right state
        // for a deleted target (PRD §11). The re-link action on that notice arrives in Phase 4b.
        onDeleted: () => void this.refresh(),
        onCreated: () => void this.refresh(),
      }),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Flush, don't dispose: the store outlives this panel and may still be held by the command
    // layer or a panel in another column. `ReviewStore.disposeAll()` on deactivate owns teardown.
    void this.store.flush();
    ReviewPanel.panels.delete(this.target.toString());

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
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

    const read = await readTarget(this.target, { force: this.forceRender });
    if (this.disposed || generation !== this.renderGeneration) return;
    if (!read.ok) {
      this.reportReadFailure(read);
      return;
    }
    const source = read.text;

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

    // Relocate against what was just rendered, *after* the sidecar is loaded (re-anchoring a
    // placeholder would be a no-op that then races the real read) and *before* the state post, so
    // the statuses and the `located` offsets in the same message describe the same document.
    //
    // When this changes something the store fires `onDidChange`, which posts state again. Both
    // posts are computed from this same `doc` and the same store state, so the second is identical
    // to the first — accepted rather than suppressed, because every state change round-tripping
    // through the store is the invariant that keeps one path from data to view.
    const before = this.store.getState();
    const changed = this.store.applyReanchor(plain);
    const rewrite = detectRewrite(before, this.store.getState());

    this.postReviewState();

    // After the state post, so the orphan list the banner refers to is already on screen. Only on
    // the transition — `changed` is what makes this a one-shot rather than a permanent fixture.
    if (changed && rewrite.rewritten) {
      this.post({ type: 'rewriteDetected', orphaned: rewrite.orphaned });
    }
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

    const sectionChanged = this.doc ? this.sectionChanged(review, this.doc, located) : [];

    // The baseline is stripped here rather than left to the webview to ignore: it is the one field
    // that can be hundreds of kilobytes, and this message goes out on every state change.
    this.post({ type: 'reviewState', review: toReviewSummary(review), located, sectionChanged });
  }

  /**
   * Open comments whose *region* changed since the prompt was copied, though their own anchored
   * text did not (D17).
   *
   * `anchor.exact` is both the passage the user pointed at and the evidence for `addressed`, and
   * those only coincide when the fix lands inside the selection. They come apart for every comment
   * whose anchor *labels* the thing to fix rather than being it — a heading above a section the
   * agent rewrote is the case that found this. Such a comment stays `open` forever and the pane
   * says nothing, which is indistinguishable from the agent never having run.
   *
   * This is deliberately **not** a status. `reanchor.ts` remains the only code that sets one, the
   * result is derived per render and never persisted, and the card asks rather than asserts.
   */
  private sectionChanged(
    review: ReviewFile,
    doc: PlainTextDoc,
    located: Record<string, Located | null>,
  ): string[] {
    // Not a status, but still the extension volunteering a theory about what the agent did.
    if (!this.store.inferAddressed) return [];

    const baseline = review.baselineText;
    // No baseline means the prompt was never copied, or the document was too large to snapshot
    // (Plan 04 §10 D2). "Changed since you asked" has no meaning before you asked.
    if (!baseline) return [];

    const ranges = this.changedRanges(baseline, review.baselineAt ?? '', doc.text);
    if (!ranges) return [];

    // A comment written after the prompt was copied was never in it, so the baseline predates the
    // claim and cannot be evidence about it. An unparseable date — which PRD §11's hand-editable
    // sidecar allows — leaves the comment in rather than out: over-reporting is the safe direction.
    const baselineTime = Date.parse(review.baselineAt ?? '');

    const ids: string[] = [];
    for (const comment of review.comments) {
      // `addressed` and `orphaned` already carry stronger evidence, and `resolved` is terminal.
      if (comment.status !== 'open') continue;

      const found = located[comment.id];
      if (!found) continue;

      if (!Number.isNaN(baselineTime)) {
        const created = Date.parse(comment.createdAt);
        if (!Number.isNaN(created) && created > baselineTime) continue;
      }

      const scope = scopeOf(doc, found);
      if (scope && touches(ranges, scope)) ids.push(comment.id);
    }
    return ids;
  }

  /**
   * The baseline diff, memoized.
   *
   * `refresh()` deliberately posts state twice when a status flips — both posts are computed from
   * the same document and the same store state, so they are byte-identical — and diffing a pair of
   * 256 KB documents twice for an identical answer is the one part of that which is not free.
   */
  private changedRanges(baseline: string, baselineAt: string, text: string): TextRange[] | null {
    const memo = this.changedMemo;
    if (memo && memo.baselineAt === baselineAt && memo.text === text) return memo.ranges;

    const ranges = changedRanges(baseline, text);
    this.changedMemo = { baselineAt, text, ranges };
    return ranges;
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
      void vscode.window.showWarningMessage(anchorRejectionMessage(result.reason));
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

  /**
   * Re-attaches an orphaned comment to the text the user just selected (PRD §6).
   *
   * Identical validation to `addComment` — same `-1` sentinel, same rejection wording — because the
   * webview sends the same payload shape for both. The only difference is what happens on success.
   */
  private reanchor(id: string, selectedText: string, offset: number, hintLine: number): void {
    const doc = this.doc;
    if (!doc) return;

    const result = createAnchor({ selectedText, offset, doc, hintLine });
    if (!result.ok) {
      void vscode.window.showWarningMessage(anchorRejectionMessage(result.reason));
      return;
    }
    this.store.reattach(id, result.anchor);
  }

  /**
   * Points this review at a different file (PRD §11).
   *
   * The panel and its store are both keyed by target URI, so re-linking cannot be done in place:
   * the comments migrate to the new file's store and a fresh pane opens on it. This one closes
   * afterwards, so there is never a pane pointing at a file that is gone.
   */
  private async relink(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: `Re-link ${path.basename(this.target.fsPath)}`,
      openLabel: 'Re-link review',
      canSelectMany: false,
      filters: { Markdown: ['md', 'markdown', 'mdown', 'mkd', 'mdx'] },
    });

    const next = picked?.[0];
    if (!next || this.disposed) return;

    const result = await ReviewStore.relink(this.context, this.target, next, this.output);
    if (!result.ok) {
      void vscode.window.showWarningMessage(
        result.reason === 'same-file'
          ? 'That is the same file this review is already attached to.'
          : 'Markdown Review could not move the comments, so nothing has been changed.',
      );
      return;
    }

    ReviewPanel.createOrShow(this.context, next, this.output);
    void vscode.window.showInformationMessage(
      `Re-linked ${String(result.moved)} comment${result.moved === 1 ? '' : 's'} to ${path.basename(next.fsPath)}.`,
    );
    this.panel.dispose();
  }

  /**
   * Turns a failed read into the matching webview state.
   *
   * PRD §11: keep the pane and the user's data, say what happened. The re-link action on the
   * unreadable notice arrives in Phase 4b; the state itself has been correct since Phase 2.
   */
  private reportReadFailure(read: Extract<ReadResult, { ok: false }>): void {
    if (read.reason === 'too-large') {
      this.post({ type: 'tooLarge', sizeBytes: read.sizeBytes });
      return;
    }
    this.output.appendLine(`[panel] cannot read ${this.target.fsPath}: ${read.detail}`);
    this.post({ type: 'targetUnreadable', reason: read.detail });
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
  <!-- Counts, status filters and the primary actions. Sticky, so "Copy review prompt" is reachable
       without scrolling back to the top of a long document. -->
  <header id="header" hidden></header>
  <!-- Above the content, not after it. Two of its three uses clear the document first, but the
       rewrite banner fires over a full one — at the end of the body it would sit below everything
       and never be seen. -->
  <div id="notice" hidden></div>
  <!-- Orphans live outside the gutter: they have no anchor to align to, so they cannot be
       positioned like a card, and PRD §6 asks for them in a section of their own. -->
  <section id="orphans" hidden aria-label="Comments that lost their anchor"></section>
  <div id="front-matter-root"></div>
  <main id="content"></main>
  <!-- Highlights are absolutely-positioned rectangles over the content, never wrappers around it:
       wrapping would split the text nodes anchor offsets are measured against. -->
  <div id="highlight-overlay" aria-hidden="true"></div>
  <aside id="gutter" aria-label="Comments"></aside>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

}
