/**
 * Fuzzy anchor relocation — tiers 3 and 4 of the `locate` cascade (PRD §5).
 *
 * Split out of `locate.ts` because the two production landmines below are only testable against
 * hand-written plain strings: no markdown, no tokens, no fixtures. Everything here operates on a
 * bare `string`.
 *
 * **Landmine 1 — pattern length.** diff-match-patch's bitap implementation throws
 * `"Pattern too long for this browser."` when the pattern exceeds `Match_MaxBits` (32), and anchors
 * are allowed up to 500 characters. Long anchors are searched via three fixed 32-character probes
 * instead (see `buildProbes`).
 *
 * **Landmine 2 — tier-4 cost.** Tier 4 must widen `Match_Distance` to the document length or it can
 * only see the first ~300 characters (PRD §5 explains the scoring arithmetic). That makes the bitap
 * scan proportional to the document, which blows the 5 MB / 50 comments / 500 ms budget by roughly
 * three orders of magnitude. `MAX_BITAP_SCAN_CHARS` below is the deterministic guard.
 */

import DiffMatchPatch from 'diff-match-patch';
import { clamp, safeSlice, snapEnd, snapStart } from './text.js';

/** diff-match-patch's bitap pattern limit. Exactly 32 is accepted; 33 throws. */
export const MATCH_MAX_BITS = 32;

/**
 * Above this document size, a document-wide bitap search is replaced by literal probe scanning.
 *
 * The honest, testable consequence: past half a megabyte, tier 4 requires at least one
 * 32-character run of the anchor to have survived verbatim. An anchor that both moved far *and*
 * was reworded throughout will orphan. That is defensible — PRD §4 treats `orphaned` as a normal
 * state needing triage, and PRD §11 says documents over 2 MB do not render interactively anyway.
 *
 * A wall-clock budget would have been the obvious alternative and is the wrong choice: it makes
 * the outcome depend on machine load, which is exactly the flakiness the performance test exists
 * to avoid.
 */
export const MAX_BITAP_SCAN_CHARS = 512 * 1024;

/** Occurrences examined per probe in the literal-scan path. */
const MAX_LITERAL_OCCURRENCES = 8;

export interface FuzzyOptions {
  /** where the anchor is expected to be */
  loc: number;
  /** maximum normalized edit distance to accept, in [0, 1] */
  threshold: number;
  /** diff-match-patch `Match_Distance`: how fast the score decays with distance from `loc` */
  matchDistance: number;
}

export interface FuzzyMatch {
  start: number;
  /** exclusive */
  end: number;
  /** normalized edit distance of the accepted match, in [0, threshold] */
  score: number;
}

interface Probe {
  text: string;
  /** offset of this probe within `exact` */
  offset: number;
}

/**
 * Finds `exact` in `text`, tolerating edits. Returns the located range, or `null` when nothing
 * scores within `threshold`.
 *
 * Deliberately **not** implemented with an n-gram index: building one costs a linear pass plus
 * memory on every `reanchor`, and `reanchor` runs on a 400 ms debounce during active editing. If
 * Phase 4 profiling ever shows the literal-scan path is the bottleneck on real documents, an index
 * built once per `PlainTextDoc` and cached alongside it is the escape hatch.
 */
export function fuzzyFind(text: string, exact: string, opts: FuzzyOptions): FuzzyMatch | null {
  if (exact.length === 0 || text.length === 0) return null;

  const dmp = new DiffMatchPatch();
  return fuzzyFindWith(dmp, text, exact, opts);
}

/** As `fuzzyFind`, but reusing a caller-owned engine. `reanchor` builds one for all 50 comments. */
export function fuzzyFindWith(
  dmp: DiffMatchPatch,
  text: string,
  exact: string,
  opts: FuzzyOptions,
): FuzzyMatch | null {
  if (exact.length === 0 || text.length === 0) return null;

  const probes = buildProbes(exact);
  const loc = clamp(opts.loc, 0, text.length);

  // A tier-4 style search asks for a scan proportional to the document; tier 3 keeps
  // `matchDistance` at 1000, which bounds its scan to a few hundred characters either side of the
  // hint and is always cheap.
  const documentWideScan = opts.matchDistance >= text.length;
  const candidates =
    documentWideScan && text.length > MAX_BITAP_SCAN_CHARS
      ? literalCandidates(text, probes)
      : bitapCandidates(dmp, text, probes, loc, opts);

  if (candidates.length === 0) return null;

  // Verification, not the candidate search, is what determines `start` and `end`: `match_main`
  // returns a start offset only, and the true matched length differs from `exact.length` whenever
  // the edit was an insertion or a deletion.
  //
  // Each candidate is verified against two windows, and the better score wins:
  //
  //  - **unpadded** — exactly `exact.length` characters from the candidate. This is the natural
  //    hypothesis and carries no padding noise, which matters more than it sounds: `diff_main`
  //    computes a *global* alignment, so when the anchor's own head or tail was the part that got
  //    edited it does not emit the window padding as a clean leading/trailing insertion run.
  //    Instead it scatters those characters through the alignment, where they count as damage and
  //    can push a perfectly locatable anchor past the threshold.
  //  - **padded** — the only way to discover the true boundaries when the edit inserted or deleted
  //    characters, which changes the matched length.
  const pad = Math.min(MATCH_MAX_BITS, Math.ceil(exact.length * 0.25));
  let best: FuzzyMatch | null = null;

  for (const candidate of candidates) {
    for (const windowPad of [0, pad]) {
      const match = verify(dmp, text, exact, candidate, windowPad);
      if (!match || match.score > opts.threshold) continue;
      if (best === null || isBetter(match, best, loc)) best = match;
    }
  }

  return best;
}

