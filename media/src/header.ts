/**
 * The header bar: counts, status filters and the two primary actions (PRD §6).
 *
 * The counts and the filter are one control rather than two. PRD §6 asks for both, and a row of
 * counts next to a separate row of filter chips means two places showing the same four statuses,
 * which then have to agree. A chip that reads "3 open" and toggles itself is the same information
 * doing both jobs.
 *
 * The decisions — what a count says, when the primary action is disabled, how a chip toggles — are
 * exported as pure functions. jsdom reports every rectangle as zero, so DOM assertions about this
 * bar would be worthless, but none of these three needs layout to be checked.
 */

import type {
  ChangeState,
  CommentStatus,
  ReviewSummary,
  SendTarget,
  WebviewMessage,
} from '../../src/panel/messages.js';
import { countByStatus } from '../../src/panel/messages.js';

export { countByStatus };

/** Display order. `resolved` sits last: it is terminal and least interesting. */
export const FILTERABLE: readonly CommentStatus[] = ['open', 'addressed', 'orphaned', 'resolved'];

export interface HeaderOptions {
  root: HTMLElement;
  onCopyPrompt(): void;
  onSendPrompt(target: SendTarget): void;
  onClearAddressed(): void;
  /** PRD §6's second destructive command, which had no in-pane surface at all (H27). */
  onClearAll(): void;
  onFilterChange(statuses: CommentStatus[]): void;
  /** The change view's button (D31): opens the baseline↔current diff. */
  onShowChanges(): void;
  /** Opens the whole-document composer; `button` is where focus returns and the composer sits. */
  onCommentOnDocument(button: HTMLElement): void;
}

export interface HeaderView {
  /** `changes` undefined hides the change control, as `no-baseline` does. */
  /** `marked` is how many blocks `applyChangeMarks` marked for `changes`; it is the count shown. */
  setState(review: ReviewSummary, changes?: ChangeState, marked?: number): void;
  /** Applies a filter restored from `setState`, without echoing it back to the host. */
  setFilter(statuses: readonly CommentStatus[]): void;
}

/**
 * The primary action's label and whether it is available.
 *
 * Disabled at zero open comments (PRD §6) rather than hidden: the button is the pane's main
 * affordance, and a control that vanishes is harder to find again than one that is greyed out.
 */
export function copyPromptLabel(open: number): { label: string; disabled: boolean } {
  return open === 0
    ? { label: 'Copy review prompt', disabled: true }
    : { label: `Copy review prompt (${String(open)})`, disabled: false };
}

/**
 * What the "Show changes" button posts. The existing rewrite-diff message, not a new type: the host
 * already guards it and opens the baseline↔current diff for it (D31, L-message-guard).
 */
export const SHOW_CHANGES_MESSAGE = { type: 'showRewriteDiff' } as const satisfies WebviewMessage;

export type ChangesControl =
  | { kind: 'hidden' }
  | { kind: 'text'; label: string }
  | { kind: 'button'; label: string; title?: string };

/**
 * The change view's header control (D31).
 *
 * `changed` counts the blocks the inline marks actually marked, passed in as `marked` from
 * `applyChangeMarks`, so the number matches the bars a reader can see. The host merges adjacent
 * changed blocks into one span (D28), so a span count would undercount: three rewritten paragraphs
 * in a row are one span and three bars. Without `marked` — a caller that did not mark anything —
 * the span count is the only number there is. `too-large` keeps the button, since the side-by-side diff still works
 * where inline marks were skipped, and its tooltip says why there are no marks. `unchanged` is
 * plain text rather than a disabled button: there is nothing to open. No baseline, or no state at
 * all, means there is no prompt to compare against, so nothing is shown.
 */
export function changesControl(changes: ChangeState | undefined, marked?: number): ChangesControl {
  switch (changes?.state) {
    case 'changed':
      return { kind: 'button', label: `Show changes (${String(marked ?? changes.blocks.length)})` };
    case 'too-large':
      return { kind: 'button', label: 'Show changes', title: 'Too large to mark inline' };
    case 'unchanged':
      return { kind: 'text', label: 'No changes since prompt' };
    case 'no-baseline':
    case undefined:
      return { kind: 'hidden' };
  }
}

