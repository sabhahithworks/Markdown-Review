/**
 * Splits the free-prose notes an agent wrote into per-comment chunks and unattached chunks
 * (release-expansion D33, D34).
 *
 * Pure and `vscode`-free (enforced by `eslint.config.mjs`). It reads no file and knows nothing of
 * the store: the caller passes the notes text and how many comments the last prompt listed.
 */

/** Notes longer than this are cut here and the result reports `cut: true` (D34). */
export const NOTES_MAX_CHARS = 16_000;

/** What `joinChunks` puts between chunks and `splitChunks` splits on. */
export const NOTE_CHUNK_SEPARATOR = '\n\n';

export interface SplitAgentNotes {
  /** Comment number (1-based, as printed in the prompt) to the chunks that name it, in order. */
  byNumber: Map<number, string[]>;
  /** Chunks that name no number in range, in their original order. */
  unattached: string[];
  /** True when the input was longer than `NOTES_MAX_CHARS` and was cut. */
  cut: boolean;
}

const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;
const NUMBER_PATTERNS: readonly RegExp[] = [
  /#(\d{1,3})\b/gi,
  /\bcomments?\s+#?(\d{1,3})\b/gi,
  /\bitems?\s+#?(\d{1,3})\b/gi,
  /^[ \t]*(\d{1,3})[.)][ \t]/g,
];

export function joinChunks(chunks: readonly string[]): string {
  return chunks.join(NOTE_CHUNK_SEPARATOR);
}

/** The inverse of `joinChunks`; empty chunks are dropped. */
export function splitChunks(text: string): string[] {
  return text.split(NOTE_CHUNK_SEPARATOR).filter((chunk) => chunk.length > 0);
}

function normalize(raw: string): string {
  return raw.normalize('NFC').replace(/\r\n/g, '\n');
}

function chunkOf(text: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const chunk = current.join('\n').trim();
    if (chunk.length > 0) chunks.push(chunk);
    current = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    if (LIST_ITEM.test(line)) flush();
    current.push(line);
  }
  flush();
  return chunks;
}

function numbersIn(chunk: string): number[] {
  const found = new Set<number>();
  for (const pattern of NUMBER_PATTERNS) {
    for (const match of chunk.matchAll(pattern)) {
      found.add(Number.parseInt(match[1] ?? '', 10));
    }
  }
  return [...found];
}

export function splitAgentNotes(raw: string, promptCount: number): SplitAgentNotes {
  let text = normalize(raw);
  const cut = text.length > NOTES_MAX_CHARS;
  if (cut) {
    text = text.slice(0, NOTES_MAX_CHARS);
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1);
  }

  const byNumber = new Map<number, string[]>();
  const unattached: string[] = [];
  for (const chunk of chunkOf(text)) {
    const attaching = numbersIn(chunk).filter(
      (n) => Number.isInteger(n) && Number.isInteger(promptCount) && n >= 1 && n <= promptCount,
    );
    if (attaching.length === 0) {
      unattached.push(chunk);
      continue;
    }
    for (const n of attaching) {
      const list = byNumber.get(n);
      if (list) list.push(chunk);
      else byNumber.set(n, [chunk]);
    }
  }
  return { byNumber, unattached, cut };
}
