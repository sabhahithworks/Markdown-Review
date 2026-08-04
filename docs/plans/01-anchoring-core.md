# Phase 1 — Anchoring Core

**Delivers:** the repo toolchain and the pure-logic heart of the extension — plain-text rendering
with an offset map, and anchor create/locate/reanchor — with the full PRD §5 test matrix passing.
**No VS Code imports anywhere in this phase.** Everything here must run under plain Node + vitest.

Spec references: PRD §4 (data model), §5 (anchoring), §10 Phase 1.

## 1. Prerequisites

None — this is the first phase. The repo contains only the PRD, `CLAUDE.md`, and `docs/`.

## 2. Toolchain scaffold

Set up once, here, so later phases only add to it:

- `package.json` — name `markdown-review`, `private` until Phase 5 fills the manifest. Scripts:
  - `test` → `vitest run`
  - `test:watch` → `vitest`
  - `typecheck` → `tsc --noEmit`
  - `lint` → `eslint .`
  - `build` → placeholder `tsc --noEmit` for now (Phase 2 replaces with esbuild)
  - `check` → typecheck + lint + test. This is the single command the plans README's
    definition-of-done maps to; CI and humans run one thing.
- Runtime deps this phase: `markdown-it`, `markdown-it-task-lists`, `diff-match-patch`.
  Dev deps: `typescript`, `vitest`, `@types/diff-match-patch`, `@types/node`, `eslint`,
  `typescript-eslint`, `@eslint/js`.
  - **No `@types/markdown-it`.** markdown-it 15 ships its own declarations
    (`dist/markdown-it.d.cts`); the DefinitelyTyped package is pinned to the 14.x API and would
    shadow them.
  - **Pin `typescript` to `~5.9`**, not latest — `typescript-eslint@8` declares a `<6.1.0` peer.
  - `markdown-it-task-lists` has no `@types` package; add an ambient declaration at
    `src/types/markdown-it-task-lists.d.ts`.
- `tsconfig.json`: `strict: true`, `module: node16`, `target: es2022`, `lib: ["es2022"]` — **no
  `dom` lib**; if a module in this phase needs DOM types, the design is wrong (webview-space
  concerns belong to Phases 2–3). Add `noUncheckedIndexedAccess: true`: this phase is dominated by
  `tokens[i]` / `blocks[mid]` indexing and manual binary searches, which is exactly where an
  out-of-range index is a real bug. Prefer small typed accessors over `!`, which the
  definition-of-done counts as a suppression. Leave `exactOptionalPropertyTypes` off — the optional
  fields all cross a JSON boundary where absent and `undefined` are the same thing.
- `eslint.config.mjs` — flat config, non-type-checked for speed: `@eslint/js` recommended +
  `typescript-eslint` recommended, plus `no-explicit-any`, `consistent-type-imports`, `eqeqeq`,
  `no-console`. The load-bearing rule is a `no-restricted-imports` block scoped to `src/anchor/**`,
  `src/render/**`, `src/prompt/**` banning `vscode` — it turns §8's manual `grep` into something
  enforced forever, which matters most in Phases 2–4 when `vscode` *is* on the import path next
  door.
- `vitest.config.ts` — `environment: 'node'`; the performance test in §7 is a plain test with a
  time assertion, not vitest bench, so CI pass/fail is deterministic. Set `fileParallelism: false`
  (the single biggest lever against perf-test flakiness) and a generous `hookTimeout` for the 5 MB
  fixture build.

Create `src/anchor/types.ts` now: transcribe `Anchor`, `Comment`, `ReviewFile` from PRD §4
verbatim, plus the result types defined below. This file is the single in-code home of the data
model; no other module redeclares these shapes.

## 3. `src/render/plaintext.ts` — normalization spec (contract owner)

This module defines **anchor space**. Every other component that touches anchors — the webview's
selection capture (Phase 3), locate, reanchor, baseline diffing (Phase 4) — must produce or consume
text that follows exactly these rules. This section is the normative spec.

### API

