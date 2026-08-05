# Phase 4 acceptance — the manual run

Everything Phase 4 claims that no harness can reach, plus the two Phase 3 boxes that are still the
entry gate for this phase. One F5 session, about 30 minutes.

Part A closes `docs/plans/03-commenting.md` §8. Part B closes the four `[ ]` items in
`docs/plans/04-prompt-and-detection.md` §9. Date both sections when they pass.

## Before you start

```sh
npm run check             # typecheck + lint + 465 unit tests
npm run test:integration  # 40 host-side assertions in a real VS Code
npm run build             # both bundles + the two CSS guards
rm -rf docs/fixtures/.reviews
```

And the browser harness, which now covers gestures as well as layout — serve the repo, open
`/dev/harness/`, then **Run checks** and **Run gestures**.

All three were green and `.reviews/` was cleared when this document was written; re-run them if
anything has changed since.

Then either:

- <kbd>F5</kbd> — the dev host opens `docs/fixtures/` as its folder, so **the workspace root is
  `docs/fixtures/`**. Messages say `review-run.md` and the sidecar lands at
  `docs/fixtures/.reviews/review-run.md.json`.
- **An installed build** — `~/.mdcm-local-build/reinstall.sh` rebuilds and installs into VS Code and
  Cursor, then *Developer: Reload Window*. Open the **repo root** as usual, so messages say
  `docs/fixtures/review-run.md` and the sidecar lands at
  `.reviews/docs__fixtures__review-run.md.json` — the flattened name, which the F5 route never
  exercises by hand.

The second is the better route for B1: the agent you paste into is already rooted at the repo, and
you are running the same bytes a user would install. Use it unless a step below says otherwise —
**A2 and A3's CSP step want the dev host**, where the webview developer tools are reachable.

Whichever you pick, note which one, because every path in this document is relative to that root.

**Run the four un-automated items in this order**, because each one leaves the state the next needs:

1. **A2** (reload) — standalone, two minutes, and the cheapest thing to find broken.
2. **B1** (real agent) — produces the addressed and section-changed cards everything below needs.
3. **B4** (re-link) — migrates those comments, so it needs them to still exist.
4. **B5** (clear modals) — deletes them, so it goes last.

B2, B3 and B6 slot in wherever; they reset their own state.

Two documents, and the difference matters:

- **`kitchen-sink.md`** — Part A only. Unit tests and `dev/harness/fixture.js` both assert against
  its exact bytes, so nothing in this run may edit it. Part A never does: commenting writes to the
  sidecar, never to the document.
- **`review-run.md`** — Part B only. Deliberately imperfect prose, asserted against by nothing, and
  meant to be rewritten by an agent. Reset it with `git checkout docs/fixtures/review-run.md`.

---

## Part A — the Phase 3 gate

Run `docs/plans/03-acceptance-run.md` end to end (8 steps, ~10 min) against `kitchen-sink.md`.

Six of its eight steps re-confirm items the harnesses already tick. **These two are the gate** — the
only unchecked boxes in Plan 03 §8, and the ones with no automated coverage of any kind:

- [x] **A1 — create flow** — **now machine-checked.** `dev/harness/` → **Run gestures** drives a
      real selection through the real debounce to a real `addComment`, and asserts the offset the
      webview computed matches the host's. Serve the repo and click the button; no F5 needed.
      >
      > What that cannot check is how it *feels* — whether the button lands somewhere sensible
      > relative to the selection, and whether the highlight and card read as connected. Worth thirty
      > seconds in a real pane, but it is no longer the gate.

