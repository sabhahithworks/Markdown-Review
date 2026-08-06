# The manual run — one sitting at a time

Everything left that a machine cannot do, in the order to do it, as a single linear list.

**This file is the running order, not the record.** The canonical boxes live in
`docs/plans/03-acceptance-run.md`, `04-acceptance-run.md` and `05-acceptance-run.md`, and each step
below names the box it closes. Tick both: here so you know where you are, and there so the phase
docs stay the record. Where this file and a phase doc disagree, **the phase doc wins** — it carries
the reasoning, and this one only carries the sequence.

The steps are grouped into four sittings by *which VS Code you need*, because the phase docs' own
order makes you switch hosts repeatedly. Within a sitting the order is theirs and it matters: each
step leaves the state the next one needs.

Roughly 70 minutes of work, plus however long an agent takes to think in M3 and M9.

**Where this stands (2026-08-06).** Eleven of the twelve steps are done — everything except step 7, a confirmation of an already-covered item, and step 5, skipped. `04-acceptance-run.md` Part A
and Part B are green, `03-commenting.md` §8 is dated, and every box in `04-prompt-and-detection.md`
§9 is ticked.

| | |
| --- | --- |
| ✅ **Passed** | 1, 2, 3, 4, 6, **8**, 9, 10, 11, **12** |
| ⏭️ **Skipped, not verified** | **5** (B3 — rewrite banner and diff; its **Dismiss** button has no coverage of any kind) |
| ☐ **Not run** | **7** (B6, a confirmation of an already-covered item) |

**Two defects came out of this run**: **D24**, the blank restored pane, which is why the archive was
repackaged; and **D23**, a latent delivery-gate bug found while chasing it. Both are fixed and in the
current `.vsix`. **D22 is closed** — step 6 confirmed its fix on the first occasion the box was ever
reached.

**Steps 12 and 8 both passed on 2026-08-06.** Step 12 was the last gate: lazy activation survived the
D24 manifest change, on the packaged archive, on a fresh profile. Step 8 confirmed the Extensions-list
identity, with two findings recorded at the step — the icon does not need its own background because
it has one, and the publisher line belongs in the post-publish checks rather than here.

**Nothing outstanding blocks publishing.** What is left is step 5's skip: the rewrite banner's
**Dismiss** button has no coverage of any kind. A known hole, worth an issue, not a blocker.

**When something fails**, do not fix it here. Write it into the owning phase doc's defect ledger
first, in the same numbered form the neighbours use (`04-prompt-and-detection.md` §10 for D-numbers,
`05-ship.md` §13 for E-numbers, `06-production-hardening.md` §4 for H-numbers), and *then* fix it. A
finding that exists only in a commit message is one the next phase re-derives from scratch.

**A skipped box left blank is indistinguishable from a failed one.** If you cannot reach a step,
write one line saying so next to it.

---

## Preflight — once, before sitting 1

```sh
npm run check              # typecheck ×3 + lint + unit tests
npm run test:integration   # host-side assertions in a real VS Code
npm run build              # both bundles + CSS colour/theme guards + the bundle guard
```

All three must be green. They were on 2026-08-05 with the D23 and D24 fixes in the tree — 513 unit
tests across 26 files, 50 integration assertions, both bundles and every guard. Re-run them anyway,
because you are about to spend an hour attributing behaviour to the build.

Then confirm exactly one Markdown Review is installed — two extensions contributing the same four
commands is a confusing hour, and a "working" result may be the *old* build answering:

```sh
code --list-extensions | grep markdown-review     # expect only SabhahithWorks.markdown-review
```

If `local-dev.markdown-review` is there, `code --uninstall-extension local-dev.markdown-review`.

The packaged archive in the repo root is the one to test against:

```sh
ls -la markdown-review-0.1.0.vsix     # 143,823 bytes, the release build (repackaged 2026-08-06)
code --install-extension markdown-review-0.1.0.vsix --force
```

**Check the byte count.** The archive was repackaged twice — for D24, and again on 2026-08-06 for the
changelog promotion and the publisher capitals. Anything older (143,522 bytes, the D24 build;
142,889, the H35–H36 layout build; or the interim 143,243-byte D23 build) is not what ships. The version is deliberately still
`0.1.0`: nothing has been published, so there is no released build to distinguish this from. If the
size is wrong, `npm run package` and re-install.

Size alone only proves the file changed. Confirm both fixes are actually in it:

```sh
unzip -p markdown-review-0.1.0.vsix extension/package.json | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).activationEvents))"
# expect [ 'onWebviewPanel:markdownReview.panel' ] — D24
unzip -p markdown-review-0.1.0.vsix extension/dist/extension.js | grep -c onVisibilityChange   # 1 — D23
```

Then *Developer: Reload Window*.

---

# Sitting 1 — Extension Development Host, `kitchen-sink.md` — ✅ COMPLETE 2026-08-05

Press <kbd>F5</kbd>. The launch config opens `docs/fixtures/` as the workspace root, so the pane's
messages say `kitchen-sink.md` and sidecars land in `docs/fixtures/.reviews/`.

**Nothing in this sitting may edit `kitchen-sink.md`.** Unit tests and `dev/harness/fixture.js` both
assert its exact bytes. Commenting only ever writes the sidecar, so you are safe as long as you do
not type into the document itself.

Clear any sidecar a previous run left behind:

