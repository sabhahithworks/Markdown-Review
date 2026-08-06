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
      **Steps 1–4 passed 2026-08-05** on an installed build, against `review-run.md` rather than
      `kitchen-sink.md` — the serializer restores by path, so the document is immaterial.
      **Step 5 passed 2026-08-05**, on the third attempt: it failed twice with a blank restored
      pane, which is the activation gap the note below predicted, now fixed as **D24**. It is the
      only box in the plan that ever caught it.

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

      > **This is the box that caught D24, and the prediction written here was correct.** Restoring
      > a webview raises the `onWebviewPanel:markdownReview.panel` activation event, and unlike
      > commands that one is **not** inferred from `contributes`. The manifest declared no
      > `activationEvents` at all, so the extension was never activated at restore time, the
      > serializer was never registered, and the pane came back as a tab with nothing in it.
      > `package.json` now declares exactly that one event — still lazy, since it fires only during
      > an actual restore. If this box fails again, check the manifest still carries it before
      > anything else.
      >
      > **A blank pane with the tab still present does not, on its own, mean `revive` failed.** That
      > reading cost two runs. VS Code restores the tab from its own workspace state without asking
      > the extension anything, so "tab present, pane empty" is also exactly what a never-activated
      > extension looks like. Settle it with *Developer: Show Running Extensions* — **not** with the
      > presence of a Markdown Review entry in the Output dropdown, which survives a reload whether
      > or not the extension ran. The channel's *contents* are evidence; its existence is not.
      > `deserializeWebviewPanel` now logs a line, so the channel can answer this directly.

  5. Repeat once with the pane as the **only** editor open (close `kitchen-sink.md`'s text editor
     first). That is the case where nothing else would have activated the extension.

- [x] **A3** — the other six steps pass (rejection wording, sidecar hand-edit, two windows, CSP
      console, three themes, the < 700 px drag). **Passed 2026-08-05** in the dev host against
      `kitchen-sink.md`, all six in one sitting, no defects found. That completes Part A.

**Part A is complete — A1, A2 and A3 all green as of 2026-08-05.** Plan 03 §8 is ticked and dated.
Continue to Part B.

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

- [x] **B1a** — **passed 2026-08-05.** Items numbered in document order, item 2 reading `On the
      section "## Failure modes"` against `On: "…"` for 1 and 3, three-space `> ` bodies, and
      nothing schema-shaped. A later round also exercised the long-quote `…` truncation (§10 D11),
      and confirmed the prompt carries **only `open` comments** — an `addressed` one is not quoted
      back at the agent.
      the toast reads exactly `3 comments copied. Paste into your agent and @-mention
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

- [x] **B1b** — **re-run and passed 2026-08-05** on the D24 build, after the H0 and H8 fixes. The
      original run is kept below because it is what produced D21. **Partial, first run
      2026-08-05:** Comment 1 flipped to `addressed` with a real before/after
      — the plain inference path demonstrated for the first time, and the clipping was the known
      `fuzzy.verify` under-report (`Counters live in memory, so they do no` against a 46-character
      before), not a wrong sentence. Comment 3 **orphaned instead of flipping**, so the header read
      `1 open, 1 addressed, 1 orphaned` rather than `1 open, 2 addressed`. That is **§10 D21**, not
      a run failure: its anchor stated an absence, and answering the comment necessarily deleted it.
      **Both are now fixed (Plan 06 H0 and H8): re-run this box.** Comment 3 will still orphan —
      an anchor whose text is genuinely gone has no position, and inventing one would be worse —
      but its orphan row now carries "The text around this changed since you copied the prompt — it
      may have been addressed rather than lost", so the row reads as *verify this* rather than as
      loss. The clipping is repaired at the span end, so a before/after should no longer end
      mid-word.
      Within ~400 ms of the agent's write (the `onDidChangeTextDocument` debounce; a
      write from outside the editor comes via the `FileSystemWatcher` instead and can take a beat
      longer):
      - **comments 1 and 3 flip to `addressed`**, each card showing a before/after;
      - the header counts follow — `1 open`, `2 addressed`;
      - **the before/after is the agent's actual edit**, not a neighbouring sentence. This is the
        one thing to look at closely: §10 records a known `fuzzy.verify` under-report where the
        status is right but the "after" text is clipped short. Clipped is expected; *a different
        sentence entirely* is a new defect.
- [x] **B1c** — **re-run blind and passed 2026-08-05**, by an agent that had *not* read this file or
      the expected outcome. That is what PRD §10 asks for and what the first pass lacked, so the
      qualification below is discharged. **First run 2026-08-05**, by an agent that had read this
      expectation beforehand (see the note under B1e). Comment 2 stayed `open`, carried the note, and offered **Looks good**;
      `## Failure modes` was untouched while its body was rewritten. The note's wording is
      imprecise at block scope — §10 D19 — but fired correctly here, where the scope really is a
      section.
      Comment 2 is still `open`, and carries the note "The text around this changed since you
      copied the prompt" with a **Looks good** button in place of **Resolve**.
      > This is the headline assertion of the whole step. `addressed` means *the text you selected*
      > changed; the agent rewrote the section under the heading and left the heading alone, so the
      > weaker signal is the correct answer and `addressed` would be a lie. It is also the exact
      > false negative the first run of this step found — see §10 D17.
      >
      > If the note is **missing**: check the setting `markdownReview.autoDetectResolution` is still
      > `true` (B6 turns it off), and that the comment was created *before* you copied the prompt.
      > Both suppress the signal by design.
