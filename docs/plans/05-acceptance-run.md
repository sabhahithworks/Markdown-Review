# Phase 5 acceptance — the manual run

Everything Plan 05 §12 claims that no harness can reach. It is short, because Phase 5 adds almost no
behaviour — what it adds is a *package*, and the only way to check a package is to install it.

The point of this run is the one thing every earlier run deliberately avoided: **stable VS Code, not
the Extension Development Host, against the exact bytes a user would install.** Every previous
acceptance run exercised the working tree. This one exercises the archive, which is the only place
`.vscodeignore` mistakes, a missing icon and a stale `dist/` can exist.

Part A is the entry gate and lives elsewhere. Part B closes the `[ ]` items in Plan 05 §12. Part C is
publish day, deliberately outside 0.1.0's definition of done. Date the sections when they pass.

## Before you start

```sh
npm run check                      # typecheck + lint + unit tests
npm run test:integration           # host-side assertions in a real VS Code
npm run build                      # both bundles + the CSS guards + check-bundles.mjs
npx --yes @vscode/vsce ls          # expect the ten files in Plan 05 §7 — empty output is a FAILURE
npx --yes @vscode/vsce package     # → markdown-review-pane-0.1.0.vsix; record the size in §12
```

**Uninstall the local build first.** `~/.mdcm-local-build/reinstall.sh` installs
`local-dev.markdown-review`, and two extensions contributing the same four commands and the same
editor-title button is a confusing hour. It also means a "working" result may be the *old* build
answering.

```sh
code --uninstall-extension local-dev.markdown-review
code --install-extension markdown-review-pane-0.1.0.vsix --force
```

Then *Developer: Reload Window*, and confirm in the Extensions view that exactly one **Markdown
Review** is installed.

Two documents, and the difference matters — the same rule as Plan 04's run:

- **`docs/fixtures/kitchen-sink.md`** — unit tests and `dev/harness/fixture.js` assert its exact
  bytes. Nothing here may edit it.
- **A real project of your own** — C2 wants one, because PRD §12 asks for the loop on a real
  document and because it is the only way the flattened sidecar name
  (`.reviews/docs__specs__auth.md.json`) gets exercised by hand. Pick something you can afford to
  have an agent rewrite, and note which file, because Cleanup needs the name.

---

## Part A — the Phase 4 gate and the 2026-11 features

Run `docs/plans/04-acceptance-run.md` end to end, then the feature checks below. If Part A is not
green, stop: everything after it tests packaging, and packaging a product whose loop is unverified
just produces a verified archive of an unverified product.

**Plan 04's four open boxes** (`docs/plans/04-acceptance-run.md`):

- [ ] **B3a** — replace the entire contents of `review-run.md` with at least two located comments;
      every comment orphans and the rewrite banner appears.
- [ ] **B3b** — **Review the diff** opens the snapshot against the current file.
- [ ] **B3c** — **Dismiss**, then edit the document again; the banner does not come back for a
      document already dismissed.
- [ ] Plan 04's `autoDetectResolution = false` box (the last open `[ ]` in that file): leave two
      comments with the setting off, edit the file, and confirm nothing flips to `addressed`.

**Plan 04 loops that need a real agent and a real dialog:**

- [ ] **Blind real-agent run.** Paste a copied prompt at an agent that has not read any plan or
      this runsheet, in the packaged build. At least one comment flips to `addressed` with a
      before/after that is the agent's own edit.
- [ ] **B4 re-link.** Rename a reviewed file on disk, open the pane, click **Locate file…**, pick
      the renamed file in the dialog, and confirm the comments migrate and the old sidecar is left
      empty rather than deleted.

**New in this release:**

- [ ] **Q1, ambiguous quotes.** In a document where one sentence appears twice, comment on one
      occurrence and copy the prompt. The item reads `On: "…" (under "## Heading", line N)`. A
      quote that appears once has no such suffix.
- [ ] **N3, prompt numbers.** After copying a prompt, each card shows `#<item number>` matching its
      position in the prompt. Add a comment afterwards: it has no number until the next copy.