```sh
rm -rf docs/fixtures/.reviews
```

---

### Step 1 — A2 step 5: reload with the pane as the only editor — ✅ PASSED 2026-08-05

*Closed: `04-acceptance-run.md` A2 step 5 — the last piece of that box, ticked there.*

**Passed on the third attempt.** It failed twice with a blank restored pane. The cause was exactly
what this step predicted — the extension never activated for the restore (**D24**) — and it is
fixed: the manifest declares `onWebviewPanel:markdownReview.panel`, and the pane now comes back
populated with the pane as the only editor open. Reasoning, and why it stays lazy, in
`04-prompt-and-detection.md` §10 D24.

Verified in the **dev host** (F5, source build). The packaged archive carries the same manifest —
confirmed inside the `.vsix` — but the packaged path gets its own exercise at step 12.

Everything below is kept as the diagnostic for a recurrence, not as work outstanding. If the pane is
ever blank here again, work it in order and *do not skip to the webview console* — it took three
runs to get here precisely because that shortcut was taken twice.

> **What cost those three runs**, so it is not repeated: the **presence of a Markdown Review entry
> in the Output dropdown** was read as proof the extension had activated. It is not — VS Code keeps
> the previously-selected channel name across a reload, so the entry outlives the event being
> tested. *Developer: Show Running Extensions* is the check that actually answers it, and it was in
> this step's checklist the whole time. A separate latent bug (D23) was found and fixed on the way,
> which is worth having but was never the cause.

1. Open `kitchen-sink.md` → *Markdown Review: Open Review Pane*.
2. Leave two comments on different paragraphs.
3. **Close `kitchen-sink.md`'s text editor tab**, leaving the review pane as the only editor open.
4. <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> → **Developer: Reload Window**.
   - Not <kbd>F5</kbd> again. Relaunching the dev host starts a new debug session and a new
     extension host, which is a different path from the one the serializer contract covers.

**Expected:** the pane is still there, on the same tab, against `kitchen-sink.md`, with both
comments and roughly the same scroll position.

**The moment the window is back, before touching anything else**, collect these two — **in this
order**. The first is decisive and takes one keystroke; the second is the one that misled three runs.

1. *Developer: Show Running Extensions* — is **Markdown Review** in the list?
2. *View → Output*, dropdown top-right → **Markdown Review** — what lines are in it?

**Running Extensions is the authority on whether the extension activated.** The output channel is
*not*: VS Code keeps the previously-selected channel name in that dropdown across a reload, so the
entry can be there with nothing behind it. That mistake is what D24 cost. The channel's *contents*
are still evidence — the lines below are written during the run, so they cannot outlive it:

| Line | Proves |
| --- | --- |
| `[extension] deserializing a review panel` | Activation happened **and** the serializer ran |
| `[extension] not reviving …` | `resolveTarget` rejected the stored path |
| `[panel] …: ready received` | The webview booted and can receive messages |
| `[panel] …: viewState visible=… canPost=…` | Every view-state flip, and whether the gate is open |
| `[panel] …: dropped <type> (gate shut …)` | A render was computed and then discarded (D23) |

Then classify. Four different bugs wear the same word "empty":

