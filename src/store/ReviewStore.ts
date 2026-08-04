/**
 * Sidecar persistence (Plan 03 §3 — contract owner for the `vscode`-facing half).
 *
 * **One store per target file, shared by every consumer.** `ReviewStore.for()` returns the same
 * instance for the same URI, so two panels, the command layer and Phase 4's change watcher all read
 * and write one source of truth (PRD §11). Consumers subscribe to `onDidChange` and re-render; they
 * never hold their own copy of the state.
 *
 * The naming rules and the validation guard live in `sidecarPath.ts` and `reviewFile.ts`, which are
 * `vscode`-free and unit-tested. This file is the I/O, the debounce and the user-facing messaging.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ReanchorOptions } from '../anchor/reanchor.js';
import { reanchor } from '../anchor/reanchor.js';
import type { Anchor, Comment, CommentStatus, PlainTextDoc, ReviewFile } from '../anchor/types.js';
import {
  BASELINE_MAX_CHARS,
  emptyReviewFile,
  parseReviewFile,
  serializeReviewFile,
} from './reviewFile.js';
import {
  REVIEWS_DIR,
  backupFileName,
  globalSidecarFileName,
  sidecarFileName,
  toTargetPath,
} from './sidecarPath.js';

/** Rapid add/edit bursts coalesce into one write. */
const WRITE_DEBOUNCE_MS = 250;

/** Shown once per machine, not once per file — the point is made the first time (PRD §11). */
const LOOSE_FILE_WARNING_KEY = 'markdownReview.looseFileWarningShown';

/**
 * The outcome of a bulk clear.
 *
 * `backup-failed` is a distinct outcome rather than a thrown error because it is the *expected*
 * failure the caller must report honestly: nothing was removed, and the user needs to be told that
 * rather than left assuming their comments are gone.
 */
export type ClearResult = { ok: true; removed: number } | { ok: false; reason: 'backup-failed' };

export class ReviewStore {
  private static readonly stores = new Map<string, ReviewStore>();

