/**
 * Anchor creation (Plan 01 §4). Turns a selection in anchor space into the durable `Anchor` record
 * that `locate` will use to find the same passage in a rewritten document.
 */

import { blockAt, normalizeAnchorText, offsetToSourceLine } from '../render/plaintext.js';
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

  const exact = normalizeSelection(input);

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
 * Normalizes the selection **the way anchor space does** — which is not the same rule everywhere.
 *
 * `walkSpans` collapses whitespace in every block *except* code, where content is preserved verbatim
 * (PRD §5). Applying `normalizeAnchorText` unconditionally therefore produced an `exact` that could
 * not appear in `doc.text` at all: every newline and every run of indentation in a fence had been
 * flattened to a single space. Tiers 1 and 2 could never match it, so a comment on a code block sat
 * permanently at fuzzy confidence — and, worse, the fuzzy span came up a few characters short of the
 * block, so `reanchor` compared it against `anchor.exact`, found a difference, and flipped the
 * comment to `addressed` on a document nobody had edited. A false `addressed` is the most expensive
 * bug this design can have; the status is the one thing the user is asked to trust.
 *
 * The webview was already right: `anchorSpace.ts::buildBlockMap` keys off `isCodeBlock(el)` and
 * sends code verbatim. The "defensive re-normalize" here — insurance against the two implementations
 * drifting apart — was itself the drift, destroying a correct value on the way in.
 *
 * The block is chosen by the selection's *start*. A selection running out of a fence and into the
 * prose below spans two normalization regimes and can be faithful to neither, so it takes the
 * collapsing path, which is what every non-code selection wants.
 */
function normalizeSelection(input: CreateAnchorInput): string {
  const verbatim = input.selectedText.normalize('NFC');
  if (input.offset < 0) return normalizeAnchorText(input.selectedText);

  const block = blockAt(input.doc, input.offset);
  if (block?.kind !== 'code') return normalizeAnchorText(input.selectedText);

  // Only when the whole selection stays inside the one code block.
  return input.offset + verbatim.length <= block.end ? verbatim : normalizeAnchorText(verbatim);
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