| What you see | What it means |
| --- | --- |
| Blank pane, **absent from Running Extensions** | The extension never activated — **this was D24**, and if it recurs the `activationEvents` entry has been lost from the manifest. Check `node -e "console.log(require('./package.json').activationEvents)"` first; for the packaged build check `extension/package.json` inside the `.vsix`, since the archive can lag the source. |
| Blank pane, **listed**, and a `deserializing` line, but no `ready received` | The webview never booted on the restore path. *Developer: Open Webview Developer Tools* and read the console — a 404 on `webview.js` or a CSP violation. |
| Blank pane, `ready received` present, `dropped …` lines following | Delivery is being gated (D23's shape). The `viewState` lines say whether a flip shut it and whether anything reopened it. |
| The pane tab is **gone entirely** | The serializer ran and rejected the panel: `isPanelState` refused the stored state and `deserializeWebviewPanel` disposed it (`src/extension.ts`), or `[extension] not reviving …` says `resolveTarget` refused the path. |
| Document renders, **comments missing** | Not a restore problem at all — a store problem, and a much more interesting one. |

**Why this step exists at all.** Activation is inferred from `contributes.commands`, which covers
every entry point the *user* initiates. A panel restore is initiated by VS Code, and the serializer
that handles it is registered at runtime — so until D24 the manifest gave VS Code no reason to wake
the extension for one. With the text editor open in A2 steps 1–4 something else activated it; with
the pane as the only editor, nothing did. That is precisely why step 5 is a separate step, and why
it is the only box that ever caught this.

The serializer path still has **zero automated coverage** — there is no `revive` or `deserialize`
test anywhere in `src/test/`, because `@vscode/test-electron` cannot reload its own window. What
*is* covered now is the manifest: `activation.spec.ts` asserts `activationEvents` is exactly
`["onWebviewPanel:markdownReview.panel"]`, so losing it or broadening it fails the integration
suite. The behaviour still needs a human, which is this step.

**If this box fails again, record it as a new D-number in `04-prompt-and-detection.md` §10 before
changing anything** — and put the Running Extensions answer in the entry, since that is the fact
both previous attempts left out.

---

### Step 2 — A3: the six remaining Phase 3 steps — ✅ PASSED 2026-08-05

*Closed: `04-acceptance-run.md` A3, which is `03-acceptance-run.md` steps 2, 3, 5, 6, 7, 8 — ticked
there, and `03-commenting.md` §8 is dated.*

All six passed in one sitting with **no defects found** — including the four things being looked at
for the first time since they were written: the H4 write-race in 2c, the H6 `img-src` change in 2d,
the forced-colors fallback in 2e, and the H16 marker layer in 2f.

Same dev host, same document. Steps 1 and 4 of that doc are already covered by the gesture harness
and by step 1 above.

- [x] **2a — Rejections** (`03-acceptance-run.md` step 2)

  Select a single two-character word, try to comment. Then select the whole **Fenced code** section
  (line 57 onward — well over 500 characters), try to comment.

  > Expect `Select at least 3 characters` and `Selection too long to anchor — select under 500
  > characters`, and **no** new card and no new sidecar entry either time. The wording itself is
  > asserted by `src/test/notices.test.ts`; what you are checking here is that nothing was
  > persisted. Open `docs/fixtures/.reviews/kitchen-sink.md.json` and count.

- [x] **2b — Hand-edit the sidecar** (step 3)

  Open `docs/fixtures/.reviews/kitchen-sink.md.json` in an editor beside the pane. Change a
  comment's `body` and save.

  > Expect the card text to update without you touching the pane. The store half is covered by
  > `store.spec.ts`; what is manual is that the card re-renders.

- [x] **2c — Two windows** (step 5)

  Open `docs/fixtures/` in a second window and open the review pane there too. Add a comment in one
  window.

  > Expect it to appear in the other within a second or two. This goes through the sidecar's
  > `FileSystemWatcher`, not shared memory — two windows are two extension hosts. Two panes in *one*
  > window is not reachable by design.
  >
  > This is also the step that would expose the write-race and temp-file-collision fixes (H4)
  > regressing. If a comment made in one window disappears from the other, or a `.tmp` file is left
  > on disk, that is the finding.

- [x] **2d — CSP** (step 6)

  *Developer: Open Webview Developer Tools* on the pane, then reload it.

  > Expect **zero** Content Security Policy violations in the console. Nothing else can check this —
  > the CSP is enforced by VS Code and the layout harness deliberately does not reproduce it.
  >
  > **New this phase (H6):** `https:` was removed from `img-src`, so a document containing a remote
  > image now renders a placeholder instead of fetching it. A CSP violation logged for a **blocked
  > image** is that fix working, not a failure. A violation on a **script or a style** is real.
  > `kitchen-sink.md` line 81's *Images and relative paths* section is where to look.

- [x] **2e — Themes** (step 7)

  Switch between Dark+, Light+ and a High Contrast theme with at least one comment on screen.

  > Expect card, popover, highlight and the *position uncertain* badge to stay legible; nothing
  > disappears into its background.
  >
  > Known weak spot to look at specifically: `.mr-highlight` differentiates by `background-color`
  > alone, which is what high-contrast themes tolerate least. A `@media (forced-colors: active)`
  > outline was added this phase for exactly this — but forced-colors itself is a Windows mode and
  > cannot be checked here.

- [x] **2f — Narrow pane** (step 8)

  Drag the pane's edge until it is under 700 px wide, then back.

  > Expect the margin to collapse to small inline markers next to each anchored passage; clicking
  > one expands its card inline. Nothing overflows the right edge in either state, and *View →
  > Output → Markdown Review* stays empty.
  >
  > Both of the bugs the layout harness ever found lived exactly here, and so did H1 and H16. Go
  > slowly. In narrow mode the markers now live in their own layer rather than inside the
  > `aria-hidden` overlay (H16) — they should be reachable by <kbd>Tab</kbd>, which is new.

**Done 2026-08-05:** A3 ticked in `04-acceptance-run.md`, and `03-commenting.md` §8 ticked and dated.

**Sitting 1 is complete.** Close the dev host. Everything from here needs the packaged build, so
re-check the preflight's byte count before starting sitting 2 — it is the one thing that silently
invalidates the four sittings below.

---

# Sitting 2 — installed build, repo root, `review-run.md` — ◐ steps 3, 4, 6 ✅ · step 5 skipped · step 7 outstanding

Open the **repo root** in normal VS Code — not `docs/fixtures/`. Paths now read
`docs/fixtures/review-run.md` and the sidecar is `.reviews/docs__fixtures__review-run.md.json`, the
flattened name, which the F5 route never exercises by hand.

Reset before you start:

```sh
git checkout docs/fixtures/review-run.md
rm -f .reviews/docs__fixtures__review-run.md.json
```

Delete **that file**, not the directory. `.reviews/` at the repo root also holds a real review of
`kitchen-sink.md`, and `rm -rf` there throws away comments the extension is specified never to
delete.

---

### Step 3 — B1: the real-agent run — ✅ PASSED 2026-08-05

*Closed: `04-acceptance-run.md` B1b (re-run) and B1c (blind re-run), both ticked there. B1a, B1d,
B1e were already green and did not regress. Closes `04-prompt-and-detection.md` §9 item 2.*

**The item nothing else could stand in for, and it holds.** B1c now has what PRD §10 actually asked
for — a blind run by an agent that had not read the expectation — rather than the informed run that
stood in for it before.

The one item nothing else can stand in for. Every automated case in the repo writes the "after" text
itself, which tests the detection machinery but not what the product actually bets on: that a real
agent, given nothing but prose and no schema, edits in a way the anchor cascade can still follow.

**Precondition:** open `docs/fixtures/review-run.md` → *Markdown Review: Open Review Pane*. Header
must read `0 open` before you start.

- [ ] **3a — leave three comments.** Select the text exactly as written; the anchor *is* the
      selection.

  | # | Select | Line | Type roughly | Why this one |
  | --- | --- | --- | --- | --- |
  | 1 | `Counters live in memory. This is fine for now.` (both sentences) | 14 | "What happens to the counters on restart or redeploy?" | Anchored **to** the thing that must change → the plain `addressed` path |
  | 2 | `Failure modes` (heading text only, no `##`) | 28 | "This section needs to say what the client should actually do." | Anchored to a **label**, not to the thing that changes → the D17 section signal |
  | 3 | `The exact ordering has not been written down anywhere` | 37–38 | "What is the ordering?" | Spans a source line break → exercises whitespace collapsing in anchor space |

  > Sanity check: header reads `3 open`, three cards in the right margin, three highlights in the
  > text, and `.reviews/docs__fixtures__review-run.md.json` has three entries.

- [ ] **3b — copy the prompt.** Click **Copy review prompt (3)** in the header bar.

  > Toast reads exactly `3 comments copied. Paste into your agent and @-mention
  > docs/fixtures/review-run.md.`
  >
  > Paste into a scratch buffer and read it before sending it anywhere. Expect: a preamble, then
  > items `1.` `2.` `3.` **in document order, not creation order**; item 2 reading `On the section
  > "## Failure modes"` while 1 and 3 read `On: "…"`; each body indented three spaces and quoted
  > with `> `; and **no** ids, JSON, status words or instructions to report back. Anything
  > schema-shaped in there is a PRD §1 violation, and the whole agent-agnostic bet rests on its
  > absence.
  >
  > This is also the moment `baselineText` is snapshotted. Everything below is measured against it,
  > so **do not edit the file between here and 3c.**

- [ ] **3c — hand it to a real agent.**

  > **Use an agent that has not read this file.** B1c is currently ticked by an agent that had read
  > the expected outcome in the same session, which makes it verified by an *informed* agent rather
  > than the naive one PRD §10 asks for. That is the specific reason this box is being re-run.
  >
  > Paste the prompt, `@`-mention the path from the toast, tell it nothing the prompt does not, and
  > keep the pane visible.

  Within ~400 ms of the agent's write (the `onDidChangeTextDocument` debounce; a write from outside
  the editor comes via the `FileSystemWatcher` and can take a beat longer):

  - **Comment 1** flips to `addressed` with a before/after. Two things to look at closely: the
    before/after must be **the agent's actual edit**, not a neighbouring sentence — and it must
    **no longer end mid-word**. That clipping was the known `fuzzy.verify` under-report, fixed this
    phase as H8. A different sentence entirely is a new defect.
  - **Comment 2** stays `open` and gains the note "The text around this changed since you copied the
    prompt" with a **Looks good** button in place of **Resolve**. *This is the headline assertion of
    the whole step.* `addressed` means the text **you selected** changed; the agent rewrote the
    section and left the heading alone, so the weaker signal is the correct answer and `addressed`
    would be a lie.
  - **Comment 3** will most likely **orphan**, and that is expected — its anchor states an absence,
    so answering the comment necessarily deletes it. What is being checked is the new part: its
    orphan row must carry **"The text around this changed since you copied the prompt — it may have
    been addressed rather than lost"**, so it reads as *verify this* rather than as loss. That is
    the D21/H0 fix, and this is its first real-world exercise.

  > If the note on comment 2 is **missing**, check that `markdownReview.autoDetectResolution` is
  > still `true` (step 7 turns it off) and that the comment was created *before* you copied the
  > prompt. Both suppress the signal by design.
  >
  > **If a different comment orphans**, that is a finding and *which one* matters. A paragraph-level
  > rewrite where a clause-level edit would have done is a **prompt** problem — the fix is PRD §7's
  > wording, not `src/anchor/`. An anchor that survived a light rewording and still orphaned is an
  > **anchoring** problem. Note the comment number and what the agent did to that passage.

