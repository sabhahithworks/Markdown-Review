# Product improvements for the first release (0.1.0)

Status: approved 2026-11-13, executing. Branch `product-improvements`. No PR.
Format: 3

## Context

Markdown Review (`markdown-review-pane` 0.1.0) is built and hardened, but it has never been released.
No git tag exists, `docs/plans/05-acceptance-run.md:247` ("Published") is unchecked, and the last
commit is 2026-08-06. A product review on 2026-11-13 (`~/.claude/plans/mdcm/product-improvements/discussion.md`)
found five gaps to close before the first publish:

- **Ambiguous prompt quotes.** `src/prompt/buildPrompt.ts:135` emits only `On: "<quote>"`. A short
  selection that occurs several times in the document gives the agent no way to tell which occurrence
  is meant. Correction to the notes: `scopeOf` (`src/detect/scope.ts:85`) returns a heading only when
  the anchor sits *inside* a heading. No helper finds the heading that encloses body text, so one is
  added.
- **No numbers on cards.** Numbers exist only inside `buildPrompt` (`index + 1`,
  `buildPrompt.ts:63-66`). The `reviewState` message carries none (`src/panel/messages.ts:82-86`), so
  an agent's "I disagree with 3" cannot be matched to a card.
- **Nothing outside the pane.** `src/` has no status bar item and no `FileDecoration`. Activation is
  lazy: `package.json:29-31` holds the single event `onWebviewPanel:markdownReview.panel`. Any
  indicator therefore needs an activation event, which changes law L-lazy-activation (owner approved, D3).
- **Edits outside anchors are invisible.** The only diff UI is the per-card before/after and the
  rewrite banner's `showRewriteDiff` (`src/detect/baselineDocuments.ts:155`). The building blocks
  exist host-side: `changedRanges` (`src/detect/changedRanges.ts:50`), memoised in
  `ReviewPanel.ts:551-559`.
- **Stale positioning.** `README.md:11` claims "Other tools have artifact commenting, but only for
  artifacts their own agent generated". That is no longer true: MD Feedback and md-redline both
  comment on any markdown file.

Release state: 4 manual boxes are open in `docs/plans/04-acceptance-run.md` (`:289`, `:294`, `:298`,
`:431`). Plan 05 Part A (`:48-56`) is a stop gate, and Part C (`:228-253`) is publish day. Any code
change invalidates the verified `.vsix`, so the archive is rebuilt and the packaged checks (C1–C5,
inside Part B `:60-226`) re-run once, at the end.

## Decisions (binding)

Owner answers (2026-11-13):

- **D1** Quote disambiguation adds `(under "<heading>", line N)` **only when the quote is ambiguous**. Unique quotes keep today's exact line, so the PRD §7 golden test (`src/test/buildPrompt.test.ts:32`) stays byte-for-byte. The owner asked the planner to think through the edge cases; the rules are D9–D13.
- **D2** Card numbers are **frozen at copy time**. A card shows the number it had in the last copied prompt. A comment added afterwards shows no number until the next copy.
- **D3** Visibility is a **status bar item plus an Explorer badge**, enabled by adding `workspaceContains:.reviews/*.json` as a second activation event. Law L-lazy-activation, `CLAUDE.md` and PRD §9 are amended to allow exactly these two events. rule: `package.json`, `src/extension.ts`, `src/test/integration/suite/activation.spec.ts`, `CLAUDE.md`, `MARKDOWN_REVIEW_PRD.md`, `.claude/laws.md`
- **D4** The change view is **inline block marks plus a header control** that opens the existing baseline↔current diff.
- **D5** README lead: "Comment on any Markdown file like a Google Doc. Copy one prompt into any agent: no MCP server, no setup. Your file is never modified with markers, and the pane shows which comments were addressed and what the agent changed."
- **D6** **Both registries.** The runsheet gains Open VSX steps. The owner runs both publish commands (L-no-vsce-publish, L-no-ovsx-publish).
- **D7** The Explorer badge shows the **number of comments needing action**: open + to-confirm (`addressed`) + orphaned, capped at `9+`. The owner revised this in the plan review: a lone `✓` read as "done". The tooltip splits the total, as in `0 open · 2 to confirm · 1 needs re-link`. There is no badge when all three counts are 0.
- **D8** Status bar text joins the non-zero parts of `N open`, `N to confirm` and `N needs re-link` with ` · `, after `$(comment)`. Examples: `$(comment) 3 open · 2 to confirm`, `$(comment) 1 needs re-link`. Clicking it opens the review pane. It is hidden for files with no review, or when all three counts are 0. The owner confirmed in the plan review that orphan-only files *do* show.

Planner decisions, quote edge cases (D1):

- **D9** "Ambiguous" means the located text (`doc.text.slice(found.start, found.end)`, uncollapsed) occurs ≥ 2 times in `doc.text`, compared exactly and case-sensitive. When the quote was truncated (PRD §7 middle ellipsis), the visible head is also checked: that is `raw.slice(0, k)`, where `k` is the length of the collapsed head before ` … `, taken from the *uncollapsed* `raw` so both sides are in anchor space. Prose blocks are already whitespace-collapsed in anchor space, so the two agree there. For code, the head check can miss, and the full-text check still applies. Counting stops at the second hit (`indexOf` from `first + 1`). Reason: this matches what the agent can grep, and it stays O(n) per comment.
- **D10** The heading is the nearest preceding `heading` block of any level, as its whole text, collapsed and `truncateQuote`d. With no preceding heading, the context is `(line N)` alone. Reason: the nearest heading is what a reader would say.
- **D11** The line is 1-based: `offsetToSourceLine(doc, found.start) + 1`. Lines are 0-based everywhere else, so this converts at the display boundary only (`src/anchor/types.ts:5-7`). For prose, it is the block's first source line (`plaintext.ts:318`), not the exact wrapped line. Front matter is already folded in. Reason: the agent reads files with line numbers, and the heading survives edits that shift lines.
- **D12** A section quote (`On the section "## X"`) is ambiguous when another heading block has identical text, compared after `collapse` on both sides with the level ignored. Its context is then the nearest preceding heading of a *higher* level, plus its own line. Example: `On the section "## Examples" (under "# Auth", line 40)`.
- **D13** An unlocatable open comment (`found === null`) keeps today's `On: "<anchor.exact>"` with no context, because no position is known.
- **D36** When the quote occurs more than once *inside its own block*, heading and line can't tell the copies apart, so the hint gains `, occurrence N of M in this paragraph`. Example: `(under "## Auth", line 42, occurrence 2 of 3 in this paragraph)`. N counts hits in the block before `found.start`. In a code block the wording is `in this code block`.

Planner decisions, card numbers (D2):

- **D14** The new field is `ReviewFile.promptOrder?: string[]`: the ids in the last copied prompt, in prompt order, where number = index + 1. It is optional, so `version` stays 1. Reason: one field set in one place, and an older sidecar without it simply shows no numbers.
- **D15** `buildPrompt` returns `order: string[]` beside `prompt` and `count`, so the numbering has one producer.
- **D16** `snapshotBaseline(plainText, promptOrder, now)` always records `promptOrder`, and it **always notifies**. Both the card numbers and the change view (D28) now render from the snapshot, so even a re-copy with the same order must refresh the marks. This reverses the "must not fire onDidChange" contract at `store.spec.ts:404` and the comments at `ReviewStore.ts:311-317,436-440`; those are rewritten. The baseline still never crosses to the webview (L-baseline-stays-on-host).
- **D34** A copy whose text exceeds `BASELINE_MAX_CHARS` now **clears** `baselineText`/`baselineAt` instead of keeping the previous prompt's baseline, which would make "changed since prompt" compare against an older prompt than the card numbers. The log line keeps its wording. This is compatible with Plan 04 §10 D2, which bounds the snapshot's size and says nothing about keeping a stale one. The change view shows `no-baseline` for that file.
- **D-q1** (V, owner, 2026-11-14) Keep D34 after verify raised it twice (E27/VF3): an over-limit copy leaves the pane silent; the Output-channel line plus README/CHANGELOG is the explanation. No in-pane notice in v1. The CV2 themes.css assumption is confirmed.
- **D17** A number shows on a card of **any** status whose id is in `promptOrder`, because the agent may refer to a comment that has since been addressed. Ids no longer in `comments` are ignored. The visible text is `#3`, and the aria-label part is `item 3 in the last copied prompt`.
- **D18** `relink` **replaces** the destination's `promptOrder` with the source's, the way it overwrites the baseline (`ReviewStore.ts:166-169`). It maps ids that collided and were re-minted (inline at `:154-163`) through a `Map<oldId, newId>` built in that same loop.
- **D19** A malformed `promptOrder` (not an array of strings) makes `isReviewFile` false. That follows the existing corrupt path (`.json.bak` backup plus notice, L-corrupt-sidecar-backup), consistent with `baselineAt` at `reviewFile.ts:102`.

