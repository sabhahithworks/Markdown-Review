# Phase 4 — Prompt Generation & Change Detection

**Delivers:** the loop that is the product's reason to exist — copy a review prompt, let any agent
edit the file, watch statuses flip to `addressed`/`orphaned`, confirm with before/after. Also the
header bar (counts, filters), the orphan-triage UI, and the remaining commands.

Spec references: PRD §7 (prompt), §8 (change detection), §4 (status semantics), §11 (rewrite,
rename/delete failure modes), §10 Phase 4.

> **Read §10 before this document.** Several sections below were wrong, and are corrected there and
> inline. The build order is 4a (host) then 4b (webview), as executed.

## 1. Prerequisites

Phase 3 acceptance checklist (Plan 03 §8) passes. **Still outstanding at the time 4a and 4b were
written** — two manual boxes (the create-flow gesture and reload persistence) remain unticked and
undated. Phase 4b's header writes `PanelState.filter`, which rides the serializer path that box
covers, so it is the one that matters most.

## 2. Store extensions (delta to Plan 03 §3)

`ReviewStore` gains, as built:

```ts
snapshotBaseline(plainText: string, now?: () => string): void   // skipped over BASELINE_MAX_CHARS
applyReanchor(doc: PlainTextDoc, options?: ReanchorOptions): boolean   // true when something changed
reattach(id: string, anchor: Anchor): void      // orphan -> open on a hand-picked selection
reopen(id: string): void                        // addressed -> open, clearing the resolution
clearAddressed(): Promise<ClearResult>          // {ok,removed} | {ok:false,reason:'backup-failed'}
clearAll(): Promise<ClearResult>                // also drops the baseline
backup(): Promise<vscode.Uri | undefined>
static relink(context, from, to, output): Promise<...>   // §10 D8
```

Three things this section did not anticipate:

- `commit` gained `{ persist, notify }`. `applyReanchor` must **always** adopt its result in memory
  (hints track edits) but persist only when `changed` — otherwise every keystroke is a disk write,
  which is exactly what `ReanchorResult.changed` excludes hint drift to prevent. `snapshotBaseline`
  is the mirror case: persist, never notify, because nothing renders the baseline.
- The clears **abandon the whole operation when the backup fails**. Letting a user action delete
  comments is only defensible while it stays recoverable (PRD §4 forbids only *automatic* deletion),
  so `ClearResult` carries that outcome rather than throwing.
- `autoDetectResolution` is read inside the store, scoped to the target, so a folder-level setting
  wins in a multi-root workspace. `resolveSidecar`'s `storageLocation` read was given the same scope
  in passing.

## 3. `src/prompt/buildPrompt.ts` (operationalizes PRD §7)

Pure function; vitest-covered this phase.

```ts
function buildPrompt(
  review: ReviewFile,
  doc: PlainTextDoc,
  options?: { locate?: Locator },   // reuse a caller's locator; also the test seam for "unlocatable"
): { prompt: string; count: number }
```

- Includes **open comments only**. Not `addressed` (re-asking makes the agent redo work), not
  `orphaned` (its text is gone, so the quote sends the agent hunting for something absent), not
  `resolved`.
- Numbered in document order: located offset, then `createdAt`, then `id`. Both tiebreaks are
  load-bearing — two comments on one sentence share an offset, and unlocatable ones share the
  sentinel, so without them the golden test asserts `sort`'s stability rather than our ordering.
- Header and rules exactly per the PRD §7 template, with the workspace-relative `targetPath` in
  the first line. Straight apostrophes, U+2014 em dash, three-space `> ` indent, one trailing
  newline. The test fixture is diffed against the PRD file itself, so a transcription slip cannot
  make the golden agree with a wrong implementation.
- Quoted anchor text > 100 chars → middle ellipsis (` … `), keeping ~48 chars each side, via
  `safeSlice`. The result is *at most* 100 — a surrogate pair at a cut shortens a side — so assert
  `<=`, never `===`.