/**
 * Toggles one status in the filter, keeping `FILTERABLE`'s order.
 *
 * Order-stable so the chips never reshuffle under the pointer, and so the value written to
 * `setState` is comparable between sessions.
 */
export function toggleStatus(
  filter: readonly CommentStatus[],
  status: CommentStatus,
): CommentStatus[] {
  const next = new Set(filter);
  if (next.has(status)) next.delete(status);
  else next.add(status);
  return FILTERABLE.filter((entry) => next.has(entry));
}

/** How a chip reads: the count and the status, e.g. "3 open". */
export function chipLabel(status: CommentStatus, count: number): string {
  return `${String(count)} ${status}`;
}

/**
 * How many comments the current filter is hiding, and the sentence saying so (H23).
 *
 * Filtering everything off produced a completely blank pane with no explanation and no way back
 * that a user would think to look for — the chips are still there, but "I hid them" is not the
 * first hypothesis when a pane goes empty.
 */
export function hiddenNotice(
  counts: Record<CommentStatus, number>,
  filter: readonly CommentStatus[],
): string | undefined {
  const hidden = FILTERABLE.filter((status) => !filter.includes(status)).reduce(
    (total, status) => total + counts[status],
    0,
  );
  if (hidden === 0) return undefined;
  return hidden === 1 ? '1 comment hidden by filter' : `${String(hidden)} comments hidden by filter`;
}

