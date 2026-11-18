/**
 * The header bar's decisions (PRD §6).
 *
 * jsdom reports every rectangle as zero, so asserting the rendered bar would prove nothing about
 * how it looks — `dev/harness/` covers that. What *is* worth pinning down is the logic behind it,
 * which is why counting, the primary action's state and chip toggling are exported separately.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Comment, CommentStatus, WebviewMessage } from '../../src/panel/messages.js';
import {
  FILTERABLE,
  SHOW_CHANGES_MESSAGE,
  changesControl,
  chipLabel,
  copyPromptLabel,
  countByStatus,
  hiddenNotice,
  initHeader,
  toggleStatus,
} from '../src/header.js';

function comment(status: CommentStatus): Comment {
  return {
    id: `c-${status}-${String(Math.random()).slice(2, 8)}`,
    body: 'body',
    author: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    status,
    anchor: { exact: 'anchor', prefix: '', suffix: '', hintLine: 0, hintOffset: 0 },
  };
}

describe('countByStatus', () => {
  it('counts every status, including the ones nobody used', () => {
    expect(countByStatus([comment('open'), comment('open'), comment('orphaned')])).toEqual({
      open: 2,
      addressed: 0,
      orphaned: 1,
      resolved: 0,
    });
  });

  it('returns zeroes for an empty review rather than an empty object', () => {
    // The bar reads these directly; a missing key would render "undefined open".
    expect(countByStatus([])).toEqual({ open: 0, addressed: 0, orphaned: 0, resolved: 0 });
  });
});

describe('copyPromptLabel', () => {
  it('disables the primary action when nothing is open (PRD §6)', () => {
    expect(copyPromptLabel(0)).toEqual({ label: 'Copy review prompt', disabled: true });
  });

  it('carries the count when there is something to send', () => {
    expect(copyPromptLabel(3)).toEqual({ label: 'Copy review prompt (3)', disabled: false });
    expect(copyPromptLabel(1).label).toBe('Copy review prompt (1)');
  });
});

describe('toggleStatus', () => {
  it('removes a shown status and restores a hidden one', () => {
    expect(toggleStatus(FILTERABLE, 'open')).toEqual(['addressed', 'orphaned', 'resolved']);
    expect(toggleStatus(['addressed'], 'open')).toEqual(['open', 'addressed']);
  });

  it('keeps display order however the chips are clicked', () => {
    // Order-stable so chips never reshuffle under the pointer, and so the value written to
    // `setState` is comparable between sessions.
    let filter: CommentStatus[] = [];
    for (const status of ['resolved', 'open', 'orphaned', 'addressed'] as CommentStatus[]) {
      filter = toggleStatus(filter, status);
    }
    expect(filter).toEqual(['open', 'addressed', 'orphaned', 'resolved']);
  });

  it('does not mutate the filter it was given', () => {
    const before: CommentStatus[] = ['open', 'addressed'];
    toggleStatus(before, 'open');
    expect(before).toEqual(['open', 'addressed']);
  });

  it('can empty the filter completely', () => {
    // A user may legitimately hide everything; the gutter then shows nothing, which is honest.
    let filter: CommentStatus[] = [...FILTERABLE];
    for (const status of FILTERABLE) filter = toggleStatus(filter, status);
    expect(filter).toEqual([]);
  });
});

describe('chipLabel', () => {
  it('reads as a count and a status', () => {
    expect(chipLabel('open', 3)).toBe('3 open');
    expect(chipLabel('orphaned', 0)).toBe('0 orphaned');
  });
});

/**
 * H23 — a filter that hides everything left a blank pane with no explanation. The chips are still
 * on screen, but "I hid them" is not a user's first hypothesis when a pane goes empty.
 */
describe('hiddenNotice', () => {
  const counts = { open: 3, addressed: 2, orphaned: 1, resolved: 4 };

  it('says nothing when the filter hides nothing', () => {
    expect(hiddenNotice(counts, FILTERABLE)).toBeUndefined();
  });

  it('counts every comment the filter is hiding', () => {
    expect(hiddenNotice(counts, ['open'])).toBe('7 comments hidden by filter');
  });

  it('is singular for one', () => {
    expect(hiddenNotice({ open: 1, addressed: 0, orphaned: 0, resolved: 0 }, [])).toBe(
      '1 comment hidden by filter',
    );
  });

  it('says nothing when there is nothing to hide', () => {
    expect(hiddenNotice({ open: 0, addressed: 0, orphaned: 0, resolved: 0 }, [])).toBeUndefined();
  });
});