- `collapse()` **before** truncating (§10 D11), and `   > ` on every body line (§10 D10).
- When an anchor covers an entire heading block (`BlockSpan.kind === 'heading'` and the anchor spans
  it exactly — this is why Plan 01 §3 records `kind`), use `On the section "## Title"` phrasing,
  rebuilding the hashes from `headingLevel`. A partial cover gets the plain form: "On the section"
  is a claim about scope, and half a heading is not a section.
- `truncateQuote` lives in `anchor/text.ts` and is re-exported from `panel/messages.ts`, because the
  webview needs the identical helper for before/after cards and may only import from there.
- Tests (18): the PRD golden byte-for-byte, ordering and both tiebreaks, status exclusion,
  truncation at 99/100/101, a surrogate pair straddling *both* cut points, heading levels 1 and 6,
  partial-heading and non-heading-exact-span cases, multi-line and CRLF bodies, fenced-code anchors,
  zero-open, purity, and a guard that the prompt never asks for structured output.

## 4. `markdownReview.copyPrompt` command + button

- Enabled only when open comments > 0 (header button disabled state webview-side; the palette
  command shows "No open comments on <file>" when empty).
- On invoke: resolve target → load the sidecar → **bail before reading the file** if nothing could
  possibly be open → read → `renderPlainText` → **`applyReanchor`** → build → clipboard →
  **snapshot baseline** → info message `"N comments copied. Paste into your agent and @-mention
  <targetPath>."`
- Three orderings that are not arbitrary:
  - The early bail tests for "not `resolved`", not "is `open`" — re-anchoring can legitimately turn
    an orphan back into an open comment when its text reappears.
  - Re-anchor *before* building: with no pane open since the agent's last edit, the sidecar can
    still say `open` for a sentence that no longer exists.
  - Snapshot the baseline *after* the clipboard write, so a clipboard failure does not leave a
    baseline recorded for a prompt nobody received.
- Reads with `force`, bypassing the 2 MB guard: that guard exists to stop a partial render desyncing
  anchor space, nothing is rendered here, and a file that already carries comments has been through
  the pane's guard already.
- Wording lives in `panel/notices.ts` (`vscode`-free, unit-tested), including the singular case —
  PRD §7 shows only the plural, and "1 comments copied" is the first thing many users would see.

## 5. Change detection & status lifecycle (contract owner for wiring)

`src/detect/changeWatcher.ts`, **one per panel** — see §10 D7 for why not per store:

- **Two sources, one trigger** (PRD §8): `workspace.onDidChangeTextDocument` filtered to the target
  (and to events that actually carry a content change), and a `FileSystemWatcher` on the target path
  (agents write to disk directly). Both feed a single 400 ms coalescer, so a save — which fires both
  — costs one pass. The debounce lives in `src/detect/coalesce.ts`, pure and `vscode`-free, so the
  timing is a fake-timer unit test rather than a stopwatch in the integration suite.
- **The watcher does not own the pipeline.** It reports that something happened;
  `ReviewPanel.refresh()` does the read → render → re-anchor → post, which it already did. The
  "content and state in one pair" requirement was **already met** by that method before this phase —
  it posts `setContent`, then state, behind a `renderGeneration` guard. Phase 4 adds one call:
  `store.applyReanchor(plain)` between `ensureLoaded()` and `postReviewState()`.
- Reading prefers the open `TextDocument` over disk. That rule already existed in
  `ReviewPanel.readSource()`; it was extracted to `src/panel/readTarget.ts` so `copyPrompt` sees the
  same bytes the pane is showing, and the prompt's numbering matches the cards on screen.
- Gate: setting `markdownReview.autoDetectResolution: false` still re-anchors (positions must
  track edits) but never flips `open → addressed`; orphaning still applies (a gone anchor is gone
  regardless of the setting).
- **Never auto-close** (PRD §8): nothing in this pipeline may set `resolved`.
- `FileSystemWatcher` delete/rename → the panel's existing `targetUnreadable` state, which already
  says the right thing; Phase 4 adds a **Locate file…** action to it. Re-linking is a store
  migration, not a `targetPath` field update (§10 D8). The sidecar is never deleted by this path.

