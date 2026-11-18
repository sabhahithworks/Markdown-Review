/**
 * "The document was rewritten" (PRD §11).
 *
 * When an agent replaces a document wholesale, every anchor vanishes at once and the pane fills with
 * orphans. Individually each one is a triage task; together they are a different situation, and the
 * useful response is not to re-anchor thirty comments by hand but to look at what changed.
 *
 * Pure and `vscode`-free so the trigger rule is a unit test rather than something only reproducible
 * by wrecking a file in a dev host.
 */

import { isDocumentComment } from '../anchor/types.js';
import type { CommentStatus, ReviewFile } from '../anchor/types.js';

export interface RewriteVerdict {
  rewritten: boolean;
  /** How many previously-located comments were lost. Zero unless `rewritten`. */
  orphaned: number;
}

/**
 * Below this, "every open comment orphaned" is just "a comment orphaned".
 *
 * A banner announcing a rewrite because one sentence was deleted is a false alarm, and a banner the
 * user learns to dismiss is worthless on the one occasion it matters. The orphan section already
 * handles the ordinary case perfectly well.
 */
export const MIN_REWRITE_COMMENTS = 2;

const LOCATED: readonly CommentStatus[] = ['open', 'addressed'];

/**
 * Compares the store's state either side of a single re-anchor pass.
 *
 * Deliberately a *transition*, not a condition: it answers "did this pass destroy everything?",
 * which can only be asked once. Re-deriving it from the current state alone would make an
 * already-wrecked document report a rewrite on every later keystroke.
 */
export function detectRewrite(before: ReviewFile, after: ReviewFile): RewriteVerdict {
  const none: RewriteVerdict = { rewritten: false, orphaned: 0 };

  // No baseline means the "review the diff" action has nothing to show, and a banner whose only
  // action is a dead end is worse than no banner.
  if (typeof after.baselineText !== 'string' || after.baselineText.length === 0) return none;

  // Only comments that *were* located can be lost. Excluding the already-orphaned is what stops an
  // untouched document from re-arming the banner forever; `resolved` is terminal (PRD §4).
  const candidates = before.comments.filter(
    (comment) => !isDocumentComment(comment) && LOCATED.includes(comment.status),
  );
  if (candidates.length < MIN_REWRITE_COMMENTS) return none;

  const status = new Map(after.comments.map((comment) => [comment.id, comment.status]));
  const allLost = candidates.every((comment) => status.get(comment.id) === 'orphaned');

  return allLost ? { rewritten: true, orphaned: candidates.length } : none;
}
