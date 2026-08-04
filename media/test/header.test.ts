/**
 * The header bar's decisions (PRD §6).
 *
 * jsdom reports every rectangle as zero, so asserting the rendered bar would prove nothing about
 * how it looks — `dev/harness/` covers that. What *is* worth pinning down is the logic behind it,
 * which is why counting, the primary action's state and chip toggling are exported separately.
 */

import { describe, expect, it } from 'vitest';
import type { Comment, CommentStatus } from '../../src/panel/messages.js';
import { FILTERABLE, chipLabel, copyPromptLabel, countByStatus, toggleStatus } from '../src/header.js';

function comment(status: CommentStatus): Comment {
  return {
    id: `c-${status}-${String(Math.random()).slice(2, 8)}`,
    body: 'body',
    author: 'tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    status,
    anchor: { exact: 'anchor', prefix: '', suffix: '', hintLine: 0, hintOffset: 0 },
  };
}

describe('countByStatus', () => {
  it('counts every status, including the ones nobody used', () => {
    expect(countByStatus([comment('open'), comment('open'), comment('orphaned')])).toEqual({
      open: 2,
      addressed: 0,
      orphaned: 1,
      resolved: 0,
    });
  });

  it('returns zeroes for an empty review rather than an empty object', () => {
    // The bar reads these directly; a missing key would render "undefined open".
    expect(countByStatus([])).toEqual({ open: 0, addressed: 0, orphaned: 0, resolved: 0 });
  });
});

describe('copyPromptLabel', () => {
  it('disables the primary action when nothing is open (PRD §6)', () => {
    expect(copyPromptLabel(0)).toEqual({ label: 'Copy review prompt', disabled: true });
  });

  it('carries the count when there is something to send', () => {
    expect(copyPromptLabel(3)).toEqual({ label: 'Copy review prompt (3)', disabled: false });
    expect(copyPromptLabel(1).label).toBe('Copy review prompt (1)');
  });
});

describe('toggleStatus', () => {
  it('removes a shown status and restores a hidden one', () => {
    expect(toggleStatus(FILTERABLE, 'open')).toEqual(['addressed', 'orphaned', 'resolved']);
    expect(toggleStatus(['addressed'], 'open')).toEqual(['open', 'addressed']);
  });

  it('keeps display order however the chips are clicked', () => {
    // Order-stable so chips never reshuffle under the pointer, and so the value written to
    // `setState` is comparable between sessions.
    let filter: CommentStatus[] = [];
    for (const status of ['resolved', 'open', 'orphaned', 'addressed'] as CommentStatus[]) {
      filter = toggleStatus(filter, status);
    }
    expect(filter).toEqual(['open', 'addressed', 'orphaned', 'resolved']);
  });

  it('does not mutate the filter it was given', () => {
    const before: CommentStatus[] = ['open', 'addressed'];
    toggleStatus(before, 'open');
    expect(before).toEqual(['open', 'addressed']);
  });

  it('can empty the filter completely', () => {
    // A user may legitimately hide everything; the gutter then shows nothing, which is honest.
    let filter: CommentStatus[] = [...FILTERABLE];
    for (const status of FILTERABLE) filter = toggleStatus(filter, status);
    expect(filter).toEqual([]);
  });
});

describe('chipLabel', () => {
  it('reads as a count and a status', () => {
    expect(chipLabel('open', 3)).toBe('3 open');
    expect(chipLabel('orphaned', 0)).toBe('0 orphaned');
  });
});
