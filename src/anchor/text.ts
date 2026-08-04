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