Planner decisions, visibility (D3):

- **D20** `countByStatus` moves from `media/src/header.ts:34` to `src/anchor/counts.ts` and is re-exported through `src/panel/messages.ts`. `header.ts` re-exports it so `media/test/header.test.ts` keeps working. Reason: L-starter-no-duplicate-helper, and the webview may import only `messages.ts` (L-webview-imports-messages-only).
- **D21** The indicator strings (`statusBarText`, `statusBarTooltip`, `badgeText`, `badgeTooltip`) live in `src/panel/notices.ts`, which is already vscode-free and tested.
- **D22** `ReviewIndex` (`src/status/reviewIndex.ts`) holds per-target counts only, never a review. It is fed from three sources:
  - a scan of `RelativePattern(folder, '.reviews/*.json')` per workspace folder at activation;
  - a watcher on the *same* per-folder pattern for writes from outside the store;
  - a new static `ReviewStore.onDidChangeAny`, fired wherever the instance emitter fires.

  It never creates a `ReviewStore`, because `ReviewStore.for` on a loose file pops `warnLooseFile` (`ReviewStore.ts:121`). This keeps L-single-review-store intact. It skips folders whose scoped `markdownReview.storageLocation` is `global`, mirroring `ReviewStore.ts:672-676`, so leftover `.reviews` files give no stale badges. Keys go through `registryKey` (`src/store/registryKey.ts:13`), the same key the store uses.
- **D23** The target URI comes from `ReviewFile.targetPath` inside the JSON joined to *that sidecar's* folder, never from reversing the sidecar filename. Reason: `__` in a real filename makes the reverse ambiguous, and Windows separators are a flagged bug source.
- **D35** While a review pane (a webview) has focus, `activeTextEditor` is `undefined`. The status bar then **keeps** the last markdown target. It hides only when a non-markdown editor becomes active, or when that target's counts reach zero. Reason: the user is looking at that file's review.
- **D24** Reviews kept in global storage (`storageLocation: global`) show indicators only after their store is loaded in the session; they are not scanned. Reason: hashed names cannot be mapped back to a folder in multi-root workspaces. This is documented in the README.
- **D25** Counts reflect the statuses last saved in the sidecar. Comments are re-checked only when the pane or copy command runs `applyReanchor`, so `statusBarTooltip` ends with `Open the review to check for changes.`
- **D26** Corrupt or unknown-version sidecars found by the scan are skipped and logged to the output channel. There is no popup: the store's own notice fires when the file is opened. A watcher re-read that fails to parse **keeps the last good counts** and logs, like `ReviewStore.ts:636-641`, because a hand-edit in progress is transiently invalid.
- **D27** `MAX_INDEXED_SIDECARS = 2000`. Past the cap, the scan logs `indexed 2000 of N reviews` (L-starter-bounded-list).

Planner decisions, change view (D4):

- **D28** The host sends a discriminated `changes` field on `reviewState`:
  `{ state: 'no-baseline' } | { state: 'unchanged' } | { state: 'changed'; blocks: ChangeSpan[] } | { state: 'too-large' }`.
  `blocks` are whole-block anchor-space ranges, with adjacent blocks merged, computed host-side from `doc.blocks`, so the webview only intersects them with `data-ap-start`/`data-ap-end` (L-block-offsets-single-source). Deletions (zero-width ranges) mark their neighbour blocks, using `touches`' ±1 rule (`changedRanges.ts:95-99`).
- **D29** Change marks are **not** gated on `autoDetectResolution`. They are a plain diff, not an inference about comments. `sectionChanged` keeps its gate.
- **D30** A mark is a 3px bar in the block's left gutter. Each marked block element gets `data-mr-changed` and `aria-description="changed since the prompt was copied"`. The bar itself is a `div.mr-change-bar` appended to `#highlight-overlay`, built from the block's measured `getBoundingClientRect()` in the same `render()` pass that draws highlights (`media/src/comments.ts:158-258`, `buildHighlight` at `:391`). The plan review rejected a `::before` on the block: `pre` (`webview.css:198`) and tables (`:231`) have `overflow-x: auto` and would clip or scroll it. Nothing is added to the flow, so block heights and card geometry don't move. The `forced-colors` rule uses `CanvasText`. There is no per-block visible "changed" text; the legend is the header control.
- **D31** The header control is a button `Show changes (4)`, where the count is changed blocks, for `changed`. It is a button `Show changes` with the tooltip `Too large to mark inline` for `too-large`. For `unchanged` it is the muted text `No changes since prompt`, and for `no-baseline` it is hidden. The button posts the existing `showRewriteDiff` message.

Planner decisions, process:

- **D32** Phase 0 commits `.claude/laws.md` (untracked since onboarding) together with the plan copy, so V3's law amendment is a reviewable diff.
- **D33** Packaging, the C1–C5 checks, the demo recording and both publishes are owner phases (O2). Plan 05 Part B is a runsheet the owner executes, and publishing is denied to agents.

## UNCONFIRMED

- **U1** Whether `workspaceContains:.reviews/*.json` matches a dot-folder at each workspace root without being hidden by `files.exclude`. To confirm: O1 step "reload with no pane open, and the status bar shows." It blocks O1 only. Fallback, written into V3's DECIDED and O1: add a row `V3b` that switches to `workspaceContains:**/.reviews/*.json`, then re-run F before O1 resumes.
- **U2** Whether an unverified Open VSX namespace shows a warning badge until ownership is claimed. This comes from a search summary, not read on open-vsx.org. To confirm: O2 after `ovsx create-namespace`. It blocks nothing; R1 writes the claim step as conditional.

## Edge matrix

| id | category | flow | case | expected | visible | phase | test |
|---|---|---|---|---|---|---|---|
| E1 | empty | copy prompt | ambiguous quote with no heading before it | context is `(line N)` alone (D1, D10) | yes | Q1 | `no preceding heading` |
| E2 | empty | indicators | workspace with no `.reviews/` | no status bar item, no badges, no error (D8) | yes | V2 | `no sidecars` |
| E3 | empty | change view | no baseline yet, or document identical to it | control hidden, or "No changes since prompt" (D31) | yes | CV3 | `no-baseline hides the control` |
| E4 | limit | copy prompt | truncated quote whose head repeats although the full text is unique | context added (D1, D9) | yes | Q1 | `truncated head` |
| E5 | limit | indicators | 10 or more comments needing action | badge `9+`, tooltip carries exact counts (D7) | yes | V1 | `caps at 9+` |
| E6 | limit | change view | either side past `MAX_DIFF_CHARS` | no marks, button without count, tooltip says why (D31) | yes | CV1 | `too-large` |
| E7 | limit | indicators | more sidecars than `MAX_INDEXED_SIDECARS` | indexes the cap, logs `indexed N of M` | no | V2 | `MAX_INDEXED_SIDECARS` |
| E8 | invalid | card number | hand-edited `promptOrder` not an array of strings | sidecar treated as corrupt: backup plus notice (D19) | yes | N1 | `rejects a malformed promptOrder` |
| E9 | invalid | indicators | corrupt or unknown-version sidecar in scan | skipped and logged, others still indexed (D26) | no | V2 | `skips a corrupt sidecar` |
| E10 | failure | copy prompt | clipboard write throws | no `promptOrder` or baseline recorded (snapshot follows the write) | no | N2 | review: snapshot stays after clipboard write |
| E11 | partial | card number | relink merges into a file whose ids collide | `promptOrder` mapped through the renames (D18) | no | N2 | `relink maps promptOrder through renamed ids` |
| E12 | retry | card number | prompt copied twice with a comment added between | second copy renumbers; the new card gets its number (D2) | yes | N2 | `second copy replaces promptOrder` |
| E13 | concurrency | indicators | sidecar rewritten by another window or git checkout | watcher re-reads it and the badge updates (D22) | yes | V2 | `external sidecar write updates counts` |
| E14 | concurrency | card number | two panels on one file | both render the store's numbers and marks | no | N3 | review: L-single-review-store, panels render store state |
| E15 | interrupt | indicators | window reload with no pane open | activation via `workspaceContains`; indicators rebuilt from scan (D3) | yes | V3 | review: live reload is checked in O1 (U1); V3 asserts the manifest only |
| E16 | timeout | change view | diff hits its time budget | coarser diff over-marks blocks, never under-marks | no | CV1 | review: existing changedRanges budget comment |
| E17 | permission | indicators | restricted (untrusted) workspace | extension's existing `capabilities` declaration applies; index only reads | no | V3 | review: index performs reads only |
| E18 | old-state | card number | sidecar written before this change (no `promptOrder`) | cards unnumbered until next copy (D14) | yes | N3 | `no promptOrder shows no number` |
| E19 | old-state | indicators | review kept in global storage | indicators only once its store loads this session (D24) | yes | V2 | `global-storage review appears once loaded` |
| E20 | environment | indicators | Windows paths, `__` in filename, multi-root | target from `targetPath` joined to its folder (D23) | no | V2 | `targetPath from JSON` |
| E21 | environment | copy prompt | front matter or CRLF before the quote | line number counts front matter (D11) | yes | Q1 | `front matter` |
| E22 | time | card number | comment added after the copy | card shows no number (D2) | yes | N3 | `added after copy` |
| E23 | security | card number | heading or quote text containing `<`, quotes | prompt is plain text; card number and badge set via `textContent`/API, no HTML | no | N3 | `textContent` |
| E24 | feedback | indicators | status bar click | opens the review pane for that file (D8) | yes | V2 | `markdownReview.open` |
| E25 | accessibility | change view | forced-colors and screen reader | bar uses `CanvasText`; `aria-description` on the block (D30) | yes | CV4 | `change marks keep block heights` |
| E26 | accessibility | card number | screen reader on a numbered card | aria-label includes `item 3 in the last copied prompt` (D17) | yes | N3 | `item 3 in the last copied prompt` |
| E27 | limit | copy prompt | copy of a document over `BASELINE_MAX_CHARS` after an earlier smaller copy | old baseline cleared; change view shows `no-baseline` (D34) | yes | N2 | `clears the baseline over the limit` |
| E28 | retry | change view | re-copy with the same prompt order | store notifies; marks clear against the new baseline (D16) | yes | N2 | `re-copy with same order notifies` |
| E29 | feedback | indicators | review pane has focus (`activeTextEditor` undefined) | status bar keeps that file's counts (D35) | yes | V2 | `keeps the item while the pane has focus` |
| E30 | invalid | indicators | external edit leaves a sidecar briefly invalid | last good counts kept, re-read logged (D26) | no | V2 | `keeps last counts on an invalid edit` |
| E31 | empty | indicators | file whose only comments are orphaned | status bar `$(comment) 1 needs re-link`, badge `1` (D7, D8) | yes | V1 | `orphan-only shows needs re-link` |
| E32 | limit | copy prompt | quote repeated inside its own paragraph | hint adds `occurrence N of M in this paragraph` (D36) | yes | Q1 | `occurrence 2 of 3` |
| E33 | environment | change view | changed fenced code block or wide table (`overflow-x: auto`) | bar drawn in the overlay, not clipped or scrolled (D30) | yes | CV4 | `change bars on a code block` |
| E34 | empty | copy prompt | document with no blocks | no hint, never `line 0` | no | Q1 | `empty doc omits hint` |

