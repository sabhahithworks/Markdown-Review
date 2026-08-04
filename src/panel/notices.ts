/**
 * User-facing wording for panel-level failures.
 *
 * `createAnchor` returns a reason code and deliberately leaves the phrasing to the extension layer
 * (see the note in `anchor/create.ts`). That layer is `ReviewPanel`, which imports `vscode` and so
 * cannot be unit-tested — which is the whole reason these strings live in their own `vscode`-free
 * module: the exact wording is specified in Plan 03 §4, and a specified string deserves a test
 * rather than an acceptance-checklist eyeball.
 *
 * The limits are interpolated rather than spelled out so the message cannot drift from the
 * constants `createAnchor` actually enforces.
 */

import type { CreateResult } from '../anchor/types.js';
import { MAX_ANCHOR_LENGTH, MIN_ANCHOR_LENGTH } from '../anchor/types.js';

type Rejection = Extract<CreateResult, { ok: false }>['reason'];

export function anchorRejectionMessage(reason: Rejection): string {
  return reason === 'too-short'
    ? `Select at least ${String(MIN_ANCHOR_LENGTH)} characters`
    : `Selection too long to anchor — select under ${String(MAX_ANCHOR_LENGTH)} characters`;
}