  private readonly emitter = new vscode.EventEmitter<ReviewFile>();
  readonly onDidChange: vscode.Event<ReviewFile> = this.emitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private state: ReviewFile;
  private loaded: Promise<void> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  /**
   * The exact bytes of our most recent write. The sidecar watcher compares against this to tell an
   * external hand-edit from the echo of our own `writeFile`.
   */
  private lastWritten: string | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly target: vscode.Uri,
    private readonly sidecar: vscode.Uri,
    private readonly output: vscode.OutputChannel,
    targetPath: string,
  ) {
    this.state = emptyReviewFile(targetPath);
  }

  /**
   * The shared instance for `target`. Cheap and synchronous — the sidecar is read on the first
   * `ensureLoaded()`, so a caller that only needs to subscribe does not pay for I/O.
   */
  static for(
    context: vscode.ExtensionContext,
    target: vscode.Uri,
    output: vscode.OutputChannel,
  ): ReviewStore {
    const key = target.toString();
    const existing = ReviewStore.stores.get(key);
    if (existing) return existing;

    const { sidecar, targetPath, loose } = resolveSidecar(context, target);
    const store = new ReviewStore(context, target, sidecar, output, targetPath);
    ReviewStore.stores.set(key, store);

    if (loose) void store.warnLooseFile();
    return store;
  }

  /**
   * Moves a review onto a different file (PRD §11's "offer to re-link").
   *
   * Not a field update, which is what "update `targetPath`" sounds like: stores are keyed by target
   * URI and the sidecar *filename* is derived from the target path, so re-linking is a migration
   * between two stores. Comments and the baseline move across; the old sidecar is emptied, never
   * deleted, and only after the new one is safely on disk — so a failure at any point leaves the
   * comments somewhere rather than nowhere.
   *
   * Anchors are carried over untouched. They are relocated by the next `applyReanchor` against the
   * new document, which is exactly the "did this text survive?" question re-linking asks.
   */
  static async relink(
    context: vscode.ExtensionContext,
    from: vscode.Uri,
    to: vscode.Uri,
    output: vscode.OutputChannel,
  ): Promise<{ ok: true; moved: number } | { ok: false; reason: 'same-file' | 'write-failed' }> {
    if (from.toString() === to.toString()) return { ok: false, reason: 'same-file' };

    const source = ReviewStore.for(context, from, output);
    const previous = await source.ensureLoaded();

    const destination = ReviewStore.for(context, to, output);
    await destination.ensureLoaded();

    destination.commit({
      ...destination.getState(),
      comments: [...destination.getState().comments, ...previous.comments],
      ...(previous.baselineText === undefined ? {} : { baselineText: previous.baselineText }),
      ...(previous.baselineAt === undefined ? {} : { baselineAt: previous.baselineAt }),
    });
    await destination.flush();

    if (destination.lastWritten === undefined) {
      // The new sidecar never reached disk; leave the old one exactly as it was.
      output.appendLine(`[store] relink aborted: could not write ${destination.sidecar.fsPath}`);
      return { ok: false, reason: 'write-failed' };
    }

    source.commit(emptyReviewFile(source.getState().targetPath));
    await source.flush();

    return { ok: true, moved: previous.comments.length };
  }

  /** Flushes and disposes every live store. Called from `deactivate()`. */
  static async disposeAll(): Promise<void> {
    const stores = [...ReviewStore.stores.values()];
    ReviewStore.stores.clear();
    await Promise.all(stores.map((store) => store.dispose()));
  }

  getState(): ReviewFile {
    return this.state;
  }

  /** Where this review is stored. Used to name the backup in a user-facing message. */
  get sidecarPath(): string {
    return this.sidecar.fsPath;
  }

  /** Reads the sidecar on first call; later calls await the same read. */
  async ensureLoaded(): Promise<ReviewFile> {
    this.loaded ??= this.load();
    await this.loaded;
    return this.state;
  }

  addComment(comment: Comment): void {
    this.commit({ ...this.state, comments: [...this.state.comments, comment] });
  }

  updateCommentBody(id: string, body: string): void {
    this.mapComment(id, (comment) => ({ ...comment, body }));
  }

  /**
   * Removes a comment. Only ever called from an explicit user action — the extension must never
   * delete a comment on its own (PRD §4).
   */
  deleteComment(id: string): void {
    const comments = this.state.comments.filter((comment) => comment.id !== id);
    if (comments.length === this.state.comments.length) return;
    this.commit({ ...this.state, comments });
  }

  setStatus(id: string, status: CommentStatus): void {
    this.mapComment(id, (comment) => ({ ...comment, status }));
  }

  /**
   * Re-attaches an orphaned comment to a selection the user picked by hand (PRD §6).
   *
   * The comment keeps its id, body, author and creation time — it is the same remark about the same
   * concern, pointed somewhere new — and returns to `open` with any stale before/after cleared,
   * since the resolution described a relocation that no longer applies.
   */
  reattach(id: string, anchor: Anchor): void {
    this.mapComment(id, (comment) => {
      const next: Comment = { ...comment, anchor, status: 'open' };
      delete next.resolution;
      return next;
    });
  }

  /**
   * Records the rendered plain text as the diff baseline (PRD §7).
   *
   * Called at the moment the prompt is copied, which is what makes "the document was rewritten"
   * answerable later. Deliberately does not notify: nothing renders the baseline, so a `reviewState`
   * round-trip carrying a quarter of a megabyte would buy nothing.
   */
  snapshotBaseline(plainText: string, now: () => string = () => new Date().toISOString()): void {
    if (plainText.length > BASELINE_MAX_CHARS) {
      this.output.appendLine(
        `[store] ${this.state.targetPath}: rendered text is ${String(plainText.length)} chars, ` +
          `over the ${String(BASELINE_MAX_CHARS)} baseline limit — skipping the snapshot ` +
          '(the rewrite diff will be unavailable for this file)',
      );
      return;
    }

    this.commit(
      { ...this.state, baselineText: plainText, baselineAt: now() },
      { notify: false },
    );
  }

  /**
   * Relocates every comment against `doc` and infers status (Plan 01 §6). Returns whether any
   * status or resolution actually changed.
   *
   * The result is *always* adopted in memory, because hints must keep tracking edits, but it is
   * persisted only when something meaningful changed. That asymmetry is deliberate and load-bearing:
   * `ReanchorResult.changed` excludes hint drift precisely so a burst of keystrokes does not turn
   * into a burst of disk writes. In between, `this.state` legitimately runs ahead of the sidecar by
   * the drifted hints, and the next real change serializes them for free.
   */
  applyReanchor(doc: PlainTextDoc, options: ReanchorOptions = {}): boolean {
    if (this.loaded === undefined) {
      // Re-anchoring before the sidecar has been read would relocate an empty placeholder and then
      // persist it over real comments.
      this.output.appendLine(`[store] applyReanchor before ensureLoaded for ${this.state.targetPath}`);
      return false;
    }

    const result = reanchor(this.state, doc, {
      ...options,
      inferAddressed: options.inferAddressed ?? this.inferAddressedSetting(),
    });

    this.commit(result.reviewFile, { persist: result.changed, notify: result.changed });
    return result.changed;
  }

  /**
   * `markdownReview.autoDetectResolution`, scoped to this target so a folder-level
   * `.vscode/settings.json` wins in a multi-root workspace.
   */
  private inferAddressedSetting(): boolean {
    return vscode.workspace
      .getConfiguration('markdownReview', this.target)
      .get<boolean>('autoDetectResolution', true);
  }

  /**
   * Removes every `addressed` comment (PRD §6). A user action, so deletion is allowed — only
   * *automatic* deletion is forbidden (PRD §4) — but only because it is recoverable, which is why a
   * failed backup abandons the whole operation rather than proceeding.
   */
  async clearAddressed(): Promise<ClearResult> {
    const remaining = this.state.comments.filter((comment) => comment.status !== 'addressed');
    return this.clearTo(remaining, this.state.comments.length - remaining.length);
  }

  /**
   * Removes every comment, and the baseline with them — a baseline with nothing left to relocate
   * would arm the rewrite banner against an empty review. The file itself is never touched.
   */
  async clearAll(): Promise<ClearResult> {
    const removed = this.state.comments.length;
    if (removed === 0) return { ok: true, removed: 0 };
    if (!(await this.backup())) return { ok: false, reason: 'backup-failed' };

    this.commit(emptyReviewFile(this.state.targetPath));
    await this.flush();
    return { ok: true, removed };
  }

  private async clearTo(comments: Comment[], removed: number): Promise<ClearResult> {
    if (removed === 0) return { ok: true, removed: 0 };
    if (!(await this.backup())) return { ok: false, reason: 'backup-failed' };

    this.commit({ ...this.state, comments });
    await this.flush();
    return { ok: true, removed };
  }

  /**
   * Copies the current comments to `<name>.json.bak`, returning where they landed.
   *
   * Public because a destructive user action has to be undoable by hand. Backs up what is *in
   * memory* rather than re-reading the sidecar: a write may still be sitting in the 250 ms debounce,
   * and this also works before the sidecar has ever been written.
   */
  async backup(): Promise<vscode.Uri | undefined> {
    await this.flush();
    return this.writeBackup(serializeReviewFile(this.state));
  }

  private mapComment(id: string, update: (comment: Comment) => Comment): void {
    let hit = false;
    const comments = this.state.comments.map((comment) => {
      if (comment.id !== id) return comment;
      hit = true;
      return update(comment);
    });
    if (hit) this.commit({ ...this.state, comments });
  }

  /**
   * Applies new state, notifies subscribers immediately, and schedules the disk write.
   *
   * Both effects are optional because Phase 4 has changes that legitimately want only one of them:
   * a re-anchor pass that moved nothing but hints must be adopted in memory *without* a write (see
   * `ReanchorResult.changed` — making hint drift persist turns every keystroke into disk I/O), and
   * a baseline snapshot must persist *without* a notify, because nothing renders the baseline and a
   * `reviewState` round-trip for it would be pure waste. The defaults are the Phase 3 behaviour, so
   * existing callers are unaffected.
   */
  private commit(next: ReviewFile, options: { persist?: boolean; notify?: boolean } = {}): void {
    const { persist = true, notify = true } = options;
    this.state = next;
    if (notify) this.emitter.fire(next);
    if (persist) this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.debounce !== undefined) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.write();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Writes any pending change now. Called on panel dispose and extension deactivate. */
  async flush(): Promise<void> {
    if (this.debounce === undefined) return;
    clearTimeout(this.debounce);
    this.debounce = undefined;
    await this.write();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.flush();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.emitter.dispose();
  }

  // ------------------------------------------------------------------ disk

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(this.sidecar));
    } catch {
      // No sidecar yet is the normal first-run case, not an error.
      this.watchSidecar();
      return;
    }

    const result = parseReviewFile(raw);
    if (result.ok) {
      this.state = result.review;
      this.emitter.fire(this.state);
    } else {
      await this.quarantine(raw, result.reason, result.detail);
    }

    this.watchSidecar();
  }

  /**
   * PRD §11: fail soft, keep every byte, say what happened. The backup is written before the empty
   * state is adopted, so a failure here leaves the original sidecar untouched rather than losing it.
   */
  private async quarantine(raw: string, reason: string, detail: string): Promise<void> {
    this.output.appendLine(`[store] ${this.sidecar.fsPath}: ${reason} — ${detail}`);

    const backup = await this.writeBackup(raw);
    if (!backup) {
      // Could not back up — do not touch the original either. The user keeps their data; the panel
      // just starts empty for this session.
      void vscode.window.showWarningMessage(
        `Markdown Review could not read the comments for ${this.state.targetPath}, and could not back the file up either. Nothing has been changed on disk.`,
      );
      return;
    }

    this.state = emptyReviewFile(this.state.targetPath);
    this.emitter.fire(this.state);

    const explanation =
      reason === 'unsupported-version'
        ? `was written by a newer version of the extension (${detail})`
        : 'could not be read';

    void vscode.window
      .showWarningMessage(
        `The comments file for ${this.state.targetPath} ${explanation}. A backup was saved as ${path.basename(backup.fsPath)} and this review is starting empty.`,
        'Show backup',
      )
      .then((choice) => {
        if (choice === 'Show backup') void vscode.window.showTextDocument(backup);
      });
  }

  /**
   * Copies `text` to `<name>.json.bak`, returning where it landed — or `undefined` when it could
   * not be written, which is always a reason to abandon whatever destructive step wanted it.
   *
   * Logged rather than thrown: every caller has to keep working after a failed backup, and each has
   * its own wording for what it then declined to do.
   */
  private async writeBackup(text: string): Promise<vscode.Uri | undefined> {
    const backup = this.sidecar.with({ path: backupFileName(this.sidecar.path) });
    try {
      await vscode.workspace.fs.createDirectory(
        this.sidecar.with({ path: path.posix.dirname(this.sidecar.path) }),
      );
      await vscode.workspace.fs.writeFile(backup, new TextEncoder().encode(text));
      return backup;
    } catch (error) {
      this.output.appendLine(`[store] could not write ${backup.fsPath}: ${String(error)}`);
      return undefined;
    }
  }

  private async write(): Promise<void> {
    const text = serializeReviewFile(this.state);
    const bytes = new TextEncoder().encode(text);
    const temporary = this.sidecar.with({ path: `${this.sidecar.path}.tmp` });

    try {
      await vscode.workspace.fs.createDirectory(this.sidecar.with({ path: path.posix.dirname(this.sidecar.path) }));
      // Write-then-rename: a crash mid-write leaves the previous sidecar intact rather than a
      // truncated one.
      await vscode.workspace.fs.writeFile(temporary, bytes);
      await vscode.workspace.fs.rename(temporary, this.sidecar, { overwrite: true });
      this.lastWritten = text;
    } catch (error) {
      this.output.appendLine(`[store] could not write ${this.sidecar.fsPath}: ${String(error)}`);
      void vscode.window.showWarningMessage(
        `Markdown Review could not save comments for ${this.state.targetPath}. They are still here in this window, but will be lost if it closes.`,
      );
    }
  }

  /**
   * Watches the sidecar so hand-editing the JSON while a panel is open behaves sanely — the PRD
   * promises the file is editable, which is only true if the UI notices.
   */
  private watchSidecar(): void {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(this.sidecar.fsPath)),
        path.basename(this.sidecar.fsPath),
      ),
    );
    this.disposables.push(watcher);

    const reread = (): void => void this.rereadExternal();
    watcher.onDidChange(reread, null, this.disposables);
    watcher.onDidCreate(reread, null, this.disposables);
  }

  private async rereadExternal(): Promise<void> {
    if (this.disposed) return;
    // A write of ours is still pending; the file on disk is about to be overwritten anyway.
    if (this.debounce !== undefined) return;

    let raw: string;
    try {
      raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(this.sidecar));
    } catch {
      return;
    }

    if (raw === this.lastWritten) return; // the echo of our own write

    const result = parseReviewFile(raw);
    if (!result.ok) {
      // A hand-edit in progress is usually transiently invalid. Say so in the log, keep the
      // in-memory state, and do not quarantine — the user is mid-keystroke, not corrupt.
      this.output.appendLine(`[store] ignoring invalid external edit: ${result.reason} — ${result.detail}`);
      return;
    }

    this.state = result.review;
    this.lastWritten = raw;
    this.emitter.fire(this.state);
  }

  private async warnLooseFile(): Promise<void> {
    if (this.context.globalState.get<boolean>(LOOSE_FILE_WARNING_KEY) === true) return;
    await this.context.globalState.update(LOOSE_FILE_WARNING_KEY, true);
    void vscode.window.showInformationMessage(
      `${path.basename(this.target.fsPath)} isn't in a workspace folder, so its comments are stored privately on this machine and can't be shared through git. Open its folder as a workspace to keep them alongside the file.`,
    );
  }
}