- [ ] **V2, status bar.** With a Markdown file active in a reviewed workspace, the status bar reads
      for example `3 open · 2 to confirm`, and clicking it opens the review pane.
- [ ] **V3, activation where reviews exist.** Open a folder that already holds
      `.reviews/*.json`, run no command, and the status bar item and Explorer badges show with no
      pane open. Open a folder with no `.reviews/` and confirm the extension is absent from
      *Developer: Show Running Extensions*.
- [ ] **U1, reload with the pane open.** Open the pane, run *Developer: Reload Window*, and confirm
      the pane comes back with its comments. **If this check fails, stop and add row `V3b` to the
      plan's tracker** (owner call) before going on.
- [ ] **CV2, change marks.** Copy a prompt, let an agent edit two blocks, and confirm a bar appears
      in the margin beside each changed block and no other.
- [ ] **CV3, Show changes.** The header reads `Show changes (N)` with N matching the marked blocks;
      clicking it opens the side-by-side diff against the copied version. With no edits it reads
      `No changes since prompt`. On a document too large to mark inline the button still opens the
      diff and its tooltip says why there are no marks.

---

## Part B — the packaged build

Run C1 → C5 in order; each leaves the state the next needs. About twenty minutes.

The C1–C5 records below are from the 2026-08 D24 archive. They are history, not a pass for the
rebuilt 0.1.0 archive (two `activationEvents`, change marks, indicators): re-run each check on
that archive and tick its box here.

- [ ] **C1 re-run** on the rebuilt 0.1.0 archive.
- [ ] **C2 re-run** on the rebuilt 0.1.0 archive.
- [ ] **C3 re-run** on the rebuilt 0.1.0 archive; the manifest has exactly two `activationEvents`
      entries (`onWebviewPanel:markdownReview.panel`, `workspaceContains:.reviews/*.json`).
- [ ] **C4 re-run** on the rebuilt 0.1.0 archive.
- [ ] **C5 re-run** on the rebuilt 0.1.0 archive.

### C1 — install and identity — §12 items 3, 4

- [x] **C1** — **re-run and passed 2026-08-06**, in a real Extensions list among competing entries.
      Data half on the shipped bytes: `displayName` "Markdown Review Pane" (was "Markdown Review" until §13 E10), `publisher` `SabhahithWorks`,
      the one-line description, and a 128×128 RGBA `media/icon.png`.
      **Two findings, both recorded rather than waved through:**
      **(a) the light-chrome risk does not apply here** — the icon's alpha is only its rounded
      corners, over a solid dark navy square, so it renders identically on dark and light. That is
      mechanical, not a judgement: corner pixels are alpha 0, the centre is opaque `#f3f4f6`.
      **(b) At 16 px it reads as one bubble plus an orange accent, not two bubbles.** The white
      bubble keeps its tail and both text lines; the orange one flattens to a solid square and loses
      its tail. Accepted — the silhouette is distinctive and the navy/white/orange signature is
      identifiable at list size — but the expectation below overstates what survives.
      **The publisher line moved out of this box** to the publish-day checks: "Sabhahith Works" is a
      property of the Marketplace publisher account, and a locally installed extension can only ever
      show the id.

> Expect: the 128×128 icon renders in the list **at 16 px and still reads as two speech bubbles** —
> this is the size the icon actually gets seen at, and the one a 128 px preview flatters. The title
> is "Markdown Review Pane" (E10) and the description is the manifest's one-liner.
>
> Then switch to a light theme and look at the icon again. The Marketplace renders it on both dark
> and light chrome, and an icon with no background of its own disappears on one of them (Plan 05 §4).
>
> Nothing automated reaches any of this: the icon is a binary asset and its legibility is a judgement.

### C2 — the full loop, on a real document — §12 item 13, PRD §12 item 7