- [x] **A2 — window reload** (Plan 03 step 4). The `WebviewPanelSerializer` path, which has no
      automated coverage of any kind — `@vscode/test-electron` cannot reload its own window.
      **Passed 2026-08-05** on an installed build, against `review-run.md` rather than
      `kitchen-sink.md` — the serializer restores by path, so the document is immaterial. Steps 1–4
      only; **step 5 is still outstanding**, and it is the one that actually exercises the
      activation gap the note below describes.

  1. Open `kitchen-sink.md` → *Markdown Review: Open Review Pane*. Leave two comments on different
     paragraphs if the sidecar is empty (commenting never edits the document, so this is safe).
  2. Scroll to roughly the middle of the document.
  3. Click the **addressed** chip in the header bar to switch it off. It dims and reads `0 addressed`
     — the exact label is `<count> <status>`, e.g. `2 open`.
  4. <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> → *Developer: Reload Window*.

      > Expect, once the window comes back: **the pane is still there**, on the same tab, against
      > `kitchen-sink.md`, with the same comments and roughly the same scroll position, and the
      > **addressed chip is still switched off**. State travels as `PanelState { targetPath,
      > scrollLine, filter }` through `vscode.setState` (`media/src/webview.ts:145`) and back via
      > `deserializeWebviewPanel` (`src/extension.ts:45`).

      > **The failure mode to watch for is a pane that comes back blank, or a tab that closes
      > itself.** Restoring a webview raises the `onWebviewPanel:markdownReview.panel` activation
      > event, and unlike commands that one is **not** inferred from `contributes` — `package.json`
      > declares no `activationEvents` at all today (deliberately, per CLAUDE.md's lazy-activation
      > rule). If the extension is not activated at restore time the serializer was never registered,
      > and VS Code discards the panel.
      >
      > If it does fail: adding `"activationEvents": ["onWebviewPanel:markdownReview.panel"]` is the
      > fix and does **not** break lazy activation — it fires only when a panel is actually being
      > restored, unlike `onStartupFinished`. Record it as a new D-number in Plan 04 §10 first.
      >
      > A blank pane with the tab still present is a different bug: the serializer ran, but `revive`
      > failed. Check *View → Output → Markdown Review* and the extension host console.

  5. Repeat once with the pane as the **only** editor open (close `kitchen-sink.md`'s text editor
     first). That is the case where nothing else would have activated the extension.

- [ ] **A3** — the other six steps pass (rejection wording, sidecar hand-edit, two windows, CSP
      console, three themes, the < 700 px drag).

Tick and **date** Plan 03 §8, then continue.

---

## Part B — Phase 4

Open `review-run.md` → *Markdown Review: Open Review Pane*.

### B1 — the real-agent run — §9 item 2

**The one item nothing else can stand in for.** Every automated case in the repo writes the "after"
text itself, which tests the detection machinery but not the thing the product actually bets on:
that a real agent, given nothing but prose and no schema, edits in a way the anchor cascade can
still follow.

**Preconditions.** Reset the fixture and its sidecar — a document an agent already rewrote will not
reproduce this, and a stale sidecar makes every count below meaningless:

```sh
git checkout docs/fixtures/review-run.md
rm -f docs/fixtures/.reviews/review-run.md.json          # F5 route
rm -f .reviews/docs__fixtures__review-run.md.json        # installed-build route
```

Delete **that file**, not the directory: `.reviews/` at the repo root also holds reviews of real
documents, and `rm -rf` there throws away comments the extension is specified never to delete.

Confirm the header reads `0 open` before you start.

**Step 1 — leave three comments**, deliberately varied, because the three exercise different halves
of the machinery. Select the text exactly as written; the anchor is the selection.

| # | Select | Type roughly | Why this one |
| --- | --- | --- | --- |
| 1 | `Counters live in memory. This is fine for now.` (line 14 — both sentences) | "What happens to the counters on restart or redeploy?" | Prose, anchored **to** the thing that must change → the plain `addressed` path |
| 2 | `Failure modes` (line 28 — the heading text only, no `##`) | "This section needs to say what the client should actually do." | Anchored to a **label**, not to the thing that changes → the D17 section signal |
| 3 | `The exact ordering has not been written down anywhere` (lines 37–38) | "What is the ordering?" | Spans a source line break, so it exercises whitespace collapsing in anchor space |

  > Sanity check before continuing: header reads `3 open`, three cards in the right margin, three
  > highlights in the text. `.reviews/…review-run.md.json` exists and has three entries.

**Step 2 — copy the prompt.** Click **Copy review prompt (3)** in the header bar (or
*Markdown Review: Copy Review Prompt*).