## Execution model

- Branch `product-improvements` off `main`; it later PRs into `main`. The commit subject tag is `(product-improvements <phase>)`.
- There is one lane, `app` (repo root), so phases run sequentially and there is no contract phase C. Each phase is briefed for the `plan-engine:implementer` agent (Sonnet) unless its heading says Opus. Opus reviews every diff against its brief.
- Repo rules come from `.claude/laws.md` (40 rows, via `laws.py`) plus `CLAUDE.md`. They are cited per phase. The ones every code phase carries are L-no-new-suppressions, L-no-new-deps, L-changelog-unreleased, L-starter-tests-assert-values and L-starter-no-swallowed-errors.
- The profile has no `docs.check` and no `docs.feature_index`, so F runs `cite-shift.py` and the gates only.
- To resume, run `/plan-engine:run-phase`. It picks the next row in §Progress by the rule there.

## Phases

### 0: Branch and plan (lane: docs, kind: docs)

GOAL: The plan and laws are committed on a fresh branch, so every later phase starts from a recorded plan.
READ FIRST: `docs/plans/README.md:11-18`, for the phase-map table to extend.
CHANGE:
- First run `git switch -c product-improvements` from `main`.
- `docs/plans/product-improvements-2026-11-13.md`: a copy of this plan.
- `docs/plans/README.md`: add the row `| 7 | [product-improvements-2026-11-13.md](product-improvements-2026-11-13.md) | Release polish: quote context, card numbers, indicators, change view, release | Phase 6 |`.
- `.claude/laws.md`: commit as-is (D32).
MIRROR: `docs/plans/README.md:18`.
INVARIANTS: none beyond L-no-vsce-publish.
DECIDED: D32. D3 is cited because its rule covers `.claude/laws.md`; this phase commits that file unchanged, and V3 amends it.
OUT OF SCOPE: all code.
ACCEPTANCE: `git log -1 --stat` shows the three files; `git branch --show-current` prints `product-improvements`.
FAILURE PATHS: none: this phase only copies and commits documents.
Depends on: none.
Entry check: `git status --porcelain docs/plans/README.md | wc -l` prints 0, and `git rev-parse --abbrev-ref HEAD` is `main`.
Done: committed, tracker row updated.

### Q1: Disambiguate repeated quotes in the prompt (lane: app)

GOAL: When a quoted passage appears more than once, the prompt names its heading and line, for example `On: "the token" (under "## Refresh", line 42)`. Unique quotes are unchanged.
READ FIRST: `src/prompt/buildPrompt.ts:101-136` (`describeAnchor`); `src/detect/scope.ts:85-142` (`scopeOf`, `sectionFrom`); `src/render/plaintext.ts:273-320` (`blockIndexAt`, `offsetToSourceLine`); `src/anchor/text.ts:106-135` (`truncateQuote`, separator ` … `); `src/test/buildPrompt.test.ts:31-64,179-233`; `docs/plans/04-prompt-and-detection.md` §10 (L-detection-corrections-first).
CHANGE:
- `src/detect/scope.ts`: add `export function enclosingHeading(doc: PlainTextDoc, offset: number, maxLevel?: number): BlockSpan | null`. It walks back from `blockIndexAt(doc, offset) - 1` and returns the nearest `heading` block, restricted to `headingLevel < maxLevel` when `maxLevel` is given.
- `src/prompt/buildPrompt.ts`: add a private `occursTwice(haystack: string, needle: string): boolean`, which returns false for an empty needle. Add a private `locationHint(entry, doc, scope): string`, which returns `''` or ` (under "<heading>", line N)` / ` (line N)`. `describeAnchor` appends it to both phrasings per D9–D13 and D36.
- `src/test/buildPrompt.test.ts`: add a `describe('buildPrompt — repeated quotes (D1)')` block with the tests named in ACCEPTANCE.
- `src/test/scope.test.ts`: add `enclosingHeading` tests.
- `MARKDOWN_REVIEW_PRD.md` §7: add a rule bullet describing D9–D13 and D36, with the example.
- `CHANGELOG.md`: add an `Unreleased` → Added entry.
MIRROR: `src/test/buildPrompt.test.ts:179-197`, for building a doc with headings and asserting exact prompt lines.
INVARIANTS: L-prompt-prose-only (the hint is prose, not a marker); L-vscode-free-core; L-detection-corrections-first; L-errors-as-values; L-starter-no-duplicate-helper (reuse `blockIndexAt`, `offsetToSourceLine`, `truncateQuote`, `collapse`); L-changelog-unreleased; 0-based lines internally, converting at display only.
DECIDED: D1, D9–D13, D36. D3 is cited because its rule covers `MARKDOWN_REVIEW_PRD.md`; this phase edits §7 only, and the §9 activation text is V3's. Expected decision: whether the heading inside the hint is truncated. Default: yes, with `truncateQuote(collapse(text))`.
OUT OF SCOPE: card UI; `promptOrder`; the README prompt example (the PRD example quotes are unique). The changes are additive, so these callers are left unchanged: `src/detect/changedRanges.ts`, `src/panel/ReviewPanel.ts`, `src/commands/copyPrompt.ts`, `src/test/fixtures/reviewLoop.ts`, `src/test/changedRanges.test.ts`, `src/test/perf.test.ts`, `eslint.config.mjs` (`scope.ts` is already on its list).
ACCEPTANCE: `npx vitest run --project node src/test/buildPrompt.test.ts src/test/scope.test.ts`, then `npm run check`. New tests, each asserting the exact emitted line:
- `adds heading and line when a quote repeats`
- `leaves a unique quote unchanged`. The golden test at `:32` must also pass unmodified.
- `no preceding heading` gives `(line N)`.
- `truncated head`: a 150-char quote whose head repeats gets context.
- `repeated section heading names its parent`
- `front matter`: the line counts front-matter lines.
- `unlocatable keeps the bare quote`
- `occurrence 2 of 3`: three copies in one paragraph, and the hint names the second.
- `empty doc omits hint`: a stubbed doc with no blocks gives no `line 0`.
FAILURE PATHS: Empty doc or no blocks: `offsetToSourceLine` returns -1, so the hint is omitted rather than printing `line 0`. Unlocatable: no hint (D13). An empty needle never counts as ambiguous.
Depends on: 0.
Entry check: `grep -c "describeAnchor" src/prompt/buildPrompt.ts` prints ≥ 2.
Done: tests pass, committed, tracker row updated.

