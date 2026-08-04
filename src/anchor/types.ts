/**
 * The data model, transcribed from PRD §4, plus the result types the anchoring modules return.
 * This file is the single in-code home of these shapes — no other module redeclares them.
 *
 * **All line numbers in this codebase are 0-based**, matching markdown-it's `token.map`, the
 * `data-line` attributes the webview emits, and VS Code's `Position.line`. There is no 1-based
 * line number anywhere; if you find yourself adding one, convert at the display boundary only.
 */

// ---------------------------------------------------------------------------
// Sidecar model (PRD §4)
// ---------------------------------------------------------------------------

export type CommentStatus = 'open' | 'addressed' | 'orphaned' | 'resolved';

export interface ReviewFile {
  version: 1;
  /** workspace-relative, forward slashes */
  targetPath: string;
  comments: Comment[];
  /** Rendered plain text at the moment the prompt was last copied. Diff baseline. */
  baselineText?: string;
  /** ISO timestamp */
  baselineAt?: string;
}

export interface Comment {
  /** nanoid, 8 chars */
  id: string;
  body: string;
  /** from config, defaults to os.userInfo().username */
  author: string;
  /** ISO */
  createdAt: string;
  status: CommentStatus;
  anchor: Anchor;
  /** Set when status flips to 'addressed'. Shown as before/after in the UI. */
  resolution?: {
    previousText: string;
    currentText: string;
    detectedAt: string;
  };
}

export interface Anchor {
  /**
   * The selected text, normalized — and the per-comment change-detection baseline: `reanchor`
   * compares the currently located text against this value to infer `addressed`. Never mutated
   * after creation.
   */
  exact: string;
  /** up to 32 chars of normalized text before */
  prefix: string;
  /** up to 32 chars of normalized text after */
  suffix: string;
  /** source line from nearest [data-line] ancestor */
  hintLine: number;
  /** char offset into the normalized plain text at creation */
  hintOffset: number;
}

// ---------------------------------------------------------------------------
// Anchor space (Plan 01 §3 — the plaintext contract)
// ---------------------------------------------------------------------------

export type BlockKind = 'text' | 'code' | 'heading';

export interface BlockSpan {
  /** inclusive start offset into `PlainTextDoc.text` */
  start: number;
  /** exclusive end offset into `PlainTextDoc.text` */
  end: number;
  /** 0-based source line range from token.map, with front-matter lines already added back */
  sourceLineStart: number;
  sourceLineEnd: number;
  kind: BlockKind;
  /** heading level when kind === 'heading' (for PRD §7 "On the section" phrasing) */
  headingLevel?: number;
}

export interface PlainTextDoc {
  text: string;
  /**
   * Non-empty, ascending, non-overlapping spans. Offsets that fall between two spans are the `\n`
   * joiners. This invariant is what makes the binary search in `offsetToSourceLine` valid.
   */
  blocks: BlockSpan[];
  /** lines consumed by stripped front matter; already folded into every sourceLine* above */
  frontMatterLineOffset: number;
}

// ---------------------------------------------------------------------------
// Module results
// ---------------------------------------------------------------------------

export type CreateResult =
  | { ok: true; anchor: Anchor }
  | { ok: false; reason: 'too-short' | 'too-long' };

export interface Located {
  start: number;
  /** exclusive */
  end: number;
  /** one of the CONFIDENCE values below */
  confidence: number;
}

export interface ReanchorResult {
  reviewFile: ReviewFile;
  /**
   * True when any status or `resolution` changed — Phase 4 uses it to skip no-op sidecar writes.
   *
   * Deliberately **not** set by hint drift. `hintOffset`/`hintLine` are refreshed in memory on
   * every pass, but they are advisory (a stale hint costs at most a confidence-tier demotion) and
   * the in-memory `ReviewFile` every panel reads already carries the fresh values. Letting hints
   * set `changed` would turn every keystroke inside the document into a disk write.
   */
  changed: boolean;
}

// ---------------------------------------------------------------------------
// Constants — tests assert against these symbols, not against literals
// ---------------------------------------------------------------------------

/** Minimum selectable anchor length, in UTF-16 code units (PRD §5). */
export const MIN_ANCHOR_LENGTH = 3;
/** Maximum selectable anchor length, in UTF-16 code units (PRD §5). */
export const MAX_ANCHOR_LENGTH = 500;
/** Characters of surrounding context captured on each side (PRD §4). */
export const CONTEXT_LENGTH = 32;

/** Confidence values produced by each tier of the `locate` cascade (PRD §5). */
export const CONFIDENCE = {
  /** exact match with full surrounding context */
  EXACT_WITH_CONTEXT: 1.0,
  /** exact match, unique in the document */
  EXACT_UNIQUE: 0.9,
  /** exact match, one of several, disambiguated by proximity to the hint */
  EXACT_NEAREST: 0.7,
  /** fuzzy match near the hint */
  FUZZY_NEAR_HINT: 0.5,
  /** fuzzy match anywhere in the document */
  FUZZY_DOCUMENT: 0.3,
} as const;

/** Below this, the UI must say "position uncertain" rather than show a confident anchor (PRD §5). */
export const UNCERTAIN_BELOW = 0.5;