export function initHeader(options: HeaderOptions): HeaderView {
  let filter: CommentStatus[] = [...FILTERABLE];
  let counts = countByStatus([]);
  let control: ChangesControl = { kind: 'hidden' };

  const chips = new Map<CommentStatus, HTMLButtonElement>();

  const countsRow = document.createElement('div');
  countsRow.className = 'mr-header-counts';

  for (const status of FILTERABLE) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mr-chip';
    chip.dataset['status'] = status;
    chip.addEventListener('click', () => {
      filter = toggleStatus(filter, status);
      paint();
      options.onFilterChange(filter);
    });
    chips.set(status, chip);
    countsRow.append(chip);
  }

  const actions = document.createElement('div');
  actions.className = 'mr-header-actions';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'mr-button-primary';
  copy.addEventListener('click', options.onCopyPrompt);

  const sendWrap = document.createElement('div');
  sendWrap.className = 'mr-send';

  const sendButton = document.createElement('button');
  sendButton.type = 'button';
  sendButton.className = 'mr-button-secondary';
  sendButton.textContent = 'Send to';
  sendButton.setAttribute('aria-haspopup', 'menu');
  sendButton.setAttribute('aria-expanded', 'false');

  const sendMenu = document.createElement('div');
  sendMenu.className = 'mr-send-menu';
  sendMenu.setAttribute('role', 'menu');
  sendMenu.setAttribute('aria-label', 'Send to');
  sendMenu.hidden = true;

  const sendItems: HTMLButtonElement[] = [];
  for (const [target, label] of [
    ['chat', 'VS Code chat'],
    ['terminal', 'Active terminal'],
  ] as const) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mr-send-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    item.addEventListener('click', () => {
      closeSendMenu(true);
      options.onSendPrompt(target);
    });
    sendItems.push(item);
    sendMenu.append(item);
  }
  sendWrap.append(sendButton, sendMenu);

  function onOutsidePointer(event: Event): void {
    if (!(event.target instanceof Node) || !sendWrap.contains(event.target)) closeSendMenu(false);
  }

  function openSendMenu(): void {
    sendMenu.hidden = false;
    sendMenu.style.left = '0px';
    sendButton.setAttribute('aria-expanded', 'true');
    // Opens below the button; shifted left when it would run past the pane's right edge.
    const overflow = sendMenu.getBoundingClientRect().right - document.documentElement.clientWidth;
    if (overflow > 0) sendMenu.style.left = `${String(-overflow)}px`;
    document.addEventListener('pointerdown', onOutsidePointer);
    sendItems[0]?.focus();
  }

  function closeSendMenu(returnFocus: boolean): void {
    if (sendMenu.hidden) return;
    sendMenu.hidden = true;
    sendButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutsidePointer);
    if (returnFocus) sendButton.focus();
  }

  // Enter and Space on a button arrive as a click, so this one handler covers all three.
  sendButton.addEventListener('click', () => {
    if (sendMenu.hidden) openSendMenu();
    else closeSendMenu(true);
  });

  sendMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSendMenu(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = sendItems.findIndex((item) => item === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    sendItems[(at + step + sendItems.length) % sendItems.length]?.focus();
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'mr-button-secondary';
  clear.textContent = 'Clear addressed';
  clear.addEventListener('click', options.onClearAddressed);

  const commentOnDocument = document.createElement('button');
  commentOnDocument.type = 'button';
  commentOnDocument.className = 'mr-button-secondary';
  commentOnDocument.textContent = 'Comment on document';
  commentOnDocument.addEventListener('click', () => {
    options.onCommentOnDocument(commentOnDocument);
  });

  // Both clears are modal-confirmed and backed up host-side, so surfacing this one costs nothing
  // in safety and closes the gap where PRD §6's other command existed only in the palette (H27).
  const clearAll = document.createElement('button');
  clearAll.type = 'button';
  clearAll.className = 'mr-button-secondary';
  clearAll.textContent = 'Clear all';
  clearAll.addEventListener('click', options.onClearAll);

  // The reset for a filter that has hidden everything (H23). Sits with the chips it undoes.
  const hidden = document.createElement('button');
  hidden.type = 'button';
  hidden.className = 'mr-header-hidden';
  hidden.hidden = true;
  hidden.addEventListener('click', () => {
    filter = [...FILTERABLE];
    paint();
    options.onFilterChange(filter);
  });
  countsRow.append(hidden);

  const showChanges = document.createElement('button');
  showChanges.type = 'button';
  showChanges.className = 'mr-button-secondary';
  showChanges.addEventListener('click', options.onShowChanges);

  // Muted, like the popover's hint: a fact about the document, not something to act on.
  const noChanges = document.createElement('span');
  noChanges.className = 'mr-popover-hint';

  actions.append(copy, sendWrap, commentOnDocument, clear, clearAll, showChanges, noChanges);
  options.root.replaceChildren(countsRow, actions);

  function paint(): void {
    for (const [status, chip] of chips) {
      const shown = filter.includes(status);
      chip.textContent = chipLabel(status, counts[status]);
      chip.setAttribute('aria-pressed', String(shown));
      chip.classList.toggle('mr-chip-off', !shown);
      // A status nobody has used is noise in a bar this small, but it must stay reachable while
      // filtered off, or a user who hides `open` cannot get it back.
      chip.hidden = counts[status] === 0 && shown;
      chip.setAttribute(
        'aria-label',
        `${shown ? 'Hide' : 'Show'} ${chipLabel(status, counts[status])}`,
      );
    }

    const primary = copyPromptLabel(counts.open);
    copy.textContent = primary.label;
    copy.disabled = primary.disabled;
    sendButton.disabled = primary.disabled;
    if (primary.disabled) closeSendMenu(false);

    clear.hidden = counts.addressed === 0;
    clearAll.hidden = Object.values(counts).every((count) => count === 0);

    const notice = hiddenNotice(counts, filter);
    hidden.hidden = notice === undefined;
    if (notice !== undefined) {
      hidden.textContent = notice;
      hidden.setAttribute('aria-label', `${notice}. Show all comments.`);
    }

    showChanges.hidden = control.kind !== 'button';
    noChanges.hidden = control.kind !== 'text';
    if (control.kind === 'button') {
      showChanges.textContent = control.label;
      if (control.title === undefined) showChanges.removeAttribute('title');
      else showChanges.title = control.title;
    } else if (control.kind === 'text') {
      noChanges.textContent = control.label;
    }

    // The whole bar is dead weight on a document nobody has commented on yet. A change control
    // keeps it up: after "Clear all" the baseline and its inline marks remain, and the button is
    // the only way to the diff that explains them.
    options.root.hidden =
      Object.values(counts).every((count) => count === 0) && control.kind === 'hidden';
  }

  paint();

  return {
    setState(review, changes, marked): void {
      counts = countByStatus(review.comments);
      control = changesControl(changes, marked);
      paint();
    },
    setFilter(statuses): void {
      filter = FILTERABLE.filter((entry) => statuses.includes(entry));
      paint();
    },
  };
}
