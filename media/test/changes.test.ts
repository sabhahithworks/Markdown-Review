/**
 * Change marks (CV2, D30) over markup from the real renderer.
 *
 * The spans come from the real host pipeline — `changedRanges` then `changeStateOf` over two
 * renders of the same document — so these tests also hold the webview's intersection to the
 * offsets the renderer stamped, rather than to numbers written by hand.
 *
 * jsdom has no layout, so bar *geometry* is the harness's job (CV4). What is assertable here is
 * which blocks carry the mark, the accessible description, and the arithmetic of `buildChangeBar`.
 */

import { describe, expect, it } from 'vitest';
import type { ChangeState } from '../../src/panel/messages.js';
import { changeStateOf, changedRanges } from '../../src/detect/changedRanges.js';
import { renderPlainText } from '../../src/render/plaintext.js';
import { renderMarkdown } from '../../src/render/renderer.js';
import {
  CHANGED_DESCRIPTION,
  applyChangeMarks,
  buildChangeBar,
  changeBarRects,
} from '../src/changes.js';

const BASELINE = [
  '# Rollout',
  '',
  'The first paragraph is left alone.',
  '',
  'The second paragraph is the one the agent rewrites.',
  '',
  '```ts',
  'const retries = 1;',
  '```',
  '',
  '| stage | owner |',
  '| ----- | ----- |',
  '| canary | ops |',
  '',
  'The last paragraph is left alone too.',
  '',
].join('\n');

function mount(source: string): HTMLElement {
  document.body.innerHTML = '<main id="content"></main>';
  const root = document.getElementById('content');
  if (!root) throw new Error('missing #content');
  root.innerHTML = renderMarkdown(source).html;
  return root;
}

/** What the host would send for `current` against `BASELINE`. */
function changesFor(current: string): ChangeState {
  const before = renderPlainText(BASELINE).text;
  const doc = renderPlainText(current);
  return changeStateOf(before, doc, changedRanges(before, doc.text));
}

function markedStarts(root: HTMLElement): string[] {
  return [...root.querySelectorAll('[data-mr-changed]')].map(
    (element) => element.getAttribute('data-ap-start') ?? '',
  );
}

function startOf(root: HTMLElement, selector: string, text: string): string {
  const element = [...root.querySelectorAll(selector)].find((candidate) =>
    (candidate.textContent ?? '').includes(text),
  );
  const start = element?.getAttribute('data-ap-start');
  if (start === null || start === undefined) throw new Error(`no block for ${text}`);
  return start;
}

const EDITED = BASELINE.replace('the one the agent rewrites', 'the one the agent has rewritten').replace(
  'const retries = 1;',
  'const retries = 3;',
);

describe('applyChangeMarks', () => {
  it('marks only intersecting blocks', () => {
    const root = mount(EDITED);
    const changes = changesFor(EDITED);
    expect(changes.state).toBe('changed');

    const count = applyChangeMarks(root, changes);

    const expected = [startOf(root, 'p', 'second paragraph'), startOf(root, 'pre', 'retries')];
    expect(markedStarts(root)).toEqual(expected);
    expect(count).toBe(2);
  });

  it('clears marks when changes become unchanged', () => {
    const root = mount(EDITED);
    applyChangeMarks(root, changesFor(EDITED));
    expect(markedStarts(root)).toHaveLength(2);

    expect(applyChangeMarks(root, { state: 'unchanged' })).toBe(0);
    expect(root.querySelectorAll('[data-mr-changed]')).toHaveLength(0);
    expect(root.querySelectorAll('[aria-description]')).toHaveLength(0);
  });

  it('undefined changes marks nothing', () => {
    const root = mount(EDITED);
    applyChangeMarks(root, changesFor(EDITED));

    expect(applyChangeMarks(root, undefined)).toBe(0);
    expect(root.querySelectorAll('[data-mr-changed]')).toHaveLength(0);

    // A state this build does not know is `no-baseline` too, never a guess.
    const unknown = { state: 'partial', blocks: [{ start: 0, end: 10_000 }] } as unknown as ChangeState;
    expect(applyChangeMarks(root, unknown)).toBe(0);
    expect(applyChangeMarks(root, { state: 'too-large' })).toBe(0);
    expect(root.querySelectorAll('[data-mr-changed]')).toHaveLength(0);
  });

  it('sets aria-description on marked blocks', () => {
    const root = mount(EDITED);
    applyChangeMarks(root, changesFor(EDITED));

    const marked = [...root.querySelectorAll('[data-mr-changed]')];
    expect(marked.length).toBeGreaterThan(0);
    for (const element of marked) {
      expect(element.getAttribute('aria-description')).toBe(CHANGED_DESCRIPTION);
    }
    // And only on them.
    expect(root.querySelectorAll('[aria-description]')).toHaveLength(marked.length);
  });

  it('a span matching no block marks nothing', () => {
    const root = mount(BASELINE);
    const end = renderPlainText(BASELINE).text.length;
    expect(applyChangeMarks(root, { state: 'changed', blocks: [{ start: end + 50, end: end + 90 }] })).toBe(
      0,
    );
    expect(applyChangeMarks(root, { state: 'changed', blocks: [] })).toBe(0);
  });
});

describe('change bars', () => {
  it('buildChangeBar positions from the rect', () => {
    const bar = buildChangeBar(new DOMRect(120, 300, 480, 42), { top: 100, left: 20 });
    expect(bar.className).toBe('mr-change-bar');
    expect(bar.style.top).toBe('200px');
    expect(bar.style.left).toBe('92px'); // 120 - 20, then 8px into the gutter
    expect(bar.style.height).toBe('42px');

    // A block flush with the overlay's edge keeps its bar inside the overlay.
    expect(buildChangeBar(new DOMRect(24, 0, 10, 10), { top: 0, left: 20 }).style.left).toBe('0px');
  });

  it('draws one bar per changed table row, not one per cell', () => {
    const current = BASELINE.replace('| canary | ops |', '| canaries | sre |');
    const root = mount(current);
    applyChangeMarks(root, changesFor(current));

    expect(root.querySelectorAll('td[data-mr-changed]')).toHaveLength(2);
    expect(changeBarRects(root)).toHaveLength(1);
  });
});