```ts
interface BlockSpan {
  /** inclusive start / exclusive end offsets into `text` */
  start: number;
  end: number;
  /** 0-based source line range from token.map */
  sourceLineStart: number;
  sourceLineEnd: number;
  kind: 'text' | 'code' | 'heading';
  /** heading level when kind === 'heading' (for PRD §7 "On the section" phrasing) */
  headingLevel?: number;
}

interface PlainTextDoc {
  text: string;
  blocks: BlockSpan[];
  /** lines consumed by stripped front matter; already folded into every sourceLine* above */
  frontMatterLineOffset: number;
}

function renderPlainText(markdown: string): PlainTextDoc;
function offsetToSourceLine(doc: PlainTextDoc, offset: number): number; // binary search over blocks
```

### Normalization rules (normative)

1. **Front matter** — if the document starts with `---\n`, strip everything through the closing
   `---` line *before* tokenizing. Front matter contributes nothing to `text`; source line numbers
   in `blocks` still count the stripped lines so `data-line` stays consistent with the real file.
   Lives in `src/render/frontMatter.ts` (`splitFrontMatter`), because Plan 02 §4 needs the same
   split for the collapsed front-matter block — one implementation, two consumers. Strip a leading
   BOM first (Windows editors emit them and they defeat a naive `startsWith('---')`). **When there
   is no closing delimiter, do not strip**: the literal reading of this rule turns any document
   opening with a horizontal rule into an empty review pane, which is total data loss and violates
   the fail-soft principle. `...` as a YAML closer is deliberately unsupported.
2. **Tokenize** with the exact markdown-it configuration owned by Plan 02 §4. Phase 1 places that
   configuration in `src/render/markdownIt.ts` (a factory returning a configured instance) so
   Phase 2 reuses it rather than redefining it — one config, two consumers.
3. **Unicode**: apply `String.prototype.normalize('NFC')` to the whole input before tokenizing.
   Combining-character equivalence is handled here, once.
4. **Text blocks** (paragraphs, headings, list items, blockquote paragraphs, table cells): take the
   inline token's plain content — concatenated `text` children, `code_inline` content verbatim,
   link children's *text* (URLs are dropped; `[text](url)` contributes `text`), image alt text.
   Then collapse every run of whitespace (space, tab, newline, NBSP) to a single space and trim.
   Each table **cell** is its own block, joined into the row with a single space; each row is one
   line of `text`.
5. **Fenced/indented code blocks**: content **verbatim** — internal newlines and indentation
   preserved, only a single trailing newline trimmed. `kind: 'code'`.
6. **Blocks are joined with `"\n"`.** No trailing newline on `text`.
7. Empty document, or document that is only front matter → `{ text: '', blocks: [] }`.

The webview's selection-to-string logic (Phase 3) mirrors rule 4 and 6: DOM block boundaries become
`\n`, intra-block whitespace collapses. State that requirement here so Phase 3 links to it instead
of re-deriving it.

**Whitespace collapse is exactly `s.replace(/\s+/g, ' ').trim()` and nothing more.** JS `\s`
already covers NBSP, U+2000–200A, ideographic space and ZWNBSP. Critically it does *not* match
ZWSP/ZWJ/ZWNJ — and it must not, because ZWJ is structural inside emoji sequences (👨‍👩‍👧) and in
Indic/Arabic joining. Bidi controls pass through verbatim. Any "cleanup" that widens this
expression silently corrupts anchor space.

**Block-span invariant:** spans are non-empty, ascending, and non-overlapping. Empty blocks emit
nothing — no span and no joiner. This is what makes the binary search in `offsetToSourceLine`
valid; state it in the module doc comment.

### `offsetToSourceLine` — two cases the rules above don't cover

- **Inside a code block**, count the `\n`s between `block.start` and `offset` and add them to
  `sourceLineStart`. A 200-line fence is a single `BlockSpan`; without this every offset inside it
  reports the same line.
- **On a joiner offset** (belongs to no block), return the *following* block's `sourceLineStart` —
  a selection starting at a block boundary is entering that block. Empty `blocks` → `-1`.

## 4. `src/anchor/create.ts`

```ts
type CreateResult =
  | { ok: true; anchor: Anchor }
  | { ok: false; reason: 'too-short' | 'too-long' };

function createAnchor(input: {
  /** selection already in anchor space (normalized per Plan 01 §3) */
  selectedText: string;
  /** offset of the selection start within doc.text; -1 when the caller could not map it */
  offset: number;
  doc: PlainTextDoc;
  /** fallback source line, used only when offset === -1 */
  hintLine?: number;
}): CreateResult;
```