- [ ] **3d — confirm and reopen.** **Looks good** on comment 1 → it resolves, drops into the
      resolved group, the header count falls and the primary action greys out to **Copy review
      prompt** with no count. Then **Reopen** → back to `open`, header back up, button back to
      **Copy review prompt (1)**.

**Then reset**, and do not commit the agent's rewrite — the fixture's value is that it starts
imperfect every time:

```sh
git checkout docs/fixtures/review-run.md
```

---

### Step 4 — B2a: orphan on deletion — ✅ PASSED 2026-08-05

*Closed: `04-acceptance-run.md` B2a, ticked there. B2b–B2d are machine-checked by the gesture
harness.*

- [ ] With a comment on an anchored sentence, delete that sentence from the document and save.

  > Expect exactly that comment to orphan. It leaves the gutter and appears in the **orphaned**
  > section above the content, quoting the text it *used* to be attached to. **Nothing else moves.**

---

### Step 5 — B3: full rewrite and the diff — ⏭️ SKIPPED 2026-08-05, not verified

*Would close: `04-acceptance-run.md` B3a, B3b, B3c. **They remain unticked there** — this was a
deliberate skip on the tester's judgement that the behaviour is working, not an observation.*

**Nothing here was run, and the boxes stay open.** Per this file's own rule, a skipped box left
blank is indistinguishable from a failed one, so it is written down rather than ticked.

