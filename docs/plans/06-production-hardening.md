# Phase 6 — Production Hardening

**Delivers:** the audited, hardened 0.1.0 — every defect found by the 2026-08-05 full-codebase
audit fixed or explicitly accepted, a UX/accessibility pass that makes the pane usable by keyboard
and screen reader, and the robustness work (store lifecycle, config reactivity, rename handling)
that a Marketplace release implies. Ends where Phase 5's deferred half begins: publish day.

Spec references: PRD §5 (confidence surfacing), §6 (webview UX/security), §11 (failure modes),
§12 (release checklist). Phase 4's ledger (`04-prompt-and-detection.md` §10) still owns D-numbers;
findings here get H-numbers so the two ledgers never collide.

> **Entry state.** Phases 1–5 built and packaged; `markdown-review-0.1.0.vsix` verified in stable
> VS Code (`05-acceptance-run.md` Part B). The audit that produced this phase read every module and
> found the defects below — none previously recorded. D21 and D22 remain open in Plan 04's ledger
> and are fixed by this phase (H0).

## 1. Findings ledger

Statuses: **open** → **fixed <date>** (with where the fix and its test live). Nothing here is
deleted once recorded; a finding judged not worth fixing moves to §4 with its reason.

### Correctness & data safety

- **H0 — D21/D22 carried in from Plan 04.** D21: an anchor stating an absence orphans when
  answered; fix is the designed one — carry the D17-style weaker signal onto the orphan row from
  the baseline offsets of the last known position, nothing persisted. D22: suppress the orphan
  section while the target is unreadable, so **Locate file…** is the only recovery action on
  screen (also H7's second half). *Fixed 2026-08-05 — the D21 half: `sectionChanged` now also considers `orphaned` comments, probing from `anchor.hintOffset` (the last known neighbourhood) since an orphan has no current position; `orphans.ts` renders the signal as its own note. The D22 half rides H7's `documentGone` flag.*
- **H1 — cards stack in store order, not document order.** `render()` sorts by anchor start
  (`media/src/comments.ts:159`) but `reposition()` iterates the unsorted `comments` array (`:206`);
  `stackTops` assumes ascending desired tops, so commenting on a late paragraph and then an early
  one pushes the early card far below its own highlight. Invisible to the harness because every
  scenario declares comments in document order, and to jsdom because every rect is zero. Fix: feed
  `stackTops` in sorted order; add an out-of-order harness scenario. *Fixed 2026-08-05 — `placed.sort((a, b) => a.top - b.top)` before `stackTops` in `reposition()`, plus a new `outOfOrder` harness scenario (comments declared reversed) and a `cards follow document order` check that fails on the old behaviour.*
- **H2 — `relink` can write a sidecar its own validator rejects.** The merge at
  `src/store/ReviewStore.ts:124` does not dedupe ids; `isReviewFile` rejects duplicate ids, so the
  next load quarantines the merged file. Fix: re-mint colliding incoming ids. *Fixed 2026-08-05 — `relink` re-mints colliding ids against a `Set` of the destination's own.*
- **H3 — `relink` can report success after a failed write, then empty the source.** The check at
  `ReviewStore.ts:130` (`lastWritten === undefined`) is only stale-safe for never-written stores.
  Fix: `write()` reports success; `relink` gates source-emptying on *this* write. *Fixed 2026-08-05 — `write()` returns success, `flush()` propagates it, and `relink` gates source-emptying on that value rather than on `lastWritten`.*
- **H4 — store write race.** `rereadExternal`'s guard (`ReviewStore.ts:503`) checks only
  `this.debounce`, which is already cleared during an in-flight `write()`; a watcher event landing
  mid-write reads pre-write disk content and overwrites `this.state`. Fix: an in-flight-write
  latch that `rereadExternal` and `flush` respect. *Fixed 2026-08-05 — writes are chained through `writeQueue` and counted by `writesPending`; `rereadExternal` returns early while either is live.*
- **H5 — cross-window temp collision.** `write()` uses the fixed name `${sidecar.path}.tmp`
  (`ReviewStore.ts:465`); two windows on one workspace collide. Fix: per-process temp suffix.
  Cross-window *state* merge stays last-writer-wins (§4). *Fixed 2026-08-05 — the temp file is `<sidecar>.<pid>.tmp`.*
- **H6 — CSP permits remote image egress — a PRD §6 defect.** `img-src … https:` is PRD §6
  verbatim, but PRD §2/§13 say no network calls, ever; a reviewed file containing a remote image
  URL makes a real request on render — document-content-controlled egress. Per the
  flag-don't-workaround rule this is recorded as a PRD correction, not a silent change: drop
  `https:` from `img-src` (`src/panel/ReviewPanel.ts:595`), render remote images as a placeholder
  naming the URL, amend PRD §6. *Fixed 2026-08-05 — `img-src` drops `https:` (`panel/csp.ts`, unit-tested), and the renderer neutralizes `http`/`https`/protocol-relative image sources to alt text carrying the URL in `title`. **PRD §6 is amended by this**; the directive it specified verbatim permitted document-controlled egress.*
- **H7 — the acceptance script tests UI that does not exist.** B3c instructs clicking **Dismiss**
  on the rewrite banner; no such button (`media/src/webview.ts:397-408`). B4a expects the
  unreadable notice to replace the content; `targetUnreadable` leaves it (`:429-442`) where
  `tooLarge` clears it. Fix both; the B4a fix includes suppressing orphans (H0/D22). *Fixed 2026-08-05 — the rewrite banner gained **Dismiss**; `targetUnreadable` now clears the content roots and, via `documentGone`, empties the gutter and orphan section so **Locate file…** is the only recovery action on screen.*
- **H8 — `fuzzy.verify` clips mid-word.** Known since D18 ("left alone"), escalated by D21's run:
  an addressed card's "after" can end mid-word and reads as corruption. Fix at display: snap to a
  word boundary or ellipsize. *Fixed 2026-08-05 — `snapToWordEnd` in `anchor/text.ts`, applied to `verify`'s span end, bounded to one word (`MATCH_MAX_BITS`). Scores are untouched.*
- **H9 — registry keys are case-sensitive on case-insensitive filesystems.** `ReviewStore.for`
  and `ReviewPanel.panels` key on `target.toString()` (`ReviewStore.ts:84`,
  `ReviewPanel.ts:83,142`); on macOS/Windows two casings of one file yield two stores and two
  panels writing one sidecar. Fix: case-fold the key on `darwin`/`win32` in one shared helper.
  *Fixed 2026-08-05 — `store/registryKey.ts`, used by both registries, case-folds on `darwin`/`win32` only.*
- **H10 — baseline-diff provider leaks and over-derefs.** `served` grows forever and its
  change-event fire is undebounced (`src/detect/baselineDocuments.ts:63,104-107`) — once a diff
  has been opened, every later keystroke re-renders. The scheme also derefs any absolute path with
  `force: true` (bypassing the 2 MB guard) and creates a store+watcher for it (`:46,79,86`). Fix:
  debounce, evict on document close, serve only targets with a live store, drop `force`. *Fixed 2026-08-05 — the provider refuses non-markdown targets, drops `force`, debounces invalidation on `CHANGE_DEBOUNCE_MS`, and evicts from `served` on document close.*

### Panel lifecycle (small, bundled)

- **H11 — `postReviewState` unguarded by the refresh generation** (`ReviewPanel.ts:147,327`):
  can post `located` computed against the previous document. *Fixed 2026-08-05 — `docGeneration` tracks which generation `this.doc` belongs to; `postReviewState` returns early on a mismatch.*
- **H12 — `addComment` captures `this.doc` before an await** (`ReviewPanel.ts:424-437`): hint may
  belong to a replaced document. *Fixed 2026-08-05 — `addComment` loads the store first and reads `this.doc` after the await.*
- **H13 — `onCreated` double-refresh** (`src/detect/changeWatcher.ts:65-69`): delete-then-write
  (the common agent save) costs an immediate un-debounced refresh plus the coalesced one. *Fixed 2026-08-05 — `onCreated` removed from the watcher options; re-creation rides the coalescer.*
- **H14 — `this.ready` never reset** on webview reload (`ReviewPanel.ts:164,248`). *Fixed 2026-08-05 — `onDidChangeViewState` clears `ready` when the panel is hidden.*
- **H15 — locator rebuilt per `postReviewState`** (`ReviewPanel.ts:328`), discarding the tier-2b
  memo. *Fixed 2026-08-05 — `locatorMemo` keyed on the `PlainTextDoc` identity.*

### Accessibility (PRD §6 quality bar; first three are violations)

- **H16 — narrow-mode markers are focusable children of `aria-hidden`**
  (`ReviewPanel.ts:624`, `media/src/comments.ts:330-345`): below 700 px comments are unreachable
  by screen reader. *Fixed 2026-08-05 — markers moved to a new `#marker-layer` sibling; verified in a real layout engine at 600 px (4 markers, none under the overlay). The harness gained a standing `nothing focusable hides inside an aria-hidden subtree` check, which is what would have caught this three phases ago.*
- **H17 — "position uncertain" never appears as text**, violating PRD §5 and `locate.ts`'s own
  header contract; only a dashed border on an `aria-hidden` overlay. *Fixed 2026-08-05 — a `position uncertain` badge on the card plus the phrase in its `aria-label`; harness check pinned to the `uncertain` scenario, jsdom test in `media/test/cards.test.ts`.*
- **H18 — cards carry no status semantics or keyboard activation**; `focus` doesn't bubble so
  inner buttons never activate the card; no `aria-live` for create/delete/resolve; notices are
  silent (`comments.ts:359-399`, `webview.ts:275-293`); focus dropped after creating a comment
  (`selection.ts:119,385`). *Fixed 2026-08-05 — cards carry an `aria-label` naming author and status and `aria-current` when active; Enter/Space activate; `focusin`/`focusout` replace the non-bubbling `focus`; a single `#announcer` live region speaks create/delete/resolve/reopen/filter; notices take `role="alert"` and move focus to their action; the popover now restores focus to what was focused before the button was hidden.*
- **H19 — no forced-colors or reduced-motion handling**; `.mr-highlight` is background-only (the
  open Plan 03 §9 finding); the 💬 marker is an OS emoji. *Fixed 2026-08-05 — a `forced-colors` block gives highlights, cards and markers real borders (`Highlight`/`CanvasText`, the system keywords, which is why the colour lint permits them), a `prefers-reduced-motion` block drops both transitions, and the 💬 emoji became a themable glyph.*

### UX

- **H20 — empty first run shows nothing**: header hides at zero counts, no hint that selection
  comments exist, no walkthrough, no keybinding; ~330 px right padding reserved even with no
  cards. *Fixed 2026-08-05 — a dismissable first-run hint in `#empty-state`, a `contributes.walkthroughs` entry with three steps, a `ctrl/cmd+shift+m` keybinding, and `body.mr-no-cards` reclaiming the ~330 px margin (measured dropping from 328 px to 32 px on an empty review).*
- **H21 — silent selection rejection** (too short / front matter) gives no feedback
  (`selection.ts:195-219`). *Fixed 2026-08-05 — `capture` returns a reason, and a transient hint appears beside the selection for `too-short` and `front-matter`.*
- **H22 — single Delete is the only unprotected destructive action** (`comments.ts:468-470`,
  `orphans.ts:112-114`) while the bulk clears are modal-confirmed and backed up. *Fixed 2026-08-05 — both Delete buttons take a second click, styled and relabelled while armed, resetting on blur.*
- **H23 — filter inconsistencies**: the status filter does not apply to the orphan section;
  orphan-section membership routes on position while header counts route on status, so they can
  disagree; filtering everything out leaves a blank pane with no hint (`webview.ts:393`,
  `orphans.ts:131-139`, `comments.ts:62-65`, `header.ts:32-41`). *Fixed 2026-08-05 — the orphan section takes the filter through `setFilter`, membership and counts route through one predicate, and `hiddenNotice` surfaces "n comments hidden by filter" as a reset button.*
- **H24 — card editor has no visible Save/Cancel and saves on blur** (`comments.ts:515-556`).
  *Fixed 2026-08-05 — the editor gained a hint row and explicit Save/Cancel, and no longer saves on blur.*
- **H25 — floating Comment button detaches on scroll** (`position: fixed`, no scroll handler,
  `selection.ts:283-286`). *Fixed 2026-08-05 — a capturing scroll listener hides the button and the hint.*
- **H26 — per-frame O(n) layout reads while scrolling** (`webview.ts:302-337`) and linear hotspot
  hit-testing per mousemove (`comments.ts:284-292`). *Fixed 2026-08-05 — `currentScrollLine` binary-searches a per-render index of page-space offsets instead of walking every `[data-line]` per frame; hover hit-testing is throttled to one frame.*
- **H27 — resolved group pinned to the gutter's absolute bottom** (`webview.css:526-531`),
  thousands of px from anything on a long document; wide-mode card click is a no-op that rebuilds
  the overlay (`comments.ts:187-190`); `clearAll` has no in-pane surface; `navigator.platform` is
  deprecated (`selection.ts:418`). *Fixed 2026-08-05 — the resolved group is placed below the last card by the layout pass, wide-mode card click selects and scrolls to the highlight, `Clear all` is in the header, and the modifier label moved to `media/src/platform.ts` using `userAgentData` first.*

### Robustness & platform

- **H28 — stores never released**: N opened files leak N sidecar watchers and N retained
  baselines until the window closes (`ReviewStore.ts:48,143`). Fix: reference-count per panel,
  dispose after idle grace. *Fixed 2026-08-05 — `ReviewStore.acquire()` reference-counts panel holders and disposes the store (and its watcher) after a 5-minute idle grace, so reopening a pane is still free.*
- **H29 — configuration changes don't take effect**: no `onDidChangeConfiguration` (
  `storageLocation` split-brains, `autoDetectResolution` needs a reopen), `authorName()` is not
  resource-scoped (`ReviewPanel.ts:40-43`), no `onDidChangeWorkspaceFolders` re-resolve.
  *Fixed 2026-08-05 — `authorName` is resource-scoped; `onDidChangeConfiguration` refreshes the
  panel and, for `storageLocation`, re-resolves every store through `ReviewStore.resettle` +
  `ReviewPanel.reattachStores`; `onDidChangeWorkspaceFolders` does the same. The re-attach half
  matters: `resettle` disposes the stores, so a panel still holding one would be talking to a dead
  object whose events never fire again.*