- Reject `< 3` chars (`too-short`) or `> 500` chars (`too-long`), measured in **UTF-16 code
  units** — the same unit as every other quantity in the system (offsets, `Match_MaxBits`,
  `diff_levenshtein`). The PRD leaves the unit undefined; this pins it. The user-facing message
  lives in the extension layer (Phase 3), not here.
- Re-normalize `selectedText` defensively (`collapse(NFC(...))`) even though the caller should
  already have. Phase 3's DOM walk is a second implementation of the same rules, and this is cheap
  insurance against the two drifting.
- `exact` = the normalized selectedText. `prefix`/`suffix` = up to 32 chars of `doc.text` either
  side of the selection (may be shorter at document edges, may span `\n` — that's fine, they're
  matched in the same space). **Snap those slice boundaries to code-point boundaries**: a blind
  `slice` can cut a surrogate pair, leaving a lone surrogate that never matches anything. The same
  helper is reused by the fuzzy probe extractor in §5.
- `hintOffset` = `offset`. `hintLine` = `offsetToSourceLine(doc, offset)`. When `offset === -1`
  (Plan 03 §2's fallback path, where the webview's DOM→offset mapping failed), derive `hintOffset`
  from the first block whose `sourceLineStart >= hintLine`.

## 5. `src/anchor/locate.ts` — the confidence cascade

```ts
interface Located { start: number; end: number; confidence: number }
function locate(anchor: Anchor, doc: PlainTextDoc): Located | null;
/** same cascade, with the diff_match_patch instance hoisted; reanchor builds one and reuses it */
function createLocator(doc: PlainTextDoc): (anchor: Anchor) => Located | null;
```

Tiers, in order, first success wins (PRD §5):

1. **Exact + context** — `indexOf(prefix + exact + suffix)`; if found once, confidence `1.0`.
   If found multiple times, pick nearest to `hintOffset`, still `1.0` (full context matched).
   **Skip this tier entirely when `prefix` *and* `suffix` are both empty** — otherwise an anchor at
   a document edge matches a bare `exact` and reports `1.0`, the "full context matched"
   confidence, which is precisely what the UI uses to decide whether to warn "position uncertain".
   One-sided context is legitimately stronger than none, so keep the tier when only one side is
   empty.
2. **Exact only** — collect all occurrences of `exact`. One → `0.9`. Several → nearest to
   `hintOffset`, `0.7`.
3. **Fuzzy near hint** — `fuzzyFind` (below) at `loc = hintOffset`, `threshold 0.4`,
   `matchDistance 1000` → `0.5`.
4. **Fuzzy whole document** — `loc 0`, `threshold 0.3`,
   **`matchDistance = max(1000, text.length / 0.01)`** → `0.3`. See PRD §5 for why tier 4 cannot
   inherit tier 3's `Match_Distance`, and why the document length alone is not a large enough
   substitute.
5. `null`.

Ties break to the earlier occurrence at every tier, so results are deterministic.

### `src/anchor/fuzzy.ts` — tiers 3 and 4, extracted

Split out from `locate.ts` so the two failure modes below are testable against hand-written plain
strings — no markdown, no tokens, no fixtures.

```ts
function fuzzyFind(
  text: string,
  exact: string,
  opts: { loc: number; threshold: number; matchDistance: number },
): { start: number; end: number } | null;
```

**Landmine 1 — `match_main` pattern length.** The bitap implementation throws
`"Pattern too long for this browser."` when the pattern exceeds `Match_MaxBits` (32), and anchors
allow `exact` up to 500 chars. So:

- `exact.length <= 32` → `match_main` directly (still routed through verification below, since it
  returns only a start offset and the true matched length differs whenever the edit was an insert
  or delete).
- `exact.length > 32` → **three fixed probes**: head `slice(0, 32)`, middle
  `slice(mid − 16, mid + 16)`, tail `slice(−32)`, each snapped to code-point boundaries and run at
  `loc + probeOffset`. A single first-32-chars probe fails on the most common real edit — a
  reworded sentence *opening*, which destroys exactly those characters. Three fixed probes are a
  strict superset at a cost of ≤3 bitap runs, and they stay explainable and testable; a
  data-dependent "most distinctive substring" probe moves when a fixture changes, so tests can no
  longer target a specific probe.

