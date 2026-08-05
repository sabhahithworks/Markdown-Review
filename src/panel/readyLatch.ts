/**
 * The host→webview delivery gate (H14, D23).
 *
 * Pure and `vscode`-free so it can be unit-tested: the bug this encodes was only ever reachable by
 * reloading a real VS Code window, which `@vscode/test-electron` cannot do to itself. Keeping the
 * decision here means the *rule* has coverage even though the path that exercised it does not.
 *
 * The rule, in one sentence: messages may be posted only after the webview has handshaked, a hide
 * closes the gate, and a show reopens it — but only if the webview had already handshaked once.
 *
 * Why the last clause. H14 closed the gate on hide because without `retainContextWhenHidden` the
 * context is destroyed, and posting into a dead webview silently "succeeds". It assumed the reverse
 * too — that the reloaded script always re-handshakes — so nothing needed to reopen the gate. A
 * window restore breaks that assumption: it emits view-state churn *without* destroying the
 * context, so the gate closes, no second `ready` is ever sent, and the pane stays blank forever
 * (D23). Reopening on show is what makes the gate recoverable. It is safe in both directions — if
 * the context really did die, the reloaded script posts its own `ready` and the caller refreshes
 * twice, which is idempotent.
 */
export class ReadyLatch {
  private open = false;
  private handshaked = false;

  /** Whether a host→webview message can be delivered right now. */
  get canPost(): boolean {
    return this.open;
  }

  /** Whether the webview has handshaked at least once in this panel's life. */
  get hasHandshaked(): boolean {
    return this.handshaked;
  }

  /** The webview posted `ready`: it has a listener attached and is accepting messages. */
  onReady(): void {
    this.open = true;
    this.handshaked = true;
  }

  /**
   * A view-state change. Returns whether the caller should re-render and re-post.
   *
   * True only on the hidden→visible edge of an already-handshaked panel: that is the case where
   * state may have been dropped while the gate was shut and nothing else will redeliver it. Before
   * the first handshake this stays false — the script genuinely has not loaded, and rendering a
   * whole document into a webview that cannot listen is wasted work on exactly the large files the
   * performance budget cares about.
   */
  onVisibilityChange(visible: boolean): boolean {
    if (!visible) {
      this.open = false;
      return false;
    }
    if (!this.handshaked || this.open) return false;
    this.open = true;
    return true;
  }
}