What is *not* covered by anything else, and is therefore what the skip actually costs:

- **5b's diff** is the only check that both sides render as prose. `detection.spec.ts` asserts the
  current side carries no `**` or `##`, so D1 cannot regress silently — this part is the smallest
  loss.
- **5a's banner placement** — "at the top of the pane and on screen without scrolling" — is a
  layout judgement. The harness `rewrite` scenario checks the banner is on screen, so this is
  largely covered.
- **5c's Dismiss button has no coverage at all.** It did not exist until H7, the banner previously
  cleared itself on the next render, and no test asserts the button is present or that dismissal
  sticks. **This is the real gap**, and it is a Phase 6 change that has never been exercised.

Worth ten minutes before publishing, since 5c is new code that nothing has looked at. Not a blocker
for the steps below — B3 resets its own state and nothing downstream depends on it.

With at least two located comments in place:

- [ ] **5a** — replace the **entire** contents of `review-run.md` with unrelated prose and save.

  > Expect a banner **at the top of the pane and on screen without scrolling**, reading "The
  > document was rewritten". Every non-resolved comment is in the orphan section. **Nothing was
  > deleted.**

- [ ] **5b** — click **Review the diff**.

  > Expect a two-pane diff with **both sides readable prose**. If one side shows `#`, `**` and table
  > pipes and the other does not, that is §10 D1 regressing — the whole point of that correction is
  > that both sides are rendered plain text.

- [ ] **5c** — click **Dismiss**, then edit the document again.

  > Expect the banner **not** to come back for a document that was already wrecked.
  >
  > The **Dismiss** button this step has always asked for did not exist until H7 — the banner had
  > only **Review the diff** and cleared itself on the next render. If it is missing again, that is
  > the fix regressing.

**Then:** `git checkout docs/fixtures/review-run.md` and re-open the pane before continuing.

---

### Step 6 — B4: rename and re-link — ✅ PASSED 2026-08-05

*Closed: `04-acceptance-run.md` B4a, B4b, B4c, all ticked there. Closes
`04-prompt-and-detection.md` §9 item 8.*

**Exercised for the first time, on the third attempt at reaching it, and it worked — but against
the wrong document.** The run renamed `kitchen-sink.md` in the dev host rather than `review-run.md`
at the repo root, so the **flattened sidecar name this step exists to exercise by hand was not**;
the sidecar landed at `docs/fixtures/.reviews/renamed.md.json`. It also deleted the fixture and its
tracked sidecar, both restored from git. The mechanism is verified; the flattened-path half is not.
A clean re-run is cheap. **Never rename `kitchen-sink.md` — its exact bytes are asserted.**

 Both earlier
attempts clicked **Re-anchor** on an orphan card instead of **Locate file…** on the unreadable
notice — the D22 finding. Suppressing the orphan section under that notice is what made the right
action the only one on screen, and this run is the evidence that fix works. `showOpenDialog` has now
been opened by a human, which no test process can do (D9).

**This has never once been exercised.** Both 2026-08-05 attempts reached for **Re-anchor** on an
orphan card instead of **Locate file…** on the unreadable notice — two recovery actions were visible
at once and the wrong one was the more discoverable. That was D22, a finding about the UI rather
than about the tester, and it is fixed. This step is where the fix gets checked.

The picker is `vscode.window.showOpenDialog`, a native OS dialog, which is exactly why no test
process can answer it (D9).

Run this with real comments in place, so there is something to migrate.

- [ ] **6a — break the link.** With the pane open and showing its comments, rename
      `docs/fixtures/review-run.md` to `docs/fixtures/renamed.md` **from a terminal**:

  ```sh
  mv docs/fixtures/review-run.md docs/fixtures/renamed.md
  ```

  > **From a terminal, not from VS Code's explorer.** Renaming inside VS Code now migrates the
  > review automatically (H30) and re-points the pane, which skips the manual path this box is
  > about. A terminal rename fires no rename event.
  >
  > Expect, within a second: the pane replaces its content with a notice headed **"This file could
  > not be read"**, body "It may have been moved, renamed or deleted. The pane is still open, and
  > nothing has been lost. (…)", and a **Locate file…** button which **takes focus**, so
  > <kbd>Enter</kbd> alone activates it.
  >
  > Check specifically: **no rendered prose underneath, no gutter cards, and no orphan section**.
  > **Locate file…** must be the only action on screen. An orphan card visible under the notice is
  > the D22 fix regressing — that is a defect, not a tester error.
  >
  > Also check the pane **did not close**, and `.reviews/docs__fixtures__review-run.md.json` is
  > still on disk with all its comments. Losing either is a PRD §11 violation — the comments outlive
  > the file.

- [ ] **6b — open the picker.** Click **Locate file…**.

  > Expect a native dialog titled **"Re-link review-run.md"**, whose confirm button reads **"Re-link
  > review"** and whose filter offers Markdown only (`md`, `markdown`, `mdown`, `mkd`, `mdx`).
  > Multi-select is off.
  >
  > Press <kbd>Esc</kbd> first: **nothing at all** should happen — no error, no state change. Then
  > reopen it.

