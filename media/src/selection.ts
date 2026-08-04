/**
 * Selection capture and the comment popover (Plan 03 §2, §4; PRD §6).
 *
 * The selection reaches the host already expressed in **anchor space** — `anchorSpace.ts` does that
 * mapping using the offsets the host stamped on each block, so nothing here re-derives the
 * normalization rules.
 *
 * When the mapping fails the payload carries `offset: -1` rather than a guess. `createAnchor`
 * treats that as "use `hintLine` instead", which costs a confidence tier but never invents a
 * position.
 */

import { MIN_ANCHOR_LENGTH } from '../../src/panel/messages.js';
import { blockOf, blockRef, blockText, offsetAt, textOfRange, verifyBlockMap } from './anchorSpace.js';

/** Long enough to not fire mid-drag, short enough that the button feels attached to the mouse. */
const SELECTION_DEBOUNCE_MS = 150;

export interface SelectionPayload {
  selectedText: string;
  offset: number;
  hintLine: number;
  body: string;
}

export interface SelectionOptions {
  root: HTMLElement;
  /** Shown in the popover so it is clear whose name the comment will carry. */
  author: string;
  onSubmit(payload: SelectionPayload): void;
  onWarning(message: string): void;
}

interface Captured {
  selectedText: string;
  offset: number;
  hintLine: number;
  rect: DOMRect;
}

export function initSelection(options: SelectionOptions): void {
  const button = createCommentButton();
  const popover = createPopover(options);
  document.body.append(button, popover.element);

  let captured: Captured | undefined;
  let debounce = 0;

  function hideButton(): void {
    button.hidden = true;
    captured = undefined;
  }

  function evaluate(): void {
    if (popover.isOpen()) return; // the popover steals the selection; keep the captured one

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hideButton();
      return;
    }

    const range = selection.getRangeAt(0);
    const next = capture(range, options.root, options.onWarning);
    if (!next) {
      hideButton();
      return;
    }

    captured = next;
    showButton(button, next.rect);
  }

  document.addEventListener('selectionchange', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(evaluate, SELECTION_DEBOUNCE_MS);
  });

  button.addEventListener('click', () => {
    if (!captured) return;
    button.hidden = true;
    popover.open(captured);
  });

  // A click that lands outside both affordances is a dismissal.
  document.addEventListener('mousedown', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (button.contains(target) || popover.element.contains(target)) return;
    if (!popover.isOpen()) hideButton();
  });

  popover.onCancel(() => {
    hideButton();
  });

  popover.onSubmit((body) => {
    const payload = captured;
    hideButton();
    if (!payload) return;
    options.onSubmit({
      selectedText: payload.selectedText,
      offset: payload.offset,
      hintLine: payload.hintLine,
      body,
    });
  });
}

/**
 * Turns a DOM range into an anchor-space payload, or `undefined` when the selection is not
 * anchorable.
 *
 * Both ends must sit inside the rendered content. Front matter is excluded from anchor space by
 * construction, and is rejected twice over: it lives outside `#content` *and* carries
 * `data-no-anchor` (Plan 02 §4).
 */
