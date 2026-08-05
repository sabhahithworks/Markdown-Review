/**
 * Code-point-safe slicing.
 *
 * Anchors, context windows and fuzzy probes are all fixed-length slices of the document. A blind
 * `slice` can cut a surrogate pair in half, and a lone surrogate never matches anything — it turns
 * a perfectly good anchor into a permanent orphan. Every fixed-length cut in this package goes
 * through these helpers.
 */

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;

function isHighSurrogate(code: number | undefined): boolean {
  return code !== undefined && code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END;
}

function isLowSurrogate(code: number | undefined): boolean {
  return code !== undefined && code >= LOW_SURROGATE_START && code <= LOW_SURROGATE_END;
}

/**
 * Moves a slice *start* forward off a low surrogate, so the slice never begins with the tail half
 * of a character.
 */
export function snapStart(text: string, index: number): number {
  const i = clamp(index, 0, text.length);
  if (i <= 0 || i >= text.length) return i;
  if (isLowSurrogate(text.charCodeAt(i)) && isHighSurrogate(text.charCodeAt(i - 1))) return i + 1;
  return i;
}

/**
 * Moves a slice *end* backward off a high surrogate, so the slice never ends with the lead half of
 * a character.
 */
export function snapEnd(text: string, index: number): number {
  const i = clamp(index, 0, text.length);
  if (i <= 0 || i >= text.length) return i;
  if (isHighSurrogate(text.charCodeAt(i - 1)) && isLowSurrogate(text.charCodeAt(i))) return i - 1;
  return i;
}

/** `text.slice(start, end)` with both boundaries snapped to code-point boundaries. */
export function safeSlice(text: string, start: number, end: number): string {
  const s = snapStart(text, start);
  const e = snapEnd(text, end);
  return e > s ? text.slice(s, e) : '';
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Letters, digits and combining marks — what a slice boundary must not land inside (H8). */
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** The code point *ending* at `index` (surrogate-aware), or `undefined` at the text's edge. */
function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined;
  const back =
    isLowSurrogate(text.charCodeAt(index - 1)) && isHighSurrogate(text.charCodeAt(index - 2))
      ? index - 2
      : index - 1;
  const code = text.codePointAt(back);
  return code === undefined ? undefined : String.fromCodePoint(code);
}

/**
 * Extends a slice *end* that landed mid-word forward to the end of that word, up to `maxExtend`
 * code units (H8, Plan 04 §10 D18/D21).
 *
 * `fuzzy.ts`'s `verify` window ends at `candidate + exact.length + pad`, so when the anchored text
 * *grew*, the verified span stops short by the growth — mid-word, which on an addressed card reads
 * as corrupted text rather than as a shortened quote ("…so they do no"). The *status* is computed
 * from normalized text and is already correct; this repairs only where the span ends.
 *
 * If the word runs past `maxExtend`, the original index is returned: clipping at a different
 * arbitrary mid-word point would repair nothing.
 */
export function snapToWordEnd(text: string, index: number, maxExtend: number): number {
  const i = clamp(index, 0, text.length);
  if (i <= 0 || i >= text.length) return i;

  const before = codePointBefore(text, i);
  const atCode = text.codePointAt(i);
  const at = atCode === undefined ? undefined : String.fromCodePoint(atCode);
  // Not mid-word: either side of the boundary is already a non-word character.
  if (before === undefined || at === undefined) return i;
  if (!WORD_CHAR.test(before) || !WORD_CHAR.test(at)) return i;

  const limit = Math.min(text.length, i + maxExtend);
  let end = i;
  while (end < limit) {
    const code = text.codePointAt(end);
    if (code === undefined) break;
    const char = String.fromCodePoint(code);
    if (!WORD_CHAR.test(char)) return end;
    end += char.length;
  }
  return end >= text.length ? end : i;
}

/** PRD §7: quoted anchor text longer than this is truncated with a middle ellipsis. */
export const MAX_QUOTE_LENGTH = 100;

/** Space, U+2026, space — the separator PRD §7 specifies for a truncated quote. */
const QUOTE_ELLIPSIS = ' … ';

/**
 * Shortens a quotation to at most `max` characters, keeping both ends (PRD §7).
 *
 * The head and tail are what make a quote recognisable — a plain tail-truncation loses the end of
 * the sentence the comment is actually about — so the cut is taken out of the middle. It lives here
 * rather than in `prompt/` because the webview needs the identical helper for the before/after on an
 * addressed card, and `media/` may only import from `panel/messages.ts`, which re-exports it.
 *
 * Cuts go through `safeSlice`, so a surrogate pair is never split. That can shrink a side by one,
 * which is why the result is *at most* `max` rather than exactly `max` — assert `<=`, never `===`.
 */
export function truncateQuote(text: string, max = MAX_QUOTE_LENGTH): string {
  if (text.length <= max) return text;

  // Both sides plus the separator must fit. A `max` too small to hold anything either side would
  // otherwise produce a bare ellipsis, which says less than a hard truncation would.
  const side = Math.floor((max - QUOTE_ELLIPSIS.length) / 2);
  if (side <= 0) return safeSlice(text, 0, max);

  return (
    safeSlice(text, 0, side) + QUOTE_ELLIPSIS + safeSlice(text, text.length - side, text.length)
  );
}