## 6. Status UI — deltas to Plans 02 §5 / 03 §5–6

Message additions **as built** — three of the six proposed here were redundant (§10 D4, D5):

```ts
// extension -> webview
| { type: 'rewriteDetected'; orphaned: number }
// webview -> extension
| { type: 'reopenComment'; id: string }      // addressed -> open (user disagrees with inference)
| { type: 'reanchorComment'; id: string; selectedText: string; offset: number; hintLine: number }
| { type: 'copyPrompt' } | { type: 'clearAddressed' }
| { type: 'showRewriteDiff' } | { type: 'relinkTarget' }
```

`reviewState.review` is narrowed to `ReviewSummary` (`Omit<ReviewFile, 'baselineText'>`) so the
baseline never crosses the channel (§10 D3).

- **Header bar**: open / addressed / orphaned counts, status filter chips (persisted via
  `setState`, Plan 03 §7), primary **Copy review prompt** button, **Clear addressed** action.
- **Addressed cards**: show `resolution.previousText` vs `currentText` as a compact inline
  before/after (del/ins styling via themed colors), plus **Looks good** (→ `resolved`) and
  **Reopen** buttons. `addressed` is a suggestion, the user confirms (PRD §8).
- **Orphaned section** (PRD §6): a `#orphans` section in **normal flow** below the header, listing
  each orphan with its original `anchor.exact` quoted, **Delete** and **Re-anchor**. Arming is
  webview-local (§10 D5); the selection arrives as one `reanchorComment` and the host runs
  `createAnchor` exactly as it does for `addComment`. Membership is decided by *position*, not
  status (§10 D14) — the gutter and this section share one predicate so they partition the comments.
- **Full-rewrite banner** (PRD §11): when a single re-anchor pass orphans every previously-*located*
  comment (at least two of them) and `baselineText` exists, show a banner with **Review the diff**.
  It fires on the transition and is dismissible, rather than being a permanent fixture (§10 D13).
  The action opens `vscode.diff` between **two** readonly `markdown-review:` documents — the stored
  baseline and `renderPlainText(current).text` — so both sides are the same language (§10 D1).

## 7. Remaining commands

- `markdownReview.clearAddressed` — moves all `addressed` → `resolved`? **No** — per PRD §6 it
  *clears* them: this is a user-initiated bulk delete of addressed comments. Modal confirm with
  the count first ("Remove 4 addressed comments? Their text changes stay in the document.").
- `markdownReview.clearAll` — modal confirm; deletes all comments for the file (sidecar becomes
  empty `ReviewFile`, file kept).
- Both are user actions, so the never-auto-delete rule is satisfied; both must be undo-friendly to
  the extent possible — write the pre-clear state to `<name>.json.bak` before clearing (reuse the
  Plan 03 §3 backup path).

## 8. Integration test (`@vscode/test-electron`)

The "full loop against a real agent" acceptance, made reproducible — a human run with a real agent
is still required once before sign-off. Built as `suite/detection.spec.ts`, plus store-level
coverage added to `suite/store.spec.ts`.

Comments are seeded by **writing the sidecar to disk**, not through the spec's own `ReviewStore`:
that would be a second instance in a second bundle, invisible to the running extension (the point
`store.spec.ts` already makes). It is also how a git-committed sidecar reaches a real user. Every
test uses its own document, because the extension keeps one store per URI for the life of the window
and memoizes the read — re-seeding a file another test opened races that store's watcher instead of
testing anything.

1. Copy prompt → clipboard equals the PRD §7 golden byte-for-byte; baseline snapshotted.
2. Direct `fs` write, no editor open — reword one anchor, delete another, leave the third:
   statuses are exactly `addressed` / `orphaned` / `open`, with the correct before/after.
3. An **unsaved** editor edit is detected, and disk still holds the original — proving both the
   document-change source and the buffer-over-disk rule.
