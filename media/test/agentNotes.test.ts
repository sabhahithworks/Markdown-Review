import { describe, expect, it, vi } from 'vitest';
import type { Comment, ReviewSummary } from '../../src/panel/messages.js';
import { initAgentNotes, notesArrived, notesKey } from '../src/agentNotes.js';

function setup(): { root: HTMLElement; onDismiss: ReturnType<typeof vi.fn>; view: ReturnType<typeof initAgentNotes> } {
  const root = document.createElement('section');
  const onDismiss = vi.fn();
  const view = initAgentNotes({ root, onDismiss });
  return { root, onDismiss, view };
}

function review(
  agentNotes: ReviewSummary['agentNotes'],
  commentNotes: string[] = [],
): ReviewSummary {
  const comments = commentNotes.map(
    (receivedAt, i) =>
      ({
        id: `c${String(i)}`,
        body: 'b',
        author: 'a',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'open',
        anchor: { exact: 'x', prefix: '', suffix: '', hintLine: 0, hintOffset: 0 },
        agentNote: { text: 't', receivedAt },
      }) as unknown as Comment,
  );
  return { comments, ...(agentNotes ? { agentNotes } : {}) } as unknown as ReviewSummary;
}

const NOTES = { unattached: 'Some notes', cut: false, receivedAt: '2026-02-01T00:00:00.000Z' };

describe('agent notes section', () => {
  it('shows unattached notes under the heading', () => {
    const { root, view } = setup();
    view.setState(NOTES);
    expect(root.hidden).toBe(false);
    expect(root.querySelector('h2')?.textContent).toBe('Notes from the agent');
    expect(root.textContent).toContain('Some notes');
  });

  it('renders markup as text', () => {
    const { root, view } = setup();
    view.setState({ ...NOTES, unattached: '<img src=x onerror=1>' });
    expect(root.textContent).toContain('<img src=x onerror=1>');
    expect(root.querySelector('img')).toBeNull();
  });

  it('shows the cut line when cut', () => {
    const { root, view } = setup();
    view.setState({ ...NOTES, cut: true });
    expect(root.textContent).toContain('Notes cut at 16,000 characters.');
    view.setState({ ...NOTES, cut: false });
    expect(root.textContent).not.toContain('Notes cut at');
  });

  it('hidden when there is nothing unattached', () => {
    const { root, view } = setup();
    view.setState(NOTES);
    view.setState(undefined);
    expect(root.hidden).toBe(true);
    view.setState(NOTES);
    view.setState({ ...NOTES, unattached: '   \n' });
    expect(root.hidden).toBe(true);
    expect(root.childElementCount).toBe(0);
  });

  it('Dismiss calls the handler', () => {
    const { root, view, onDismiss } = setup();
    view.setState(NOTES);
    const button = root.querySelector('button');
    expect(button?.textContent).toBe('Dismiss');
    button?.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('announces new notes once', () => {
    expect(notesKey(review(NOTES))).toBe(notesKey(review({ ...NOTES })));
    expect(notesKey(review(NOTES, ['2026-03-01T00:00:00.000Z']))).not.toBe(notesKey(review(NOTES)));
    expect(notesKey(review({ ...NOTES, receivedAt: '2026-04-01T00:00:00.000Z' }))).not.toBe(
      notesKey(review(NOTES)),
    );
    expect(notesKey(review(undefined))).toBe('');
    expect(notesKey(review({ ...NOTES, unattached: '  ' }))).toBe('');
  });

  it('decides when to announce', () => {
    const key = notesKey(review(NOTES));
    expect(notesArrived(undefined, key)).toBe(false);
    expect(notesArrived(key, key)).toBe(false);
    expect(notesArrived('A|B', 'B')).toBe(false);
    expect(notesArrived('A', 'A|B')).toBe(true);
    expect(notesArrived('', key)).toBe(true);
  });
});
