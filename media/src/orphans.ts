/**
 * Comments whose anchor could not be found (PRD §6).
 *
 * They live here rather than in the gutter for a reason that is both design and bug fix. Design:
 * PRD §6 asks for "a distinct section with the original text quoted", because an orphan has nothing
 * to align to and a card floating at an arbitrary height reads as a positioning error. Bug: cards
 * are `position: absolute` and every orphan was skipped before `stackTops` ran, so none of them ever
 * had a `top` set and they all piled up at the same point (Plan 04 §9 D6).
 *
 * In normal flow, so nothing here can overlap, escape the pane, or need measuring.
 */

import type { Comment, CommentStatus, Located } from '../../src/panel/messages.js';
import { isDocumentComment, truncateQuote } from '../../src/panel/messages.js';
import { belongsInOrphans } from './comments.js';
import { FILTERABLE } from './header.js';

/** Long enough to recognise a sentence, short enough not to dominate the section. */
const QUOTE_LENGTH = 160;

export interface OrphansOptions {
  root: HTMLElement;
  onDelete(id: string): void;
  /** Arms re-anchor mode. The new selection arrives later, through the selection controller. */
  onReanchor(id: string): void;
  onCancelReanchor(): void;
  /** Speaks a sentence through the pane's live region (H18). */
  announce(message: string): void;
}

export interface OrphansView {
  /**
   * Takes exactly what the gutter cannot place, using the same predicate — so the two views
   * partition the comments between them and none can fall through both. `sectionChanged` carries
   * the D21 signal (H0): ids whose last known neighbourhood changed since the prompt was copied.
   */
  setState(
    comments: readonly Comment[],
    located: Record<string, Located | null>,
    sectionChanged?: readonly string[],
  ): void;
  /** Shows which orphan is waiting for a selection, or `undefined` for none. */
  setArmed(id: string | undefined): void;
  /**
   * The status chips filter this section too (H23). They did not, so switching `orphaned` off
   * removed the gutter cards but left the triage list fully visible — the one place the filter
   * most obviously *should* apply.
   */
  setFilter(statuses: readonly CommentStatus[]): void;
}

export function initOrphans(options: OrphansOptions): OrphansView {
  let all: readonly Comment[] = [];
  let positions: Record<string, Located | null> = {};
  let orphans: Comment[] = [];
  let armed: string | undefined;
  let changed = new Set<string>();
  let filter: CommentStatus[] = [...FILTERABLE];

  /**
   * Membership is by *position* (`belongsInOrphans`), but visibility is by the comment's declared
   * status — the same value the header counts — so the two can never disagree about what the
   * chips mean.
   */
  function recompute(): void {
    orphans = all.filter(
      (comment) =>
        !isDocumentComment(comment) && belongsInOrphans(comment, positions) && filter.includes(comment.status),
    );
    if (armed !== undefined && !orphans.some((comment) => comment.id === armed)) {
      armed = undefined;
    }
  }

  function render(): void {
    if (orphans.length === 0) {
      options.root.hidden = true;
      options.root.replaceChildren();
      return;
    }

    const heading = document.createElement('h2');
    heading.className = 'mr-orphans-heading';
    heading.textContent =
      orphans.length === 1
        ? '1 comment lost its anchor'
        : `${String(orphans.length)} comments lost their anchor`;

    const list = document.createElement('ul');
    list.className = 'mr-orphan-list';
    for (const comment of orphans) list.append(buildRow(comment));

    options.root.replaceChildren(heading, list);
    options.root.hidden = false;
  }

  function buildRow(comment: Comment): HTMLElement {
    const row = document.createElement('li');
    row.className = 'mr-orphan';
    row.dataset['commentId'] = comment.id;

    const body = document.createElement('p');
    body.className = 'mr-orphan-body';
    body.textContent = comment.body;

    const detail = document.createElement('p');
    detail.className = 'mr-orphan-detail';

    if (armed === comment.id) {
      // `aria-live` because the instruction replaces content the user is not looking at — they have
      // just been told to go and select something in the document.
      detail.setAttribute('aria-live', 'polite');
      detail.textContent = 'Select the new text in the document, or press Escape to cancel.';
      row.classList.add('mr-orphan-armed');
    } else {
      const quote = document.createElement('q');
      quote.className = 'mr-orphan-quote';
      // The anchor's own text, not the document's: the document no longer contains it, and this is
      // the record of what the user was commenting on.
      quote.textContent = truncateQuote(comment.anchor?.exact ?? '', QUOTE_LENGTH);
      detail.append('was on ', quote);
    }

    row.append(body, detail);

    // The D21 signal (H0): an anchor that stated an absence can only be addressed by deleting it,
    // so the answer the user wanted arrives here — as apparent loss. Same observation-not-claim
    // wording as the card note (D17/D19), with the consequence spelled out, because in this
    // section the default reading is "something went wrong".
    if (armed !== comment.id && changed.has(comment.id)) {
      const note = document.createElement('p');
      note.className = 'mr-orphan-note';
      note.textContent =
        'The text around this changed since you copied the prompt — it may have been addressed rather than lost.';
      row.append(note);
    }

    row.append(buildActions(comment));
    return row;
  }

  function buildActions(comment: Comment): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'mr-orphan-actions';

    const isArmed = armed === comment.id;

    const reanchor = action(
      isArmed ? 'Cancel' : 'Re-anchor',
      isArmed
        ? 'Cancel re-anchoring this comment'
        : `Re-anchor "${truncateQuote(comment.anchor?.exact ?? '', 40)}" to new text`,
      () => {
        if (isArmed) options.onCancelReanchor();
        else options.onReanchor(comment.id);
      },
    );

    // Two-step, matching the gutter card (H22). An orphan is the case where an accidental delete
    // costs most: it is the only copy of a remark whose anchor is already gone.
    const remove = action('Delete', `Delete comment by ${comment.author}`, () => {
      if (remove.dataset['confirming'] === 'true') {
        options.announce(`Comment by ${comment.author} deleted.`);
        options.onDelete(comment.id);
        return;
      }
      remove.dataset['confirming'] = 'true';
      remove.textContent = 'Delete?';
      remove.classList.add('mr-card-action-danger');
      remove.setAttribute('aria-label', `Confirm deleting the comment by ${comment.author}`);
      remove.addEventListener(
        'blur',
        () => {
          delete remove.dataset['confirming'];
          remove.textContent = 'Delete';
          remove.classList.remove('mr-card-action-danger');
          remove.setAttribute('aria-label', `Delete comment by ${comment.author}`);
        },
        { once: true },
      );
    });

    actions.append(reanchor, remove);
    return actions;
  }

  function action(label: string, ariaLabel: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mr-card-action';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', run);
    return button;
  }

  return {
    setState(comments, located, sectionChanged = []): void {
      changed = new Set(sectionChanged);
      all = comments;
      positions = located;
      // An armed comment that is no longer orphaned — re-anchored elsewhere, deleted, or its text
      // reappeared — must not leave the pane waiting for a selection nothing will consume;
      // `recompute` drops it.
      recompute();
      render();
    },
    setArmed(id): void {
      armed = id;
      render();
    },
    setFilter(statuses): void {
      filter = [...statuses];
      recompute();
      render();
    },
  };
}
