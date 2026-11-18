/**
 * Card layout and formatting (Plan 03 §5).
 *
 * jsdom reports every rectangle as zero, so the *geometry* is only testable because it was factored
 * into `stackTops` — a pure function over numbers. That is the reason it is exported.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetBlockMaps } from '../src/anchorSpace.js';
import { initComments, relativeTime, sectionNote, stackTops } from '../src/comments.js';

/**
 * The wording of the D17 note, pinned as a *requirement* rather than as copy (§10 D19).
 *
 * `scopeOf` returns `'section' | 'block'`, but that kind never crosses the message channel —
 * `sectionChanged` is a bare `string[]`, kept narrow on purpose (§10 D3). So one string has to be
 * true at both scopes, and the note shipped for a while claiming a heading-delimited section had
 * moved when the diff had touched a single paragraph. Asserting the *absence* of a scope word
 * catches that regression without freezing the phrasing.
 */
describe('sectionNote', () => {
  it('names no scope it cannot know', () => {
    const text = sectionNote().textContent ?? '';
    expect(text).not.toMatch(/\bsections?\b/i);
    expect(text).not.toMatch(/\bblocks?\b|\bparagraphs?\b/i);
  });

  it('still says what changed and when, which is the whole point of the note', () => {
    expect(sectionNote().textContent).toMatch(/changed since you copied the prompt/);
  });
});

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


describe('fallback placement and reveal', () => {
  afterEach(() => {
    resetBlockMaps();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.className = '';
  });

  function mount(extra: { fallbackRect?: () => DOMRect | undefined; onReveal?: () => boolean }) {
    document.body.innerHTML =
      '<div id="root"><pre data-ap-start="0" data-ap-end="9"><code>graph TD A</code></pre></div>' +
      '<div id="gutter"></div><div id="overlay"></div><div id="markers"></div>';
    resetBlockMaps();
    const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
    Object.defineProperty(el('root'), 'clientWidth', { value: 800, configurable: true });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects'];
    const view = initComments({
      root: el('root'),
      gutter: el('gutter'),
      overlay: el('overlay'),
      markerLayer: el('markers'),
      onEdit: () => undefined,
      onDelete: () => undefined,
      onResolve: () => undefined,
      onReopen: () => undefined,
      announce: () => undefined,
      ...extra,
    });
    view.setState(
      {
        version: 1,
        targetPath: 'a.md',
        comments: [
          {
            id: 'c1',
            body: 'note',
            author: 'me',
            createdAt: '2026-01-01T00:00:00Z',
            status: 'open',
            anchor: { exact: 'graph', prefix: '', suffix: '', hintLine: 0, hintOffset: 0 },
          },
        ],
      },
      { c1: { start: 0, end: 5, confidence: 1 } },
      [],
    );
    return { gutter: el('gutter'), overlay: el('overlay') };
  }

  it('card is placed from the fallback rect', () => {
    const { gutter, overlay } = mount({ fallbackRect: () => new DOMRect(0, 123, 10, 10) });
    const card = gutter.querySelector<HTMLElement>('.mr-card');
    expect(card?.style.top).toBe('123px');
    expect(overlay.querySelector('.mr-highlight')).toBeNull();
  });

  it('card is not placed without a fallback rect', () => {
    const { gutter } = mount({ fallbackRect: () => undefined });
    expect(gutter.querySelector<HTMLElement>('.mr-card')?.style.top).toBe('');
  });

  it('a card click reveals a hidden source in a wide pane', () => {
    const onReveal = vi.fn(() => false);
    const { gutter } = mount({ onReveal });
    gutter.querySelector<HTMLElement>('.mr-card')?.click();
    expect(onReveal).toHaveBeenCalledTimes(1);
    const range = (onReveal.mock.calls[0] as unknown as [Range])[0];
    expect(range.toString()).toBe('graph');
  });
});