### N1: Record prompt order in the model (lane: app)

GOAL: Each copied prompt's numbering exists as data (`promptOrder`) that survives a reload and reaches the webview.
READ FIRST: `src/anchor/types.ts:16-25` (`ReviewFile`); `src/store/reviewFile.ts:80-110` (`isReviewFile`); `src/panel/messages.ts:24-47` (`ReviewSummary`, `toReviewSummary`); `src/prompt/buildPrompt.ts:22-70` (`PromptResult`).
CHANGE:
- `src/anchor/types.ts`: add `promptOrder?: string[]` to `ReviewFile`, with a doc comment (D14).
- `src/store/reviewFile.ts`: `isReviewFile` rejects `promptOrder` unless it is `undefined` or an array of strings (D19).
- `src/panel/messages.ts`: `toReviewSummary` adds `...(review.promptOrder ? { promptOrder: [...review.promptOrder] } : {})`, so the key is absent rather than `undefined`, matching how the store spreads optional fields.
- `src/prompt/buildPrompt.ts`: add `order: string[]` to `PromptResult` (`[]` when count is 0), equal to the ids of `entries` after sorting.
- `src/test/reviewFile.test.ts`, `src/test/messages.test.ts`, `src/test/buildPrompt.test.ts`: add the tests below.
MIRROR: `src/store/reviewFile.ts:99-102` (optional-field validation).
INVARIANTS: L-version-skew-refused (version stays 1); L-corrupt-sidecar-backup; L-baseline-stays-on-host (`toReviewSummary` still omits `baselineText`); L-vscode-free-core; L-prompt-prose-only.
DECIDED: D14, D15, D19.
OUT OF SCOPE: writing `promptOrder` (N2), and rendering it (N3). The new field is optional and `order` is an added property, so every other importer the scanner lists (the `types.ts`, `messages.ts` and `reviewFile.ts` callers, and `copyPrompt.ts`) is left unchanged.
ACCEPTANCE: `npx vitest run --project node src/test/reviewFile.test.ts src/test/messages.test.ts src/test/buildPrompt.test.ts`, then `npm run check`. Tests:
- `accepts a sidecar with promptOrder`
- `rejects a malformed promptOrder` (`[1]` and `"a"` both rejected)
- `summary carries promptOrder and omits baselineText`
- `order lists ids in prompt order`, asserting the exact array for three comments added out of document order.
FAILURE PATHS: A malformed field fails the guard, which routes to the existing corrupt-sidecar path. An empty review gives `order: []`.
Depends on: Q1.
Entry check: `grep -c "promptOrder" src/anchor/types.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### N2: Save prompt order on copy (lane: app)

GOAL: Copying a prompt saves its numbering and tells open panels, even for documents too large for a baseline.
READ FIRST: `src/store/ReviewStore.ts:305-450` (`snapshotBaseline`, `commit` and their doc comments); `src/store/ReviewStore.ts:136-185` (`relink`, ids re-minted inline at `:154-163`); `src/commands/copyPrompt.ts:60-76`; `src/test/integration/suite/store.spec.ts:385-415,555-615`.
CHANGE:
- `src/store/ReviewStore.ts`: change the signature to `snapshotBaseline(plainText: string, promptOrder: readonly string[], now?: () => string): void`. It always commits `promptOrder` and **always notifies** (D16). Within `BASELINE_MAX_CHARS` it sets `baselineText`/`baselineAt`. Over the limit it removes both and keeps the existing log line (D34). Rewrite the doc comments at `:311-317` and `:436-440` to say why it notifies now. `relink`: build `Map<oldId, newId>` in the re-mint loop at `:154-163`, then set the destination's `promptOrder` to the source's mapped through it (D18).
- `src/commands/copyPrompt.ts`: destructure `order` and call `store.snapshotBaseline(doc.text, order)`, still after `clipboard.writeText`.
- `src/test/integration/suite/store.spec.ts`: update the existing calls at `:394`, `:411`, `:563`, `:611`. Replace the assertion at `:404` with `snapshotBaseline notifies when promptOrder changes`. Rewrite the over-limit test at `:411` as `clears the baseline over the limit`: take a small snapshot, then an oversize one, and assert `baselineText` and `baselineAt` are absent while `promptOrder` is set. Add `re-copy with same order notifies`, `second copy replaces promptOrder` and `relink maps promptOrder through renamed ids`.
MIRROR: `src/test/integration/suite/store.spec.ts:385-410`.
INVARIANTS: L-single-review-store; L-never-auto-delete-comment; L-corrupt-sidecar-backup; L-detection-corrections-first (the baseline timing is unchanged: after the clipboard write); L-starter-error-path.
DECIDED: D16, D18, D34. Expected decision: whether the over-limit log line should mention the cleared baseline. Default: append ` (the previous baseline was cleared)`.
OUT OF SCOPE: webview rendering. `snapshotBaseline` has exactly two callers, `copyPrompt.ts` and `store.spec.ts`, and both are in CHANGE. The other `ReviewStore` importers are unaffected.
ACCEPTANCE: `npm run test:integration` (the store specs exist only in the extension-host suite, which has no per-file filter), `npm run check`. Each new test asserts the exact saved `promptOrder` array and the `onDidChange` count.
FAILURE PATHS: Over the limit, the baseline is cleared and logged, while the numbers are still recorded (E27). A clipboard failure throws before the snapshot, so nothing is recorded (E10). A sidecar write failure goes through the existing `commit`/flush error path, which already logs and notifies.
Depends on: N1.
Entry check: `grep -n "snapshotBaseline(doc.text)" src/commands/copyPrompt.ts` finds one line.
Done: tests pass, committed, tracker row updated.

### N3: Show the prompt number on cards (lane: app)

GOAL: Each card from the last copied prompt shows `#3` in its header, so an agent's "I disagree with 3" maps to a card.
READ FIRST: `media/src/comments.ts:452-520` (`buildCard`, header, aria-label); `media/src/comments.ts:140-180` (where `signals` are built from state); `media/test/cards.test.ts:164-245`; `media/webview.css:855-870`.
CHANGE:
- `media/src/comments.ts`: add `promptNumber?: number` to `CardSignals` (`:427`). Build a `Map<id, index+1>` from `review.promptOrder` once per `setState`, and read it in `render()` (`:158-180`) where `signals` is assembled for `buildCard` (`:174`). `buildCard` prepends `<span class="mr-card-number">#N</span>`, built with `createElement`/`textContent`, to the card header, and pushes `item N in the last copied prompt` into `labelParts`.
- `media/webview.css`: add `.mr-card-number` using `--vscode-descriptionForeground` and tabular numerals, with no background-only state.
- `media/test/cards.test.ts`: add the tests below.
- `CHANGELOG.md`: add an `Unreleased` → Added entry.
MIRROR: `media/test/cards.test.ts:164-181`.
INVARIANTS: L-innerhtml-sanitized-only; L-theme-vars-only; L-state-not-by-colour-alone; L-webview-imports-messages-only; L-single-review-store (two panels, E14); L-changelog-unreleased.
DECIDED: D2, D17. Expected decision: the position of the number. Default: first child of `.mr-card-header`, before the author.
OUT OF SCOPE: header and the change view.
ACCEPTANCE: `npx vitest run --project webview media/test/cards.test.ts`, then `npm run check`. Tests:
- `shows #2 for the second prompt item`
- `added after copy`: no `.mr-card-number`.
- `no promptOrder shows no number`
- `numbers an addressed card`
- `item 3 in the last copied prompt` in the aria-label.
- `textContent`: the number is set as text, so `innerHTML` holds no markup but the span.
FAILURE PATHS: A missing or empty `promptOrder` gives no numbers. Ids absent from `comments` are ignored.
Depends on: N2.
Entry check: `grep -c "promptOrder" src/panel/messages.ts` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### V1: Shared counts and indicator wording (lane: app)

GOAL: The host and the webview count statuses with one helper, and the status bar and badge strings exist and are tested.
READ FIRST: `media/src/header.ts:30-45` (`countByStatus`); `media/test/header.test.ts:10-45`; `src/panel/messages.ts:14-22` (re-exports); `src/panel/notices.ts:1-40`; `src/test/notices.test.ts`.
CHANGE:
- `src/anchor/counts.ts` (new): `export function countByStatus(comments: readonly Comment[]): Record<CommentStatus, number>`, moved verbatim.
- `src/panel/messages.ts`: `export { countByStatus } from '../anchor/counts.js'`.
- `media/src/header.ts`: delete the local function, then import and re-export `countByStatus` from `../../src/panel/messages.js`.
- `src/panel/notices.ts`: add four functions over `c: Record<CommentStatus, number>`, where "needing action" is `n = c.open + c.addressed + c.orphaned`:
  - `statusBarText(c): string | null`: `$(comment) ` plus the non-zero parts of `N open`, `N to confirm` and `N needs re-link`, joined with ` · `. It returns `null` when `n === 0` (D8).
  - `statusBarTooltip(c): string`: all three counts, then the line `Open the review to check for changes.` (D25).
  - `badgeText(c): string | undefined`: `String(n)`, `9+` past `BADGE_CAP`, `undefined` at 0 (D7).
  - `badgeTooltip(c): string`: `0 open · 2 to confirm · 1 needs re-link`, with zero parts kept so the total is explained.

  Export `const BADGE_CAP = 9`.
