/**
 * Specified user-facing wording (Plan 03 §4).
 *
 * Plan 03 §8 lists "selections < 3 or > 500 chars rejected with the exact messages in §4" as an
 * acceptance item, which as written means someone reading a notification in a dev host. The strings
 * are specified, so they are testable; this file is what turns that checklist row into a test.
 */

import { describe, expect, it } from 'vitest';
import { MAX_ANCHOR_LENGTH, MIN_ANCHOR_LENGTH } from '../anchor/types.js';
import { anchorRejectionMessage } from '../panel/notices.js';

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
