/**
 * D23: the delivery gate must be recoverable.
 *
 * The bug these cover was only reachable by reloading a real VS Code window with the review pane as
 * the only editor — a path `@vscode/test-electron` cannot reach, since it cannot reload itself. The
 * rule was extracted into `ReadyLatch` precisely so the part that was wrong can be asserted here.
 */

import { describe, expect, it } from 'vitest';
import { ReadyLatch } from '../panel/readyLatch.js';

describe('ReadyLatch', () => {
  it('drops messages until the webview handshakes', () => {
    const latch = new ReadyLatch();
    expect(latch.canPost).toBe(false);
    expect(latch.hasHandshaked).toBe(false);

    latch.onReady();
    expect(latch.canPost).toBe(true);
  });

  it('shuts on hide, because the context is gone and posting would silently succeed (H14)', () => {
    const latch = new ReadyLatch();
    latch.onReady();

    expect(latch.onVisibilityChange(false)).toBe(false);
    expect(latch.canPost).toBe(false);
  });

  it('reopens on show and asks for a refresh, so a survived context is not stranded (D23)', () => {
    const latch = new ReadyLatch();
    latch.onReady();
    latch.onVisibilityChange(false);

    // The regression: this returned nothing and left `canPost` false forever, so a correctly
    // rendered payload was discarded and the pane stayed blank until the panel was recreated.
    expect(latch.onVisibilityChange(true)).toBe(true);
    expect(latch.canPost).toBe(true);
  });

  it('stays shut on show before the first handshake', () => {
    const latch = new ReadyLatch();

    // The script genuinely has not loaded. Rendering a whole document into a webview with no
    // listener is wasted work on exactly the large files the performance budget cares about.
    expect(latch.onVisibilityChange(true)).toBe(false);
    expect(latch.canPost).toBe(false);
  });

  it('does not ask for a refresh when a visible panel is reported visible again', () => {
    const latch = new ReadyLatch();
    latch.onReady();

    // View-state events fire for focus changes too, not just visibility edges. Re-rendering on
    // every one of them would be a full document render per tab click.
    expect(latch.onVisibilityChange(true)).toBe(false);
    expect(latch.canPost).toBe(true);
  });

  it('survives the restore interleaving: ready, then a spurious flip, then visible', () => {
    const latch = new ReadyLatch();

    // Exactly the D23 sequence. `refresh()` is async: it starts here, awaits the file read, and the
    // flip lands mid-await — so the render completes into a shut gate and is dropped.
    latch.onReady();
    latch.onVisibilityChange(false);
    expect(latch.canPost).toBe(false);

    // Nothing re-handshakes, because the context was never destroyed. The show edge is the only
    // thing left that can redeliver.
    expect(latch.onVisibilityChange(true)).toBe(true);
    expect(latch.canPost).toBe(true);
  });
});