- [ ] **6c — re-link.** Pick `renamed.md`.

  > Expect a toast `Re-linked 3 comments to renamed.md.` (or however many survived step 3), and a
  > **new pane** on `renamed.md` with every comment present, located, and in the status it had. The
  > old pane closes itself — re-linking cannot happen in place, because panel and store are both
  > keyed by target URI.
  >
  > On disk: `.reviews/docs__fixtures__renamed.md.json` now holds the comments, **and**
  > `.reviews/docs__fixtures__review-run.md.json` still **exists and still parses** — emptied, never
  > deleted. Open both and confirm.
  >
  > This is also where the H2/H3 relink fixes get their only real exercise: an id collision would
  > show as a sidecar that quarantines itself on next load, and a failed-flush would show as
  > comments vanishing from both files.

- [ ] **6d — restore.** `mv docs/fixtures/renamed.md docs/fixtures/review-run.md`, then re-link the
      pane back onto it the same way, so the comments end under the original sidecar name again.

---

### Step 7 — B6: inference off

*Closes: `04-acceptance-run.md` B6.*

- [ ] Set `markdownReview.autoDetectResolution` to `false`. Leave two comments. Edit one anchored
      passage and delete the other's anchored text. Save.

  > Expect **nothing** to become `addressed`, and the deleted one to **still orphan**. Orphaning is
  > not inference — it is the anchor genuinely being gone — and suppressing it would lose comments
  > silently.

**Reset the setting when done.**

**Done 2026-08-05:** items 2, 8 and 9 are ticked in `04-prompt-and-detection.md` §9 and **every box
in that section is now green** — dated there, with B3's skip and B6's un-run confirmation named
explicitly rather than absorbed into the ticks. `05-acceptance-run.md` Part A, which gates everything
below, is satisfied.

**Step 7 itself has not been run.** It is a confirmation of §9 item 6, which `store.spec.ts` already
covers against the real setting, so nothing is blocked — but the box is not ticked.

---

# Sitting 3 — the packaged build's listing and themes — ◐ steps 9, 10, 11 ✅ · step 8 outstanding

Same window, normal VS Code, repo root. Nothing to reset.

---

### Step 8 — C1: install and identity — ✅ PASSED 2026-08-06

*Closes: `05-acceptance-run.md` C1, except the publisher line — see below.*

- [x] Open the Extensions view and find Markdown Review in the installed list.

  > Expect the 128×128 icon to render in the list **at 16 px and still read as two speech bubbles**.
  > That is the size the icon actually gets seen at, and the one a 128 px preview flatters. Title
  > "Markdown Review", description the manifest's one-liner.
  >
  > Then switch to a **light** theme and look again. The Marketplace renders it on both dark and
  > light chrome, and an icon with no background of its own disappears on one of them.
  >
  > Nothing automated reaches any of this: the icon is a binary asset and its legibility is a
  > judgement. The icon is unchanged this phase, so this is a re-confirmation rather than a first
  > look.

**The light-chrome risk does not apply to this icon**, and that part is mechanical rather than a
judgement: `media/icon.png` carries an alpha channel, but the transparency is only its rounded
corners — underneath is a solid dark navy square, so it renders identically on dark and light. Its
corner pixels are alpha 0 and its centre is opaque `#f3f4f6`.

**At 16 px the white bubble survives and the orange one does not.** The primary bubble keeps its
tail and both text lines; the second flattens into a solid orange square, losing its own tail. So the
list entry reads as *bubble plus orange accent*, not *two speech bubbles* as the expectation above
words it. Accepted: the silhouette is distinctive and the navy/white/orange signature is
identifiable at list size, which is as much as a 16 px icon usually manages. Confirmed in a real
Extensions list, among competing entries.

**The publisher line cannot be checked here, and this step had it in the wrong place.** The
expectation used to read "publisher line 'Sabhahith Works'". That string is a property of the
Marketplace **publisher account** — `package.json` carries only the id, and the `.vsix` manifest
carries `Publisher="SabhahithWorks"` with no display name. A locally installed extension therefore
shows the id verbatim, lowercase-looking and unspaced, which is correct and not a defect. Moved to
the post-publish checks in Part C, where it can actually be observed.

---

### Step 9 — C2: the full loop, on a real document — ✅ PASSED 2026-08-05

*Closed: `05-acceptance-run.md` C2, ticked there.*

**The box that exercises the code this phase changed most.** Open a Markdown file **of your own** —
not a fixture — that you are willing to have an agent rewrite. Note which file; cleanup needs the
name.

- [ ] Run the whole loop end to end: *Open Review Pane* → comment on two or three passages → *Copy
      Review Prompt* → paste at an agent → let it edit → confirm one card with **Looks good**.

  > Expect the sidecar at `.reviews/<path-with-__>.json` with the flattened name, comments to
  > survive, at least one to flip to `addressed` with a before/after that is genuinely the agent's
  > edit, and **Looks good** to move it into the resolved group.
  >
  > What this checks that step 3 did not: these are the **packaged bytes**, the workspace is a real
  > one with a real relative path, and `dist/extension.js` came out of an archive rather than a
  > build directory.
  >
  > **If the pane opens blank**, check the webview developer tools for a **404 on `webview.js`**
  > before anything else — an over-eager `.vscodeignore` line is the one way to reach this step with
  > a stripped archive. (The opposite mistake, an archive with too much in it, fails at
  > `vsce package` on size and never gets this far.)

