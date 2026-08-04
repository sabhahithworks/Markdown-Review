# Phase 4 acceptance — the manual run

Everything Phase 4 claims that no harness can reach, plus the two Phase 3 boxes that are still the
entry gate for this phase. One F5 session, about 30 minutes.

Part A closes `docs/plans/03-commenting.md` §8. Part B closes the four `[ ]` items in
`docs/plans/04-prompt-and-detection.md` §9. Date both sections when they pass.

## Before you start

```sh
npm run check             # typecheck + lint + 421 unit tests
npm run test:integration  # 39 host-side assertions in a real VS Code
npm run build             # both bundles + the two CSS guards
rm -rf docs/fixtures/.reviews
```

All three were green and `.reviews/` was cleared when this document was written; re-run them if
anything has changed since.

Then <kbd>F5</kbd>. The dev host opens `docs/fixtures/` as its folder, so **the workspace root is
`docs/fixtures/`, not the repo root** — paths in messages and sidecars are relative to it.

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

- [ ] **A1 — create flow** (run step 1). Select the sentence beginning "The authentication service
      validates every incoming bearer token…", click the floating **Comment** button, type a body,
      submit with <kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd>.
      > Expect: the popover closes, a card appears in the right margin aligned to that sentence, the
      > sentence gains a highlight, and hovering either one emphasises the other.

- [ ] **A2 — window reload** (run step 4). *Developer: Reload Window* with the pane open.
      > Expect: the pane returns against the same file with the same comments. This is the
      > `WebviewPanelSerializer` path. Phase 4 added `PanelState.filter`, which rides through it —
      > so set a filter chip *before* reloading and check it survives.

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

Leave three comments, deliberately varied:

1. On the sentence "Counters live in memory. This is fine for now." — ask what happens on restart.
2. On the whole `## Failure modes` **heading** — select exactly the heading text, so the prompt uses
   PRD §7's `On the section "## Failure modes"` phrasing rather than `On:`.
3. On "The exact ordering has not been written down anywhere" — ask for the ordering.

Then click **Copy review prompt (3)** in the header bar.

- [ ] **B1a** — the confirmation reads `3 comments copied. Paste into your agent and @-mention
      review-run.md.` Paste the prompt somewhere first and eyeball it: numbered items, each with an
      `On:` or `On the section:` line, bodies indented three spaces and quoted with `> `.
- [ ] **B1b** — paste into a real agent and let it edit the file. If the agent is rooted at the repo
      rather than at `docs/fixtures/`, give it the path `docs/fixtures/review-run.md`.
      > Expect: within ~400 ms of the agent's write, cards flip to **addressed** with a before/after
      > on the card, and the header counts follow. Check the before/after is actually the change the
      > agent made, not a neighbouring sentence.
- [ ] **B1c** — **Looks good** on one card → it resolves and drops into the resolved group.
- [ ] **B1d** — **Reopen** on another → it returns to `open`, and the header's open count and the
      **Copy review prompt (n)** label both go back up.

> If a comment orphans instead of flipping to `addressed`, that is the finding. Note **which**
> comment and **what the agent did to that passage** — a paragraph-level rewrite where a clause-level
> edit would have done is a prompt problem, not an anchoring problem, and the fix is PRD §7's
> wording rather than `src/anchor/`.

### B2 — orphan and the re-anchor gesture — §9 item 4

- [ ] **B2a** — delete an anchored sentence from the document and save.
      > Expect: exactly that comment orphans. It leaves the gutter and appears in the **orphaned**
      > section above the content, quoting the text it *used* to be attached to. Nothing else moves.
- [ ] **B2b** — click **Re-anchor** on that row.
      > Expect: the row explains itself — "Select the new text in the document, or press Escape to
      > cancel." — and the button becomes **Cancel**.
- [ ] **B2c** — select new text in the document.
      > Expect: the floating button reads **Re-anchor here**, and clicking it commits immediately
      > with **no popover** (there is no body to type). The comment returns to `open` in the gutter
      > with its original body and author intact.
- [ ] **B2d** — arm another re-anchor and press <kbd>Escape</kbd>. It disarms cleanly.

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

- [ ] **B4a** — with the pane open, rename `review-run.md` to `renamed.md` in the explorer.
      > Expect: the pane shows "This file could not be read", with a **Locate file…** action. The
      > pane stays open; the sidecar is untouched.
- [ ] **B4b** — **Locate file…** → pick `renamed.md`.
      > Expect: the picker opens, the pane re-renders against the new file with every comment still
      > present and located, and `.reviews/renamed.md.json` now exists. The old
      > `.reviews/review-run.md.json` is **emptied, not deleted** — check it still exists and still
      > parses.

Rename it back to `review-run.md` afterwards.

### B5 — the clear commands — §9 item 9

Modals cannot be answered from `@vscode/test-electron` (§10 D9), so the confirmations are only ever
checked here. The store-level behaviour underneath is already covered.

- [ ] **B5a** — *Markdown Review: Clear Addressed Comments* with some addressed.
      > Expect: a modal reading `Remove N addressed comments? Their text changes stay in the
      > document.` Cancel → nothing happens. Confirm → they go, a `.json.bak` appears next to the
      > sidecar, and the message names it.
- [ ] **B5b** — the **Clear addressed** button in the header bar does the same thing.
- [ ] **B5c** — *Markdown Review: Clear All Comments*.
      > Expect: `Remove all N comments from review-run.md? The document itself is not changed.` The
      > document is genuinely untouched afterwards. There is deliberately **no** button for this —
      > palette only, per PRD §6.
- [ ] **B5d** — run either command with nothing to clear → `No addressed comments on review-run.md.`
      and **no** `.bak` is written.

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
rm -rf docs/fixtures/.reviews
git status --short docs/fixtures/     # .vscode/settings.json if B6 wrote one
```

## Recording the outcome

- Plan 03 §8 — tick A1 and A2, date the section.
- Plan 04 §9 — tick items 2, 4, 8 and 9, date the section.
- Anything that failed goes in Plan 04 §10 as a new defect, in the same D-numbered form, before it
  gets fixed. A finding recorded only in a commit message is a finding the next phase will re-derive.