4. A burst of writes coalesces, and `detectedAt` survives a following no-op write.
5. Full rewrite → all orphaned, sidecar parses, no `.bak`, baseline intact.
6. The diff's two sides are both rendered plain text; an absent baseline explains itself.
7. Clears back up, remove the right comments, and remove **nothing** when the backup fails.

The harness gained `afterEach` for this — cleanup written as a test's last statement is skipped
exactly when it matters. Mocha was reconsidered and declined: the suite grew by about six tests, and
`afterEach` was the only thing it actually lacked.

## 9. Acceptance checklist

Each item records *how* it is verified, following Plan 03 §8. The manual remainder is scripted in
[04-acceptance-run.md](04-acceptance-run.md), which also carries the two Phase 3 items that are
this phase's entry gate. Date this section when it passes.

- [x] Copy prompt produces the PRD §7 format byte-for-byte for the golden fixture; baseline
      snapshots at copy time
      — `buildPrompt.test.ts` against the PRD's own example (the fixture is diffed against the PRD
      itself, so it cannot drift), and again on the real clipboard in `detection.spec.ts`
- [ ] Real-agent manual run: comments flip to `addressed` with correct before/after; "Looks good"
      resolves; "Reopen" reverts
      — **manual, and the one item nothing else can stand in for.** PRD §10 names it as the
      acceptance for this phase. Every automated case uses synthetic edits
- [x] Deleting an anchored sentence orphans exactly that comment; orphan section shows the quote
      — `detection.spec.ts` for the status, `dev/harness/` `orphans` scenario for the section
- [ ] Manual re-anchor re-attaches an orphan
      — **manual**: `reattach` is covered in `store.spec.ts` and the armed row renders in the
      harness, but the gesture (arm → select → commit) needs a pane
- [x] Full rewrite → all orphaned, banner appears, diff view shows baseline vs current, no crash
      — `detection.spec.ts` (statuses, sidecar, both diff sides), `rewrite.test.ts` (the trigger
      rule), harness `rewrite` scenario (the banner, and that it is *on screen*)
- [x] `autoDetectResolution: false` never infers `addressed`, and a deleted anchor still orphans
      — `store.spec.ts` against the real setting. Re-worded per §10 D12: "keeps positions tracking"
      is unobservable, because hint drift is deliberately never persisted
- [x] Editor edits and direct disk writes both trigger detection; debounce coalesces bursts
      — `detection.spec.ts` for both sources; `coalesce.test.ts` for the timing, with fake timers
- [ ] Rename/delete of target → "target missing" + working re-link; sidecar preserved
      — `store.spec.ts` covers the migration and `detection.spec.ts` the surviving sidecar; the
      **file picker is manual**
- [ ] Clear addressed / clear all confirm, back up, and execute correctly
      — `store.spec.ts` covers backup, removal and the backup-failure abort; the **modals are
      manual** (§10 D9)
- [x] Integration test suite green alongside `npm test`
      — 421 unit, 39 integration. Plus, outside `npm run check`: 195 harness checks wide and 183
      narrow, across eight scenarios and three themes

## 10. Spec corrections applied in this phase

Recorded here so later phases don't "restore" them, mirroring Plan 01 §9 and Plan 03 §9. The
Phase 4 commit messages refer to this section as "§9"; it is §10 because the acceptance checklist
stays last-but-one, as in Plan 03.

### Release-blocking — these would have shipped broken

**D1 — the rewrite diff compared two different languages.** §6 as written opened `vscode.diff`
between a virtual document serving `baselineText` and *the current file*. But `baselineText` is
rendered **plain text** and the file is **Markdown source**: `renderPlainText` strips `#`, `**`,
list markers and table pipes, collapses whitespace and joins blocks with `\n`. Every line would have
differed, and the one feature whose entire job is "show me what changed" would have shown noise.
Fixed by serving **both** sides from the same function — `baselineText` against
`renderPlainText(current).text`. The integration test asserts the current side contains no `**` and
no `##`, so the defect cannot come back quietly.

