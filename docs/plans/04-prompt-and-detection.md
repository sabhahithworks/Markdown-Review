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
this phase's entry gate.

**All items ticked 2026-08-05**, the last two being the real-agent run and the re-link. Two
qualifications, neither of which owns a box here, so both are stated rather than hidden by the
ticks:

- **B3 (full rewrite and the diff) was skipped, not run.** Item 5 is ticked on automated coverage,
  which is genuine, but `04-acceptance-run.md` B3a–B3c stay open. B3c's **Dismiss** button (Plan 06
  H7) has no coverage of any kind.
- **B6 (`autoDetectResolution: false`) has not been re-confirmed by hand.** Item 6 is ticked on
  `store.spec.ts` against the real setting, which is the stronger evidence anyway; the manual pass
  was only ever a confirmation.

- [x] Copy prompt produces the PRD §7 format byte-for-byte for the golden fixture; baseline
      snapshots at copy time
      — `buildPrompt.test.ts` against the PRD's own example (the fixture is diffed against the PRD
      itself, so it cannot drift), and again on the real clipboard in `detection.spec.ts`
- [x] Real-agent manual run: comments flip to `addressed` with correct before/after; "Looks good"
      resolves; "Reopen" reverts
      — **passed in full 2026-08-05** on the D24 build. B1b re-run after the H0 and H8 fixes, and
      **B1c re-run blind**, by an agent that had not read the expectation — which is what PRD §10
      asks for and what discharges the qualification recorded below.
      — **manual, and the one item nothing else can stand in for.** PRD §10 names it as the
      acceptance for this phase. Every automated case uses synthetic edits.
      **Passed 2026-08-05**, completed on the **packaged `0.1.0` `.vsix` in stable VS Code** rather
      than a dev host. A comment flipped to `addressed` with a before/after that was genuinely the
      agent's edit, a heading-anchored comment correctly declined to (§10 D17's fix, working), and
      the second run closed B1d/B1e — **Looks good** resolves, **Reopen** reverts. Two
      qualifications stand and are not blocking: a comment orphaned rather than flipping in the
      first run (§10 D21), and B1c was verified by an agent that had read the expectation, so it
      still wants one blind re-run
- [x] Deleting an anchored sentence orphans exactly that comment; orphan section shows the quote
      — `detection.spec.ts` for the status, `dev/harness/` `orphans` scenario for the section
- [x] Manual re-anchor re-attaches an orphan
      — `store.spec.ts` for `reattach`; `dev/harness/` **Run gestures** for the gesture itself:
      arm from the orphan row, select new text, confirm the button reads "Re-anchor here", commit,
      and assert a `reanchorComment` carrying the right id and text — plus that **no popover opens**,
      which is the part of the design a human would most easily forget to check. Escape disarms
- [x] Full rewrite → all orphaned, banner appears, diff view shows baseline vs current, no crash
      — `detection.spec.ts` (statuses, sidecar, both diff sides), `rewrite.test.ts` (the trigger
      rule), harness `rewrite` scenario (the banner, and that it is *on screen*)
- [x] `autoDetectResolution: false` never infers `addressed`, and a deleted anchor still orphans
      — `store.spec.ts` against the real setting. Re-worded per §10 D12: "keeps positions tracking"
      is unobservable, because hint drift is deliberately never persisted
- [x] Editor edits and direct disk writes both trigger detection; debounce coalesces bursts
      — `detection.spec.ts` for both sources; `coalesce.test.ts` for the timing, with fake timers
- [x] Rename/delete of target → "target missing" + working re-link; sidecar preserved
      — **passed 2026-08-05**, the first time B4 was ever exercised. `showOpenDialog` has now been
      opened by a human, the unreadable notice offered **Locate file…** as its only action, and the
      comments migrated with the old sidecar left emptied rather than deleted. That is D22's fix
      confirmed in the place it was meant to be confirmed.
      — `store.spec.ts` covers the migration and `detection.spec.ts` the surviving sidecar; the
      **file picker is manual**. **Still not exercised after the 2026-08-05 packaged run**: that
      attempt reached for **Re-anchor** on an orphan card and re-anchored a comment by selecting
      text — the B2 gesture, not this one — so `showOpenDialog` has still never been opened by a
      human. See §10 D22; the confusion is the finding