function capture(
  range: Range,
  root: HTMLElement,
  warn: (message: string) => void,
): Captured | undefined {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  if (elementOf(range.startContainer)?.closest('[data-no-anchor]')) return undefined;

  const block = blockOf(range.startContainer);
  if (!block) return undefined;

  const selectedText = textOfRange(range, root);
  if (selectedText.trim().length < MIN_ANCHOR_LENGTH) return undefined;

  const hintLine = nearestDataLine(range.startContainer);

  /**
   * The one place the DOM walk can disagree with the host, now that block boundaries are stamped
   * rather than inferred. It should be unreachable; if it ever fires, anchoring in that block is
   * silently off, so it goes to the output channel and the offset degrades to the `hintLine` path
   * rather than being trusted.
   */
  const ref = blockRef(block);
  if (!verifyBlockMap(ref)) {
    warn(
      `anchor-space mismatch in block at offset ${String(ref.start)}: ` +
        `DOM walk produced ${String(blockText(block).length)} chars, host expected ${String(ref.end - ref.start)}`,
    );
    return { selectedText, offset: -1, hintLine, rect: range.getBoundingClientRect() };
  }

  const offset = offsetAt(range.startContainer, range.startOffset);

  return {
    selectedText,
    // `-1` is the documented sentinel; the host recovers a position from `hintLine`.
    offset: offset ?? -1,
    hintLine,
    rect: range.getBoundingClientRect(),
  };
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function nearestDataLine(node: Node): number {
  const line = elementOf(node)?.closest('[data-line]')?.getAttribute('data-line');
  const parsed = Number(line);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------- affordances

function createCommentButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mr-selection-button';
  button.textContent = 'Comment';
  button.setAttribute('aria-label', 'Comment on the selected text');
  button.hidden = true;
  return button;
}

function showButton(button: HTMLElement, rect: DOMRect): void {
  button.hidden = false;
  // Positioned against the viewport (the button is `position: fixed`), so no scroll maths.
  button.style.top = `${String(Math.max(rect.top - button.offsetHeight - 8, 8))}px`;
  button.style.left = `${String(Math.max(rect.left, 8))}px`;
}

interface Popover {
  element: HTMLElement;
  open(at: Captured): void;
  isOpen(): boolean;
  onSubmit(handler: (body: string) => void): void;
  onCancel(handler: () => void): void;
}

function createPopover(options: SelectionOptions): Popover {
  const element = document.createElement('div');
  element.className = 'mr-popover';
  element.hidden = true;
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', 'New comment');

  const author = document.createElement('div');
  author.className = 'mr-popover-author';
  author.textContent = options.author;

  const textarea = document.createElement('textarea');
  textarea.className = 'mr-popover-input';
  textarea.rows = 3;
  textarea.setAttribute('aria-label', 'Comment text');
  textarea.placeholder = 'Leave a comment…';

  const hint = document.createElement('div');
  hint.className = 'mr-popover-hint';
  hint.textContent = `${modifierLabel()}+Enter to comment · Esc to cancel`;

  const actions = document.createElement('div');
  actions.className = 'mr-popover-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'mr-button-secondary';
  cancel.textContent = 'Cancel';

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'mr-button-primary';
  submit.textContent = 'Comment';
  submit.disabled = true;

  actions.append(cancel, submit);
  element.append(author, textarea, hint, actions);

  let open = false;
  /** Restored on close so dismissing the popover does not dump focus on `<body>`. */
  let previousFocus: Element | null = null;
  const submitHandlers: Array<(body: string) => void> = [];
  const cancelHandlers: Array<() => void> = [];

  function close(): void {
    open = false;
    element.hidden = true;
    textarea.value = '';
    submit.disabled = true;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }

  function commit(): void {
    const body = textarea.value.trim();
    if (body.length === 0) return;
    close();
    for (const handler of submitHandlers) handler(body);
  }

  function dismiss(): void {
    close();
    for (const handler of cancelHandlers) handler();
  }

  textarea.addEventListener('input', () => {
    submit.disabled = textarea.value.trim().length === 0;
  });

  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Tab') trapFocus(event, [textarea, cancel, submit]);
  });

  cancel.addEventListener('click', dismiss);
  submit.addEventListener('click', commit);

  return {
    element,
    isOpen: () => open,
    open(at: Captured) {
      previousFocus = document.activeElement;
      open = true;
      element.hidden = false;
      element.style.top = `${String(Math.max(at.rect.bottom + 8, 8))}px`;
      element.style.left = `${String(Math.max(at.rect.left, 8))}px`;
      textarea.focus();
    },
    onSubmit(handler) {
      submitHandlers.push(handler);
    },
    onCancel(handler) {
      cancelHandlers.push(handler);
    },
  };
}

/** Keeps Tab inside the dialog while it is open, per PRD §6's focus-trap requirement. */
function trapFocus(event: KeyboardEvent, order: HTMLElement[]): void {
  const focusable = order.filter((element) => !(element as HTMLButtonElement).disabled);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function modifierLabel(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
}