/**
 * Where this target's sidecar lives, and what `ReviewFile.targetPath` should say.
 *
 * `workspace` mode keeps comments next to the code so they can be committed; `global` mode and the
 * no-workspace fallback both use `globalStorageUri`, where a flattened relative path would be
 * meaningless — hence the hashed name (PRD §11, Plan 03 §3).
 */
function resolveSidecar(
  context: vscode.ExtensionContext,
  target: vscode.Uri,
): { sidecar: vscode.Uri; targetPath: string; loose: boolean } {
  const folder = vscode.workspace.getWorkspaceFolder(target);
  // Scoped to the target: in a multi-root workspace one folder may keep its reviews in git while
  // another keeps them private, and an unscoped read would silently apply the first folder's answer
  // to both.
  const mode = vscode.workspace
    .getConfiguration('markdownReview', target)
    .get<'workspace' | 'global'>('storageLocation', 'workspace');

  if (folder && mode === 'workspace') {
    const relative = path.relative(folder.uri.fsPath, target.fsPath);
    return {
      sidecar: vscode.Uri.joinPath(folder.uri, REVIEWS_DIR, sidecarFileName(relative)),
      targetPath: toTargetPath(relative),
      loose: false,
    };
  }

  return {
    sidecar: vscode.Uri.joinPath(
      context.globalStorageUri,
      'reviews',
      globalSidecarFileName(target.fsPath),
    ),
    // Still workspace-relative when a folder exists — only the *storage location* changed.
    targetPath: folder
      ? toTargetPath(path.relative(folder.uri.fsPath, target.fsPath))
      : path.basename(target.fsPath),
    loose: !folder,
  };
}