- [ ] **B1a** — the toast reads exactly `3 comments copied. Paste into your agent and @-mention
      <path>.` — `docs/fixtures/review-run.md` from the repo root, `review-run.md` from the F5 host.
      Paste the prompt into a scratch buffer and read it before sending it anywhere:
      - a preamble, then numbered items `1.` `2.` `3.` in the order the comments appear in the
        document — **not** creation order;
      - item 2 reads `On the section "## Failure modes"`, items 1 and 3 read `On: "…"`. If item 2
        says `On:` the `scopeOf` unification regressed (§10 D17);
      - each body indented three spaces and quoted with `> `;
      - **no** ids, JSON, status words or instructions to report back. Anything schema-shaped in
        there is a PRD §1 violation, and the whole agent-agnostic bet rests on its absence.

      > Copying the prompt is also what snapshots `baselineText`. Everything below is measured
      > against this moment, so do not edit the file between here and step 3.

**Step 3 — hand it to a real agent.** Paste into whichever agent you like, `@`-mention the path from
the toast, and let it edit. Do not tell it anything the prompt does not. Keep the pane visible.

- [ ] **B1b** — within ~400 ms of the agent's write (the `onDidChangeTextDocument` debounce; a
      write from outside the editor comes via the `FileSystemWatcher` instead and can take a beat
      longer):
      - **comments 1 and 3 flip to `addressed`**, each card showing a before/after;
      - the header counts follow — `1 open`, `2 addressed`;
      - **the before/after is the agent's actual edit**, not a neighbouring sentence. This is the
        one thing to look at closely: §10 records a known `fuzzy.verify` under-report where the
        status is right but the "after" text is clipped short. Clipped is expected; *a different
        sentence entirely* is a new defect.
- [ ] **B1c** — **comment 2 is still `open`**, and carries the note "This section changed since you
      copied the prompt" with a **Looks good** button in place of **Resolve**.
      > This is the headline assertion of the whole step. `addressed` means *the text you selected*
      > changed; the agent rewrote the section under the heading and left the heading alone, so the
      > weaker signal is the correct answer and `addressed` would be a lie. It is also the exact
      > false negative the first run of this step found — see §10 D17.
      >
      > If the note is **missing**: check the setting `markdownReview.autoDetectResolution` is still
      > `true` (B6 turns it off), and that the comment was created *before* you copied the prompt.
      > Both suppress the signal by design.
- [ ] **B1d** — **Looks good** on comment 2 → it resolves, drops into the resolved group, header
      goes to `0 open`, and the primary action greys out to **Copy review prompt** with no count.
- [ ] **B1e** — **Reopen** it → back to `open`, header back to `1 open`, button back to **Copy
      review prompt (1)**.

> **If a comment orphans instead of any of the above**, that is a finding, and *which* one matters.
> Note the comment number and what the agent did to that passage. A paragraph-level rewrite where a
> clause-level edit would have done is a **prompt** problem — the fix is PRD §7's wording, not
> `src/anchor/`. An anchor that survived a light rewording and still orphaned is an anchoring
> problem. Record it in Plan 04 §10 before touching anything.

> **Then reset**: `git checkout docs/fixtures/review-run.md`. Do not commit the agent's rewrite —
> the fixture's value is that it starts imperfect every time.

> **Comment 2 will not flip to `addressed`, and that is correct.** It is anchored to a heading, and
> `addressed` means the text you *selected* changed — rewriting the section below leaves the heading
> untouched. Expect the weaker signal instead: the card keeps its `open` status and gains the note
> "This section changed since you copied the prompt", with **Looks good**. That is D17, found by the
> first run of this very step; see Plan 04 §10.
>
> If a comment orphans instead, that is a different finding. Note **which** comment and **what the
> agent did to that passage** — a paragraph-level rewrite where a clause-level edit would have done
> is a prompt problem, not an anchoring problem, and the fix is PRD §7's wording rather than
> `src/anchor/`.

### B2 — orphan and the re-anchor gesture — §9 item 4

- [ ] **B2a** — delete an anchored sentence from the document and save.
      > Expect: exactly that comment orphans. It leaves the gutter and appears in the **orphaned**
      > section above the content, quoting the text it *used* to be attached to. Nothing else moves.
