/**
 * The "Notes from the agent" section: the agent's notes that were not tied to a comment.
 *
 * The text is set through `textContent` only. Like the orphan section, the root hides itself when
 * there is nothing to show.
 */

import type { ReviewSummary } from '../../src/panel/messages.js';

export interface AgentNotesOptions {
  root: HTMLElement;
  onDismiss(): void;
}

export interface AgentNotesView {
  setState(notes: ReviewSummary['agentNotes']): void;
}

/** The sentence shown when the host cut the notes at its limit. */
export const CUT_LINE = 'Notes cut at 16,000 characters.';

export function initAgentNotes(options: AgentNotesOptions): AgentNotesView {
  function setState(notes: ReviewSummary['agentNotes']): void {
    if (notes === undefined || notes.unattached.trim() === '') {
      options.root.hidden = true;
      options.root.replaceChildren();
      return;
    }

    const heading = document.createElement('h2');
    heading.className = 'mr-agent-notes-heading';
    heading.textContent = 'Notes from the agent';

    const text = document.createElement('p');
    text.className = 'mr-agent-notes-text';
    text.textContent = notes.unattached;

    const children: HTMLElement[] = [heading, text];

    if (notes.cut) {
      const cut = document.createElement('p');
      cut.className = 'mr-agent-notes-cut';
      cut.textContent = CUT_LINE;
      children.push(cut);
    }

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'mr-agent-notes-dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => {
      options.onDismiss();
    });
    children.push(dismiss);

    options.root.replaceChildren(...children);
    options.root.hidden = false;
  }

  return { setState };
}

/** The sorted `receivedAt` values of the review's notes and of every comment's note, joined. */
export function notesKey(review: ReviewSummary): string {
  const stamps: string[] = [];
  if (review.agentNotes !== undefined && review.agentNotes.unattached.trim() !== '') {
    stamps.push(review.agentNotes.receivedAt);
  }
  for (const comment of review.comments) {
    if (comment.agentNote !== undefined) stamps.push(comment.agentNote.receivedAt);
  }
  return stamps.sort().join('|');
}

/** Whether `next` holds a stamp that `previous` does not; false before the first state. */
export function notesArrived(previous: string | undefined, next: string): boolean {
  if (previous === undefined) return false;
  const known = new Set(previous.split('|'));
  return next.split('|').some((stamp) => stamp !== '' && !known.has(stamp));
}