- [x] **C2** — **re-run and passed 2026-08-05** on the D24 build, against a real non-fixture
      document of the tester's own. That discharges the re-run this box was carrying, and covers the
      one gap the earlier pass had: the document was a fixture, not a file from a real project.
      **Earlier pass, previous build:** this is the box
      that exercises the code Plan 06 changed most. Previously passed against
      `docs/fixtures/review-run.md` with the **repo root** as
      the workspace, so `.reviews/docs__fixtures__review-run.md.json` exercised the flattened name by
      hand. A separate non-fixture document was not used; the path shape PRD §12 cares about was.
      Open a Markdown file you are willing to have rewritten, and run the whole loop: *Open Review Pane* → comment on two or three passages →
      *Copy Review Prompt* → paste at an agent → let it edit → confirm one card with **Looks good**.

> Expect: the sidecar lands at `.reviews/<path-with-__>.json` with the flattened name, comments
> survive, at least one flips to `addressed` with a before/after that is genuinely the agent's edit,
> and **Looks good** moves it into the resolved group.
>
> What is being checked here that Plan 04's B1 did not: these are the packaged bytes, the workspace
> is a real one with a real relative path, and `dist/extension.js` came out of an archive rather than
> a build directory.
>
> **If the pane opens blank**, check the webview developer tools for a 404 on `webview.js` before
> anything else — an over-eager `.vscodeignore` line is the one way to reach this step with a
> stripped archive. Plan 05 §13 E1 covers the opposite and far likelier mistake, an archive with
> *too much* in it, but that one fails at `vsce package` on size and never gets this far.

### C3 — lazy activation on a fresh profile — §12 item 14, PRD §9

- [x] **C3** — **re-run and passed 2026-08-06** on the D24 archive, in a `mdcm-fresh` profile
      holding no other extension. Absent at "Eager extensions activated"; still absent after a
      Markdown file opened and pulled in `vscode.markdown-language-features` on `onLanguage:markdown`;
      activated 39 s later with `activationEvent: 'onCommand:markdownReview.open'`. Those 39 seconds
      covered the fresh profile's Welcome page, which answers the walkthrough risk below rather than
      assuming it. The static half re-verified on the shipped bytes: exactly one `activationEvents`
      entry and that one, `main` present, four commands, `engines.vscode` `^1.90.0`.
      **Earlier pass, previous build:** the static half was voided by D24 — it had been taken
      against bytes carrying no `activationEvents` at all — and a walkthrough contribution was new
      in Plan 06, walkthroughs being a documented way to get pulled in early. The behavioural half
      had held: absent from *Show Running Extensions* on a fresh profile with a Markdown folder open
      and no command run, appearing only after *Open Review Pane*. To repeat it:
      `code --profile mdcm-fresh --install-extension`, then `--new-window` on a folder
      containing Markdown, and **without running any command** open
      *Developer: Show Running Extensions*.
      >
      > **Reload the window between installing and looking.** Installing into an already-open
      > profile does not leave you with the cold start this box is about.
      >
      > Do the static half first — it fails faster. Unzip the `.vsix` and check
      > `extension/package.json` has **exactly two `activationEvents` entries,
      > `onWebviewPanel:markdownReview.panel` and `workspaceContains:.reviews/*.json`** (D24 and
      > product-improvements D3 — anything else, or none at all, is a regression), a `main`,
      > four `contributes.commands` and `engines.vscode` ≥ 1.74. That
      > establishes the precondition; only the Running Extensions view establishes the behaviour.
      >
      > **`exthost.log` answers this, and answers it better than the view** — it is the same
      > activation data *Show Running Extensions* renders, plus timestamps and reasons, which is how
      > the 2026-08-06 run could say the extension was still asleep *after* a Markdown file had
      > already woken the built-in language features. Two things must be right; the 2026-08-05
      > attempt got both wrong and concluded it was unautomatable:
      >
      > - Use **`--profile`**, not `--extensions-dir` / `--user-data-dir`. The isolated-directory
      >   instance launched but wrote no extension-host log and did not answer `code --status`. Four
      >   attempts, no evidence.
      > - Read the **running** instance's session directory. All windows share one main process, so a
      >   new-profile window appends a `window<N>/` to the existing
      >   `~/Library/Application Support/Code/logs/<session>/`. A fresh session directory does appear
      >   at launch and it is empty — that is the trap. Identify the right window by what its
      >   `exthost/` lacks: a clean profile has no GitLens or Pylance MCP logs.
      >
      > A human still runs the command at the end. Nothing here removes that.