**Verification determines `start` and `end`.** Run `diff_main(exact, window)` with
`Diff_Timeout = 0.1`, and **do not** call `diff_cleanupSemantic` — it rewrites op boundaries for
human readability, which moves the trim points. Leading and trailing `DIFF_INSERT` runs are window
padding, not anchor text; trim them to get `start`/`end`. Score the *trimmed* diff with
`diff_levenshtein`, normalize by `exact.length`, accept at `<= threshold`. Best normalized score
wins; ties break by proximity to `loc`, then by lower offset. `Diff_Timeout` is a safety valve, not
a correctness risk — a timed-out diff is larger, which only raises the score, which can only make
us more conservative.

**Verify each candidate against two windows and keep the better score:** the unpadded window
(exactly `exact.length` characters from the candidate) and a padded one with
`pad = min(32, ceil(exact.length * 0.25))`. The padded window is the only way to discover the true
boundaries when an edit inserted or deleted characters. But `diff_main` computes a *global*
alignment, so when the edited part is the anchor's own head or tail it does not emit the padding as
a clean leading/trailing insertion run — it scatters those characters through the alignment, where
they count as damage and can push a perfectly locatable anchor past the threshold. The unpadded
window carries no such noise. One extra diff per candidate buys immunity to a whole class of false
orphans.

**Landmine 2 — tier 4 cost.** Widening `matchDistance` to the document length (the PRD §5 fix)
makes the bitap scan O(document) per comment; at 5 MB × 50 comments that misses the 500 ms budget
by roughly three orders of magnitude. Resolve with a **deterministic size guard** — a wall-clock
budget would reintroduce the flakiness we're avoiding:

- `text.length <= 512 KB` → true whole-document fuzzy search. Covers every realistic document.
- `text.length > 512 KB` → degrade to literal probe scanning: `indexOf` each probe (native, memory-
  bandwidth-bound), cap 8 occurrences per probe, verify each. The honest, testable consequence:
  above 512 KB tier 4 requires at least one 32-character run of the anchor to have survived
  verbatim. An anchor both moved far *and* reworded throughout orphans — defensible, since PRD §4
  treats `orphaned` as a normal state needing triage and PRD §11 says documents over 2 MB don't
  render interactively anyway.

Tier 3 needs no guard: `Match_Distance = 1000` bounds its scan to ~±400 chars by construction.

An n-gram index is explicitly **not** built in Phase 1 — it costs a linear pass plus memory on
every `reanchor`, which runs on a 400 ms debounce during active editing. Leave a comment marking it
as the escape hatch if Phase 4 profiling demands it.

Cover both landmines with dedicated tests: a 200-char anchor reworded in its first / middle / last
third must locate without throwing, and an anchor edited *and* moved 20 KB from its hint must
locate at `0.3` (this one fails against the PRD as originally written).

## 6. `src/anchor/reanchor.ts`

```ts
interface ReanchorResult { reviewFile: ReviewFile; changed: boolean }
function reanchor(
  reviewFile: ReviewFile,
  newDoc: PlainTextDoc,
  opts?: { now?: () => string; inferAddressed?: boolean },
): ReanchorResult;
```

**Pure** — builds a new `ReviewFile` with new `Comment` objects and never mutates its input. PRD §5
leaves mutation semantics unspecified; purity lets Phase 4 use reference equality as a cheap change
check and lets tests assert the input was untouched.

`inferAddressed` (default `true`) is specified now rather than retrofitted: Plan 04 §5 already
mandates that `autoDetectResolution: false` still re-anchors and still orphans but never infers
`addressed`. One branch and one test here; a signature the store would otherwise have to change
later.

For each comment (statuses per PRD §4 — this module is the only code allowed to set `addressed`
and `orphaned`):

