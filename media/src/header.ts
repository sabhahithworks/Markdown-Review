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

import type { Comment, CommentStatus, ReviewSummary } from '../../src/panel/messages.js';

/** Display order. `resolved` sits last: it is terminal and least interesting. */
export const FILTERABLE: readonly CommentStatus[] = ['open', 'addressed', 'orphaned', 'resolved'];

export interface HeaderOptions {
  root: HTMLElement;
  onCopyPrompt(): void;
  onClearAddressed(): void;
  /** PRD §6's second destructive command, which had no in-pane surface at all (H27). */
  onClearAll(): void;
  onFilterChange(statuses: CommentStatus[]): void;
}

export interface HeaderView {
  setState(review: ReviewSummary): void;
  /** Applies a filter restored from `setState`, without echoing it back to the host. */
  setFilter(statuses: readonly CommentStatus[]): void;
}

export function countByStatus(comments: readonly Comment[]): Record<CommentStatus, number> {
  const counts: Record<CommentStatus, number> = {
    open: 0,
    addressed: 0,
    orphaned: 0,
    resolved: 0,
  };
  for (const comment of comments) counts[comment.status] += 1;
  return counts;
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

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'mr-button-secondary';
  clear.textContent = 'Clear addressed';
  clear.addEventListener('click', options.onClearAddressed);

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

  actions.append(copy, clear, clearAll);
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

    clear.hidden = counts.addressed === 0;
    clearAll.hidden = Object.values(counts).every((count) => count === 0);

    const notice = hiddenNotice(counts, filter);
    hidden.hidden = notice === undefined;
    if (notice !== undefined) {
      hidden.textContent = notice;
      hidden.setAttribute('aria-label', `${notice}. Show all comments.`);
    }

    // The whole bar is dead weight on a document nobody has commented on yet.
    options.root.hidden = Object.values(counts).every((count) => count === 0);
  }

  paint();

  return {
    setState(review): void {
      counts = countByStatus(review.comments);
      paint();
    },
    setFilter(statuses): void {
      filter = FILTERABLE.filter((entry) => statuses.includes(entry));
      paint();
    },
  };
}