/**
 * Three fixed probes for a long anchor: head, middle, tail.
 *
 * A single first-32-characters probe fails on the most common real edit there is — a reworded
 * sentence *opening*, which destroys exactly those characters. Three fixed probes are a strict
 * superset at a cost of at most three bitap runs. They are fixed rather than "the most distinctive
 * substring" on purpose: a data-dependent probe moves when a fixture changes, so tests can no
 * longer target a specific one.
 */
export function buildProbes(exact: string): Probe[] {
  if (exact.length <= MATCH_MAX_BITS) return [{ text: exact, offset: 0 }];

  const half = MATCH_MAX_BITS / 2;
  const mid = Math.floor(exact.length / 2);
  const raw: Array<[number, number]> = [
    [0, MATCH_MAX_BITS],
    [mid - half, mid + half],
    [exact.length - MATCH_MAX_BITS, exact.length],
  ];

  const probes: Probe[] = [];
  const seen = new Set<string>();
  for (const [from, to] of raw) {
    const offset = snapStart(exact, from);
    const text = safeSlice(exact, from, to);
    if (text.length === 0) continue;
    const key = `${String(offset)}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    probes.push({ text, offset });
  }
  return probes;
}

function bitapCandidates(
  dmp: DiffMatchPatch,
  text: string,
  probes: readonly Probe[],
  loc: number,
  opts: FuzzyOptions,
): number[] {
  dmp.Match_Threshold = opts.threshold;
  dmp.Match_Distance = opts.matchDistance;

  const starts = new Set<number>();
  for (const probe of probes) {
    const at = dmp.match_main(text, probe.text, clamp(loc + probe.offset, 0, text.length));
    if (at !== -1) starts.add(clamp(at - probe.offset, 0, text.length));
  }
  return [...starts];
}

/**
 * The large-document fallback: `indexOf` is native and memory-bandwidth-bound, where a
 * document-wide bitap scan is not.
 */
function literalCandidates(text: string, probes: readonly Probe[]): number[] {
  const starts = new Set<number>();
  for (const probe of probes) {
    let from = 0;
    for (let n = 0; n < MAX_LITERAL_OCCURRENCES; n++) {
      const at = text.indexOf(probe.text, from);
      if (at === -1) break;
      starts.add(clamp(at - probe.offset, 0, text.length));
      from = at + 1;
    }
  }
  return [...starts];
}

/**
 * Aligns `exact` against a padded window around `candidate` and reads the true match boundaries
 * off the alignment.
 *
 * `diff_cleanupSemantic` is deliberately **not** called: it rewrites operation boundaries to be
 * more readable to humans, which moves exactly the trim points this function depends on.
 */
function verify(
  dmp: DiffMatchPatch,
  text: string,
  exact: string,
  candidate: number,
  pad: number,
): FuzzyMatch | null {
  const windowStart = snapStart(text, Math.max(0, candidate - pad));
  const windowEnd = snapEnd(text, Math.min(text.length, candidate + exact.length + pad));
  if (windowEnd <= windowStart) return null;

  const window = text.slice(windowStart, windowEnd);

  // A timed-out diff is a coarser (larger) diff, which can only raise the score and so can only
  // make us more conservative. It is a safety valve, not a correctness risk.
  const previousTimeout = dmp.Diff_Timeout;
  dmp.Diff_Timeout = 0.1;
  let diffs: Array<[number, string]>;
  try {
    diffs = dmp.diff_main(exact, window, false);
  } finally {
    dmp.Diff_Timeout = previousTimeout;
  }

  // Leading and trailing insertions are window padding, not anchor text.
  let head = 0;
  let leading = 0;
  while (head < diffs.length && diffs[head]?.[0] === DiffMatchPatch.DIFF_INSERT) {
    leading += diffs[head]?.[1].length ?? 0;
    head += 1;
  }
  let tail = diffs.length - 1;
  let trailing = 0;
  while (tail >= head && diffs[tail]?.[0] === DiffMatchPatch.DIFF_INSERT) {
    trailing += diffs[tail]?.[1].length ?? 0;
    tail -= 1;
  }

  const trimmed = diffs.slice(head, tail + 1);
  if (trimmed.length === 0) return null;

  const start = windowStart + leading;
  const end = windowEnd - trailing;
  if (end <= start) return null;

  return { start, end, score: dmp.diff_levenshtein(trimmed) / exact.length };
}

/** Lower score wins; ties break to the candidate nearer `loc`, then to the earlier offset. */
function isBetter(candidate: FuzzyMatch, incumbent: FuzzyMatch, loc: number): boolean {
  if (candidate.score !== incumbent.score) return candidate.score < incumbent.score;

  const candidateDistance = Math.abs(candidate.start - loc);
  const incumbentDistance = Math.abs(incumbent.start - loc);
  if (candidateDistance !== incumbentDistance) return candidateDistance < incumbentDistance;

  return candidate.start < incumbent.start;
}