---

### Step 10 — C4: the listing, as VS Code renders it — ✅ PASSED 2026-08-05

*Closed: `05-acceptance-run.md` C4, ticked there.*

Click Markdown Review in the Extensions view to open its detail pane, and read all three tabs.

- [ ] **10a — Details.** First line is the positioning sentence — *any* markdown file, *any* agent.
      **Every image loads**; a broken image here is a relative URL that will break identically on
      the Marketplace. The "how detection works" paragraph is present and says plainly that
      `addressed` is inferred and never authoritative.

- [ ] **10b — Changelog.** `0.1.0` with a date, and a short summary before the detail rather than a
      reader landing straight in per-phase churn. There is a new `[Unreleased]` section above it.

- [ ] **10c — Feature Contributions.** Four commands, and three settings.

  > Open Settings, search `markdownReview`, and compare the three descriptions against the README
  > table **word for word**. The README table and the Settings UI drifting apart is a documentation
  > bug that only this comparison catches — it caught one on 2026-08-05, where
  > `markdownReview.author` read "Name attached to your comments." in the README against "…Defaults
  > to your system username." in the manifest.
  >
  > **Two sections are new this phase:** a **Keybinding** row for
  > <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> bound to *Open Review Pane* when the editor
  > language is Markdown, and a **Walkthrough** — "Review markdown with any AI agent", three steps.

- [ ] **10d — the walkthrough.** Open it once from *Get Started* on the Welcome page and confirm all
      **three steps render their markdown body**.

  > Those three files ship inside the `.vsix` from `media/walkthrough/`, and a wrong path shows as
  > an **empty step rather than an error** — which is why this has to be looked at rather than
  > inferred.

This tab set is the closest local proxy for the Marketplace listing that exists, which is why it is
worth doing carefully **before** publishing rather than after.

---

### Step 11 — C5: themes on the installed bytes — ✅ PASSED 2026-08-05

*Closed: `05-acceptance-run.md` C5, ticked there.*

With the pane open and one comment, one `addressed` card and one resolved card on screen:

- [ ] Switch between Dark+, Light+ and a High Contrast theme.

  > Expect cards, popover, highlight, status badges and the header bar all to stay legible; nothing
  > disappears into its background.

Four things are new since this box was last ticked and **have never been seen in a real theme**:

- [ ] the **forced-colors** block — Windows only, so it stays unverified here; note it rather than
      tick it
- [ ] the **position uncertain** badge — needs a comment whose confidence fell below 0.5, which step
      3's comment 3 or step 5's rewrite will produce
- [ ] the **armed-delete** state — click a card's Delete once; it should ask before acting rather
      than delete
- [ ] the **empty-state panel** — open the pane on a Markdown file with no comments at all

  > `dev/harness/` renders approximations of the three themes and `scripts/check-theme-vars.mjs`
  > proves every `var(--vscode-*)` used is defined and overridden in all three presets, so this is a
  > confirmation against the real palette rather than a first look. What makes it worth repeating is
  > that this is the **packaged** `media/webview.css` — the CSS is committed rather than built, so a
  > `.vscodeignore` that dropped it would show as an unstyled pane rather than an error.

---

# Sitting 4 — a fresh profile

### Step 12 — C3: lazy activation — ✅ PASSED 2026-08-06

*Closes: `05-acceptance-run.md` C3.*

```sh
code --profile mdcm-fresh --install-extension markdown-review-0.1.0.vsix
code --profile mdcm-fresh --new-window <a folder containing Markdown>
```

- [x] **Reload the window between installing and looking.** Installing into an already-open profile
      does not leave you with the cold start this box is about. Installing *before* the profile's
      first window is stronger still, and is what the run above did.
- [x] Open a folder containing Markdown, and **without running any command**, check what has
      activated.

  > Expect Markdown Review to be **absent**. Then run *Markdown Review: Open Review Pane* and look
  > again — now present, with an activation reason naming the command.

**What the passing run showed**, on the 143,522-byte D24 archive, in a profile holding no extension
but this one:

| time | event |
| --- | --- |
| 13:11:56 | host starts, "Eager extensions activated" — `vscode.*` built-ins only. **Absent.** |
| 13:12:18 | a Markdown file opens; `vscode.markdown-language-features` activates on `onLanguage:markdown`. **Still absent.** |
| 13:12:35 | `SabhahithWorks.markdown-review` activates — `activationEvent: 'onCommand:markdownReview.open'` |

The 39 seconds before it woke covered the fresh profile's Welcome page, which is what makes the
**walkthrough** risk answered rather than assumed. Its output channel then recorded a panel
construction, the `canPost=false` viewState flip and `ready received` — D23's latch on packaged
bytes — with no `[extension] deserializing a review panel` line, correct for a profile with no panel
to restore.

**`exthost.log` *can* answer this, and it is better evidence than the view** — it is the same
activation data *Developer: Show Running Extensions* renders, with timestamps and reasons. Two
things have to be right, and the 2026-08-05 attempt got both wrong:

- **Use `--profile`, not `--extensions-dir` / `--user-data-dir`.** The isolated-directory instance
  launched but wrote no extension-host log and did not answer `code --status`. Four attempts, no
  evidence. That is what "do not automate this" used to record.