- **H30 — target rename is unrecoverable unless a pane was already open**: no
  `workspace.onDidRenameFiles`; wire renames through the (now-safe) `ReviewStore.relink`.
  *Fixed 2026-08-05 — `onDidRenameFiles` migrates any review that actually has comments and
  retargets an open pane. Depends on H2/H3: routing renames through a `relink` that could write a
  self-rejecting sidecar or report a false success would have made this worse, not better.*
- **H31 — manifest declares no `capabilities`**: in virtual/untrusted workspaces all four
  commands are offered and every one fails. Declare `virtualWorkspaces: false` and a limited
  `untrustedWorkspaces` story. *Fixed 2026-08-05 — both declared, each with a reason string.*
- **H32 — serializer revives an unvalidated path** (`src/extension.ts:53`); `toUri`'s
  cross-extension branch can never work (`String(arg)` → `"[object Object]"`,
  `src/commands/resolveTarget.ts:37-41`) and `resolveTarget` has zero tests.
  *Fixed 2026-08-05 — the serializer validates the restored path through `resolveTarget`; `toUri`
  rebuilds from `scheme` + `fsPath`/`path`. `src/test/integration/suite/target.spec.ts` covers
  both, the file having had no tests at all.*

### Found while fixing the above

- **H33 — the webview shell is written twice, and the harness copy silently invalidates every
  check.** `ReviewPanel.getHtmlForWebview` and `dev/harness/index.html` each carry their own copy
  of the shell markup. Adding `#marker-layer`, `#announcer` and `#empty-state` to the first left
  the second stale, and because `webview.ts` calls `requireElement` for each id and *throws* on the
  first missing one, the harness did not degrade — the bundle never booted, so scenarios reported
  "ALL PASS" while testing nothing. Caught only because one check happened to assert on uncaught
  errors. *Fixed 2026-08-05 — the harness shell updated and given a comment saying it must track
  the panel's; the `no uncaught errors` check is what makes a future drift loud. A shared template
  would be better and is deferred: the panel's copy is a nonce-carrying template literal, and
  extracting it is a Phase 2 contract change, not a Phase 6 one.*