- [x] Clear addressed / clear all confirm, back up, and execute correctly
      — **passed 2026-08-05** on the packaged build, all five boxes (B5a–B5e): cancel writes no
      backup, confirm writes one and removes, the header button routes the same way, clear-all
      leaves the document byte-identical, and the empty case writes no `.bak` over the good one.
      `store.spec.ts` covers backup, removal and the backup-failure abort; the **modals are
      manual** (§10 D9)
- [x] Integration test suite green alongside `npm test`
      — 465 unit, 40 integration. Plus, outside `npm run check`: 195 harness checks wide and 183
      narrow, across eight scenarios and three themes, and three gesture checks

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

### Found by the first real-agent run

**D17 — a comment on a heading can never be inferred `addressed`.** The acceptance run's whole
purpose, delivering on its first use. A comment was anchored to a heading, the agent rewrote the
section beneath it, and the comment stayed `open` — correctly, per PRD §5, and uselessly.

The root cause is that `anchor.exact` does two jobs. It is the *reference* the user pointed at, and
the *evidence* that the comment was acted on. Those coincide only when the fix lands inside the
selection, which is not true of any comment whose anchor **labels** the thing to fix: a heading, a
list's intro line, "add a caveat after this". So this was never a heading special case. Worse, the
pane had no way to say "the agent ran and changed something near here", so the state was
indistinguishable from the agent never having run at all.

Fixed with a second, weaker, **derived** signal rather than by widening `addressed` — that status is
the one thing the user is asked to trust, and buying coverage with false positives spends exactly the
credibility it depends on. `src/detect/scope.ts` decides what region a comment is about,
`src/detect/changedRanges.ts` diffs `baselineText` into current-document coordinates, and
`ReviewPanel.postReviewState` intersects the two. Nothing is persisted, no status was added, and the
sidecar format is unchanged. PRD §5 and §8 are amended.

Two things fell out of it:

- `buildPrompt` and the detector had disagreed about what a heading anchor means. The prompt said
  `On the section "## …"` while `reanchor` watched only the heading line. They now share `scopeOf`.
- `headingBlockAt`'s exact-span-equality rule is gone. It reasoned that "half a heading is not a
  section" — but the anchor that produced D17 was a heading selected without its manual `2. `
  numbering, which is the ordinary gesture, and nobody selects three words of a heading to talk
  about only those three words. An anchor that *runs out* of the heading still falls back to block
  scope; that boundary has its own test.

**Also corrected: PRD §5 claimed locating an anchor inside `baselineText` was "not implementable".**
Too strong — `createLocator` reads only `doc.text`. What the baseline lacks is block structure, and
the signal needs none: it maps the diff into the current document, where the block map is the one
just rendered. The conclusion the claim supported (that `anchor.exact`, not `baselineText`, is the
`addressed` comparison basis) is unaffected and stands.

**D18 — a comment on a code block reported itself `addressed` on an unedited document.** The second
defect from the same acceptance run, and a false positive on the one status the design asks the user
to trust.

`createAnchor` ran `normalizeAnchorText` over every selection, collapsing whitespace. `walkSpans`
keeps code **verbatim** (PRD §5). So a multi-line code anchor's `exact` — newlines and indentation
flattened to single spaces — could not occur in `doc.text` at all: tiers 1 and 2 could never match
it, tier 3 found it fuzzily at 0.5, and the fuzzy span came up a few characters short of the block.
`reanchor` read that shortfall as an edit and flipped the comment to `addressed`, with a before/after
that looks identical to a human because it *is* identical apart from the clipped tail.

The webview was already right — `anchorSpace.ts::buildBlockMap` keys off `isCodeBlock(el)` and sends
code verbatim. The line that broke it was `createAnchor`'s "defensive re-normalize", added as
insurance against the host and the webview drifting apart; it was itself the drift, destroying a
correct value on arrival.

Why it survived Phase 1's test matrix: PRD §5 requires a case for "anchor inside a fenced code
block", and there is one — on a *single line* of code. One line has no newline to flatten, so it
passes either way. The new cases are multi-line.

Fixed in three places: `createAnchor` picks its normalization from the block kind at the selection's
start; `locate` gains tier 2b for anchors already written the old way (and for hand-edited sidecars,
which PRD §11 invites); and `blockIndexAt` moves into `plaintext.ts` so `offsetToSourceLine`,
`createAnchor` and `scope.ts` stop keeping three copies of the same binary search.

