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
import type { Comment, CommentStatus, ReviewFile } from '../anchor/types.js';
import { emptyReviewFile, parseReviewFile, serializeReviewFile } from './reviewFile.js';
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

  /** Flushes and disposes every live store. Called from `deactivate()`. */
  static async disposeAll(): Promise<void> {
    const stores = [...ReviewStore.stores.values()];
    ReviewStore.stores.clear();
    await Promise.all(stores.map((store) => store.dispose()));
  }

  getState(): ReviewFile {
    return this.state;
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

  private mapComment(id: string, update: (comment: Comment) => Comment): void {
    let hit = false;
    const comments = this.state.comments.map((comment) => {
      if (comment.id !== id) return comment;
      hit = true;
      return update(comment);
    });
    if (hit) this.commit({ ...this.state, comments });
  }

  /** Applies new state, notifies subscribers immediately, and schedules the disk write. */
  private commit(next: ReviewFile): void {
    this.state = next;
    this.emitter.fire(next);
    this.scheduleWrite();
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
    const backup = this.sidecar.with({ path: backupFileName(this.sidecar.path) });
    this.output.appendLine(`[store] ${this.sidecar.fsPath}: ${reason} — ${detail}`);

    try {
      await vscode.workspace.fs.writeFile(backup, new TextEncoder().encode(raw));
    } catch (error) {
      // Could not back up — do not touch the original either. The user keeps their data; the panel
      // just starts empty for this session.
      this.output.appendLine(`[store] could not write ${backup.fsPath}: ${String(error)}`);
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
  const mode = vscode.workspace
    .getConfiguration('markdownReview')
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