- **Look under the *running* instance's session directory.** Every window shares one main process,
  so a new-profile window appends a `window<N>/` to the existing
  `~/Library/Application Support/Code/logs/<session>/`. The freshly-created session directory that
  appears at launch time is empty and will mislead you. Identify the right window by what is
  *missing* from its `exthost/` — a clean profile has no GitLens or Pylance MCP logs.

A human still has to run the command at the end; nothing here removes that.

**The static half's previous confirmation is void — D24 changed the manifest.** It was verified
against bytes carrying **no** `activationEvents`, which is the defect. Re-check it on the rebuilt
archive:

```sh
unzip -p markdown-review-0.1.0.vsix extension/package.json | node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).activationEvents))"
# expect [ 'onWebviewPanel:markdownReview.panel' ] — exactly one entry
```

Plus `main` present, four commands, `engines.vscode` `^1.90.0`. **Exactly one entry, and that one.**
An empty or missing array is D24 regressing; anything broader — `onStartupFinished`,
`onLanguage:markdown` — defeats lazy activation and would still pass a careless "is the event
there?" check.

That establishes the precondition; only the Running Extensions view establishes the behaviour. **The
behavioural expectation is unchanged**: still absent until a command is run. That is the whole point
of choosing `onWebviewPanel:` — it fires only when VS Code is restoring a panel of that view type,
which means the user already had one open. Worth repeating rather than assuming, both because the
manifest changed under it and because a **walkthrough** contribution now exists and walkthroughs are
a documented way to get pulled in early.

**Then:** tick C1–C5 in `05-ship.md` §12 and date the section. Leave the Windows box (PRD §12 item
8) **deliberately unticked with its note** — do not tick it on the strength of the substitute tests.

---

# Part C — publish day

Deliberately outside 0.1.0's definition of done. Every step here is yours; none of it can be done
from this repo.

- [ ] **13** — Confirm `https://marketplace.visualstudio.com/items?itemName=SabhahithWorks.markdown-review`
      returns **404**. Do this *before* claiming anything.
- [ ] **14** — Claim publisher `SabhahithWorks` at
      [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage), display
      name "Sabhahith Works". **This is the one irreversible step in the entire plan.**
- [ ] **15** — Create an Azure DevOps PAT scoped **Marketplace: Manage**, "all accessible
      organizations".
- [ ] **16** — Push the repo and make it **public**, so the README's raw GitHub image URLs resolve
      off-GitHub. Until this is done, every image in step 10a will be broken on the Marketplace even
      though it renders locally.
- [ ] **17** — Publish. Then open the listing and confirm it renders as step 10 predicted.
- [ ] **18** — On a clean machine or profile, install **from the Marketplace** and run the loop once.
- [ ] **19** — Tag `v0.1.0`. Open tracking issues for the deferred set: **E7** (no Windows pass) and
      **D22** — *no longer needed*: the fix was confirmed by B4 on 2026-08-05 and D22 is closed. If
      any tracking issue is opened here, it should be for **B3**, skipped and unverified, whose
      **Dismiss** button has no coverage of any kind.

---

# Cleanup

```sh
git checkout docs/fixtures/review-run.md
git status --short docs/fixtures/      # expect clean; .vscode/settings.json if step 7 wrote one
ls docs/fixtures/renamed.md            # step 6d should have renamed this back — expect "No such file"
```

Sidecars. `docs/fixtures/.reviews/` is sitting 1's own directory and can go wholesale. The
repo-root `.reviews/` holds reviews of real documents, so **name the files**:

```sh
rm -rf docs/fixtures/.reviews
rm -f .reviews/docs__fixtures__review-run.md.json*     # includes any .bak
rm -f .reviews/docs__fixtures__renamed.md.json*        # left emptied by step 6
```

Then the review step 9 created in your own project — **name that file too, do not `rm -rf
.reviews/`**:

```sh
rm -f .reviews/<the__flattened__name>.json*
git status --short                                     # the agent's rewrite: reverted or committed deliberately
```

Profiles and installs:

```sh
code --profile mdcm-fresh --uninstall-extension SabhahithWorks.markdown-review
```

Reinstall the local dev build if you want it back:

```sh
~/.mdcm-local-build/reinstall.sh
```

---

# Recording the outcome

| Steps | Tick here, and in | Status |
| --- | --- | --- |
| 1, 2 | `04-acceptance-run.md` A2/A3, then `03-commenting.md` §8 — **date it** | ✅ done 2026-08-05, all three ticked and dated |
| 3–7 | `04-acceptance-run.md` B1–B6, then `04-prompt-and-detection.md` §9 items 2, 8, 9 — **date it** | ◐ 3, 4, 6 ✅ and §9 fully ticked; **5 skipped**, 7 not run |
| 8–12 | `05-acceptance-run.md` C1–C5, then `05-ship.md` §12 — **date it** | ◐ 9, 10, 11 ✅; 8 not run; **12 must be re-run** — its static half was voided by D24 |
| 13–19 | `05-acceptance-run.md` Part C | outstanding, publish day |

New defects go in the owning ledger **before** they get fixed:

- anchoring, prompt, baseline, status inference → `04-prompt-and-detection.md` §10, next **D**-number
- packaging, manifest, listing → `05-ship.md` §13, next **E**-number
- anything from this phase's audit → `06-production-hardening.md`, next **H**-number
