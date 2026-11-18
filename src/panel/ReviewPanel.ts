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
import type { ChangeState, Comment, Located, PlainTextDoc, ReviewFile } from '../anchor/types.js';
import { showRewriteDiff } from '../detect/baselineDocuments.js';
import { changeStateOf, changedRanges, touches } from '../detect/changedRanges.js';
import { createChangeWatcher } from '../detect/changeWatcher.js';
import { detectRewrite } from '../detect/rewrite.js';
import type { TextRange } from '../detect/scope.js';
import { scopeOf } from '../detect/scope.js';
import type { Locator } from '../anchor/locate.js';
import { renderPlainText } from '../render/plaintext.js';
import type { ImageResolver } from '../render/renderer.js';
import { renderMarkdown } from '../render/renderer.js';
import { ReviewStore } from '../store/ReviewStore.js';
import { registryKey } from '../store/registryKey.js';
import { buildCsp } from './csp.js';
import type { HostMessage } from './messages.js';
import { REVIEW_VIEW_TYPE, isWebviewMessage, toReviewSummary } from './messages.js';
import { anchorRejectionMessage } from './notices.js';
import type { ReadResult } from './readTarget.js';
import { readTarget } from './readTarget.js';
import { ReadyLatch } from './readyLatch.js';

const ALLOWED_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * The name attached to new comments: the `markdownReview.author` setting, else the system username
 * (PRD §4). `os.userInfo()` throws when the uid has no passwd entry — some containers — so the
 * fallback keeps comment creation working rather than failing on a cosmetic field.
 *
 * Scoped to the target (H29) so a folder-level `.vscode/settings.json` author wins in a multi-root
 * workspace, matching how the store reads its own settings.
 */