- [x] **B1d** — **passed 2026-08-05**, against the packaged `0.1.0` `.vsix` in stable VS Code.
      **Looks good** on comment 2 → it resolves, drops into the resolved group, header
      goes to `0 open`, and the primary action greys out to **Copy review prompt** with no count.
      > Use **comment 1** in the 2026-08-05 run: it is the one that carries **Looks good** and
      > **Reopen**, because it reached `addressed`. This box names comment 2 only because the
      > script assumed the section comment would be the one to resolve.
- [x] **B1e** — **passed 2026-08-05.** **Reopen** it → back to `open`, header back to `1 open`,
      button back to **Copy review prompt (1)**.

> **Agent caveat for the 2026-08-05 run.** The stand-in agent had read B1c's expected outcome in the
> same session before editing, so it knew that rewriting the section while leaving the heading alone
> was the behaviour under test. B1c is therefore verified by an *informed* agent, not the naive one
> PRD §10 asks for. B1a, B1b and B1d/B1e do not depend on the agent's knowledge; B1c should be
> re-run against a genuinely blind agent before the phase is called done.

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
> "The text around this changed since you copied the prompt", with **Looks good**. That is D17, found by the
> first run of this very step; see Plan 04 §10.
>
> If a comment orphans instead, that is a different finding. Note **which** comment and **what the
> agent did to that passage** — a paragraph-level rewrite where a clause-level edit would have done
> is a prompt problem, not an anchoring problem, and the fix is PRD §7's wording rather than
> `src/anchor/`.

### B2 — orphan and the re-anchor gesture — §9 item 4

- [x] **B2a** — **passed 2026-08-05.** Delete an anchored sentence from the document and save.
      > Expect: exactly that comment orphans. It leaves the gutter and appears in the **orphaned**
      > section above the content, quoting the text it *used* to be attached to. Nothing else moves.
- [x] **B2b–B2d** — arm, select, commit, and Escape-to-disarm are **now machine-checked** by
      `dev/harness/` → **Run gestures**, including that committing opens **no popover** and that the
      posted `reanchorComment` carries the right id. What is left for a human is the round trip
      *through the host*: that the comment comes back `open` in the gutter with its original body
      and author, which the harness cannot see because it has no store behind it.
      >
      > **Host round trip confirmed 2026-08-05**, on the packaged build — arm from the orphan row,
      > select new text, commit, comment re-attached correctly. Reached by accident: the run was
      > attempting B4 and reached for this gesture instead, which is itself the finding in §10 D22.

### B3 — full rewrite and the diff — §9 item 5 (confirmation)

> **Skipped 2026-08-05, deliberately and without being run** — the tester's judgement was that the
> behaviour is working. The boxes stay open, because a skipped box left blank is indistinguishable
> from a failed one. §9 item 5 is ticked on automated coverage and does not depend on this, so
> nothing downstream is blocked.
>
> **B3c is the part that has no coverage at all.** The **Dismiss** button did not exist before Plan
> 06 H7, and nothing asserts it is present or that dismissal sticks. B3a's banner placement is
> largely covered by the harness `rewrite` scenario, and B3b's both-sides-prose claim by
> `detection.spec.ts`. If only one of these three is ever run, run B3c.

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
      > The **Dismiss** button this step has always asked for did not exist until Plan 06 H7 — the
      > banner had only **Review the diff** and cleared itself on the next render. If it is missing
      > again, that is the fix regressing.

Then `git checkout docs/fixtures/review-run.md` and re-open the pane before continuing.

### B4 — rename and re-link — §9 item 8

The picker is `vscode.window.showOpenDialog` — a native OS dialog, which is precisely why no test
process can answer it (§10 D9). Run this with B1's comments still in place, so there is something
real to migrate.

> **Not exercised in either 2026-08-05 run.** The packaged-build attempt reached for **Re-anchor**
> on an orphan card instead of **Locate file…** on the unreadable notice, and re-anchored a comment
> by selecting text — the B2 gesture, not this one. The picker was never opened. See §10 D22: two
> recovery actions were visible at once and the wrong one was the more discoverable, which was a
> finding about the UI, not about the tester.
>
> **That competition is now gone** (Plan 06 H7/H0): while the target is unreadable the pane clears
> its content *and* empties the orphan section, so **Locate file…** is the only recovery action on
> screen. B4a's expectation below is what the code now does rather than what it used to; if an
> orphan card is visible under the notice, that is a regression in the fix, not a tester error.

