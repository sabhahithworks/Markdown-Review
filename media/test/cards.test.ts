/**
 * What the card and orphan DOM actually says (Phase 6, H16–H23).
 *
 * jsdom reports every rectangle as zero, which is why *geometry* lives in `stackTops` and the
 * harness. It says nothing about markup, though, and the accessibility contract this phase adds is
 * entirely markup: status in the accessible name, "position uncertain" as text, the confirm step on
 * delete, markers outside the aria-hidden overlay. All of that is assertable here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment, Located, ReviewSummary } from '../../src/panel/messages.js';
import { applyChangeMarks } from '../src/changes.js';
import { initComments } from '../src/comments.js';
import { initOrphans } from '../src/orphans.js';

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    body: 'Say what happens when the key set cannot be fetched.',
    author: 'reviewer',
    createdAt: '2026-08-01T09:30:00.000Z',
    status: 'open',
    anchor: {
      exact: 'validated against the issuer key set',
      prefix: 'the token is ',
      suffix: ' before the request',
      hintOffset: 40,
      hintLine: 3,
    },
    ...overrides,
  };
}

function review(comments: Comment[]): ReviewSummary {
  return { version: 1, targetPath: 'docs/auth.md', comments };
}

/**
 * jsdom implements neither of these. `initComments` observes its root for layout changes and
 * defers the repositioning pass a frame; both are geometry plumbing that reports zeroes here
 * anyway, so a no-op observer and a synchronous frame keep the markup under test reachable.
 */
function stubLayoutApis(): void {
  if (!('ResizeObserver' in window)) {
    (window as unknown as Record<string, unknown>)['ResizeObserver'] = class {
      observe(): void {
        /* no layout in jsdom */
      }
      unobserve(): void {
        /* no layout in jsdom */
      }
      disconnect(): void {
        /* no layout in jsdom */
      }
    };
  }
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    callback(0);
    return 0;
  });
  // jsdom's Range has no `getClientRects`. Returning an empty list is the honest answer — it has
  // no layout — and is what the zero-rect note in `comments.ts` already describes; the positioning
  // pass then places nothing, which is exactly the part these tests are not about.
  if (typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = (): DOMRectList =>
      Object.assign([], { item: () => null }) as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect();
  }
}

function harness() {
  stubLayoutApis();
  document.body.innerHTML = `
    <main id="content"><p data-ap-start="0" data-ap-end="80">the token is validated against the issuer key set before the request</p></main>
    <div id="highlight-overlay" aria-hidden="true"></div>
    <div id="marker-layer"></div>
    <aside id="gutter"></aside>
    <section id="orphans"></section>`;

  const root = document.getElementById('content') as HTMLElement;
  const overlay = document.getElementById('highlight-overlay') as HTMLElement;
  const markerLayer = document.getElementById('marker-layer') as HTMLElement;
  const gutter = document.getElementById('gutter') as HTMLElement;
  const orphansRoot = document.getElementById('orphans') as HTMLElement;

  const calls = {
    deleted: [] as string[],
    resolved: [] as string[],
    reopened: [] as string[],
    edited: [] as Array<[string, string]>,
    announced: [] as string[],
  };

  const view = initComments({
    root,
    gutter,
    overlay,
    markerLayer,
    announce: (message) => calls.announced.push(message),
    onEdit: (id, body) => calls.edited.push([id, body]),
    onDelete: (id) => calls.deleted.push(id),
    onResolve: (id) => calls.resolved.push(id),
    onReopen: (id) => calls.reopened.push(id),
  });

  return { view, gutter, overlay, markerLayer, orphansRoot, calls };
}