describe('changesControl (D31)', () => {
  it('no-baseline hides the control', () => {
    expect(changesControl({ state: 'no-baseline' })).toEqual({ kind: 'hidden' });
    // Undefined is the failure path: no state at all reads as nothing to compare against.
    expect(changesControl(undefined)).toEqual({ kind: 'hidden' });
  });

  it('unchanged shows "No changes since prompt"', () => {
    expect(changesControl({ state: 'unchanged' })).toEqual({
      kind: 'text',
      label: 'No changes since prompt',
    });
  });

  it('changed shows "Show changes (4)"', () => {
    const blocks = [0, 10, 20, 30].map((start) => ({ start, end: start + 5 }));
    expect(changesControl({ state: 'changed', blocks })).toEqual({
      kind: 'button',
      label: 'Show changes (4)',
    });
  });

  it('changed counts marked blocks, not merged spans', () => {
    // One merged span (D28) over three rewritten paragraphs: three bars, so the button says 3.
    expect(changesControl({ state: 'changed', blocks: [{ start: 0, end: 30 }] }, 3)).toEqual({
      kind: 'button',
      label: 'Show changes (3)',
    });
  });

  it('too-large shows the button without a count', () => {
    expect(changesControl({ state: 'too-large' })).toEqual({
      kind: 'button',
      label: 'Show changes',
      title: 'Too large to mark inline',
    });
  });

  it('the button posts showRewriteDiff', () => {
    // Wired the way webview.ts wires it, so the message the click produces is the one asserted.
    const posted: WebviewMessage[] = [];
    const root = document.createElement('div');
    const view = initHeader({
      root,
      onCopyPrompt: () => undefined,
      onSendPrompt: () => undefined,
      onClearAddressed: () => undefined,
      onClearAll: () => undefined,
      onFilterChange: () => undefined,
      onShowChanges: () => posted.push(SHOW_CHANGES_MESSAGE),
      onCommentOnDocument: () => undefined,
    });
    const summary = { version: 1 as const, targetPath: 'docs/auth.md', comments: [comment('open')] };
    view.setState(summary, { state: 'too-large' });

    const button = [...root.querySelectorAll('button')].find(
      (element) => element.textContent === 'Show changes',
    );
    expect(button?.hidden).toBe(false);
    expect(button?.title).toBe('Too large to mark inline');
    button?.click();
    expect(posted).toEqual([{ type: 'showRewriteDiff' }]);

    // And it goes away again once there is no baseline.
    view.setState(summary, { state: 'no-baseline' });
    expect(button?.hidden).toBe(true);
  });
});

describe('Comment on document button', () => {
  it('header has a Comment on document button', () => {
    const root = document.createElement('div');
    const handler = vi.fn();
    initHeader({
      root,
      onCopyPrompt: () => undefined,
      onSendPrompt: () => undefined,
      onClearAddressed: () => undefined,
      onClearAll: () => undefined,
      onFilterChange: () => undefined,
      onShowChanges: () => undefined,
      onCommentOnDocument: handler,
    });

    const button = [...root.querySelectorAll('button')].find(
      (element) => element.textContent === 'Comment on document',
    );
    expect(button).toBeDefined();
    button?.click();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(button);
  });
});

describe('Send to menu', () => {
  function build() {
    const sent: string[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const view = initHeader({
      root,
      onCopyPrompt: () => undefined,
      onSendPrompt: (target) => sent.push(target),
      onClearAddressed: () => undefined,
      onClearAll: () => undefined,
      onFilterChange: () => undefined,
      onShowChanges: () => undefined,
      onCommentOnDocument: () => undefined,
    });
    const summary = { version: 1 as const, targetPath: 'docs/auth.md', comments: [comment('open')] };
    const button = root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
    const menu = root.querySelector<HTMLElement>('[role="menu"]');
    const items = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    if (!button || !menu) throw new Error('no Send to control');
    return { root, view, summary, button, menu, items, sent };
  }
  const key = (target: HTMLElement, name: string): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  };

  it('Send to is disabled with no open comments', () => {
    const { view, summary, button } = build();
    view.setState({ ...summary, comments: [] });
    expect(button.disabled).toBe(true);
    view.setState(summary);
    expect(button.disabled).toBe(false);
  });

  it('menu opens with Enter and closes with Escape', () => {
    const { view, summary, button, menu, items, sent } = build();
    view.setState(summary);
    expect(menu.hidden).toBe(true);
    button.click(); // the click a keyboard Enter or Space produces
    expect(menu.hidden).toBe(false);
    expect(document.activeElement).toBe(items[0]);
    key(items[0] as HTMLElement, 'Escape');
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(sent).toEqual([]);
  });

  it('arrow keys move between the two items and wrap', () => {
    const { view, summary, button, items } = build();
    view.setState(summary);
    button.click();
    key(items[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(items[1] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key(items[0] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(items[1]);
  });

  it("choosing Active terminal calls onSendPrompt('terminal') and closes the menu", () => {
    const { view, summary, button, menu, items, sent } = build();
    view.setState(summary);
    button.click();
    expect(items.map((item) => item.textContent)).toEqual(['VS Code chat', 'Active terminal']);
    items[1]?.click();
    expect(sent).toEqual(['terminal']);
    expect(menu.hidden).toBe(true);
  });

  it('aria-expanded follows the menu', () => {
    const { view, summary, button } = build();
    view.setState(summary);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
