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
import { modifierLabel } from './platform.js';

/** Long enough to not fire mid-drag, short enough that the button feels attached to the mouse. */
const SELECTION_DEBOUNCE_MS = 150;

/** Gap between a floating element and both the selection it describes and the viewport edge. */
const MARGIN_PX = 8;

export interface SelectionPayload {
  selectedText: string;
  offset: number;
  hintLine: number;
  body: string;
}

/** The same shape as `SelectionPayload` minus the body: a re-anchor has nothing new to type. */
export interface ReanchorPayload {
  id: string;
  selectedText: string;
  offset: number;
  hintLine: number;
}

export interface SelectionOptions {
  root: HTMLElement;
  /** Shown in the popover so it is clear whose name the comment will carry. */
  author: string;
  onSubmit(payload: SelectionPayload): void;
  onReanchor(payload: ReanchorPayload): void;
  /** Mirrors the armed state into the orphan section, which shows which row is waiting. */
  onArmChange(id: string | undefined): void;
  onWarning(message: string): void;
}

/**
 * Re-anchor mode (PRD §6).
 *
 * Arming lives entirely in the webview. Plan 04 §6 originally had the host hold the mode, but a
 * host-side mode survives a reload the webview does not, and can be left armed for a comment the
 * user can no longer see (Plan 04 §9 D5).
 */
export interface SelectionController {
  armReanchor(id: string): void;
  disarm(): void;
  isArmed(): boolean;
}

interface Captured {
  selectedText: string;
  offset: number;
  hintLine: number;
  rect: DOMRect;
}

/**
 * Why a selection produced no Comment button.
 *
 * `undefined` means "nothing to say" — a selection outside the content, or one the user is still
 * dragging. The two named reasons are worth telling the user about (H21): before this, a selection
 * that was too short or landed in front matter simply produced no button, which is
 * indistinguishable from the feature being broken.
 */
type Rejection = 'too-short' | 'front-matter' | undefined;

type CaptureResult = { ok: true; value: Captured } | { ok: false; reason: Rejection };

export function initSelection(options: SelectionOptions): SelectionController {
  const button = createCommentButton();
  const hint = createHint();
  const popover = createPopover(options);
  document.body.append(button, hint, popover.element);

  let captured: Captured | undefined;
  let debounce = 0;
  /** The orphan waiting for a new anchor, if re-anchor mode is armed. */
  let arming: string | undefined;

  function hideButton(): void {
    button.hidden = true;
    captured = undefined;
  }

  function setArming(id: string | undefined): void {
    if (arming === id) return;
    arming = id;
    // The button commits immediately while armed, so it has to say so.
    button.textContent = id === undefined ? 'Comment' : 'Re-anchor here';
    button.classList.toggle('mr-selection-button-arming', id !== undefined);
    hideButton();
    options.onArmChange(id);
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
    if (!next.ok) {
      hideButton();
      // Say why, where the user is looking (H21). Silence here is indistinguishable from the
      // feature not existing, and the too-short wording previously only appeared as a host toast
      // *after* a submit that could no longer happen.
      if (next.reason) showHint(hint, REJECTION_TEXT[next.reason], range.getBoundingClientRect());
      return;
    }

    hideHint(hint);
    captured = next.value;
    showButton(button, next.value.rect);
  }

  document.addEventListener('selectionchange', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(evaluate, SELECTION_DEBOUNCE_MS);
  });

  // Both floating affordances are `position: fixed` and nothing re-places them on scroll, so they
  // stayed pinned to the viewport while the text they describe moved away — the button ends up
  // pointing at an unrelated paragraph (H25). Hiding is the honest response: the selection itself
  // survives, so scrolling back and re-selecting is one gesture.
  window.addEventListener(
    'scroll',
    () => {
      if (popover.isOpen()) return;
      if (!button.hidden) hideButton();
      hideHint(hint);
    },
    { passive: true, capture: true },
  );

  button.addEventListener('click', () => {
    if (!captured) return;
    // Captured before the button is hidden, so the popover has something real to restore focus to
    // when it closes (H18).
    const restoreFocusTo = document.activeElement === button ? options.root : document.activeElement;
    button.hidden = true;

    if (arming !== undefined) {
      // No popover: the comment already has a body, and asking for one again would imply the old
      // text is being replaced rather than re-pointed.
      const payload = captured;
      const id = arming;
      hideButton();
      setArming(undefined);
      options.onReanchor({
        id,
        selectedText: payload.selectedText,
        offset: payload.offset,
        hintLine: payload.hintLine,
      });
      return;
    }

    popover.open(captured, restoreFocusTo);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && arming !== undefined) setArming(undefined);
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

  return {
    armReanchor(id): void {
      setArming(id);
    },
    disarm(): void {
      setArming(undefined);
    },
    isArmed(): boolean {
      return arming !== undefined;
    },
  };
}