const AT: Record<string, Located> = {
  certain: { start: 13, end: 49, confidence: 1 },
  uncertain: { start: 13, end: 49, confidence: 0.3 },
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('card semantics (H18)', () => {
  it('names the author and the status in the accessible name', () => {
    const { view, gutter } = harness();
    view.setState(review([comment({ status: 'addressed' })]), { c1: AT.certain! }, []);

    const card = gutter.querySelector('.mr-card');
    expect(card?.getAttribute('aria-label')).toContain('reviewer');
    expect(card?.getAttribute('aria-label')).toContain('addressed');
  });

  it('distinguishes open from resolved, which used to announce identically', () => {
    const { view, gutter } = harness();
    view.setState(
      review([comment(), comment({ id: 'c2', status: 'resolved' })]),
      { c1: AT.certain!, c2: AT.certain! },
      [],
    );

    const labels = [...gutter.querySelectorAll('.mr-card')].map((card) =>
      card.getAttribute('aria-label'),
    );
    expect(labels.some((label) => label?.includes('open'))).toBe(true);
    expect(labels.some((label) => label?.includes('resolved'))).toBe(true);
  });

  it('opens on Enter, not only on click', () => {
    const { view, gutter } = harness();
    view.setState(review([comment()]), { c1: AT.certain! }, []);

    const card = gutter.querySelector('.mr-card') as HTMLElement;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Wide mode (jsdom width is 1024): activating selects the card rather than expanding it.
    expect(card.classList.contains('mr-card-active')).toBe(true);
  });

  it('marks the active card with aria-current', () => {
    const { view, gutter } = harness();
    view.setState(review([comment()]), { c1: AT.certain! }, []);

    const card = gutter.querySelector('.mr-card') as HTMLElement;
    card.dispatchEvent(new MouseEvent('mouseenter'));
    expect(card.getAttribute('aria-current')).toBe('true');
    card.dispatchEvent(new MouseEvent('mouseleave'));
    expect(card.hasAttribute('aria-current')).toBe(false);
  });
});

describe('position uncertain (H17, PRD §5)', () => {
  it('says the words on the card, not only as a dashed underline', () => {
    const { view, gutter } = harness();
    view.setState(review([comment()]), { c1: AT.uncertain! }, []);

    const card = gutter.querySelector('.mr-card') as HTMLElement;
    expect(card.textContent).toContain('position uncertain');
    expect(card.getAttribute('aria-label')).toContain('position uncertain');
  });

  it('says nothing of the sort when the match was exact', () => {
    const { view, gutter } = harness();
    view.setState(review([comment()]), { c1: AT.certain! }, []);

    const card = gutter.querySelector('.mr-card') as HTMLElement;
    expect(card.textContent).not.toContain('position uncertain');
  });
});

describe('prompt number on cards', () => {
  const withOrder = (comments: Comment[], promptOrder?: string[]): ReviewSummary => ({
    ...review(comments),
    ...(promptOrder ? { promptOrder } : {}),
  });

  it('shows #2 for the second prompt item', () => {
    const { view, gutter } = harness();
    view.setState(
      withOrder([comment({ id: 'c1' }), comment({ id: 'c2' })], ['c1', 'c2']),
      { c1: AT.certain!, c2: AT.certain! },
      [],
    );
    const card = gutter.querySelector('[data-comment-id="c2"]') as HTMLElement;
    expect(card.querySelector('.mr-card-number')?.textContent).toBe('#2');
    expect(card.querySelector('.mr-card-header')?.firstElementChild?.className).toBe('mr-card-number');
  });

  it('shows no number for a comment added after copy', () => {
    const { view, gutter } = harness();
    view.setState(
      withOrder([comment({ id: 'c1' }), comment({ id: 'c2' })], ['c1']),
      { c1: AT.certain!, c2: AT.certain! },
      [],
    );
    const card = gutter.querySelector('[data-comment-id="c2"]') as HTMLElement;
    expect(card.querySelector('.mr-card-number')).toBeNull();
  });

  it('no promptOrder shows no number', () => {
    const { view, gutter } = harness();
    view.setState(review([comment()]), { c1: AT.certain! }, []);
    expect(gutter.querySelector('.mr-card-number')).toBeNull();
    view.setState(withOrder([comment()], []), { c1: AT.certain! }, []);
    expect(gutter.querySelector('.mr-card-number')).toBeNull();
  });

  it('numbers an addressed card and ignores ids that are gone', () => {
    const { view, gutter } = harness();
    view.setState(
      withOrder([comment({ id: 'c1', status: 'addressed' })], ['gone', 'x', 'c1']),
      { c1: AT.certain! },
      [],
    );
    const card = gutter.querySelector('.mr-card') as HTMLElement;
    expect(card.querySelector('.mr-card-number')?.textContent).toBe('#3');
    expect(card.getAttribute('aria-label')).toContain('item 3 in the last copied prompt');
  });

  it('sets the number as text', () => {
    const { view, gutter } = harness();
    view.setState(withOrder([comment()], ['c1']), { c1: AT.certain! }, []);
    const number = gutter.querySelector('.mr-card-number') as HTMLElement;
    expect(number.innerHTML).toBe('#1');
    expect(number.children).toHaveLength(0);
  });
});

describe('delete confirmation (H22)', () => {
  it('does not delete on the first click', () => {
    const { view, gutter, calls } = harness();
    view.setState(review([comment()]), { c1: AT.certain! }, []);

    const remove = [...gutter.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete',
    ) as HTMLButtonElement;
    remove.click();

    expect(calls.deleted).toEqual([]);
    expect(remove.textContent).toBe('Delete?');
  });

  it('deletes on the second, and says so', () => {
    const { view, gutter, calls } = harness();
    view.setState(review([comment()]), { c1: AT.certain! }, []);

    const remove = [...gutter.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete',
    ) as HTMLButtonElement;
    remove.click();
    remove.click();

    expect(calls.deleted).toEqual(['c1']);
    expect(calls.announced.join(' ')).toContain('deleted');
  });
});

describe('orphan section (H0, H22, H23)', () => {
  function orphanHarness() {
    document.body.innerHTML = '<section id="orphans"></section>';
    const root = document.getElementById('orphans') as HTMLElement;
    const calls = { deleted: [] as string[], announced: [] as string[] };
    const view = initOrphans({
      root,
      announce: (message) => calls.announced.push(message),
      onDelete: (id) => calls.deleted.push(id),
      onReanchor: () => undefined,
      onCancelReanchor: () => undefined,
    });
    return { view, root, calls };
  }

  const lost = comment({ status: 'orphaned' });

  it('quotes the text the comment was on', () => {
    const { view, root } = orphanHarness();
    view.setState([lost], { c1: null });
    expect(root.textContent).toContain('validated against the issuer key set');
  });

  it('carries the D21 signal when the surrounding text changed', () => {
    const { view, root } = orphanHarness();
    view.setState([lost], { c1: null }, ['c1']);
    expect(root.textContent).toContain('may have been addressed rather than lost');
  });

  it('says nothing extra when it did not', () => {
    const { view, root } = orphanHarness();
    view.setState([lost], { c1: null }, []);
    expect(root.textContent).not.toContain('may have been addressed');
  });

  it('honours the status filter, which it used to ignore entirely', () => {
    const { view, root } = orphanHarness();
    view.setState([lost], { c1: null });
    expect(root.hidden).toBe(false);

    view.setFilter(['open', 'addressed', 'resolved']);
    expect(root.hidden).toBe(true);

    view.setFilter(['open', 'addressed', 'orphaned', 'resolved']);
    expect(root.hidden).toBe(false);
  });

  it('confirms before deleting, like the gutter card', () => {
    const { view, root, calls } = orphanHarness();
    view.setState([lost], { c1: null });

    const remove = [...root.querySelectorAll('button')].find(
      (button) => button.textContent === 'Delete',
    ) as HTMLButtonElement;
    remove.click();
    expect(calls.deleted).toEqual([]);
    remove.click();
    expect(calls.deleted).toEqual(['c1']);
  });
});

describe('the gutter and the orphan section partition the comments', () => {
  it('an unlocatable comment appears in exactly one of them', () => {
    const { view, gutter } = harness();
    view.setState(review([comment()]), { c1: null }, []);
    expect(gutter.querySelectorAll('.mr-card')).toHaveLength(0);

    document.body.innerHTML += '<section id="orphans2"></section>';
    const root = document.getElementById('orphans2') as HTMLElement;
    const orphans = initOrphans({
      root,
      announce: () => undefined,
      onDelete: () => undefined,
      onReanchor: () => undefined,
      onCancelReanchor: () => undefined,
    });
    orphans.setState([comment()], { c1: null });
    expect(root.querySelectorAll('.mr-orphan')).toHaveLength(1);
  });
});

describe('change bars in the overlay pass (CV2)', () => {
  it('draws one bar per marked block beside the highlights, and clears it with the mark', () => {
    const { view, overlay, gutter } = harness();
    const root = document.getElementById('content') as HTMLElement;

    applyChangeMarks(root, { state: 'changed', blocks: [{ start: 0, end: 80 }] });
    view.setState(review([comment()]), { c1: AT.certain! }, []);
    expect(overlay.querySelectorAll('.mr-change-bar')).toHaveLength(1);
    // A bar is decoration in the aria-hidden overlay; the card is untouched by it.
    expect(gutter.querySelectorAll('.mr-card')).toHaveLength(1);

    applyChangeMarks(root, { state: 'unchanged' });
    view.reposition();
    expect(overlay.querySelectorAll('.mr-change-bar')).toHaveLength(0);
  });
});

describe('whole-document card', () => {
  function docComment(overrides: Partial<Comment> = {}): Comment {
    const full = comment({ id: 'doc', body: 'Overall tone', ...overrides });
    delete full.anchor;
    return full;
  }
  const prompted = (comments: Comment[]): ReviewSummary => ({
    ...review(comments),
    promptOrder: comments.map((c) => c.id),
  });

  it('whole-document card is first and labelled', () => {
    const { view, gutter } = harness();
    view.setState(review([comment(), docComment()]), { c1: AT.certain! }, []);

    const first = gutter.querySelector('.mr-card');
    expect(first?.getAttribute('data-comment-id')).toBe('doc');
    expect(first?.textContent).toContain('Whole document');
  });

  it('card still shows with no located anchors and no hint', () => {
    const { view, gutter } = harness();
    view.setState(prompted([docComment()]), {}, [], false);

    const card = gutter.querySelector('.mr-card');
    expect(card?.textContent).toContain('Whole document');
    expect(card?.textContent).not.toContain('Document changed since the prompt');
  });

  it('hint shows after the document changed', () => {
    const { view, gutter } = harness();
    const text = 'Document changed since the prompt';

    view.setState(prompted([docComment()]), {}, [], true);
    expect(gutter.querySelector('.mr-card')?.textContent).toContain(text);

    view.setState(review([docComment()]), {}, [], true);
    expect(gutter.querySelector('.mr-card')?.textContent).not.toContain(text);

    view.setState(prompted([docComment()]), {}, [], false);
    expect(gutter.querySelector('.mr-card')?.textContent).not.toContain(text);
  });

  it('resolved whole-document comment has no hint', () => {
    const { view, gutter } = harness();
    view.setState(prompted([docComment({ status: 'resolved' })]), {}, [], true);
    expect(gutter.textContent).not.toContain('Document changed since the prompt');
  });

  it('narrow pane shows a marker at the top', () => {
    const { view, markerLayer } = harness();
    const root = document.getElementById('content') as HTMLElement;
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 300 });
    vi.stubGlobal('innerWidth', 300);
    view.setState(review([docComment()]), {}, []);
    expect(markerLayer.querySelectorAll('.mr-marker')).toHaveLength(1);
  });
});