> Expect: Markdown Review is **not** in the list. Then run *Markdown Review: Open Review Pane* and
> look again — now it is, with an activation reason naming the command.
>
> The manifest declares exactly two `activationEvents` entries and no `onStartupFinished`; VS Code
> infers the rest from `contributes.commands`. The first fires only during an actual panel restore;
> the second only in a workspace that holds `.reviews/*.json`, so the fresh-profile folder for this
> check must not contain one. This is the only check that the inference actually held in a
> packaged build, and a fresh profile is what makes it meaningful — an existing profile may have
> the extension already activated by a restored webview from a previous session.

### C4 — the listing, as VS Code renders it — §12 items 5, 7, 15

- [x] **C4** — **re-run and passed 2026-08-05** on the D24 build, all three tabs including the
      walkthrough's three steps. The re-run this box was carrying is discharged. **Earlier pass:**
      the settings comparison is re-done and found a
      drift (see below); the Changelog tab has a new `[Unreleased]` section above `0.1.0`, and
      Feature Contributions has gained a keybinding and a walkthrough. Click Markdown Review to open
      its detail pane and read all three tabs.

> Expect, on **Details**: the first line is the PRD §1 positioning sentence — *any* markdown file,
> *any* agent. Every image loads; a broken image here is a relative URL that will break identically
> on the Marketplace (PRD §12). The "how detection works" paragraph is present and says plainly that
> `addressed` is inferred and never authoritative.
>
> On **Changelog**: `0.1.0` with a date at the top, and a short summary before the detail rather than
> a reader landing straight in per-phase churn.
>
> On **Feature Contributions**: four commands, and three settings whose descriptions match Plan 05
> §5's README table word for word. Open Settings and search `markdownReview` to compare — the README
> table and the Settings UI drifting apart is a documentation bug that only this comparison catches.
> It caught one on the 2026-08-05 re-run: `markdownReview.author` read "Name attached to your
> comments." in the README against "…Defaults to your system username." in the manifest. §5 says the
> table carries the manifest description *verbatim*, so the README was the side corrected.
>
> **Two sections are new since the first pass** (Plan 06): a **Keybinding** row for
> <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> bound to *Open Review Pane* when the editor
> language is Markdown, and a **Walkthrough** — "Review markdown with any AI agent", three steps.
> The walkthrough also appears in the *Get Started* section of the Welcome page; open it once and
> confirm all three steps render their markdown body, since those three files ship in the `.vsix`
> and a wrong path here shows as an empty step rather than an error.
>
> This tab set is the closest local proxy for the Marketplace listing that exists, which is why it is
> worth doing carefully before publishing rather than after.

### C5 — themes on the installed bytes — §12 item 15

- [x] **C5** — **re-run and passed 2026-08-05** on the D24 build, with the four things Plan 06 added
      seen in a real theme for the first time. **Windows forced-colors remains unverified** — it
      cannot be reached on this platform, and is deliberately not claimed by this tick. **Earlier
      pass:** the precondition is re-verified — the packaged
      `media/webview.css` is byte-identical to the repo's, so nothing was stripped — and the three
      harness presets pass on the new stylesheet. But Plan 06 added a forced-colors block, a
      `position uncertain` badge, an armed-delete state and an empty-state panel, none of which
      existed when this box was last ticked. With the pane open and at least one comment, one
      `addressed` card and one resolved card on screen, switch between Dark+, Light+ and a High
      Contrast theme. **On Windows, also try forced-colors** — that is the one Plan 06 could not
      verify anywhere.

> Expect: cards, popover, highlight, status badges and the header bar all stay legible; nothing
> disappears into its background.
>
> `dev/harness/` renders approximations of these three and `scripts/check-theme-vars.mjs` proves
> every `var(--vscode-*)` used is defined and overridden in all three presets, so this is a
> confirmation against the real palette rather than a first look. What makes it worth repeating here
> is that it is the packaged `media/webview.css` — the CSS is committed rather than built, so a
> `.vscodeignore` that dropped it would show as an unstyled pane rather than an error.