- `src/test/notices.test.ts`: add the tests below.
MIRROR: `src/test/notices.test.ts` (exact-string assertions).
INVARIANTS: L-starter-no-duplicate-helper; L-webview-imports-messages-only; L-vscode-free-core (`src/anchor/**`); L-starter-limits-in-config (`BADGE_CAP`); L-bundle-size.
DECIDED: D7, D8, D20, D21, D25. Expected decision: the singular wording for one to-confirm comment. Default: `1 to confirm` (the phrase has no plural form).
OUT OF SCOPE: VS Code registration (V2). `header.ts` keeps exporting `countByStatus`, and the other notices are untouched, so the callers `comments.ts`, `orphans.ts`, `webview.ts`, `clearComments.ts`, `copyPrompt.ts` and `ReviewPanel.ts` don't change.
ACCEPTANCE: `npx vitest run --project node src/test/notices.test.ts` and `npx vitest run --project webview media/test/header.test.ts`, then `npm run check`. Tests:
- `statusBarText reads "$(comment) 3 open · 2 to confirm · 1 needs re-link"`
- `statusBarText is null at zero`
- `orphan-only shows needs re-link`: `$(comment) 1 needs re-link`, badge `1`.
- `caps at 9+`: 7 open + 3 to confirm gives `9+`.
- `badge counts everything needing action`: 0 open + 2 to confirm gives `2`, with tooltip `0 open · 2 to confirm · 0 needs re-link`.
- `status bar tooltip ends with the re-check line`
FAILURE PATHS: none: these are pure functions over counts, and zero counts yield `null`/`undefined`.
Depends on: N3.
Entry check: `grep -c "export function countByStatus" media/src/header.ts` prints 1.
Done: tests pass, committed, tracker row updated.

### V2: Status bar item and Explorer badges (lane: app)

GOAL: With any reviewed file active, the status bar shows its counts, and reviewed files carry a badge in the Explorer. Both stay current as comments change.
READ FIRST: `src/extension.ts:28-100` (synchronous activate, subscriptions, config and folder listeners); `src/store/ReviewStore.ts:55-70` (emitter); `src/store/ReviewStore.ts:440-530` (fire sites); `src/store/ReviewStore.ts:600-697` (the external-reread keep-state rule and the `resolveSidecar` mode check); `src/store/reviewFile.ts` (`parseReviewFile`); `src/store/registryKey.ts:13`; `src/test/integration/suite/store.spec.ts:14-21,76,205`; `src/test/integration/run.ts:22-47`.
CHANGE:
- `src/store/ReviewStore.ts`: add `static readonly onDidChangeAny: vscode.Event<{ target: vscode.Uri; review: ReviewFile }>`, backed by a static emitter. Fire it through one private `emit(review)` that replaces the four direct `fire` calls.
- `src/status/reviewIndex.ts` (new): `class ReviewIndex implements vscode.Disposable`. Its API:
  - a synchronous `constructor(output: vscode.OutputChannel, storeEvents: vscode.Event<{ target: vscode.Uri; review: ReviewFile }> = ReviewStore.onDidChangeAny)`;
  - `scan(): Promise<void>`;
  - `countsFor(uri): Record<CommentStatus, number> | undefined`;
  - `readonly onDidChange: vscode.Event<vscode.Uri[]>`;
  - exported `MAX_INDEXED_SIDECARS = 2000`, plus an optional `cap` constructor argument as a test seam.

  It does four things:
  - Per workspace folder whose scoped `storageLocation` is `workspace`, it `findFiles(new RelativePattern(folder, '.reviews/*.json'))` up to the cap.
  - It watches that same per-folder pattern: create/change re-reads, delete drops. A failed parse keeps the last counts (D26).
  - It subscribes to `storeEvents`.
  - It rebuilds the folder set on `onDidChangeWorkspaceFolders` and on `markdownReview.storageLocation` changes.

  It keys by `registryKey(uri.toString())`, and targets come from `targetPath` joined to the sidecar's folder (D22, D23). Parsing reuses `parseReviewFile` from `src/store/reviewFile.ts`.
- `src/status/indicators.ts` (new): `registerIndicators(index: ReviewIndex): { item: vscode.StatusBarItem; provider: vscode.FileDecorationProvider & { provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined }; dispose(): void }`. Returning the item and provider is the test seam, because VS Code has no API to read status bar text or decorations back.
  - The item is created with `createStatusBarItem(vscode.StatusBarAlignment.Left, 100)`. Its `command` is `{ command: 'markdownReview.open', title: 'Open review', arguments: [uri] }`, and its `accessibilityInformation.label` is the plain text without `$(comment)`.
  - It updates on `onDidChangeActiveTextEditor` (keeping the last markdown target when the editor is `undefined`, D35) and on `index.onDidChange`.
  - The provider fires its `onDidChangeFileDecorations` with the changed URIs, and returns `badge`/`tooltip` from `notices.ts` with `propagate: false`.