- [x] **B2b–B2d** — arm, select, commit, and Escape-to-disarm are **now machine-checked** by
      `dev/harness/` → **Run gestures**, including that committing opens **no popover** and that the
      posted `reanchorComment` carries the right id. What is left for a human is the round trip
      *through the host*: that the comment comes back `open` in the gutter with its original body
      and author, which the harness cannot see because it has no store behind it.

### B3 — full rewrite and the diff — §9 item 5 (confirmation)

- [ ] **B3a** — with at least two located comments, replace the entire contents of `review-run.md`
      with unrelated prose and save.
      > Expect: a banner, *at the top of the pane and on screen without scrolling*, reading "The
      > document was rewritten". Every non-resolved comment is in the orphan section. Nothing was
      > deleted.
- [ ] **B3b** — **Review the diff**.
      > Expect: a two-pane diff, **both sides readable prose**. If one side shows `#`, `**` and
      > table pipes and the other does not, that is §10 D1 regressing — the whole point of that
      > correction is that both sides are rendered plain text.
- [ ] **B3c** — **Dismiss**, then edit the document again. The banner does not come back for a
      document that was already wrecked.

Then `git checkout docs/fixtures/review-run.md` and re-open the pane before continuing.

### B4 — rename and re-link — §9 item 8

The picker is `vscode.window.showOpenDialog` — a native OS dialog, which is precisely why no test
process can answer it (§10 D9). Run this with B1's comments still in place, so there is something
real to migrate.

**Step 1 — break the link.**

- [ ] **B4a** — with the pane open and showing its comments, rename `docs/fixtures/review-run.md` to
      `renamed.md` in the explorer (<kbd>F2</kbd>).
      > Expect, within a second: the pane replaces its content with a notice headed **"This file
      > could not be read"**, body "It may have been moved, renamed or deleted. The pane is still
      > open, and nothing has been lost. (…)", and a **Locate file…** button.
      >
      > Also check: the pane **did not close**, and `.reviews/…review-run.md.json` is still on disk
      > with all its comments. Losing either is a PRD §11 violation — the comments outlive the file.

**Step 2 — re-link.**

- [ ] **B4b** — click **Locate file…**.
      > Expect a native file dialog titled **"Re-link review-run.md"**, whose confirm button reads
      > **"Re-link review"** and whose filter offers Markdown only (`md`, `markdown`, `mdown`,
      > `mkd`, `mdx`). Multi-select is off.
      >
      > Press <kbd>Esc</kbd> first: nothing at all should happen — no error, no state change. Then
      > reopen it.
- [ ] **B4c** — pick `renamed.md`.
      > Expect: a toast `Re-linked 3 comments to renamed.md.` (or however many survive B1), and a
      > **new pane** on `renamed.md` with every comment present, located, and in the status it had.
      > The old pane closes itself — re-linking cannot happen in place, because panel and store are
      > both keyed by target URI (`ReviewPanel.relink`).
      >
      > On disk: `.reviews/…renamed.md.json` now holds the comments, and the old
      > `.reviews/…review-run.md.json` still **exists and still parses** — it is emptied, never
      > deleted. Open both and confirm.
> The two rejection paths — re-linking a file to itself (`That is the same file this review is
> already attached to.`) and a destination whose sidecar cannot be written (`Markdown Review could
> not move the comments, so nothing has been changed.`) — are already covered host-side by
> `store.spec.ts` and are not reachable by hand once the dialog has done its job. Do not chase them
> here; the manual part of B4 is the dialog and the two disk states around it.

**Step 3 — restore.** With the file back at `review-run.md`, re-link the pane onto it the same way,
so the comments end up under the original sidecar name again. `.reviews/` is cleared in cleanup, so
the emptied leftovers do not matter.

### B5 — the clear commands — §9 item 9

Modals cannot be answered from `@vscode/test-electron` (§10 D9), so the confirmations are only ever
checked here. The store-level behaviour underneath is already covered.

These are the only two places in the extension that delete a comment at all (PRD §4), so both are
gated on a modal naming the count, and both write a `.json.bak` **before** removing anything — the
store abandons the whole operation if that backup cannot be written. Run this last: it destroys the
state the earlier items need.