- `resolved` → untouched, never re-evaluated.
- Locate against `newDoc`:
  - **Not found** → `orphaned`. Keep the anchor as-is (its `exact` is the record of what the user
    commented on — Phase 4's orphan UI quotes it).
  - **Found, located text === `anchor.exact`** → `open` (also flips a previously-`orphaned`
    comment back to `open` if its text reappears — restructure-then-restore must self-heal), and
    **clear any `resolution`** — otherwise a reverted comment renders a phantom before/after diff
    in Phase 4's card. Update `hintOffset`/`hintLine` to the new position so future relocations
    start from truth.
  - **Found, located text differs** → `addressed`, populate
    `resolution = { previousText: anchor.exact, currentText: <located>, detectedAt }`. Do **not**
    mutate `anchor.exact` — the before/after display and any later "Looks good" need the original.
    A comment already `addressed` whose current text changes again just updates `currentText`;
    **if the `currentText` is unchanged, keep the original `detectedAt`**, or every 400 ms debounce
    tick rewrites the timestamp, flips `changed`, and churns the sidecar to disk on every keystroke
    burst.
- Compare with `collapse(NFC(a)) !== collapse(NFC(b))`, not raw `!==`. Both sides *should* already
  be in anchor space, but a sidecar written by an older build or hand-edited by the user (PRD §11
  explicitly supports that) may not be — and without this, a whitespace-only difference flips every
  comment in the file to `addressed` at once.
- `changed` is true when any status or resolution changed (Phase 4 uses it to skip no-op persists).
  **Hint drift deliberately does not set it**: `hintOffset`/`hintLine` are refreshed in memory on
  every pass but are advisory — a stale hint costs at most a tier demotion — and the in-memory
  `ReviewFile` every panel reads carries the fresh values for the whole session. Making hints set
  `changed` turns every keystroke into a disk write. Document this on `ReanchorResult.changed` so
  nobody "fixes" it into a write amplifier.
- Timestamps: `now: () => string` defaults to `() => new Date().toISOString()` so tests inject
  fixed clocks.

The *per-comment* change test is "located text ≠ `anchor.exact`" — precisely "differs from the text
at anchor creation". PRD §5 and §4 have been amended to say so directly. `baselineText` (the
whole-document snapshot) is owned by Phase 4 for its diff banner and is not consumed here; don't
blend the two.

## 7. Test suite — `src/test/anchor.test.ts` (+ `plaintext.test.ts`)

The PRD §5 matrix is the contract; do not mark this phase done until every row passes. Organize as
one file per module — `frontMatter`, `markdownIt`, `plaintext` (rules of §3), `anchor`
(create/locate), `fuzzy`, `reanchor` (lifecycle), `perf`.

**Fixture policy:** inline template literals for anything under ~20 lines; committed `.md` files
only for documents reused across suites or phases. The decisive argument is offset assertions —
nobody can eyeball-verify `expect(start).toBe(147)` against a file they have to open. Two helpers
carry the suite's readability: `offsetOf(doc, needle)`, which throws if the needle is absent *or
non-unique* so a fixture edit that duplicates a phrase fails loudly instead of silently testing the
wrong occurrence, and `anchorOn(doc, needle)`.

The one committed fixture, `docs/fixtures/kitchen-sink.md`, is built here rather than under
`src/test/fixtures/` — Plan 02 §8 needs the same document for manual CSP and theme verification,
and one artifact serving two phases beats two that drift apart.

Beyond the PRD matrix, add:

- Normalization idempotence: `renderPlainText` of a doc's own plain text round-trips stably.
- `offsetToSourceLine` correctness at block boundaries (first/last char of a block, offset on the
  `\n` joiner).
- Confidence values asserted per tier (a test per tier that can *only* succeed at that tier). Note
  that `0.7` is only reachable by making `prefix+exact+suffix` fail *and* `exact` repeat; with
  repeated full context, tier 1 correctly still returns `1.0`.
- Empty `prefix` *and* `suffix` → `0.9`, not `1.0` (the tier-1 skip in §5).
- The >32-char fuzzy pattern cases from §5, including `exact.length` of exactly 32 and 33 (the
  branch boundary), and the tier-4 20 KB regression guard.
- Large-document guard: `fuzzyFind` over a synthetic 600 KB plain string returns well under 100 ms,
  and an anchor reworded beyond any surviving 32-char run returns `null` rather than hanging.
- `offsetToSourceLine` at block start, block end, joiner offset, empty doc, and past-end.
- Task lists produce no `<input` substring in `doc.text`.
- `reanchor` with an injected clock produces deterministic `detectedAt`, and `detectedAt` is stable
  across two passes with the same `currentText`.
