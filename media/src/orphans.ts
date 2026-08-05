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

import type { Comment, Located } from '../../src/panel/messages.js';
import { truncateQuote } from '../../src/panel/messages.js';
import { belongsInOrphans } from './comments.js';

/** Long enough to recognise a sentence, short enough not to dominate the section. */
const QUOTE_LENGTH = 160;

export interface OrphansOptions {
  root: HTMLElement;
  onDelete(id: string): void;
  /** Arms re-anchor mode. The new selection arrives later, through the selection controller. */
  onReanchor(id: string): void;
  onCancelReanchor(): void;
}

export interface OrphansView {
  /**
   * Takes exactly what the gutter cannot place, using the same predicate — so the two views
   * partition the comments between them and none can fall through both.
   */
  setState(comments: readonly Comment[], located: Record<string, Located | null>): void;
  /** Shows which orphan is waiting for a selection, or `undefined` for none. */
  setArmed(id: string | undefined): void;
}

export function initOrphans(options: OrphansOptions): OrphansView {
  let orphans: Comment[] = [];
  let armed: string | undefined;

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
      quote.textContent = truncateQuote(comment.anchor.exact, QUOTE_LENGTH);
      detail.append('was on ', quote);
    }

    row.append(body, detail, buildActions(comment));
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
        : `Re-anchor "${truncateQuote(comment.anchor.exact, 40)}" to new text`,
      () => {
        if (isArmed) options.onCancelReanchor();
        else options.onReanchor(comment.id);
      },
    );

    const remove = action('Delete', `Delete comment by ${comment.author}`, () => {
      options.onDelete(comment.id);
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
    setState(comments, located): void {
      orphans = comments.filter((comment) => belongsInOrphans(comment, located));
      // An armed comment that is no longer orphaned — re-anchored elsewhere, deleted, or its text
      // reappeared — must not leave the pane waiting for a selection nothing will consume.
      if (armed !== undefined && !orphans.some((comment) => comment.id === armed)) {
        armed = undefined;
      }
      render();
    },
    setArmed(id): void {
      armed = id;
      render();
    },
  };
}
