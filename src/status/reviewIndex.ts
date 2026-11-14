/**
 * Per-target comment counts for the status bar and the Explorer badge.
 *
 * The index holds counts only, never a review and never a `ReviewStore`: creating a store for a
 * loose file would raise the loose-file warning, and the store registry stays the one owner of
 * review state. It is fed by a scan of each workspace folder's `.reviews/*.json`, by a watcher on
 * the same pattern (writes from outside the store), and by `ReviewStore.onDidChangeAny`.
 */

import * as vscode from 'vscode';
import { countByStatus } from '../anchor/counts.js';
import type { CommentStatus, ReviewFile } from '../anchor/types.js';
import { ReviewStore } from '../store/ReviewStore.js';
import { registryKey } from '../store/registryKey.js';
import { parseReviewFile } from '../store/reviewFile.js';
import { REVIEWS_DIR } from '../store/sidecarPath.js';

export const MAX_INDEXED_SIDECARS = 2000;

export type StatusCounts = Record<CommentStatus, number>;
type StoreEvents = vscode.Event<{ target: vscode.Uri; review: ReviewFile }>;

interface Entry {
  readonly uri: vscode.Uri;
  readonly counts: StatusCounts;
}

export class ReviewIndex implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  /** Sidecar URI string -> target key, so a deleted sidecar drops the right entry. */
  private readonly sidecarTargets = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChange: vscode.Event<vscode.Uri[]> = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private watchers: vscode.Disposable[] = [];
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly output: vscode.OutputChannel,
    storeEvents: StoreEvents = ReviewStore.onDidChangeAny,
    private readonly cap: number = MAX_INDEXED_SIDECARS,
  ) {
    this.disposables.push(
      storeEvents(({ target, review }) => {
        this.set(target, countByStatus(review.comments));
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.rescan('a workspace folder change')),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('markdownReview.storageLocation')) {
          this.rescan('a storageLocation change');
        }
      }),
    );
  }

  countsFor(uri: vscode.Uri): StatusCounts | undefined {
    return this.entries.get(registryKey(uri.toString()))?.counts;
  }

  /**
   * Rebuilds the watchers and the sidecar-derived entries for the current workspace folders.
   *
   * A newer scan, or `dispose`, supersedes this one at any await. A superseded scan creates no
   * more watchers, which would land in the newer scan's list or outlive `dispose`, and still
   * announces the entries it cleared: the newer scan never saw them, so nobody else will. A scan
   * that throws announces them too before the error propagates.
   */
  async scan(): Promise<void> {
    const generation = ++this.generation;
    const superseded = (): boolean => this.disposed || generation !== this.generation;
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];

    const changed: vscode.Uri[] = [];
    for (const [sidecar, key] of this.sidecarTargets) {
      const entry = this.entries.get(key);
      if (entry) changed.push(entry.uri);
      this.entries.delete(key);
      this.sidecarTargets.delete(sidecar);
    }

    try {
      await this.rebuild(superseded);
    } finally {
      if (!this.disposed && changed.length > 0) this.changeEmitter.fire(changed);
    }
  }

  private async rebuild(superseded: () => boolean): Promise<void> {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter(
      (folder) =>
        vscode.workspace
          .getConfiguration('markdownReview', folder.uri)
          .get<'workspace' | 'global'>('storageLocation', 'workspace') === 'workspace',
    );

    const found: { sidecar: vscode.Uri; folder: vscode.WorkspaceFolder }[] = [];
    for (const folder of folders) {
      if (superseded()) return;
      const pattern = new vscode.RelativePattern(folder, `${REVIEWS_DIR}/*.json`);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidCreate((uri) => void this.reread(uri, folder));
      watcher.onDidChange((uri) => void this.reread(uri, folder));
      watcher.onDidDelete((uri) => this.drop(uri));
      this.watchers.push(watcher);

      const uris = await vscode.workspace.findFiles(pattern);
      for (const sidecar of uris) found.push({ sidecar, folder });
    }
    if (superseded()) return;

    for (const { sidecar, folder } of found.slice(0, this.cap)) {
      const result = await this.read(sidecar, folder);
      if (superseded()) return;
      if (result.ok) {
        this.sidecarTargets.set(sidecar.toString(), registryKey(result.target.toString()));
        this.set(result.target, result.counts);
      } else {
        this.output.appendLine(`[index] ${sidecar.fsPath}: ${result.reason}`);
      }
    }
    if (found.length > this.cap) {
      this.output.appendLine(`[index] indexed ${String(this.cap)} of ${String(found.length)} reviews`);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const watcher of this.watchers) watcher.dispose();
    for (const disposable of this.disposables) disposable.dispose();
    this.changeEmitter.dispose();
  }

  private rescan(reason: string): void {
    this.scan().catch((error: unknown) => {
      this.output.appendLine(`[index] rescan after ${reason} failed: ${errorText(error)}`);
    });
  }

  private set(target: vscode.Uri, counts: StatusCounts): void {
    this.entries.set(registryKey(target.toString()), { uri: target, counts });
    this.changeEmitter.fire([target]);
  }

  private drop(sidecar: vscode.Uri): void {
    const key = this.sidecarTargets.get(sidecar.toString());
    if (key === undefined) return;
    this.sidecarTargets.delete(sidecar.toString());
    const entry = this.entries.get(key);
    this.entries.delete(key);
    if (entry) this.changeEmitter.fire([entry.uri]);
  }

  /** A watcher re-read: a failed parse keeps the last counts, since a hand-edit may be mid-keystroke. */
  private async reread(sidecar: vscode.Uri, folder: vscode.WorkspaceFolder): Promise<void> {
    const result = await this.read(sidecar, folder);
    if (this.disposed) return;
    if (!result.ok) {
      this.output.appendLine(`[index] ${sidecar.fsPath}: ${result.reason} (keeping the last counts)`);
      return;
    }
    this.sidecarTargets.set(sidecar.toString(), registryKey(result.target.toString()));
    this.set(result.target, result.counts);
  }

  private async read(
    sidecar: vscode.Uri,
    folder: vscode.WorkspaceFolder,
  ): Promise<{ ok: true; target: vscode.Uri; counts: StatusCounts } | { ok: false; reason: string }> {
    let raw: string;
    try {
      raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(sidecar));
    } catch (error) {
      return { ok: false, reason: `read failed: ${errorText(error)}` };
    }
    const parsed = parseReviewFile(raw);
    if (!parsed.ok) return { ok: false, reason: `${parsed.reason}: ${parsed.detail}` };
    // `targetPath` is workspace-relative with forward slashes (D23); never derived from the file name.
    const target = vscode.Uri.joinPath(folder.uri, ...parsed.review.targetPath.split('/'));
    return { ok: true, target, counts: countByStatus(parsed.review.comments) };
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