/**
 * Turns a DOM range into an anchor-space payload, or `undefined` when the selection is not
 * anchorable.
 *
 * Both ends must sit inside the rendered content. Front matter is excluded from anchor space by
 * construction, and is rejected twice over: it lives outside `#content` *and* carries
 * `data-no-anchor` (Plan 02 §4).
 */
function capture(range: Range, root: HTMLElement, warn: (message: string) => void): CaptureResult {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return { ok: false, reason: undefined };
  }
  const noAnchor = elementOf(range.startContainer)?.closest('[data-no-anchor]');
  if (noAnchor) {
    // Only front matter carries the value `true` and its hint; any other value is rejected silently.
    return {
      ok: false,
      reason: noAnchor.getAttribute('data-no-anchor') === 'true' ? 'front-matter' : undefined,
    };
  }

  const block = blockOf(range.startContainer);
  if (!block) return { ok: false, reason: undefined };

  const selectedText = textOfRange(range, root);
  if (selectedText.trim().length < MIN_ANCHOR_LENGTH) {
    return { ok: false, reason: 'too-short' };
  }

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
    return {
      ok: true,
      value: { selectedText, offset: -1, hintLine, rect: range.getBoundingClientRect() },
    };
  }

  const offset = offsetAt(range.startContainer, range.startOffset);

  return {
    ok: true,
    value: {
      selectedText,
      // `-1` is the documented sentinel; the host recovers a position from `hintLine`.
      offset: offset ?? -1,
      hintLine,
      rect: range.getBoundingClientRect(),
    },
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

/**
 * Place a `position: fixed` element beside a selection, kept inside the viewport (§10 D20).
 *
 * Both callers are `position: fixed`, so this is viewport coordinates throughout and there is no
 * scroll maths. The element must already be visible — `offsetHeight` is zero while `hidden`.
 *
 * Flip before clamp. Clamping alone would slide the element up over the very text it describes,
 * which for the composer means covering the passage the user is writing about; flipping to the
 * other side of the selection keeps it adjacent. Clamping is the last resort for a selection so
 * tall that neither side fits, and it is what stops the actions row leaving the screen.
 */
function placeFixed(element: HTMLElement, rect: DOMRect, prefer: 'above' | 'below'): void {
  const { offsetHeight: height, offsetWidth: width } = element;
  const above = rect.top - height - MARGIN_PX;
  const below = rect.bottom + MARGIN_PX;

  const fits = (top: number): boolean => top >= MARGIN_PX && top + height <= window.innerHeight - MARGIN_PX;
  let top = prefer === 'above' ? above : below;
  if (!fits(top)) {
    const other = prefer === 'above' ? below : above;
    if (fits(other)) top = other;
  }

  const maxTop = Math.max(window.innerHeight - height - MARGIN_PX, MARGIN_PX);
  const maxLeft = Math.max(window.innerWidth - width - MARGIN_PX, MARGIN_PX);
  element.style.top = `${String(Math.min(Math.max(top, MARGIN_PX), maxTop))}px`;
  element.style.left = `${String(Math.min(Math.max(rect.left, MARGIN_PX), maxLeft))}px`;
}

function showButton(button: HTMLElement, rect: DOMRect): void {
  button.hidden = false;
  placeFixed(button, rect, 'above');
}

/**
 * Why a selection cannot be commented on, in the words the user needs (H21).
 *
 * `too-short` interpolates the same constant `createAnchor` enforces, so it cannot drift; the
 * host's `anchorRejectionMessage` says the same thing for the submit path that can still reach it.
 */
const REJECTION_TEXT: Record<Exclude<Rejection, undefined>, string> = {
  'too-short': `Select at least ${String(MIN_ANCHOR_LENGTH)} characters to comment`,
  'front-matter': 'Front matter cannot be commented on',
};

/** Transient, non-interactive, and never focus-stealing: the user is mid-drag. */
function createHint(): HTMLElement {
  const hint = document.createElement('div');
  hint.className = 'mr-selection-hint';
  hint.setAttribute('role', 'status');
  hint.hidden = true;
  return hint;
}

function showHint(hint: HTMLElement, text: string, rect: DOMRect): void {
  hint.textContent = text;
  hint.hidden = false;
  placeFixed(hint, rect, 'above');
}

function hideHint(hint: HTMLElement): void {
  hint.hidden = true;
}

interface Popover {
  element: HTMLElement;
  open(at: Captured, restoreFocusTo?: Element | null): void;
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
    open(at: Captured, restoreFocusTo?: Element | null) {
      // The caller passes what had focus *before* it hid the Comment button. Reading
      // `document.activeElement` here instead — as this did — always saw `<body>`, because hiding
      // the button had already dropped focus, so `close()`'s restore was a silent no-op (H18).
      previousFocus = restoreFocusTo ?? document.activeElement;
      open = true;
      element.hidden = false;
      placeFixed(element, at.rect, 'below');
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

