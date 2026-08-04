/**
 * Front-matter splitting (Plan 01 §3 rule 1).
 *
 * Two consumers: `plaintext.ts` (which excludes front matter from anchor space but must keep
 * source line numbers aligned to the real file) and Phase 2's renderer (which shows it as a
 * collapsed block). One implementation so the two can never disagree about where the body starts.
 */

const BOM = '﻿';

export interface FrontMatterSplit {
  /** the document with front matter (and any BOM) removed */
  body: string;
  /** number of lines the front matter occupied; add to every source line number derived from body */
  lineOffset: number;
  /** the raw front-matter text between the delimiters, or undefined when there is none */
  frontMatter?: string;
}

/** Strips a leading byte-order mark. Windows editors emit them and they defeat `startsWith('---')`. */
export function stripBom(source: string): string {
  return source.startsWith(BOM) ? source.slice(1) : source;
}

/**
 * Splits leading YAML front matter off a markdown document.
 *
 * Requires a closing `---` line. **When there is no closing delimiter, nothing is stripped** — the
 * literal reading of "strip through the closing `---`" would turn any document that opens with a
 * horizontal rule into an empty review pane, which is total data loss and violates the fail-soft
 * principle (PRD §11). `...` as a YAML document terminator is deliberately unsupported: it is rare
 * in front matter and supporting it widens the blast radius of the same failure.
 *
 * Slicing is by character index into the original string, never by re-joining split lines, so CRLF
 * documents survive byte-for-byte.
 */
export function splitFrontMatter(source: string): FrontMatterSplit {
  const text = stripBom(source);

  const opening = /^---[ \t]*(\r\n|\r|\n)/.exec(text);
  if (!opening) {
    return { body: text, lineOffset: 0 };
  }

  const openingLength = opening[0].length;
  let cursor = openingLength;
  // Line 0 is the opening delimiter; scan from line 1 for the closer.
  let lineCount = 1;

  while (cursor < text.length) {
    const lineEnd = findLineEnd(text, cursor);
    const line = text.slice(cursor, lineEnd.contentEnd);
    lineCount += 1;

    if (/^---[ \t]*$/.test(line)) {
      return {
        body: text.slice(lineEnd.nextLineStart),
        lineOffset: lineCount,
        frontMatter: text.slice(openingLength, cursor),
      };
    }

    if (lineEnd.nextLineStart === cursor) break; // defensive: no forward progress
    cursor = lineEnd.nextLineStart;
  }

  // Unterminated front matter — leave the document intact.
  return { body: text, lineOffset: 0 };
}

function findLineEnd(text: string, from: number): { contentEnd: number; nextLineStart: number } {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') return { contentEnd: i, nextLineStart: i + 1 };
    if (ch === '\r') {
      const isCrlf = text[i + 1] === '\n';
      return { contentEnd: i, nextLineStart: isCrlf ? i + 2 : i + 1 };
    }
  }
  return { contentEnd: text.length, nextLineStart: text.length };
}