---

## Part C — deferred to publish day

The owner's publish-day steps for 0.1.0 on both registries (D6, D33), run by the owner only.
Recorded here so publish day is a checklist rather than a research session (Plan 05 §10).

- [x] Publisher claimed 2026-08-06 at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
      as **`SabhahithWorks`** — note the capitals, which Plan 05 §2 wrongly said were impossible —
      display name "Sabhahith Works". Irreversible. The manifest was matched to the claim exactly and
      the archive rebuilt, though resolution proved case-insensitive either way.
- [x] `items?itemName=SabhahithWorks.markdown-review-pane` returned 404 before publishing (checked
      2026-08-06, alongside the publisher URL, which 404'd until the claim went through).
- [~] Azure DevOps PAT scoped **Marketplace: Manage**, "all accessible organizations". **Not needed
      for the first release** — the web UI upload at `manage` authenticates with the Microsoft
      account directly. Required only for `vsce publish` from a terminal, so this box belongs to
      0.1.1 rather than 0.1.0.
- [x] Repo pushed and public, so the README's raw image URLs resolve off-GitHub. **Verified
      2026-08-06:** public, all three `docs/media/*.jpg` on `origin/main` — the branch the raw URLs
      name — and Phase 6 plus the release prep are merged, so `main` carries the source the shipped
      bytes came from and `v0.1.0` can be tagged against it.
- [ ] **Open VSX, owner steps** (`vsce` and `ovsx` publishing are run by the owner, never by an agent):
  - [ ] Link an Eclipse account to your open-vsx.org profile, then sign the Publisher Agreement from
        that profile page.
  - [ ] Generate an access token on open-vsx.org and export it as `OVSX_PAT`.
  - [ ] `npx ovsx create-namespace SabhahithWorks -p $OVSX_PAT`
  - [ ] `npx ovsx publish markdown-review-pane-0.1.0.vsix -p $OVSX_PAT`
  - [ ] If the listing shows the namespace as unverified, file the namespace-ownership claim on the
        open-vsx.org namespace page (U2).
  - [ ] The Open VSX listing renders the README and its images.
- [ ] Published; the listing renders as C4 predicted.
- [ ] **The publisher line reads "Sabhahith Works", not the id.** Moved here from C1: the display
      name lives on the Marketplace publisher account, so a locally installed `.vsix` can only show
      `SabhahithWorks` and C1 could never have checked this.
- [ ] Clean machine or profile: install from the Marketplace and run the loop once.
- [ ] `v0.1.0` tagged; issues opened for D22, E7, and B3c — the rewrite banner's **Dismiss** button,
      which step 5's skip leaves with no coverage of any kind.

---

## Cleanup

```sh
code --uninstall-extension SabhahithWorks.markdown-review-pane
code --profile mdcm-fresh --uninstall-extension SabhahithWorks.markdown-review-pane   # C3's profile
```

Then the review C2 created, in your real project. **Name the file — do not `rm -rf .reviews/`**: that
directory also holds reviews of real documents, and throwing it away destroys comments the extension
is specified never to delete.

```sh
rm -f .reviews/<the__flattened__name>.json*    # includes any .bak
git status --short                             # confirm the agent's rewrite is reverted or committed deliberately
```

Reinstall the local build if you want it back:

```sh
~/.mdcm-local-build/reinstall.sh
```

## Recording the outcome

- Plan 05 §12 — tick C1–C5's items and date the section. The Windows box (PRD §12 item 8) is
  **deliberately left unticked with its note**; do not tick it on the strength of §9's substitute
  tests.
- Tick the boxes in **this** document as you go, and leave a one-line note next to anything you
  skipped or could not reach. A skipped box left blank is indistinguishable from one that failed.
- Anything that failed goes in Plan 05 §13 as a new defect, in the same E-numbered form, before it
  gets fixed. A finding recorded only in a commit message is a finding the next release will
  re-derive.