**Step 1 — break the link.**

> **Ticked on the mechanism, with a discrepancy recorded.** The 2026-08-05 run renamed
> **`kitchen-sink.md`**, not `review-run.md`, and ran in the **dev host** with `docs/fixtures/` as
> the workspace root. So the notice, the picker and the re-link are genuinely verified — the first
> time any of them has been — but three things this box specifies were not: the comments migrated
> were not the ones B1 created, the toast count was against different data, and the sidecar written
> was `docs/fixtures/.reviews/renamed.md.json` rather than the **flattened**
> `.reviews/docs__fixtures__renamed.md.json`, which is part of what B4 exists to exercise.
>
> The rename also deleted the `kitchen-sink.md` fixture and its tracked sidecar; both were restored
> from git and `npm run check` is green again. A clean re-run against `review-run.md` at the repo
> root would close the flattened-path half. **Do not re-run it on `kitchen-sink.md`** — unit tests
> and `dev/harness/fixture.js` assert its exact bytes.

- [x] **B4a** — **passed 2026-08-05, the first time this box was ever exercised.** With the pane
      open and showing its comments, rename `docs/fixtures/review-run.md` to
      `renamed.md` in the explorer (<kbd>F2</kbd>).
      > Expect, within a second: the pane replaces its content with a notice headed **"This file
      > could not be read"**, body "It may have been moved, renamed or deleted. The pane is still
      > open, and nothing has been lost. (…)", and a **Locate file…** button — which takes focus,
      > so <kbd>Enter</kbd> alone activates it.
      >
      > The document really is gone from the pane: no rendered prose underneath, no gutter cards,
      > and **no orphan section** (Plan 06 H7). **Locate file…** is the only action offered.
      >
      > Also check: the pane **did not close**, and `.reviews/…review-run.md.json` is still on disk
      > with all its comments. Losing either is a PRD §11 violation — the comments outlive the file.
      >
      > **Note:** renaming inside VS Code now also migrates the review automatically (Plan 06 H30),
      > so the pane may re-open on `renamed.md` by itself. To exercise the manual path this box is
      > about, rename the file **outside** VS Code (in a terminal or Finder) so no rename event
      > fires.

**Step 2 — re-link.**

- [x] **B4b** — **passed 2026-08-05.** Click **Locate file…**. `showOpenDialog` has now been opened
      by a human — the thing no test process can answer (§10 D9).
      > Expect a native file dialog titled **"Re-link review-run.md"**, whose confirm button reads
      > **"Re-link review"** and whose filter offers Markdown only (`md`, `markdown`, `mdown`,
      > `mkd`, `mdx`). Multi-select is off.
      >
      > Press <kbd>Esc</kbd> first: nothing at all should happen — no error, no state change. Then
      > reopen it.
- [x] **B4c** — **passed 2026-08-05.** Pick `renamed.md`.
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

- [x] **B5a — cancel.** **Passed 2026-08-05.** *Markdown Review: Clear Addressed Comments* from the palette.
      > Expect a **modal** (dims the window, cannot be clicked away) reading `Remove 2 addressed
      > comments? Their text changes stay in the document.`, with a **Remove** button next to
      > Cancel. Note the singular is handled: one comment reads `Remove 1 addressed comment?`.
      >
      > Click **Cancel**. Expect: nothing changes — same cards, same counts, and **no `.json.bak`
      > on disk**. Check the directory; a backup written before the answer would mean the modal is
      > decorative.
- [x] **B5b — confirm.** **Passed 2026-08-05.** Run it again, click **Remove**.
      > Expect: the addressed cards disappear, the header count drops, and a toast
      > `Removed 2 addressed comments. A backup was saved as review-run.md.json.bak.` (the flattened
      > name `docs__fixtures__review-run.md.json.bak` from the repo root). Open the `.bak` — it is
      > the full sidecar as it was a moment ago, and every removed comment is in it.
- [x] **B5c — the header button.** **Passed 2026-08-05.** Make another comment addressed, then use **Clear addressed** in
      the header bar rather than the palette. Same modal, same outcome — it routes through the same
      command (`ReviewPanel.ts:212`).
- [x] **B5d — clear all.** **Passed 2026-08-05.** *Markdown Review: Clear All Comments*.
      > Expect: `Remove all N comments from review-run.md? The document itself is not changed.`
      > Confirm, then check the document itself in a text editor — **byte-identical**, and
      > `git diff docs/fixtures/review-run.md` shows only the agent's B1 edits if you have not reset
      > yet. The pane is empty, the sidecar is empty, a fresh `.bak` holds everything.
      >
      > There is deliberately **no** header button for this one — palette only, per PRD §6. Confirm
      > there isn't one.
- [x] **B5e — nothing to clear.** **Passed 2026-08-05.** With the review now empty, run each command once more.
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
