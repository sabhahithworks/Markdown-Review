/**
 * A trailing debounce, extracted so it can be tested (Plan 04 §4a.4).
 *
 * `changeWatcher.ts` is unreachable from vitest — it subscribes to `vscode` events — but the only
 * part of it with any behaviour worth arguing about is *when* the callback fires. That part lives
 * here, `vscode`-free, so a burst of edits collapsing into one pass is a unit test rather than a
 * stopwatch and a hopeful assertion in the integration suite.
 *
 * Trailing rather than leading: the point is to act on the document once it has settled. Firing on
 * the first keystroke would re-anchor against a half-typed sentence and orphan comments that are
 * about to be fine.
 */

export interface Coalescer {
  /** Starts, or restarts, the quiet window. Calls during a pending window collapse into one run. */
  schedule(): void;
  /** Runs a pending callback immediately. A no-op when nothing is scheduled. */
  flush(): void;
  /** Drops a pending callback without running it. */
  cancel(): void;
  isPending(): boolean;
  /** Cancels, and makes every later `schedule()` a no-op. */
  dispose(): void;
}

export function createCoalescer(delayMs: number, run: () => void): Coalescer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clear = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  return {
    schedule(): void {
      if (disposed) return;
      clear();
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, delayMs);
    },

    flush(): void {
      if (timer === undefined) return;
      clear();
      // Still runs when disposed *after* scheduling: a pending change is real work, and dropping it
      // silently is how an edit goes missing. `dispose()` cancels; only `flush()` runs.
      run();
    },

    cancel(): void {
      clear();
    },

    isPending(): boolean {
      return timer !== undefined;
    },

    dispose(): void {
      disposed = true;
      clear();
    },
  };
}
