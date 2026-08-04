/**
 * Anchor creation (Plan 01 §4). Turns a selection in anchor space into the durable `Anchor` record
 * that `locate` will use to find the same passage in a rewritten document.
 */

import { normalizeAnchorText } from '../render/plaintext.js';
import { offsetToSourceLine } from '../render/plaintext.js';
import { clamp, safeSlice } from './text.js';
import {
  CONTEXT_LENGTH,
  MAX_ANCHOR_LENGTH,
  MIN_ANCHOR_LENGTH,
  type CreateResult,
  type PlainTextDoc,
} from './types.js';

export interface CreateAnchorInput {
  /** selection already in anchor space (normalized per Plan 01 §3) */
  selectedText: string;
  /** offset of the selection start within `doc.text`; `-1` when the caller could not map it */
  offset: number;
  doc: PlainTextDoc;
  /** fallback source line, used only when `offset` is `-1` */
  hintLine?: number;
}

/**
 * Length limits are measured in **UTF-16 code units** — the same unit as offsets, diff-match-patch's
 * `Match_MaxBits`, and `diff_levenshtein`. The PRD leaves the unit undefined; using anything else
 * (code points, graphemes) would make the limit disagree with every other quantity in the system.
 *
 * User-facing wording for a rejection lives in the extension layer (Phase 3), not here.
 */
export function createAnchor(input: CreateAnchorInput): CreateResult {
  const { doc } = input;

  // Re-normalize defensively. The caller should already have — but Phase 3's DOM walk is a second
  // implementation of the same rules, and this is cheap insurance against the two drifting apart.
  const exact = normalizeAnchorText(input.selectedText);

  if (exact.length < MIN_ANCHOR_LENGTH) return { ok: false, reason: 'too-short' };
  if (exact.length > MAX_ANCHOR_LENGTH) return { ok: false, reason: 'too-long' };

  const start = resolveOffset(input);
  // The selection *should* sit at `start`; when the caller's offset was approximate (or derived
  // from `hintLine`), fall back to the nominal length so prefix/suffix are still taken from the
  // right neighbourhood.
  const end = doc.text.startsWith(exact, start)
    ? start + exact.length
    : clamp(start + exact.length, 0, doc.text.length);

  return {
    ok: true,
    anchor: {
      exact,
      prefix: safeSlice(doc.text, start - CONTEXT_LENGTH, start),
      suffix: safeSlice(doc.text, end, end + CONTEXT_LENGTH),
      hintLine: offsetToSourceLine(doc, start),
      hintOffset: start,
    },
  };
}

/**
 * `offset === -1` is Plan 03 §2's fallback: the webview could not map the DOM selection back to an
 * offset and sent the nearest `data-line` instead. Recover a usable offset from the first block at
 * or after that line.
 */
function resolveOffset(input: CreateAnchorInput): number {
  const { doc, offset, hintLine } = input;
  if (offset >= 0) return clamp(offset, 0, doc.text.length);

  if (hintLine !== undefined) {
    for (const block of doc.blocks) {
      if (block.sourceLineStart >= hintLine) return block.start;
    }
    const last = doc.blocks[doc.blocks.length - 1];
    if (last) return last.start;
  }
  return 0;
}
