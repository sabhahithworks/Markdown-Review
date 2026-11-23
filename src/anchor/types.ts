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
  /** Ids of the comments in the last copied prompt, in prompt order; a comment's number is its index + 1. */
  promptOrder?: string[];
  /**
   * What the agent wrote to the notes file, as last read (release-expansion D47). Held on the host;
   * the webview gets only `unattached`, `cut` and `receivedAt`.
   */
  agentNotes?: {
    /** The notes file's text as last ingested; a read equal to it is a no-op. Cleared when a round ends. */
    raw: string;
    /** The part of `unattached` that came from earlier rounds and was not dismissed. */
    carried: string;
    /** The text shown under "Notes from the agent": `carried` followed by this round's unattached chunks. */
    unattached: string;
    /** True when `raw` was cut at the length limit. */
    cut: boolean;
    /** ISO timestamp of the read that last changed these notes. */
    receivedAt: string;
    /** Exact text of the chunks the user dismissed this round; filtered out of later reads. Cleared when a round ends. */
    dismissed: string[];
  };
}

/** A note the agent wrote about one comment (release-expansion D33). */
export interface AgentNote {
  text: string;
  /** ISO timestamp */
  receivedAt: string;
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
  /** Absent on a whole-document comment (release-expansion D26). */
  anchor?: Anchor;
  /** Set when status flips to 'addressed'. Shown as before/after in the UI. */
  resolution?: {
    previousText: string;
    currentText: string;
    detectedAt: string;
  };
  /** The agent's note about this comment, from the notes file. */
  agentNote?: AgentNote;
}

/** True for a whole-document comment, which carries no anchor (release-expansion D26). */
export function isDocumentComment(comment: Pick<Comment, 'anchor'>): boolean {
  return comment.anchor === undefined;
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

/**
 * A run of whole blocks, in anchor space, that differs from the review baseline (D28).
 *
 * Always block-aligned — `start` is a block's `start`, `end` a block's `end` — and adjacent changed
 * blocks arrive merged into one span, joiners included. Computed host-side from `doc.blocks`, so the
 * webview only intersects these with `data-ap-start`/`data-ap-end` and never derives a boundary.
 */
export interface ChangeSpan {
  start: number;
  /** exclusive */
  end: number;
}

/**
 * What the change view can say about the document since the prompt was copied (D28).
 *
 * `no-baseline` and `too-large` are "no answer", not "no changes": only `unchanged` is a claim that
 * nothing moved. `changed` carries the spans to mark, which may be empty when every block that
 * changed has since been removed.
 */
export type ChangeState =
  | { state: 'no-baseline' }
  | { state: 'unchanged' }
  | { state: 'changed'; blocks: ChangeSpan[] }
  | { state: 'too-large' };

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
