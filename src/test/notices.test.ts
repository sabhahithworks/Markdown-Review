/**
 * Specified user-facing wording (Plan 03 §4).
 *
 * Plan 03 §8 lists "selections < 3 or > 500 chars rejected with the exact messages in §4" as an
 * acceptance item, which as written means someone reading a notification in a dev host. The strings
 * are specified, so they are testable; this file is what turns that checklist row into a test.
 */

import { describe, expect, it } from 'vitest';
import { MAX_ANCHOR_LENGTH, MIN_ANCHOR_LENGTH } from '../anchor/types.js';
import {
  anchorRejectionMessage,
  backupFailedMessage,
  clearAddressedConfirm,
  clearAllConfirm,
  clearedMessage,
  noOpenCommentsMessage,
  nothingToClearMessage,
  promptCopiedMessage,
} from '../panel/notices.js';

describe('anchorRejectionMessage', () => {
  it('matches Plan 03 §4 verbatim', () => {
    expect(anchorRejectionMessage('too-short')).toBe('Select at least 3 characters');
    expect(anchorRejectionMessage('too-long')).toBe(
      'Selection too long to anchor — select under 500 characters',
    );
  });

  it('interpolates the limits createAnchor actually enforces', () => {
    // The literals above are the spec; these assertions are what catches a limit changing in
    // `types.ts` without the message following it.
    expect(anchorRejectionMessage('too-short')).toContain(String(MIN_ANCHOR_LENGTH));
    expect(anchorRejectionMessage('too-long')).toContain(String(MAX_ANCHOR_LENGTH));
  });

  it('uses an em dash, not a hyphen', () => {
    // Easy to "fix" during an unrelated edit; it is part of the specified string.
    expect(anchorRejectionMessage('too-long')).toContain('—');
  });
});

describe('promptCopiedMessage', () => {
  it('matches the PRD §7 sentence verbatim', () => {
    expect(promptCopiedMessage(3, 'docs/auth.md')).toBe(
      '3 comments copied. Paste into your agent and @-mention docs/auth.md.',
    );
  });

  it('says "1 comment", not "1 comments"', () => {
    // PRD §7 only shows the plural. Reading "1 comments copied" in the one case a user is most
    // likely to hit first is a bad first impression for a message this prominent.
    expect(promptCopiedMessage(1, 'notes.md')).toBe(
      '1 comment copied. Paste into your agent and @-mention notes.md.',
    );
  });

  it('keeps the @-mention instruction, which is what makes the path actionable', () => {
    expect(promptCopiedMessage(2, 'docs/specs/auth.md')).toContain('@-mention docs/specs/auth.md');
  });
});

describe('noOpenCommentsMessage', () => {
  it('names the file rather than saying "this file"', () => {
    expect(noOpenCommentsMessage('docs/auth.md')).toBe('No open comments on docs/auth.md.');
  });
});

describe('destructive-command wording', () => {
  it('names the count and reassures that the document is untouched', () => {
    // The fear when deleting review comments is that the edits go with them.
    expect(clearAddressedConfirm(4)).toBe(
      'Remove 4 addressed comments? Their text changes stay in the document.',
    );
    expect(clearAllConfirm(6, 'docs/auth.md')).toBe(
      'Remove all 6 comments from docs/auth.md? The document itself is not changed.',
    );
  });

  it('gets the singular right in every message', () => {
    expect(clearAddressedConfirm(1)).toContain('1 addressed comment?');
    expect(clearAllConfirm(1, 'a.md')).toContain('all 1 comment from');
    expect(clearedMessage(1, 'comment', 'a.md.json.bak')).toContain('Removed 1 comment.');
  });

  it('names the backup, so the action is visibly recoverable', () => {
    expect(clearedMessage(4, 'addressed comment', 'docs__auth.md.json.bak')).toBe(
      'Removed 4 addressed comments. A backup was saved as docs__auth.md.json.bak.',
    );
  });

  it('says nothing was removed when the backup failed', () => {
    // Reporting a success that did not happen is the one outcome that loses trust outright.
    expect(backupFailedMessage()).toBe(
      'Markdown Review could not write a backup, so nothing was removed.',
    );
  });

  it('distinguishes "no addressed comments" from "no comments"', () => {
    expect(nothingToClearMessage('addressed', 'a.md')).toBe('No addressed comments on a.md.');
    expect(nothingToClearMessage('any', 'a.md')).toBe('No comments on a.md.');
  });
});