**Found by D18 and left alone: `fuzzy.verify` under-reports the end of a match when the text grew.**
It scores an unpadded window of exactly `exact.length` against a padded one, and — as its own
comment explains — `diff_main`'s global alignment scatters the padding through the match rather than
emitting it as a clean leading run, so the unpadded window usually wins and the span stops short by
however much the text lengthened. The *status* is correct; only the before/after on the card is
clipped. `reanchor.test.ts` documents it with an assertion that holds before and after a fix.

### Found by a later real-agent run

**D20 — [Phase 3 bug] the comment popover falls off the bottom of the pane.** Surfaced by the
acceptance run's own comment 3, which anchors to `The exact ordering has not been written down
anywhere` — the fixture's final paragraph, and therefore always near the viewport bottom.

`.mr-popover` is `position: fixed` (`media/webview.css:549`) and was placed at `rect.bottom + 8`
with `Math.max(…, 8)` as the only clamp (`media/src/selection.ts:358`). That clamp guards the
**top-left** edges and nothing else, so a selection in the bottom ~150 px pushed the popover past
the fold — and being `position: fixed`, it could not be scrolled back: the popover stays pinned to
the viewport while the document moves underneath. `.mr-popover-actions` is the popover's last row,
so **Cancel** and **Comment** were exactly what disappeared, leaving a composer that could be typed
into but not submitted or dismissed except by <kbd>Esc</kbd>.

The consequence is not confined to this fixture: commenting on the last screenful of *any* document
required scrolling the passage higher first. Since the popover is positioned once at open time from
the captured rect, that workaround did work — which is likely why the gesture went unnoticed by
hand.

The floating **Comment** button did not share the vertical half: it places *above* the selection
(`selection.ts:254`), so it degrades at the top edge, where the existing clamp catches it. Both
elements shared the horizontal half — neither clamped against `innerWidth`, so a selection near the
right of a wide pane overflowed sideways.

Fixed with one `placeFixed` helper used by both: measure after unhiding, try the preferred side,
flip to the other when the preferred one overflows, then clamp into the viewport on both axes. Flip
before clamp matters — clamping alone would slide the popover up to overlap the very text the user
selected, which is worse than a flip for a composer whose whole job is to sit beside that text.

Why nothing caught it: jsdom reports every rectangle as zero, so the vitest suites are blind to it
by construction, and `dev/harness/` — which does have a real layout engine and does drive a real
selection — opened the popover only against text mid-viewport. A `popover: clamped to the viewport`
gesture now opens it against the bottom edge and asserts the action row is inside `innerHeight`,
which is the assertion whose absence let this ship.

**D19 — the D17 note says "section" for a scope that is a block.** **Fixed 2026-08-05** — the note now
reads *"The text around this changed since you copied the prompt"*, the second of the two options
below. `scopeOf` returns
`ScopeKind = 'section' | 'block'` (`src/detect/scope.ts:30`), and an anchor that is not a heading
falls back to block scope — one paragraph, one list item, one fence. But `sectionChanged` travels to
the webview as a bare `string[]` of ids (`src/panel/messages.ts:85`), so the kind never crosses the
channel, and `sectionNote` (`media/src/comments.ts:432`) hardcodes one string for both: *"This
section changed since you copied the prompt"*.

Observed on two comments anchored to inline code spans — `Authorization` and `RATE_LIMIT=600` —
inside paragraphs the agent rewrote. Both correctly stayed `open` (their anchor text survived
verbatim, so `addressed` would have been a lie) and both correctly raised the weaker signal. Only
the noun is wrong: the card claims a heading-delimited section moved when the diff touched a single
paragraph.

This is worth more than the usual wording nit because of the argument `sectionNote`'s own doc
comment makes: the phrasing was chosen on the grounds that *"This section changed" is a fact*, as
against a guess the extension deliberately declines to make. At block scope it is not quite a fact —
it overstates the region. The note's whole value is being an observation precise enough for the user
to judge, and this is the wrong direction for it to be imprecise in.

Two fixes are open, and the choice is a real one rather than a formality. Widening the message to
carry the kind gives the truthful noun per comment but adds a field to a contract that has stayed
deliberately narrow (D3 exists because that message is posted on *every* state change). Picking
wording true at both scopes — "The text around this changed since you copied the prompt" — costs
nothing on the wire and loses the sharper word in the case where "section" is exactly right.

No status, no persistence and no sidecar field is involved, so nothing downstream depends on which
way it goes.

**Resolved: the wording, not the wire.** Widening the message would have bought the sharper noun in
the section case at the cost of a field on a contract D3 exists to keep narrow, and the note's value
is precision *about the region* — which the neutral phrasing does not lose. Overstating was the
wrong direction to be imprecise in; understating is not, because "the text around this" is exactly
what the detector actually compared.

Also fixed the reason it slipped: the string had **no test**. `media/test/comments.test.ts` now
asserts the *requirement* rather than the copy — the note must name no scope word (`section`,
`block`, `paragraph`) while still saying what changed and when — so rewording stays free but
re-introducing a scope claim fails. `sectionNote` is exported for that, the same reason `stackTops`
is. PRD §8 and the `04-acceptance-run.md` expectations were updated to match; leaving them stale
would have made the next manual run fail against a document that was itself wrong.

**D21 — an anchor that states an absence can only be addressed by deleting it, so it orphans.**
*Recorded, not yet fixed.* Found 2026-08-05 by the scripted B1 run, on comment 3: *"What is the
ordering?"*, anchored to *"The exact ordering has not been written down anywhere"*. The agent wrote
the ordering down, which necessarily removed the sentence saying it was unwritten — once the
ordering is recorded, that claim is false. The comment came back `orphaned`.

This is **not** the case the acceptance run tells the reader to triage as a prompt problem. That
rule assumes a paragraph-level rewrite where a clause-level edit would have done, and the fix is
PRD §7's wording. Here no edit at any granularity preserves the anchor: replacing only the clause
still deletes it, because the clause is the thing the comment asked to be made untrue.

It is the same family as D17, and the mirror of it. D17 covered anchors that **label** the thing to
fix — a heading, a list's intro line — where the fix lands outside the selection. D21 is anchors
that **negate** it, where the fix lands on top of the selection by erasing it. In both, `exact` is
being asked to serve as reference and as evidence at once, and the two come apart.

D21 lands harder than D17, though. D17's comment stayed `open` — accurate, if unhelpful. D21's
becomes `orphaned`, which is the triage state: it tells the user something may have been lost and
asks them to go and look, for a comment that was answered completely and correctly. The one status
that means "come and check this by hand" is being spent on the outcome the user wanted.

The machinery for a fix already exists and needs no new status. `changedRanges` knows that region
of the document changed; `postReviewState` already intersects it with each comment's scope to raise
the D17 note. It is not applied to orphans because an orphan has no located span to intersect
against — but the *baseline* offsets of its last known position are exactly what the diff is
expressed in. Carrying the same weaker signal onto the orphan row in `media/src/orphans.ts` —
"the text this pointed at was rewritten since you copied the prompt" — would separate *deleted
because you asked for it* from *deleted by accident*, which is the distinction the row cannot
currently draw. Nothing persisted, no sidecar change, same shape as D17's fix.

Observed in the same run and worth deciding alongside it: the `fuzzy.verify` under-report recorded
above is user-visible on the `addressed` card, and it truncates **mid-word** — comment 1's "after"
read `Counters live in memory, so they do no` against a 46-character "before". The status is right
and the clipping is known, but on screen it reads as corrupted text rather than as a shortened
quote. Snapping the span to a word boundary, or marking it with an ellipsis, would cost nothing and
is independent of fixing the under-report itself.

### Found by the packaged-build acceptance run

**D22 — the two recovery actions compete, and the wrong one is more discoverable.** The 2026-08-05
run on the packaged `.vsix` set out to do B4 — rename the target, then re-link the review to the
renamed file through **Locate file…** on the unreadable notice. It instead clicked **Re-anchor** on
an orphaned comment card and re-anchored that comment by selecting new text. The picker was never
opened, so §9 item 8 is still untested after two acceptance runs.

Two different repairs are on screen at the same time and they are easy to confuse. **Locate file…**
repairs *the review's target* — one file picker, all comments migrate. **Re-anchor** repairs *one
comment's position* — arm, select text, commit. They fix different breakages, but both read as "this
is broken, fix it", and the one that is wrong for a renamed file is the one sitting on a card in the
content area, where the eye already is. The notice's button is in a replaced pane the user has just
been told they cannot read.

Nothing is broken in either flow — the re-anchor round trip through the host worked correctly, which
is itself a first (04-acceptance-run.md B2b–B2d's host half had no human confirmation before this).
The finding is that the UI does not distinguish the two repairs well enough for someone holding the
script that names them. Worth considering before v1: the unreadable notice could suppress the orphan
section entirely — with the target unreadable, every comment is orphaned by definition and
re-anchoring one against a file that cannot be read is not a coherent action.

Recorded, then fixed in Phase 6 (H7): the unreadable notice replaces the pane's content *and*
empties the orphan section, so **Locate file…** became the only action on screen. The pull was
confirmed by a second observation — a later attempt reached for **Re-anchor** the same way — which
is what the "one observation" caveat below asked for before moving anything.

**Fix verified 2026-08-05.** B4 passed on its third attempt at being reached, with the right button
clicked this time and no orphan card visible under the notice. Closed.

Covered 2026-11: harness checks and `rewrite.test.ts` (release-expansion T1).

### Found by the A2 step 5 reload run

**D23 — the `ready` latch is cleared by a visibility flip that did not tear the context down, and
nothing ever re-arms it.** A2 step 5 — reload the window with the review pane as the only editor —
came back with the tab restored and the pane permanently blank. The comments were intact, the
output channel existed and was empty, and closing the pane and reopening it rendered everything
correctly. Confirmed on 2026-08-05 by switching to another editor tab and back, which repopulated
the pane immediately.

`ready` (`src/panel/ReviewPanel.ts:65`) gates every host→webview message: `post()` drops silently
when it is false, and `refresh()` returns early. It is set only by the webview's `ready` message and
cleared on any `onDidChangeViewState` where `panel.visible` is false. The comment above that handler
states the assumption it rests on — *"hiding the panel tears the webview context down; the script
reloads on show and posts a fresh `ready`"* — and that is true for a real hide, but not for the
transient view-state churn a window restore produces. The sequence:

1. The revived webview boots and posts `ready`; the host sets `ready = true`, posts `init` and calls
   `void this.refresh()`.
2. `refresh()` is async and awaits `readTarget`, yielding the event loop mid-flight.
3. A transient `visible === false` arrives during restore and clears the latch.
4. `refresh()` resumes, renders correctly, and calls `post()` — which discards the result.
5. The context was never destroyed, so no second `ready` is ever sent. The pane stays blank until
   something forces a genuine teardown.

The silence is the design working as written: these are dropped messages, not errors, so nothing
reaches the output channel. That is why the symptom is indistinguishable by eye from a render
failure, and why the first hypothesis for this box was the wrong one — see the note below.

**D23 is latent, not the cause of the blank pane. The cause is D24.** This was first recorded the
other way round, and the correction matters more than the finding: the reasoning that got there is a
trap the next person will walk into as well.

The blank pane was attributed to this latch because the **Markdown Review output channel was present
in the Output dropdown**, which was read as proof that `activate()` had run. It is not. VS Code
keeps the previously-selected channel name in that dropdown across a window reload, so an entry can
survive with no live registration behind it. *Developer: Show Running Extensions* answered the
question the channel could not, and the extension was **absent** — it had never activated. See D24.

**"The channel exists" and "our code ran" are different claims.** The check that distinguishes them
is Running Extensions, or a log line written *during* the run — which is why `deserializeWebviewPanel`
now appends one. An artefact that persists across the event you are testing cannot be evidence about
that event.

The latch defect itself is real and stays fixed: the gate genuinely could not reopen without a full
context teardown, so any future path that hides the pane without destroying it would strand exactly
this way. It simply was not what happened here.

Fixed by re-arming on the way back to visible and re-running the refresh, rather than trusting the
webview to re-handshake. H14's intent is preserved — nothing is posted into a context known to be
dead — but a spurious flip can no longer strand the pane. If the context *was* torn down the webview
posts its own `ready` and the refresh runs twice, which is idempotent.

**Also added while chasing this:** `[panel]` tracing on the output channel — panel construction, the
handshake, every view-state flip with the gate's state, and every dropped message with its type.
Three reload runs produced no evidence at all, because a shut gate discarding messages is the design
working and writes nothing anywhere. The first run should have been conclusive.

**What is and is not covered.** The gate's rule was extracted into `src/panel/readyLatch.ts` —
pure and `vscode`-free — so `src/test/readyLatch.test.ts` can assert the part that was wrong,
including the exact ready → spurious-flip → visible interleaving. What remains uncovered is the
*trigger*: `@vscode/test-electron` cannot reload its own window, so the serializer path stays
unreachable (D9's neighbour) and only a human running A2 step 5 can prove the churn happens at all.
The unit tests stop the rule regressing; they cannot stop a future change to `onDidChangeViewState`
from bypassing the latch.

**D24 — nothing in the manifest wakes the extension for a panel restore, so a reloaded pane is never
revived.** The actual cause of the A2 step 5 failure, confirmed on 2026-08-05: after *Developer:
Reload Window* with the review pane as the only editor, the tab came back blank and *Developer: Show
Running Extensions* did **not** list Markdown Review. It had not activated, so
`registerWebviewPanelSerializer` had never run, so `deserializeWebviewPanel` was never called. VS
Code restores the panel's tab from its own workspace state regardless — only the *contents* need the
extension — which is why the symptom is a blank pane rather than a missing one.

This is exactly what `04-acceptance-run.md:102` predicted, written down long before it was confirmed.

Activation is inferred from `contributes.commands` (PRD §9), which covers every entry point the user
initiates. A restore is the one entry point the user does *not* initiate: the serializer is
registered at **runtime**, inside `activate()`, so the manifest never mentions
`onWebviewPanel:markdownReview.panel` and VS Code has no reason to wake anything. Opening the file
in a text editor first happened to activate the extension by other means, which is why A2 steps 1–4
passed and only step 5 failed, and why this needed to be its own step.

Fixed by declaring `"activationEvents": ["onWebviewPanel:markdownReview.panel"]`. **This does not
weaken lazy activation** — the event fires only when VS Code is actually restoring a panel of that
view type, which by definition means the user already had one open. It is not `onStartupFinished`,
and a fresh window with no review pane still never loads the extension.

**PRD §9 and CLAUDE.md's hard constraint both said "no `activationEvents`" and both were wrong** —
not about the goal, but about the mechanism. "Inferred from `contributes.commands`" is sufficient
only for command-initiated entry, and the extension has a second entry point. The constraint is
restated as *lazy*, with the one permitted event named and justified, rather than as a bare
prohibition. Updated in four places, all of which asserted the absence:

- `package.json` — the manifest itself
- `src/extension.ts:5` — the file header
- `src/test/integration/suite/activation.spec.ts` — now asserts the value rather than the absence,
  and still asserts the extension is dormant before any command
- `CLAUDE.md` and `docs/plans/05-acceptance-run.md` C3's static half

**C3 (`05-acceptance-run.md`, manual-run step 12) must be re-run** against a rebuilt `.vsix`, with
its expectation rewritten: the static half now expects exactly one `activationEvents` entry, and the
behavioural half is unchanged — still absent from Running Extensions until a command is run. The
static half's previous "confirmed on the shipped bytes 2026-08-05" no longer applies.

**Cost of the misdiagnosis, recorded deliberately.** Three reload runs were spent on this. Two
things made it expensive: a shut delivery gate discards messages silently, so the failure wrote
nothing anywhere (now fixed by the `[panel]` tracing), and the presence of the output channel was
taken as proof of activation when it is an artefact that outlives the reload. The check that would
have settled it on the first run — Running Extensions — costs one keystroke and was in the step's
own checklist from the start.

### Noted, not changed

- `#notice` remains a single slot shared by `tooLarge`, `targetUnreadable` and `rewriteDetected`.
  They are mutually exclusive in practice: a rewrite cannot be detected without a rendered document.
- `resolveSidecar` read `storageLocation` without a resource scope, so a folder-level setting was
  ignored in a multi-root workspace. Fixed in passing while adding the scoped `autoDetectResolution`
  read; not a Phase 4 defect.
- Phase 3's open finding — `.mr-highlight` differentiating by `background-color` alone, which
  Windows forced-colors mode strips — is untouched by Phase 4 and stays on the acceptance run's
  theme step.