- `src/extension.ts`: `activate` stays synchronous (`:28`). Construct `new ReviewIndex(output)`, call `void index.scan().catch((error) => output.appendLine(...))`, then push `index` and `registerIndicators(index)` into `context.subscriptions`.
- `src/test/integration/suite/indicators.spec.ts` (new): the specs import source modules, not the extension bundle (`store.spec.ts:14-21`), so they get a separate `ReviewStore` static. Each test therefore builds its own `new ReviewIndex(output)` plus `registerIndicators(index)` from source, and asserts on `item.text` and `provider.provideFileDecoration(uri)`.
MIRROR: `src/test/integration/suite/store.spec.ts:76` (writing a sidecar into `MDR_WORKSPACE`) and `:205` (external rewrite).
INVARIANTS: L-single-review-store (the index holds counts only, never creates a store, D22); L-sidecar-path-separators; L-starter-bounded-list; L-starter-no-swallowed-errors (log every skipped sidecar with its path and reason); L-no-network; L-lazy-activation (unchanged until V3).
DECIDED: D3, D7, D8, D22–D27, D35. Expected decisions:
- Status bar alignment: Left, priority 100.
- An active non-markdown editor hides the item.
- "Markdown" means `languageId === 'markdown'`.
OUT OF SCOPE: `package.json` activation (V3), global-storage scanning (D24). The `emit` refactor keeps the instance `onDidChange` behaviour, so the other `ReviewStore` callers are unchanged.
ACCEPTANCE: `npm run test:integration` (the only runner that can load `vscode`), `npm run check`. Tests in `indicators.spec.ts`, each asserting exact text or badge:
- `no sidecars`
- `reads counts from a sidecar` (`item.text` equals `$(comment) 2 open · 1 to confirm`, and the badge is `3`)
- `targetPath from JSON` (a file named `a__b.md` in a subfolder)
- `skips a corrupt sidecar`
- `external sidecar write updates counts`
- `keeps last counts on an invalid edit`
- `store change updates counts` (fire the injected `storeEvents`)
- `global-storage review appears once loaded`
- `keeps the item while the pane has focus` (close all editors after showing the markdown file, and the item text is unchanged)
- `MAX_INDEXED_SIDECARS` (pass `cap: 2` with 3 sidecars and assert the `indexed 2 of 3` log line)
- `markdownReview.open` is the item's command, with the target URI argument.
FAILURE PATHS:
- A read or parse failure during the scan skips that file and logs `[index] <path>: <reason>`. During a watcher re-read, it keeps the last counts and logs.
- A `scan()` or `findFiles` rejection is logged by the `.catch` in `activate`, and the index still updates from store events.
- No workspace folders: nothing is scanned, and store events still work.
- At the cap, the scan logs `indexed N of M`.
Depends on: V1.
Entry check: `grep -c "onDidChangeAny" src/store/ReviewStore.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### V3: Activate where reviews exist (lane: app)

GOAL: After a window reload with no pane open, a workspace that holds reviews shows its indicators. Every other workspace stays unwoken.
READ FIRST: `package.json:29-31`; `src/test/integration/suite/activation.spec.ts:45-70`; `src/extension.ts:1-20`; `CLAUDE.md` "Hard constraints" activation bullet; `MARKDOWN_REVIEW_PRD.md:440-452` (§9); the `.claude/laws.md` L-lazy-activation row.
CHANGE:
- `package.json`: set `activationEvents` to `["onWebviewPanel:markdownReview.panel", "workspaceContains:.reviews/*.json"]`.
- `src/test/integration/suite/activation.spec.ts`: change the assertion at `:60-64` to the exact two-element array, with a message citing D3.
- `src/extension.ts`: update the header comment at `:7-12`.
- `CLAUDE.md`, `MARKDOWN_REVIEW_PRD.md` §9, `.claude/laws.md`: amend the rule to "exactly these two events; no `onStartupFinished`, no language event", giving the reason (indicators, D3).
- `CHANGELOG.md`: add an `Unreleased` → Added entry for the status bar item and Explorer badges.
MIRROR: `src/test/integration/suite/activation.spec.ts:51-65`.
INVARIANTS: L-lazy-activation, as amended in this same commit. L-bundle-size.
DECIDED: D3. U1 fallback: if O1 finds the pattern doesn't fire, a new row `V3b` switches to `workspaceContains:**/.reviews/*.json` and F re-runs. Don't pre-empt it here.
OUT OF SCOPE: the Plan 05 runsheet text (R1).
ACCEPTANCE: `npm run test:integration` (the activation spec runs only in the extension host) passes with the `workspaceContains:.reviews/*.json` assertion. `npm run check`. `node -e "console.log(require('./package.json').activationEvents.length)"` prints 2. `grep -c "workspaceContains" CLAUDE.md MARKDOWN_REVIEW_PRD.md .claude/laws.md` prints ≥ 1 for each file.
FAILURE PATHS: none: this is a manifest change, and its failure mode (the event not firing) degrades to today's behaviour, which O1 checks under U1.
Depends on: V2.
Entry check: `node -e "console.log(require('./package.json').activationEvents.length)"` prints 1.
Done: tests pass, committed, tracker row updated.

### CV1: Compute changed blocks host-side (lane: app)

GOAL: Each `reviewState` tells the webview which blocks changed since the prompt was copied, or why it can't say.
READ FIRST: `src/detect/changedRanges.ts:41-120` (`changedRanges`, `touches`, `merge`); `src/panel/ReviewPanel.ts:470-560` (`postReviewState`, `sectionChanged`, the memoised wrapper); `src/panel/messages.ts:82-86`; `src/test/changedRanges.test.ts`; `docs/plans/04-prompt-and-detection.md` §10 D17.
CHANGE:
- `src/detect/changedRanges.ts`: add `export function changedBlockRanges(doc: PlainTextDoc, ranges: readonly TextRange[]): TextRange[]`. It is a two-pointer sweep over sorted ranges and `doc.blocks`, marks a block if `touches([range], block)`, and merges adjacent marked blocks into one span. It returns `[]` for empty input. Also add the pure decision `export function changeStateOf(baseline: string | undefined, doc: PlainTextDoc, ranges: readonly TextRange[] | null): ChangeState`:
  - `no-baseline` when `baseline` is `undefined`;
  - `unchanged` when `baseline === doc.text`;
  - `too-large` when either length exceeds `MAX_DIFF_CHARS`;
  - otherwise `changed` with `changedBlockRanges(doc, ranges ?? [])`.

  A `null` `ranges` that reaches the last case is treated as `too-large`, never as unchanged.
- `src/anchor/types.ts`: add `export interface ChangeSpan { start: number; end: number }` and `export type ChangeState = …` (D28), next to `Located`. That file is the single home of shared shapes, and the detect modules already import from it, so the layers stay anchor ← detect ← panel.
- `src/panel/messages.ts`: re-export `ChangeSpan` and `ChangeState`, and add a required `changes: ChangeState` to `reviewState`.
- `src/panel/ReviewPanel.ts`: in `postReviewState`, compute `changes = changeStateOf(review.baselineText, doc, this.changedRanges(...))`, reusing the memoised wrapper at `:551-559`. It is not gated on `inferAddressed` (D29), and is passed in the existing `post` at `:480`.
- `src/test/changedRanges.test.ts`: add the tests below.
MIRROR: `src/test/changedRanges.test.ts` (rendering a doc with `renderPlainText` and asserting exact ranges).
INVARIANTS: L-block-offsets-single-source (spans come from `doc.blocks`); L-baseline-stays-on-host (only spans cross, never text); L-vscode-free-core; L-detection-corrections-first; L-reanchor-perf (linear sweep); L-starter-no-duplicate-helper (reuse `touches`).
DECIDED: D28, D29. Expected decision: whether `sectionChanged` should reuse `changeStateOf`. Default: no; leave it as is.
OUT OF SCOPE: webview rendering (CV2, CV3). The `webview.ts` handler ignores the new field until CV2, `dev/harness/index.html` posts without it until CV4, and the media tests call `setState` directly, so those callers are unchanged in this phase.
ACCEPTANCE: `npx vitest run --project node src/test/changedRanges.test.ts`, then `npm run check`. Tests:
- `marks the edited paragraph only`
- `merges adjacent changed blocks`
- `a deletion marks its neighbours`
- `empty ranges give no spans`
- `too-large`: `changeStateOf` with a `MAX_DIFF_CHARS + 1` baseline gives `{ state: 'too-large' }`.
- `changeStateOf maps each state`: `no-baseline`, `unchanged` and `changed` with exact `blocks`.
FAILURE PATHS: A missing baseline gives `no-baseline`, identical text gives `unchanged`, an oversize side gives `too-large`, and a timeout gives a coarser diff (E16). `null` from `changedRanges` is never shown as "no changes".
Depends on: V3.
Entry check: `grep -c "changedBlockRanges" src/detect/changedRanges.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### CV2: Mark changed blocks (lane: app)

GOAL: Blocks the agent changed since the prompt carry a gutter bar, including code blocks and tables, without moving any card or highlight.
READ FIRST: `media/src/webview.ts:460-590` (`applyReviewState`, its `documentGone` early return at `:510-514`, `lastReviewState` replay); `media/src/anchorSpace.ts:72-90` (`blockRef`, `blocksIn`); `media/src/comments.ts:150-400` (`render()`, the overlay pass that appends `buildHighlight` at `:258`, the `ResizeObserver` at `:331`, `originOf`/`buildHighlight` at `:386-400`); `media/webview.css:196-235` (the `overflow-x` rules); `media/webview.css:1026-1058` (forced colors); `media/test/cards.test.ts:164-181`.
CHANGE:
- `media/src/changes.ts` (new): add two functions.
  - `export function applyChangeMarks(root: HTMLElement, changes: ChangeState | undefined): number`. It removes `data-mr-changed` and the `aria-description` set by a previous pass. For `changed`, it sets both on every `blocksIn(root)` element whose `[start,end)` intersects a span (sorted two-pointer sweep). It returns the marked count. A missing `changes` (harness, older host) is treated as `no-baseline`.
  - `export function buildChangeBar(rect: DOMRect, origin: { top: number; left: number }): HTMLElement`, which returns a `div.mr-change-bar` positioned like `buildHighlight`.
- `media/src/comments.ts`: in `render()`'s overlay pass, beside the highlights, append one `buildChangeBar` per `root.querySelectorAll('[data-mr-changed]')` element, using its `getBoundingClientRect()`. Clearing the overlay already removes old bars. The existing `ResizeObserver` re-render keeps them in place.
- `media/src/webview.ts`: in `applyReviewState`, call `applyChangeMarks(content, message.changes)` *before* `comments?.setState`. On the `documentGone` path, call `applyChangeMarks(content, undefined)` so stale marks clear.
- `media/webview.css`: add `.mr-change-bar` (3px wide, `left` offset into the gutter, `background: var(--vscode-editorGutter-modifiedBackground)`). Add a forced-colors rule (`background: CanvasText`).
- `media/test/changes.test.ts` (new): the tests below.
MIRROR: `media/src/comments.ts:391-400` (`buildHighlight`) for the bar; `media/test/cards.test.ts:164-181` for jsdom over real-renderer markup.
INVARIANTS: L-block-offsets-single-source (read `data-ap-*` only); L-innerhtml-sanitized-only (attributes and `createElement` only); L-theme-vars-only; L-state-not-by-colour-alone (shape plus `aria-description`, and the forced-colors rule); L-webview-imports-messages-only; L-baseline-stays-on-host; L-harness-shell-in-step (the overlay already exists in both shells).
DECIDED: D28, D30. Expected decision: the bar's horizontal offset. Default: `left: -8px` relative to the block's rect, clamped to ≥ 0 within the overlay.
- **Amended during run (2026-11-14):** The gutter-bar colour the brief picked (VS Code's 'modified line' gutter colour) is missing from the dev harness's three theme presets, so the build's theme-variable check fails. Who adds it to the presets? → Let CV2 add --vscode-editorGutter-modifiedBackground to dev/harness/themes.css (base/dark, light and hc blocks, using VS Code's default values) so the CV2 commit builds (an assumption the owner confirms after the run) (grants: dev/harness/themes.css) [assumption: recommended option, owner confirms]
OUT OF SCOPE: the header control (CV3); harness (CV4). `orphans.ts` is unaffected.
ACCEPTANCE: `npx vitest run --project webview media/test/changes.test.ts media/test/cards.test.ts`, then `npm run check` (the build runs the CSS colour and theme-variable checks). Tests:
- `marks only intersecting blocks`, asserting the exact set of `data-ap-start` values marked.
- `clears marks when changes become unchanged`
- `undefined changes marks nothing`
- `sets aria-description on marked blocks`
- `buildChangeBar positions from the rect`
FAILURE PATHS: Undefined or unknown `changes` is treated as `no-baseline`, with nothing marked. A span matching no block marks nothing. A document that disappears clears its marks.
Depends on: CV1.
Entry check: `grep -c "changes: ChangeState" src/panel/messages.ts` prints 1.
Done: tests pass, committed, tracker row updated.

### CV3: "Show changes" header control (lane: app)

GOAL: The header shows `Show changes (N)` when the agent changed something since the prompt, opening the side-by-side diff, and `No changes since prompt` when it changed nothing.
READ FIRST: `media/src/header.ts:19-200` (`HeaderOptions`, `initHeader`, `setState`); `media/test/header.test.ts:1-60`; `media/src/webview.ts:240-550` (`initHeader` wiring, `applyReviewState`, the rewrite banner posting `showRewriteDiff`).
CHANGE:
- `media/src/header.ts`: add a pure `export function changesControl(changes: ChangeState | undefined): { kind: 'hidden' } | { kind: 'text'; label: string } | { kind: 'button'; label: string; title?: string }`, per D31. `setState(review, changes?)` renders it into the actions row after `clearAll`. Add `onShowChanges(): void` to `HeaderOptions`.
- `media/src/webview.ts`: pass `message.changes` to `header?.setState`. Wire `onShowChanges` to `vscode.postMessage({ type: 'showRewriteDiff' })`.
- `media/test/header.test.ts`: add the tests below.
- `CHANGELOG.md`: add an `Unreleased` → Added entry for the change view.
MIRROR: `media/src/header.ts:51-60` (`copyPromptLabel`, a pure label helper) and its tests in `media/test/header.test.ts`.
INVARIANTS: L-message-guard (reuses the existing `showRewriteDiff` message, no new webview→host type); L-innerhtml-sanitized-only; L-theme-vars-only; L-webview-imports-messages-only; L-changelog-unreleased.
DECIDED: D4, D31. Expected decision: whether `No changes since prompt` uses an existing muted class. Default: reuse the header's description-foreground style if one exists, else add `.mr-header-note`.
OUT OF SCOPE: marks (CV2). `comments.ts` and `orphans.ts` import from `header.ts` but not `setState`, so they are unchanged.
ACCEPTANCE: `npx vitest run --project webview media/test/header.test.ts`, then `npm run check`. Tests:
- `no-baseline hides the control`
- `unchanged shows "No changes since prompt"`
- `changed shows "Show changes (4)"`
- `too-large shows the button without a count`, with title `Too large to mark inline`.
- `the button posts showRewriteDiff`
FAILURE PATHS: Undefined `changes` hides the control. If the host-side diff command fails, the existing `ReviewPanel.ts:290` handler path applies.
Depends on: CV2.
Entry check: `grep -c "applyChangeMarks" media/src/webview.ts` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### CV4: Harness coverage for marks and numbers (lane: app)

GOAL: Change marks and card numbers are verified in a real layout engine across the three themes, including that bars on code blocks aren't clipped and marks don't move cards.
READ FIRST: `dev/harness/generate.mjs:100-304` (the `comment()` helper and the `nearby` scenario); `dev/harness/index.html:60-190` (shell, posting, check verdicts); `dev/harness/index.html:408-425` (a check to mirror); `dev/harness/index.html:579-600` (`runChecks`).
CHANGE:
- `dev/harness/generate.mjs`: add a scenario `changed` whose `changes` are computed with `changeStateOf`, imported the same way the file already imports the renderer, from a baseline that differs in one paragraph and one fenced code block. `promptOrder` is set on two comments.
- `dev/harness/index.html`: post `scenario.changes` in `reviewState`, and add four checks. Each skips outside its scenario.
  - `change marks land only on the changed blocks`
  - `change marks keep block heights`: block heights and card tops are equal with and without the scenario's `changes`.
  - `change bars on a code block`: the bar's rect lies within the overlay and vertically overlaps the `pre`'s rect after scrolling the `pre` horizontally.
  - `numbered cards show #N`
- `dev/harness/fixture.js`: regenerate with `node dev/harness/generate.mjs`.
MIRROR: `dev/harness/index.html:408-425`.
INVARIANTS: L-harness-shell-in-step (the shell is untouched; the `no uncaught errors` check must still pass); L-extend-harnesses.
DECIDED: D30.
OUT OF SCOPE: new harness pages.
ACCEPTANCE: `node dev/harness/generate.mjs`, then `npm run check`. Serve the repo root (for example `npx --yes http-server -p 8080 .`) and open `http://localhost:8080/dev/harness/`. Select scenario `changed` and each of the three theme presets in the page's controls. Each run reports `ALL CHECKS PASSED`. The run-phase executor drives this with the Chrome tools, reading page text rather than screenshots, and records the result lines in the tracker note.
FAILURE PATHS: none: this is a test harness. A failing check reports `N CHECK(S) FAILED` by design.
Depends on: CV3.
Entry check: `grep -c "changesControl" media/src/header.ts` prints ≥ 1.
Done: harness green, committed, tracker row updated.

### R1: README, changelog and release runsheet (lane: docs, kind: docs)

GOAL: The README leads with the new positioning and the shipped features, and the runsheets carry every remaining manual check and both publishes.
READ FIRST: `README.md:1-35`; `CHANGELOG.md:1-25`; `docs/plans/05-acceptance-run.md:40-260`; `docs/plans/04-acceptance-run.md:285-435`; `docs/media/RECORDING.md:57-96`.
CHANGE:
- `README.md`: replace `:1-12` with the D5 lead. Drop the `:11` claim. Add short sections on prompt numbers, status bar and badges (with the global-storage note, D24) and changes since prompt. Keep the prompt example accurate to Q1 (add one ambiguous item).
- `CHANGELOG.md`: the file has two unreleased `## [0.1.0]` sections (`:10`, dated 2026-08-06, and `:110`, dated 2026-08-05). Merge both, plus `Unreleased`, into one `## [0.1.0] — unreleased` at `:10`, dedupe repeated bullets, and delete the `:110` heading. Keep an empty `## [Unreleased]` above it. The owner sets the date on publish day.
- `docs/plans/05-acceptance-run.md`:
  - Part A: replace the stale list at `:48-56` with the 4 Plan 04 boxes, the blind real-agent run, B4 re-link, and new checks for each feature (Q1, N3, V2/V3 including the U1 reload check, CV2/CV3). Note that if the U1 check fails, the owner stops and adds row `V3b`.
  - Part B: the activation-events text at `:123-163` now says two events (D3).
  - Part C: add the Open VSX steps (sign the Publisher Agreement from the open-vsx.org profile after linking an Eclipse account, generate an access token, `npx ovsx create-namespace SabhahithWorks -p $OVSX_PAT`, `npx ovsx publish markdown-review-pane-0.1.0.vsix -p $OVSX_PAT`, and the namespace-ownership claim if the listing shows unverified, U2).
- `docs/media/RECORDING.md`: add a take showing the card number and the change marks.
MIRROR: `docs/plans/05-acceptance-run.md:228-253` (checkbox runsheet style).
INVARIANTS: L-no-vsce-publish, L-no-ovsx-publish (steps written, never run); README claims checkable against the 2026-11-13 competitor notes; L-no-network claims stay true.
DECIDED: D5, D6, D24, D33.
OUT OF SCOPE: running any publish or package command.
ACCEPTANCE: `grep -c "only for artifacts their own agent generated" README.md` prints 0. `grep -c "ovsx publish" docs/plans/05-acceptance-run.md` prints ≥ 1. `grep -c "^## \[0.1.0\]" CHANGELOG.md` prints 1. `npm run check`.
FAILURE PATHS: none: documentation only. Each runsheet step already names what to do when it fails.
Depends on: CV4.
Entry check: `grep -c "## \[Unreleased\]" CHANGELOG.md` prints 1.
Done: committed, tracker row updated.

### F: Final checks (lane: app, Opus)

GOAL: The branch is green on every gate, and every cited line still points at what it claims.
READ FIRST: §Progress; the Edge matrix.
CHANGE: none.
MIRROR: none.
INVARIANTS: all laws in scope above. The profile has no `docs.check` and no `docs.feature_index`, so both steps are skipped.
DECIDED: none.
OUT OF SCOPE: fixes; anything found becomes a new row.
ACCEPTANCE: `npm test && npm run typecheck && npm run lint && npm run build && npm run test:integration`, and `cite-shift.py --base $(git merge-base HEAD origin/main || git merge-base HEAD main) --require-symbol` prints `shift=0 review=0 nosym=0`.
For `/plan-engine:verify-work`, the user flows changed are:
- copy prompt (quote context, numbering);
- card rendering (numbers);
- the indicators (status bar, Explorer badge, click to open);
- the change view (marks, header control, diff).

Seams to exercise live: the host→webview `reviewState.changes` and `review.promptOrder`, and store→index counts.
FAILURE PATHS: none: this phase only runs checks.
Depends on: R1.
Entry check: `git status --porcelain | grep -v '^??' | wc -l` prints 0.
Done: gates pass, tracker row updated.

### O1: Manual acceptance (lane: docs, kind: owner)

GOAL: Plan 05 Part A is green, including the Plan 04 boxes, a blind real-agent run, B4 re-link and the new-feature checks.
READ FIRST: `docs/plans/05-acceptance-run.md` Part A as rewritten in R1.
CHANGE: none.
MIRROR: none.
INVARIANTS: Part A stops the release if it is not green (`05-acceptance-run.md:54`).
DECIDED: U1 is confirmed here. If the reload check fails, add row `V3b` (lane app, depends on F: switch to `workspaceContains:**/.reviews/*.json` and update the activation spec), re-run F, then resume O1.
OUT OF SCOPE: packaging. `docs/plans/04-acceptance-run.md` is ticked by the owner during the run. It isn't a CHANGE file, because owner phases have none.
ACCEPTANCE: every Part A box is checked in `docs/plans/05-acceptance-run.md`; `grep -c "\- \[ \]" docs/plans/04-acceptance-run.md` prints 0.
FAILURE PATHS: none: an owner run. A red box stops the release per `05-acceptance-run.md:54` and becomes a new row.
Depends on: F.
Entry check: `grep -c "workspaceContains" docs/plans/05-acceptance-run.md` prints ≥ 1.
Done: boxes checked and committed by the owner, tracker row updated.

### O2: Package, record, publish (lane: docs, kind: owner)

GOAL: 0.1.0 is live on the Marketplace and Open VSX, with a demo video and a `v0.1.0` tag.
READ FIRST: `docs/plans/05-acceptance-run.md` Parts B and C; `docs/media/RECORDING.md`.
CHANGE: none.
MIRROR: none.
INVARIANTS: L-no-vsce-publish, L-no-ovsx-publish. The owner runs both.
DECIDED: D6, D33.
OUT OF SCOPE: code.
ACCEPTANCE: `npm run package` produces the archive under the 500 KB budget; C1–C5 are checked; `git tag` lists `v0.1.0`.
FAILURE PATHS: none: an owner run. A failed packaged check stops before publish.
Depends on: O1.
Entry check: `grep -c "\- \[x\]" docs/plans/05-acceptance-run.md` prints ≥ 1.
Done: the owner records the publish, tracker row updated.

## Lanes and the contract

There is one lane (`app`, repo root; runner `npm (run )?(test|check)` / `npx vitest`), plus `docs` for 0, R1 and the owner rows. There is no contract phase: the only cross-boundary shape is `messages.ts`, which is compiled into both bundles and type-checked by `npm run typecheck` (three tsconfig projects), so drift fails the build. Shared files touched in several phases are all on one sequential chain:
- `CHANGELOG.md` (Q1, N3, V3, CV3, R1)
- `src/panel/messages.ts` (N1, V1, CV1)
- `src/anchor/types.ts` (N1, CV1)
- `src/store/ReviewStore.ts` (N2, V2)
- `media/src/header.ts` (V1, CV3)
- `media/src/webview.ts` (CV2, CV3)
- `media/src/comments.ts` (N3, CV2)
- `MARKDOWN_REVIEW_PRD.md` (Q1, V3)
- `package.json` (V3 only)

## Decision coverage

| decision | phase | verdict | quote |
|---|---|---|---|
| D1/D9–D13/D36 | Q1 | applies | "`describeAnchor` appends it to both phrasings per D9–D13 and D36" |
| D3 (rule) | 0, Q1 | applies (cited, untouched) | "D3 is cited because its rule covers …" |
| D14/D15/D19 | N1 | applies | "`isReviewFile` rejects `promptOrder` unless…" |
| D16/D18/D34 | N2 | applies (fixed) | "always commits `promptOrder` and **always notifies**"; "Over the limit it removes both" |
| D2/D17 | N3 | applies | "pushes `item N in the last copied prompt`" |
| D7/D8/D20/D21/D25 | V1 | applies (fixed) | "`statusBarTooltip(c)` … `Open the review to check for changes.`" |
| D22–D24/D26/D27/D35 | V2 | applies (fixed) | "watches that same per-folder pattern"; "keeping the last markdown target" |
| D3 | V3 | applies | "set `activationEvents` to […]"; docs grep in ACCEPTANCE |
| D28/D29 | CV1 | applies | "`changeStateOf` … not gated on `inferAddressed`" |
| D30 | CV2 | applies (fixed) | "append one `buildChangeBar` per … `[data-mr-changed]` element" |
| D4/D31 | CV3 | applies | "`changesControl(changes)` … per D31" |
| D30 | CV4 | applies | "`change bars on a code block`" |
| D5/D6/D24/D33 | R1 | applies | "replace `:1-12` with the D5 lead" |
| D32 | 0 | applies | "commit as-is (D32)" |
| D33 | O2 | applies | "The owner runs both" |

coverage-hash: 9a4a97af

## §Progress (resume here: the next phase, by the rule below)

| phase | lane | depends on | scope | state | commits | note |
|---|---|---|---|---|---|---|
| 0 | docs | - | branch, plan copy, laws | done | tag | branch created; plan copied; laws committed |
| Q1 | app | 0 | prompt quote context | done | tag | repeated quotes get (under heading, line N); 526 tests pass |
| N1 | app | Q1 | promptOrder model | done | tag | ReviewFile.promptOrder + guard, summary carries it, buildPrompt returns order; 530 tests pass |
| N2 | app | N1 | save order on copy | done | tag | snapshotBaseline records promptOrder, always notifies, clears baseline over limit; relink maps order; 530 + 54 integration pass |
| N3 | app | N2 | card numbers | done | tag | cards show #N from promptOrder (any status), aria-label item N; 535 tests pass |
| V1 | app | N3 | counts helper, indicator text | done | tag | countByStatus moved to src/anchor/counts.ts; statusBar/badge text+tooltip in notices.ts; 541 tests pass |
| V2 | app | V1 | index, status bar, badges | done | tag | ReviewIndex (scan+watcher+onDidChangeAny), status bar item, Explorer badge; 541 + 65 integration pass |
| V3 | app | V2 | activation event | done | tag | activationEvents adds workspaceContains:.reviews/*.json; laws/CLAUDE/PRD amended; 541 + 65 integration pass |
| CV1 | app | V3 | changed blocks host-side | done | tag | Tests 25 passed (25); Tests 549 passed (549) |
| CV2 | app | CV1 | change marks (overlay bars) | done | tag | leeway: dev/harness/themes.css (Recommended option: CV2 defines --vscode-editorGutter-modifiedBackground in the base/dark, light and hc preset blocks so check-theme-vars passes and the CV2 commit… |
| CV3 | app | CV2 | header "Show changes" control | done | tag | 1 fix round; Tests 19 passed (19); Tests 563 passed (563) |
| CV4 | app | CV3 | harness checks | done | tag | 2; changed 1.0, 1.0, 1.0; Tests 563 passed (563); ALL CHECKS PASSED; ALL CHECKS PASSED; ALL CHECKS PASSED; ALL CHECKS PASSED |
| R1 | docs | CV4 | README, changelog, runsheets | done | tag | 2 fix rounds; 0; 1; 1; Tests 563 passed (563) |
| F | app | R1 | final gates | done | tag | 0 (tree clean; F-r1.diff is empty); Tests 563 passed (563); SUMMARY shift=0 review=0 applied_lines=0 base=54f3386c code_files=41 nosym=0 |
| O1 | docs | F | manual acceptance | todo | | |
| O2 | docs | O1 | package, record, publish | todo | | |
| V | all | O2 | verification | in-progress | - | - |

Order: 0 → Q1 → N1 → N2 → N3 → V1 → V2 → V3 → CV1 → CV2 → CV3 → CV4 → R1 → F → O1 → O2
