/**
 * The debounce behind change detection (PRD §8's 400 ms).
 *
 * Fake timers throughout: the whole point of extracting this from `changeWatcher.ts` was to assert
 * the timing without a real clock, since a test that sleeps is a test that is flaky on a loaded CI
 * box and slow everywhere else.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCoalescer } from '../detect/coalesce.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createCoalescer', () => {
  it('runs once, after the quiet window', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.schedule();
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst into a single run', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    // A save fires the document-change event and the file watcher; a typing burst fires many more.
    for (let i = 0; i < 20; i++) {
      coalescer.schedule();
      vi.advanceTimersByTime(50);
    }
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('restarts the window rather than letting the first call win', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.schedule();
    vi.advanceTimersByTime(300);
    coalescer.schedule();
    vi.advanceTimersByTime(300);

    // 600 ms since the first schedule, but only 300 ms of quiet.
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again after a completed window', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.schedule();
    vi.advanceTimersByTime(400);
    coalescer.schedule();
    vi.advanceTimersByTime(400);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports whether a run is pending', () => {
    const coalescer = createCoalescer(400, vi.fn());

    expect(coalescer.isPending()).toBe(false);
    coalescer.schedule();
    expect(coalescer.isPending()).toBe(true);
    vi.advanceTimersByTime(400);
    expect(coalescer.isPending()).toBe(false);
  });

  it('flush runs a pending callback immediately and only once', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.schedule();
    coalescer.flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(coalescer.isPending()).toBe(false);

    // The timer must be gone, not merely ignored.
    vi.advanceTimersByTime(400);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flush does nothing when nothing is scheduled', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.flush();

    expect(run).not.toHaveBeenCalled();
  });

  it('cancel drops a pending callback', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.schedule();
    coalescer.cancel();
    vi.advanceTimersByTime(400);

    expect(run).not.toHaveBeenCalled();
  });

  it('dispose cancels a pending callback and ignores later schedules', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.schedule();
    coalescer.dispose();
    vi.advanceTimersByTime(400);
    expect(run).not.toHaveBeenCalled();

    // A watcher event arriving after the panel closed must not re-arm the timer.
    coalescer.schedule();
    vi.advanceTimersByTime(400);
    expect(run).not.toHaveBeenCalled();
    expect(coalescer.isPending()).toBe(false);
  });

  it('still flushes work scheduled before disposal', () => {
    const run = vi.fn();
    const coalescer = createCoalescer(400, run);

    coalescer.schedule();
    coalescer.flush();
    coalescer.dispose();

    expect(run).toHaveBeenCalledTimes(1);
  });
});