function authorName(target: vscode.Uri): string {
  const configured = vscode.workspace
    .getConfiguration('markdownReview', target)
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
  /**
   * Gates every host→webview message: before the webview posts `ready`, and while it is hidden,
   * delivery is impossible and `post()` drops rather than silently succeeding (H14, D23). The rule
   * lives in `readyLatch.ts` so it can be unit-tested without a real window reload.
   */
  private readonly latch = new ReadyLatch();
  /** Guards against a slow read overwriting the result of a newer one. */
  private renderGeneration = 0;
  /**
   * The generation `this.doc` (or the reported read failure) belongs to. `postReviewState` posts
   * only when it matches `renderGeneration` (H11) — a store change firing mid-refresh would
   * otherwise post `located` offsets computed against the previous document.
   */
  private docGeneration = 0;
  /** Set by `renderAnyway`; in-memory only, so a reload re-arms the size guard. */
  private forceRender = false;
  /** One locator per rendered document (H15): `createLocator` memoizes per instance. */
  private locatorMemo: { doc: PlainTextDoc; locate: Locator } | undefined;

  /** Comments for this file. Shared with every other consumer of the same target (PRD §11). */
  private store: ReviewStore;
  /** Held separately from `disposables` so both can be replaced when the store is (H29). */
  private storeSubscription: vscode.Disposable;
  private storeHold: vscode.Disposable;

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
    const existing = ReviewPanel.panels.get(registryKey(target.toString()));
    if (existing) {
      // No column argument: reveal it where it already is. Moving a pane the user has arranged —
      // dragged to another group, or left beside the source — would be the command undoing their
      // layout every time they re-ran it.
      existing.panel.reveal();
      return;
    }

    // `Active`, not `Beside`: the pane is a reading surface, not a live preview to diff against the
    // source. It needs the whole editor width — the prose column plus a 280 px comment margin does
    // not fit in half a window, and splitting by default meant every open started cramped. Users who
    // do want it side-by-side can drag the tab into a split, and `reveal()` above keeps it there.
    const panel = vscode.window.createWebviewPanel(
      REVIEW_VIEW_TYPE,
      path.basename(target.fsPath),
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
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
    const existing = ReviewPanel.panels.get(registryKey(target.toString()));
    if (existing) {
      // Two panels for one file would be two sources of truth. Keep the live one, in its column.
      panel.dispose();
      existing.panel.reveal();
      return;
    }

    panel.webview.options = ReviewPanel.webviewOptions(context, target);
    new ReviewPanel(context, panel, target, output);
  }

  /**
   * Re-acquires every open panel's store after the registry was dropped (H29).
   *
   * `ReviewStore.resettle` flushes and disposes the live stores so the next `for()` re-resolves
   * where the sidecar belongs. Any panel still holding one of those would be talking to a disposed
   * object whose events never fire again, so each re-acquires and re-subscribes, then re-renders
   * from whatever the new location holds.
   */
  static reattachStores(): void {
    for (const panel of ReviewPanel.panels.values()) {
      if (panel.disposed) continue;
      panel.storeSubscription.dispose();
      panel.storeHold.dispose();
      panel.store = ReviewStore.for(panel.context, panel.target, panel.output);
      panel.storeSubscription = panel.store.onDidChange(() => panel.postReviewState());
      panel.storeHold = panel.store.acquire();
      void panel.refresh();
    }
  }

  /**
   * Points an open pane at a file that has just been renamed (H30).
   *
   * The panel is keyed by target URI and its `localResourceRoots` are bound to the old directory,
   * so this cannot be done in place — the same reason `relink` opens a fresh pane. The comments
   * have already moved; this is only the window following them.
   */
  static retarget(
    context: vscode.ExtensionContext,
    from: vscode.Uri,
    to: vscode.Uri,
    output: vscode.OutputChannel,
  ): void {
    const existing = ReviewPanel.panels.get(registryKey(from.toString()));
    if (!existing) return;

    ReviewPanel.createOrShow(context, to, output);
    existing.panel.dispose();
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
    ReviewPanel.panels.set(registryKey(target.toString()), this);

    this.store = ReviewStore.for(context, target, output);
    // Every state change round-trips through the store, including this panel's own edits, so there
    // is exactly one path from data to view.
    this.storeSubscription = this.store.onDidChange(() => this.postReviewState());
    this.storeHold = this.store.acquire();
    this.disposables.push({
      dispose: () => {
        this.storeSubscription.dispose();
        // Releases the store to the idle timer (H28); it stays alive for a while so reopening the
        // pane does not re-read the sidecar.
        this.storeHold.dispose();
      },
    });

    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-light.svg'),
      dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-dark.svg'),
    };
    this.trace('panel constructed, waiting for the webview handshake');
    panel.webview.html = this.getHtmlForWebview(panel.webview);

    panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // A window restore emits view-state churn without destroying the webview context, so a flip
    // landing inside `refresh()`'s await can shut the gate just in time for the finished render to
    // be dropped — and no second `ready` ever comes. Reopening on the way back to visible is what
    // makes that recoverable (D23); see `readyLatch.ts` for why it is safe in both directions.
    panel.onDidChangeViewState(
      () => {
        const refreshing = this.latch.onVisibilityChange(panel.visible);
        this.trace(
          `viewState visible=${String(panel.visible)} canPost=${String(this.latch.canPost)}` +
            `${refreshing ? ' → refresh' : ''}`,
        );
        if (refreshing) void this.refresh();
      },
      null,
      this.disposables,
    );

    panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        // One of two untrusted-input boundaries in the extension; narrow before use, drop silently
        // on a shape we do not recognise.
        if (!isWebviewMessage(raw)) return;
        switch (raw.type) {
          case 'ready':
            this.latch.onReady();
            this.trace('ready received');
            // `targetPath` here is the absolute path the serializer needs to reopen the file — not
            // `ReviewFile.targetPath`, which is workspace-relative (PRD §4). Two different jobs.
            this.post({ type: 'init', targetPath: this.target.fsPath, author: authorName(this.target) });
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
          case 'addDocumentComment':
            void this.addDocumentComment(raw.body);
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
          case 'dismissAgentNote':
            this.store.dismissAgentNote(raw.id);
            break;
          case 'sendPrompt':
            void vscode.commands.executeCommand(
              raw.target === 'chat' ? 'markdownReview.sendPromptToChat' : 'markdownReview.sendPromptToTerminal',
              this.target,
            );
            break;
          case 'copyPrompt':
            void vscode.commands.executeCommand('markdownReview.copyPrompt', this.target);
            break;
          case 'clearAddressed':
            void vscode.commands.executeCommand('markdownReview.clearAddressed', this.target);
            break;
          case 'clearAll':
            // Same command the palette runs, so the modal confirm and the backup are not bypassed.
            void vscode.commands.executeCommand('markdownReview.clearAll', this.target);
            break;
        }
      },
      null,
      this.disposables,
    );

    // Settings that change what the pane shows have to take effect without a reopen (H29).
    // `author` is read per comment and `storageLocation` is owned by the store; what is left here
    // is the rendering half — `autoDetectResolution` gates the section-change signal, which is
    // computed on every post.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('markdownReview', this.target)) return;
        void this.refresh();
      }),
    );

    // PRD §8: editor edits and direct disk writes both have to land, and a save (which is both)
    // must cost one refresh. The watcher owns the debounce, so there is no second timer here.
    this.disposables.push(
      createChangeWatcher({
        target,
        onChanged: () => void this.refresh(),
        // `refresh()`'s read fails and reports `targetUnreadable`, which is already the right state
        // for a deleted target (PRD §11); its notice carries the re-link action (`relink`, below).
        // Re-creation rides the coalescer inside the watcher (H13).
        onDeleted: () => void this.refresh(),
      }),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Flush, don't dispose: the store outlives this panel and may still be held by the command
    // layer or a panel in another column. `ReviewStore.disposeAll()` on deactivate owns teardown.
    void this.store.flush();
    ReviewPanel.panels.delete(registryKey(this.target.toString()));

    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  /**
   * Diagnostics for the restore path (D23).
   *
   * The pane going blank after a reload produces no error anywhere: dropped messages are the gate
   * working as designed, so the failure is silent by construction. These lines are what turn a
   * second occurrence into evidence instead of another round of hypotheses. They are quiet in
   * normal use — a handful per panel, none per keystroke.
   */
  private trace(message: string): void {
    this.output.appendLine(`[panel] ${path.basename(this.target.fsPath)}: ${message}`);
  }

  private post(message: HostMessage): void {
    if (this.disposed) return;
    if (!this.latch.canPost) {
      // The one line that would have identified D23 on the first run rather than the third.
      this.trace(`dropped ${message.type} (gate shut, handshaked=${String(this.latch.hasHandshaked)})`);
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    // Nothing would be delivered yet; the `ready` handler runs a refresh of its own, so a change
    // arriving before the script loads is covered without queueing anything here.
    if (!this.latch.canPost) return;

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
    this.docGeneration = generation;

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
    // A refresh is mid-flight: `this.doc` describes the previous document, and posting offsets
    // computed against it would flash highlights at stale positions (H11). The refresh posts the
    // state itself once the new document is in place.
    if (this.renderGeneration !== this.docGeneration) return;

    const review = this.store.getState();
    const located: Record<string, Located | null> = {};

    if (this.doc) {
      // Memoized per document (H15): `createLocator` carries a per-instance collapsed-code memo,
      // and rebuilding it on every state change discards that on exactly the documents where it
      // is expensive.
      if (this.locatorMemo?.doc !== this.doc) {
        this.locatorMemo = { doc: this.doc, locate: createLocator(this.doc) };
      }
      const locate = this.locatorMemo.locate;
      for (const comment of review.comments) {
        if (comment.anchor === undefined) continue;
        located[comment.id] = locate(comment.anchor);
      }
    } else {
      // Nothing rendered yet; the cards still render, without highlights.
      for (const comment of review.comments) located[comment.id] = null;
    }

    const sectionChanged = this.doc ? this.sectionChanged(review, this.doc, located) : [];
    const changes = this.changeState(review, this.doc);

    // The baseline is stripped here rather than left to the webview to ignore: it is the one field
    // that can be hundreds of kilobytes, and this message goes out on every state change.
    this.post({
      type: 'reviewState',
      review: toReviewSummary(review),
      located,
      sectionChanged,
      changes,
    });
  }

  /**
   * The change view's state (D28): which blocks differ from the baseline, or why that cannot be said.
   *
   * Deliberately **not** gated on `inferAddressed` (D29) — it is a plain diff, not a theory about
   * comments — and it shares the memoised diff with `sectionChanged`, so a post costs one diff at
   * most. With nothing rendered there are no blocks to mark, which is "no answer", never
   * "unchanged".
   */
  private changeState(review: ReviewFile, doc: PlainTextDoc | undefined): ChangeState {
    if (!doc) return { state: 'no-baseline' };
    const baseline = review.baselineText;
    const ranges = baseline
      ? this.changedRanges(baseline, review.baselineAt ?? '', doc.text)
      : null;
    return changeStateOf(baseline, doc, ranges);
  }

  /**
   * Open comments whose *region* changed since the prompt was copied, though their own anchored
   * text did not (D17) — and orphaned comments whose last known neighbourhood changed (D21/H0).
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
      // `addressed` already carries stronger evidence, and `resolved` is terminal. `orphaned` is
      // the D21 case (H0): an anchor that *stated an absence* can only be addressed by deleting
      // it, so the answer the user wanted arrives as an orphan — the one status that reads as
      // loss. The same weaker signal applies: not a status, just "the text around where this
      // lived changed since you asked".
      if (comment.status !== 'open' && comment.status !== 'orphaned') continue;
      if (comment.anchor === undefined) continue;

      const found = located[comment.id];
      // An orphan has no current position — that is what orphaned means — but its hint was
      // refreshed on every pass until the text vanished, so it is the last known neighbourhood.
      // Good enough for a question about a *region*; `scopeOf` clamps it into the document.
      const probe =
        found ?? { start: comment.anchor.hintOffset, end: comment.anchor.hintOffset + 1 };

      if (!Number.isNaN(baselineTime)) {
        const created = Date.parse(comment.createdAt);
        if (!Number.isNaN(created) && created > baselineTime) continue;
      }

      const scope = scopeOf(doc, probe);
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
    const text = body.trim();
    if (text.length === 0) return; // the popover disables submit on empty; belt and braces

    // Load first, anchor second (H12): `this.doc` can be replaced while this awaits, and an anchor
    // computed before the await could carry hints belonging to a document no longer on screen.
    await this.store.ensureLoaded();
    if (this.disposed) return;

    const doc = this.doc;
    if (!doc) return;

    const result = createAnchor({ selectedText, offset, doc, hintLine });
    if (!result.ok) {
      // The pure layer returns a reason; the wording is the extension layer's job (Plan 01 §4).
      void vscode.window.showWarningMessage(anchorRejectionMessage(result.reason));
      return;
    }

    const comment: Comment = {
      id: nanoid(8),
      body: text,
      author: authorName(this.target),
      createdAt: new Date().toISOString(),
      status: 'open',
      anchor: result.anchor,
    };
    this.store.addComment(comment);
  }

  /** Stores a comment with no anchor: it belongs to the document, not to a passage. */
  private async addDocumentComment(body: string): Promise<void> {
    const text = body.trim();
    if (text.length === 0) return;

    await this.store.ensureLoaded();
    if (this.disposed) return;

    this.store.addComment({
      id: nanoid(8),
      body: text,
      author: authorName(this.target),
      createdAt: new Date().toISOString(),
      status: 'open',
    });
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
   * PRD §11: keep the pane and the user's data, say what happened. The unreadable notice carries
   * the re-link action (handled by `relink`, above); the state itself has been correct since
   * Phase 2.
   */
  private reportReadFailure(read: Extract<ReadResult, { ok: false }>): void {
    // The failure state is as current as this generation gets; without this, a read failure would
    // freeze `postReviewState` (H11's guard) until the next successful render.
    this.docGeneration = this.renderGeneration;
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
   * Anything with a scheme (`data:`, and Windows drive letters, which match the same pattern) is
   * declined: CSP permits `data:` for images, a drive letter is outside the target's tree by
   * definition, and remote (`http`/`https`) sources are neutralized by the renderer itself before
   * this resolver runs (H6 — no network calls, ever). Anything escaping the tree is declined too
   * and renders broken rather than being granted access.
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

    // PRD §6 as corrected by H6 (no network origins); see `csp.ts` for the reasoning and the test.
    const csp = buildCsp(webview.cspSource, nonce);

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
  <section id="agent-notes" hidden aria-label="Notes from the agent"></section>
  <!-- First run shows a rendered document and no UI whatsoever: the header hides itself at zero
       counts, and nothing says selecting text does anything (H20). Dismissable, and it never comes
       back once the pane has a comment on it. -->
  <div id="empty-state" hidden></div>
  <div id="front-matter-root"></div>
  <main id="content"></main>
  <!-- Highlights are absolutely-positioned rectangles over the content, never wrappers around it:
       wrapping would split the text nodes anchor offsets are measured against. Paint only, so it is
       hidden from assistive tech — which is exactly why the markers below cannot live in here. -->
  <div id="highlight-overlay" aria-hidden="true"></div>
  <!-- Narrow-pane markers: focusable buttons, and below 700 px the only way to open a card. They
       were inside the overlay, i.e. focusable children of an aria-hidden container — a hard ARIA
       violation that made every comment unreachable by screen reader on a narrow pane (H16). -->
  <div id="marker-layer"></div>
  <aside id="gutter" aria-label="Comments"></aside>
  <!-- Single polite announcer. Creating, deleting, resolving and filtering all changed the pane
       silently before (H18); the orphan arm instruction had the only live region in the app. -->
  <div id="announcer" class="mr-visually-hidden" role="status" aria-live="polite"></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }

}