**Precondition:** at least one `addressed` comment. B1 leaves two. If you have already cleared them,
edit an anchored sentence and save to make one.

- [ ] **B5a — cancel.** *Markdown Review: Clear Addressed Comments* from the palette.
      > Expect a **modal** (dims the window, cannot be clicked away) reading `Remove 2 addressed
      > comments? Their text changes stay in the document.`, with a **Remove** button next to
      > Cancel. Note the singular is handled: one comment reads `Remove 1 addressed comment?`.
      >
      > Click **Cancel**. Expect: nothing changes — same cards, same counts, and **no `.json.bak`
      > on disk**. Check the directory; a backup written before the answer would mean the modal is
      > decorative.
- [ ] **B5b — confirm.** Run it again, click **Remove**.
      > Expect: the addressed cards disappear, the header count drops, and a toast
      > `Removed 2 addressed comments. A backup was saved as review-run.md.json.bak.` (the flattened
      > name `docs__fixtures__review-run.md.json.bak` from the repo root). Open the `.bak` — it is
      > the full sidecar as it was a moment ago, and every removed comment is in it.
- [ ] **B5c — the header button.** Make another comment addressed, then use **Clear addressed** in
      the header bar rather than the palette. Same modal, same outcome — it routes through the same
      command (`ReviewPanel.ts:212`).
- [ ] **B5d — clear all.** *Markdown Review: Clear All Comments*.
      > Expect: `Remove all N comments from review-run.md? The document itself is not changed.`
      > Confirm, then check the document itself in a text editor — **byte-identical**, and
      > `git diff docs/fixtures/review-run.md` shows only the agent's B1 edits if you have not reset
      > yet. The pane is empty, the sidecar is empty, a fresh `.bak` holds everything.
      >
      > There is deliberately **no** header button for this one — palette only, per PRD §6. Confirm
      > there isn't one.
- [ ] **B5e — nothing to clear.** With the review now empty, run each command once more.
      > Expect an information toast, **no modal**, and **no new `.bak`**: `No addressed comments on
      > review-run.md.` and `No comments on review-run.md.` respectively. A `.bak` written here
      > would overwrite the one from B5d with an empty file — that is the failure worth checking
      > for, since it silently destroys the only copy of the comments.

### B6 — `autoDetectResolution: false` — §9 item 6 (confirmation)

- [ ] Set `markdownReview.autoDetectResolution` to `false` in the dev host, leave two comments, then
      edit one anchored passage and delete another.
      > Expect: **nothing becomes `addressed`**, and the deleted one **still orphans**. Orphaning is
      > not inference — it is the anchor genuinely being gone — and suppressing it would lose
      > comments silently.

Reset the setting when done.

---

## Cleanup

```sh
git checkout docs/fixtures/review-run.md
git status --short docs/fixtures/     # expect clean; .vscode/settings.json if B6 wrote one
ls docs/fixtures/renamed.md           # B4 should have renamed this back — expect "No such file"
```

Then the sidecars this run created. `docs/fixtures/.reviews/` is the run's own directory and can go
wholesale; the repo-root `.reviews/` holds reviews of real documents, so name the files:

```sh
rm -rf docs/fixtures/.reviews                             # F5 route
rm -f .reviews/docs__fixtures__review-run.md.json*        # installed-build route, incl. .bak
rm -f .reviews/docs__fixtures__renamed.md.json*           # left emptied by B4
```

## Recording the outcome

- Plan 03 §8 — tick A2, date the section. A1 is already ticked: the gesture harness drives the
  create flow, so the run only re-confirms how it feels.
- Plan 04 §9 — tick items 2 (B1), 8 (B4) and 9 (B5), date the section. B2, B3 and B6 have no box
  left to tick — items 3, 4, 5 and 6 are already green from `detection.spec.ts` and the harness,
  and those steps are confirmations in a real pane rather than the gate.
- Tick the boxes in **this** document as you go, and leave a one-line note next to anything you
  skipped or could not reach. A skipped box left blank is indistinguishable from one that failed.
- Anything that failed goes in Plan 04 §10 as a new defect, in the same D-numbered form, before it
  gets fixed. A finding recorded only in a commit message is a finding the next phase will re-derive.
