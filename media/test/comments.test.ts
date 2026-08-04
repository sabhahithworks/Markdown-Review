/**
 * Card layout and formatting (Plan 03 §5).
 *
 * jsdom reports every rectangle as zero, so the *geometry* is only testable because it was factored
 * into `stackTops` — a pure function over numbers. That is the reason it is exported.
 */

import { describe, expect, it } from 'vitest';
import { relativeTime, stackTops } from '../src/comments.js';

describe('stackTops', () => {
  it('leaves cards that already clear each other where they are', () => {
    expect(stackTops([0, 100, 200], [40, 40, 40], 8)).toEqual([0, 100, 200]);
  });

  it('pushes an overlapping card below the previous one', () => {
    // Second card wants 20 but the first occupies 0–40, so it goes to 40 + 8.
    expect(stackTops([0, 20], [40, 40], 8)).toEqual([0, 48]);
  });

  it('cascades through a run of overlaps', () => {
    expect(stackTops([0, 0, 0], [10, 10, 10], 5)).toEqual([0, 15, 30]);
  });

  it('never reorders: a card wanting to sit higher than its predecessor is pushed down', () => {
    // Document order is authoritative — a comment anchored to an earlier passage stays above one
    // anchored later, even when relocation puts their rectangles out of order.
    expect(stackTops([100, 50], [20, 20], 4)).toEqual([100, 124]);
  });

  it('handles an empty list and a single card', () => {
    expect(stackTops([], [], 8)).toEqual([]);
    expect(stackTops([42], [10], 8)).toEqual([42]);
  });

  it('treats a missing height as zero rather than producing NaN', () => {
    // jsdom reports `offsetHeight` as 0; a real layout may still race a card that is not laid out
    // yet. Either way the result must stay a number.
    expect(stackTops([0, 0], [], 8)).toEqual([0, 8]);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');

  it.each([
    ['2026-06-01T11:59:30.000Z', 'now'],
    ['2026-06-01T11:58:00.000Z', '2 minutes ago'],
    ['2026-06-01T09:00:00.000Z', '3 hours ago'],
    ['2026-05-30T12:00:00.000Z', '2 days ago'],
    ['2026-04-01T12:00:00.000Z', '2 months ago'],
    ['2024-06-01T12:00:00.000Z', '2 years ago'],
  ])('formats %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it('falls back to the raw value for an unparseable timestamp', () => {
    // The sidecar is hand-editable, so this is reachable input, not a hypothetical.
    expect(relativeTime('not a date', now)).toBe('not a date');
  });
});