**D2 — `baselineText` makes the sidecar unbounded.** PRD §4 puts the whole rendered snapshot in the
sidecar. The render guard admits documents up to 2 MB, so that is a multi-megabyte JSON string,
rewritten on every later save and committed to git — contradicting PRD §4's own "human-readable" and
PRD §11's "shareable". Fixed with `BASELINE_MAX_CHARS = 256 KB` in `store/reviewFile.ts`: above it
the baseline is skipped with an output-channel line, and the *only* casualty is the rewrite diff for
that file. Nothing else reads the baseline — `anchor.exact` is the per-comment comparison basis
(PRD §5), not this.

**D3 — `reviewState` shipped the baseline to the webview.** The message posts the whole `ReviewFile`
and goes out on *every* state change, so once a baseline existed, up to 256 KB crossed the channel
each time a status flipped. Unnoticed only because nothing set the field until this phase. Fixed
with `ReviewSummary = Omit<ReviewFile, 'baselineText'>` and a `toReviewSummary` written field by
field, so adding a required field to `ReviewFile` fails to compile until someone decides whether the
webview should see it.

### Corrected in this plan, inline above

**D4 — three of §6's messages were redundant.** `confirmAddressed` duplicates the existing
`resolveComment` ("Looks good" is a button label, not a new host action). `targetMissing` duplicates
`targetUnreadable`, whose doc comment already named Phase 4 as the owner of the re-link action.
`setFilter` is a host-side no-op: PRD §6 puts filter state in `getState`/`setState`, and
`PanelState.filter` was already declared *and* guard-validated — the only gap was that `saveState()`
never wrote it. A message the host receives and ignores is dead contract surface with a guard, a
test row and a switch case attached. `messages.test.ts` asserts `setFilter` is *rejected*, so the
decision is pinned rather than remembered.

**D5 — `reanchorManually` put a mode in the host.** A host-side "waiting for a selection" flag
outlives the webview that set it and can be left armed for a comment the user can no longer see.
Replaced by one `reanchorComment` carrying the selection, reusing `addComment`'s payload shape and
therefore its validation, its `-1` sentinel and its rejection wording. Arming is webview-local.

**D6 — [Phase 3 bug] orphaned cards overlapped.** `reposition()` added `.mr-card-orphaned` and
`continue`d before the card reached `stackTops`, so no orphan ever had a `top` set — and `.mr-card`
is `position: absolute`, so they all resolved to the same static position and stacked on each other.
Invisible because the only orphan scenario had exactly one orphan. Fixed by construction: orphans
moved to a section in normal flow, which is what PRD §6 asked for anyway. See D14 — the first fix
was incomplete.