- **H34 — the harness asserted no accessibility property whatsoever.** Nine scenarios, three
  themes, ~380 checks, and not one of them looked at ARIA, focus order or the accessibility tree —
  which is why H16 survived from Phase 3 to here in the one harness built to catch layout bugs.
  *Fixed 2026-08-05 — three standing checks added: focusable-inside-`aria-hidden`, every card names
  its status, and the uncertain card says "position uncertain".*

## 2. Execution order

1. **H1–H15** (correctness/data safety, panel lifecycle) — each lands with its test.
2. **H16–H27** (a11y + UX) — webview-only; verified by new jsdom suites + regenerated harness with
   out-of-order, keyboard and action gestures. All new colors via `--vscode-*` variables; every new
   variable added to `dev/harness/themes.css` base **and** both theme overrides (the check is
   bidirectional).
3. **H28–H32** (robustness/platform) — then repackage.
4. Full verification: `npm run check`, `npm run test:integration`, `npm run build`, one full PERF
   run, harness checks, `vsce package` (< 500 KB, `vsce ls` non-empty, from the repo root per
   Plan 05 §13 E6). Then the manual remainder: `05-acceptance-run.md` Part A, updated where H7
   changed the script's expectations.

## 3. Test additions

Host: relink id-collision + failed-flush, write-race + unique temp, CSP string, registry-key
helper, `resolveTarget` (all rejection reasons + both `toUri` branches), `openExternal` scheme
allowlist, `tooLarge` notice assertion, serializer restore/reject, `changeWatcher`
delete-then-create. Webview: D21 orphan-signal rendering, Dismiss + unreadable-clears-content,
DOM-builder suites (`buildCard`, `initOrphans`, `initHeader.paint`, the message switch,
`belongsInOrphans`, filter wiring) — jsdom's zero-rect limit does not excuse pure DOM
construction. Harness: out-of-order scenario, keyboard-path gestures, edit/delete/resolve/reopen
gestures, aria-hidden-focusable audit.

## 4. Accepted as-is (recorded so nothing is silently dropped)

- **Tier 2b reports 0.9 for whitespace-collapsed whole-code-block matches**
  (`src/anchor/locate.ts:101-109`): near-certain in practice; not worth a new constant.
- **Perf suite asserts wall-clock** (`perf.test.ts:147`): `fileParallelism: false` and `PERF=0`
  mitigate; a machine-independent proxy would measure less than the PRD's actual target.
- **E8 precondition pinned by test** rather than a runtime guard (Plan 05 §13).
- **Hidden pane doesn't update statuses** (`04-prompt-and-detection.md` §6): deliberate,
  self-heals on show.
- **Cross-window state merge is last-writer-wins** (the write itself made safe by H5); a merge is
  v0.2+ work.
- **E7 — no Windows machine**: unchanged from Plan 05 §13; unit-level compensation only.