- `reanchor` purity: `structuredClone` the input, run, deep-equal the original.
- `inferAddressed: false` re-anchors and orphans but never sets `addressed`.
- Orphan → open self-heal (text deleted, then restored), clearing `resolution`.

**Performance test** (PRD: 5 MB doc, 50 comments, reanchor < 500 ms): generate the fixture
programmatically in a `beforeAll` (repeated realistic markdown — heading, prose, nested list,
fenced code, table — not one giant line), place 50 unique sentinel anchors spread through it,
reword exactly 10, assert wall-clock with a 500 ms budget. Use a **seeded `mulberry32` PRNG, never
`Math.random()`**: a corpus that differs run to run gives a timing distribution that differs run to
run, which *is* the flakiness. Discard one warm-up call, then assert the **median of 3** runs.
Assert correctness too — exactly 10 `addressed`, 40 `open`, 0 `orphaned` — since a cascade that
degrades to "orphan everything" is both fast and useless. Separately *record* (don't assert)
`renderPlainText` time: it dominates `reanchor` by an order of magnitude and Phase 2 should size
its 2 MB guard from that data. Skippable via `PERF=0`, runs by default locally.

## 8. Acceptance checklist

Verified 2026-08-04, during the Phase 3 → Phase 4 gate pass.

- [x] `npm run check` green — typecheck under `strict: true`, lint, and every PRD §5 matrix row
      plus the additions in §7
- [x] The `no-restricted-imports` rule enforces the no-`vscode` ban (no manual grep needed)
      — the rule now also covers `src/store/{sidecarPath,reviewFile}.ts` and `src/panel/notices.ts`
- [x] `@types/markdown-it` absent from `package.json`; `npm ls typescript` shows 5.9.x — 5.9.3
- [x] Tier-4 regression test (0.3 at 20 KB from hint) passes; `fuzzyFind` on 600 KB returns
      in <100 ms
- [x] Performance test passes on the dev machine: median <500 ms **and** the 10/40/0 status split
      — `src/test/perf.test.ts`, 3 tests, run as part of `npm test` (skipped only under `PERF=0`)
- [x] `src/anchor/types.ts` matches PRD §4 field-for-field
- [x] markdown-it config lives in `src/render/markdownIt.ts` (single factory, ready for Phase 2)
- [x] `docs/fixtures/kitchen-sink.md` covers everything Plan 02 §8 lists — and is now also the
      corpus the layout harness renders
- [x] `CHANGELOG.md` has an `Unreleased → Added` entry

## 9. Spec corrections applied in this phase

Recorded here so later phases don't "restore" them. Two were release-blocking and are fixed in the
PRD itself (§5); the rest are fixed inline in the sections above.

**In the PRD:** tier 4's `Match_Distance` (a whole-document search that could only see the first
~300 characters, silently orphaning everything past it), and the `addressed` comparison basis
(`baselineText` → `anchor.exact`, since `baselineText` has no block map to locate an anchor
inside).

Both were confirmed against a running implementation, and the first needed a second correction on
the way: widening `Match_Distance` to the *document length* is still not enough, because a flawless
match at the far end of an N-character document then scores `N/N = 1.0`. The divisor has to be the
share of the score budget proximity may consume at the furthest point — hence `text.length / 0.01`.

**In this plan:** window-padding contamination in fuzzy verification, found while implementing —
`diff_main` computes a global alignment, so when the anchor's own head or tail is the edited part
it scatters the padding through the alignment instead of emitting it as a trimmable insertion run,
inflating the score enough to orphan a locatable anchor. Fixed by scoring an unpadded window
alongside the padded one (§5). Also: tier-1 confidence inflation at document edges (§5);
`offsetToSourceLine` inside
multi-line code blocks and on joiner offsets (§3); front matter with no closing delimiter erasing
the document (§3 rule 1); the whitespace-collapse expression, which must not touch ZWJ/ZWSP/ZWNJ
(§3); stale `resolution` on a reverted comment (§6); `detectedAt` churn on every debounce tick
(§6); hint drift as a write amplifier (§6); the anchor length unit (§4); surrogate-pair-splitting
slices in `prefix`/`suffix` and fuzzy probes (§4, §5).