**D7 — a store-owned change pipeline cannot render.** §5 put read → render → re-anchor → post in a
watcher owned by the store. But `renderMarkdown` needs an `ImageResolver` built from
`webview.asWebviewUri`, which is per-*webview*, not per-target. A store-side pipeline would have to
either render without it or hand the panel a source string to render again — and the second is the
two-substrates desync Plan 03 §9 C1 spent a release-blocking correction removing ("rendering both
from the same source string on the same code path is what keeps anchor space honest"). The watcher
is a trigger source; `ReviewPanel.refresh()` keeps the pipeline; watchers are panel-scoped.

*Consequence, accepted deliberately:* a hidden pane stops updating statuses, because `refresh()` is
gated on the webview being ready and PRD §6 rules out `retainContextWhenHidden`. It self-heals on
show — the reloaded webview posts `ready`, which refreshes against current content — and status is
a derived value, so nothing is lost. The alternative is a full re-anchor pass on every keystroke in
a document nobody is looking at.

**D8 — "on re-link, update `targetPath`" is not a field update.** Stores are keyed by target URI and
the sidecar *filename* derives from the target path, so re-linking is a migration between two
stores: `ReviewStore.relink(context, from, to, output)`. It writes the destination and verifies it
reached disk *before* emptying the source, so a failure at any point leaves the comments somewhere
rather than nowhere. The old sidecar is emptied, never deleted (PRD §11).

**D9 — the clear commands' modals are unreachable from `@vscode/test-electron`.** A modal cannot be
answered from the test process, and a test-only `skipConfirm` parameter in production code is worse
than the gap. Split: the store behaviour is integration-tested (backup, correct removal, and the
backup-failure abort), the modal goes on the manual list.

**D10 — PRD §7 does not specify multi-line comment bodies**, and the card is a textarea, so they are
routine. Decided: `   > ` on **every** line, blank interior lines included. It is the only option
that is both lossless and unambiguous — collapsing destroys a bulleted list of three concerns, and
indenting continuation lines without `>` renders, in any agent that reads the prompt as Markdown, as
a blockquote followed by loose paragraphs at ambiguous nesting.

**D11 — a fenced-code anchor contains literal newlines.** Anchor space preserves fence content
verbatim, so `On: "…"` would break across lines. The *quote* is `collapse()`d before truncation;
`anchor.exact` is the durable record and is never rewritten.

**D12 — the `autoDetectResolution: false` acceptance item was unobservable as worded.** With
`inferAddressed: false` a text drift changes only hints, and hint drift is deliberately never
persisted (Plan 01 §6), so "positions still track" has nothing to assert against. Re-worded as the
observable pair: **nothing becomes `addressed`, and a deleted anchor still orphans.**

**D13 — the rewrite banner is an event, not a state.** `setContent` already clears the notice, so a
condition-derived banner would re-appear on every re-render of an already-wrecked document. It fires
once on the transition (`changed && rewritten`) and carries a Dismiss; the durable, actionable UI is
the orphan section. The trigger also requires **at least two** previously-located comments —
announcing a rewrite because one sentence was deleted spends credibility the banner needs for the
real case.

### Found by the layout harness, after 4b was written

All three were invisible to vitest, which reports every rectangle as zero, and to the integration
suite, which never renders. They are why `dev/harness/` exists.

**D14 — D6's fix was incomplete: status and position legitimately disagree.** Moving orphans out of
the gutter keyed on `status === 'orphaned'`. But `applyReanchor` — the only thing that sets that
status — runs during a re-render, while `postReviewState` also fires on *any* store change. An
externally hand-edited sidecar (PRD §11 explicitly invites one) therefore reaches the webview saying
`open` with an anchor that cannot be found: it fell through both views, kept `position: absolute`
with no `top`, and piled up exactly as before. Fixed by making **position** decide placement, via one
`belongsInOrphans` predicate both views share, so they partition the comments and nothing can fall
through both. `resolved` is exempt — terminal, never re-anchored, and belongs in the collapsed group
rather than a triage list asking the user to act.

**D15 — the header and orphan sections moved the content out from under the highlights.** Both are
in normal flow above `#content`, and `reviewState` updated them *after* `comments.setState()` — so
rectangles were measured, then everything below shifted. Long paragraphs absorbed the offset; short
blocks did not, and highlights landed on the wrong line. Fixed by ordering the three updates so what
is measured is measured last.

**D16 — the rewrite banner rendered below the entire document.** `#notice` was the last element in
the shell, which suits the two states that clear the content first (`tooLarge`, `targetUnreadable`)
but not one that fires over a full document. Moved above the content in both shells, and the harness
check now asserts the banner is **on screen at scroll top** rather than merely present — "exists"
was the assertion that let this through.

### Noted, not changed

- `#notice` remains a single slot shared by `tooLarge`, `targetUnreadable` and `rewriteDetected`.
  They are mutually exclusive in practice: a rewrite cannot be detected without a rendered document.
- `resolveSidecar` read `storageLocation` without a resource scope, so a folder-level setting was
  ignored in a multi-root workspace. Fixed in passing while adding the scoped `autoDetectResolution`
  read; not a Phase 4 defect.
- Phase 3's open finding — `.mr-highlight` differentiating by `background-color` alone, which
  Windows forced-colors mode strips — is untouched by Phase 4 and stays on the acceptance run's
  theme step.
