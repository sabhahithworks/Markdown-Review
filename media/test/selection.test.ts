/**
 * The comment composer's modes and the hints for selections that cannot be commented on.
 *
 * jsdom reports every rectangle as zero, so placement is not asserted here; what is asserted is
 * which elements show, which handler a submit reaches, and where focus goes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initSelection } from '../src/selection.js';
import type { SelectionController, SelectionOptions } from '../src/selection.js';

let root: HTMLElement;
let onSubmit: ReturnType<typeof vi.fn<SelectionOptions['onSubmit']>>;
let onDocumentSubmit: ReturnType<typeof vi.fn<SelectionOptions['onDocumentSubmit']>>;
let controller: SelectionController;
let opener: HTMLButtonElement;

function popover(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.mr-popover');
  if (!element) throw new Error('no popover');
  return element;
}

function heading(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.mr-popover-heading');
  if (!element) throw new Error('no heading');
  return element;
}

function type(text: string): void {
  const textarea = popover().querySelector('textarea');
  if (!textarea) throw new Error('no textarea');
  textarea.value = text;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function submitButton(): HTMLButtonElement {
  const button = popover().querySelector<HTMLButtonElement>('.mr-button-primary');
  if (!button) throw new Error('no submit');
  return button;
}

function selectIn(element: Element): void {
  const range = document.createRange();
  const text = element.firstChild;
  if (text) {
    range.setStart(text, 0);
    range.setEnd(text, text.textContent?.length ?? 0);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(200);
}

function hintText(): string | undefined {
  const hint = document.querySelector<HTMLElement>('.mr-selection-hint');
  return hint && !hint.hidden ? hint.textContent : undefined;
}

function commentButton(): HTMLElement | undefined {
  const button = document.querySelector<HTMLElement>('.mr-selection-button');
  return button && !button.hidden ? button : undefined;
}

const ZERO_RECT = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no layout: Range and DOMRect are partly missing.
  Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  document.body.replaceChildren();
  root = document.createElement('div');
  root.innerHTML =
    '<div data-no-anchor="true"><p id="fm">title: a long front matter line</p></div>' +
    '<div data-no-anchor="diagram"><p id="dg">a node label in a diagram</p></div>' +
    '<p id="ps" data-line="2" data-ap-start="0" data-ap-end="31">a passage that can be commented</p>';
  opener = document.createElement('button');
  document.body.append(root, opener);
  onSubmit = vi.fn();
  onDocumentSubmit = vi.fn();
  controller = initSelection({
    root,
    author: 'tester',
    onSubmit,
    onDocumentSubmit,
    onReanchor: () => undefined,
    onArmChange: () => undefined,
    onWarning: () => undefined,
  });
});

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
});

describe('document composer', () => {
  it('document composer shows its heading', () => {
    controller.openDocumentComposer(ZERO_RECT, opener);
    expect(popover().hidden).toBe(false);
    expect(heading().hidden).toBe(false);
    expect(heading().textContent).toBe('Comment on the whole document');
    expect(popover().getAttribute('aria-label')).toBe('Comment on the whole document');
  });

  it('the passage composer has no heading', () => {
    const target = root.querySelector('#ps');
    if (!target) throw new Error('no target');
    selectIn(target);
    commentButton()?.click();
    expect(popover().hidden).toBe(false);
    expect(heading().hidden).toBe(true);
    expect(popover().getAttribute('aria-label')).toBe('New comment');
  });

  it('submitting the document composer calls onDocumentSubmit', () => {
    controller.openDocumentComposer(ZERO_RECT, opener);
    expect(submitButton().disabled).toBe(true);
    type('   ');
    expect(submitButton().disabled).toBe(true);
    type('  Needs a summary.  ');
    expect(submitButton().disabled).toBe(false);
    submitButton().click();
    expect(onDocumentSubmit).toHaveBeenCalledWith('Needs a summary.');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(popover().hidden).toBe(true);
  });

  it('Escape closes the document composer and restores focus', () => {
    opener.focus();
    controller.openDocumentComposer(ZERO_RECT, opener);
    expect(document.activeElement).not.toBe(opener);
    type('draft');
    popover().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popover().hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(onDocumentSubmit).not.toHaveBeenCalled();
  });
});

describe('rejected selections', () => {
  it('a selection in front matter still shows the front-matter hint', () => {
    const target = root.querySelector('#fm');
    if (!target) throw new Error('no target');
    selectIn(target);
    expect(hintText()).toBe('Front matter cannot be commented on');
    expect(commentButton()).toBeUndefined();
  });

  it('a selection on a diagram shows the diagram hint', () => {
    const target = root.querySelector('#dg');
    if (!target) throw new Error('no target');
    selectIn(target);
    expect(hintText()).toBe('Switch to Source to comment on this diagram');
    expect(commentButton()).toBeUndefined();
  });
});
