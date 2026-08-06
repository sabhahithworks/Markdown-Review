# Phase 5 — Ship

**Delivers:** a `.vsix` under 500 KB that installs into stable VS Code and passes the full loop,
plus the listing assets that make it publishable — manifest identity, icon, README, CHANGELOG,
`.vscodeignore` — and two new machine checks that hold the package honest. No feature work: feature
gaps discovered here go back to their owning phase.

Spec references: PRD §9 (manifest), §12 (release checklist), §10 Phase 5, §1 (positioning),
§2/§13 (no telemetry, no network).

> **Scope for 0.1.0: package, not publish.** The phase ends at a verified `.vsix`. Claiming the
> publisher, the Azure DevOps PAT and `vsce publish` are §10's second half — written down in full,
> deliberately outside this phase's definition of done. Everything up to that point can be done
> without Marketplace credentials, which is why it is worth separating.

## 1. Prerequisites

`docs/plans/README.md` makes the previous phase's checklist a hard entry check, and Phase 4's is not
green. **This document may be written now; it may not be executed until these close:**

**Updated 2026-08-05** after the packaged-build run — two of the five closed:

| Open | What it is | Where |
|---|---|---|
| Plan 04 §9 item 2 | The real-agent run — **passed 2026-08-05** (B1d/B1e exercised on the packaged build), but the box stays open for its two standing qualifications: D21's orphan, and a **blind** B1c re-run (the first was verified by an agent that had read the expectation) | `04-acceptance-run.md` B1b–B1e |
| ~~Plan 04 §9 item 9~~ | ~~Clear addressed / clear all~~ — **closed 2026-08-05**, all five boxes | `04-acceptance-run.md` B5a–B5e |
| Plan 04 §9 item 8 | Rename/delete of the target → re-link. **Still not exercised after two runs** — the 2026-08-05 attempt used the re-anchor gesture instead (§10 D22) | `04-acceptance-run.md` B4a–B4c |
| Plan 04 §10 D21 | An anchor stating an absence orphans instead of flipping — a live defect the first real-agent run found | `04-prompt-and-detection.md` §10 |
| Plan 03 §8 / A3 | Six Phase 3 steps: rejection wording, sidecar hand-edit, two windows, CSP, themes, narrow pane | `04-acceptance-run.md` A3 |

The packaged run also produced a new Phase 4 finding, **§10 D22** — the re-link and re-anchor
recovery actions compete for the same attention, and the wrong one is more discoverable. Recorded,
not fixed: it is a UI change in Phase 4's surface, and this phase is explicitly no feature work.

D19 ("the D17 note says *section* for a scope that is a block") was **fixed 2026-08-05** (commit
`2db4759`) — the note now names no scope word; see `04-prompt-and-detection.md` §10 D19 for the
resolution and the test that pins the wording.

## 2. Identity — name, publisher, repository

Two of the three public identifiers are effectively permanent: the extension is addressed as
`publisher.name`, and changing either after the first publish means a new listing with installs,
ratings and URLs stranded on the old one. `displayName` can change whenever you like.

### The three identifiers

| Field | Rules | Where it appears |
|---|---|---|
| `publisher` | **Globally unique.** Letters, digits and hyphens, starting alphanumeric — vsce's `nameRegex` is `/^[a-z0-9][a-z0-9\-]*$/i`, so **no spaces**. Claimed once at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and never renamed | Extension id, listing URL, "More info" panel |
| `name` | **Globally unique across the whole Marketplace** — §13 E9. This table originally said "unique only within the publisher", which is wrong and cost a rejected upload. Lowercase, no spaces | Extension id, listing URL, `code --install-extension <id>` |
| `displayName` | Free text, under ~40 characters so it is not truncated in the Extensions view. Freely changeable | Marketplace title, Extensions view, search results |

### Name — decided, and already applied

**`markdown-review-pane` / "Markdown Review".** The `name` half was `markdown-review` until
2026-08-06, when the Marketplace rejected it as already taken (§13 E9) — `-pane` was appended after
the reasoning below had already been done, and none of that reasoning is disturbed by it: it is all
about `displayName`, which did not change. The four constraints are a display-name test, not a
`name` test, and the only constraint on `name` turns out to be one this section got wrong.

`displayName` carries the discovery weight — Marketplace
search ranks over display name, description and `keywords` — so it has to contain the words someone
would actually type, here *markdown* plus *review* or *comment*. Four constraints, in order:

1. Says what it does to someone who has never heard of it. "Markdown Review" passes; an invented
   word does not.
2. Contains a high-traffic search term, and is not confusable with the several existing *Markdown
   Preview* extensions — the word *preview* is worth avoiding for that reason alone.
3. No other product's trademark, including "VS Code" and "Visual Studio" (Microsoft's Marketplace
   naming rules prohibit implying an official relationship).
4. Survives the PRD §1 positioning sentence sitting directly under it without redundancy.

The alternatives considered were *Review Markdown with AI* and *Comment & Review for Markdown*; both
buy search coverage at the cost of reading like a category rather than a product, and the second also
dates badly. The working name was already the shortest option satisfying all four, so PRD §1's
"working name" becomes the final one. The coverage the longer candidates would have bought is bought
instead through `description` and `keywords`, which rank alongside `displayName` and cost nothing in
the title.

### Publisher and repository — resolved

| Thing | Value |
|---|---|
| Publisher **id** | `SabhahithWorks` |
| Publisher **display name** | `Sabhahith Works` |
| `author` | `Nagaraja Sabhahith` |
| Extension id | `SabhahithWorks.markdown-review-pane` |
| `repository` | `https://github.com/sabhahithworks/Markdown-Review` |
| Raw asset base | `https://raw.githubusercontent.com/sabhahithworks/Markdown-Review/main/` |

**The publisher id is not the publisher name, and conflating them is the most likely mistake in this
phase.** "Sabhahith Works" cannot be an id — ids take letters, digits and hyphens, no spaces. `manage`
takes the id and a separate display name; the display name is what appears on the listing, the id is
what appears in the URL and in `code --install-extension`. `SabhahithWorks` matches the GitHub org
exactly, which is the whole reason to prefer it over `sabhahith-works`.

**Claimed 2026-08-06 as `SabhahithWorks`**, display name "Sabhahith Works". Note the capitals: this
section originally asserted ids are lowercase, which is wrong — vsce's `nameRegex` carries the `i`
flag and the form accepts mixed case. Marketplace resolution is case-insensitive (both spellings of
the publisher URL resolve, and the integration suite's lowercase `getExtension` still finds it), so
the case is cosmetic — but the manifest was set to match the claim exactly rather than rely on that.

Claim it **before** writing it into the manifest, even though publishing is deferred: the form
rejects a taken id immediately, the id is permanent, and unclaimed ids are first-come. **This
ordering was not followed** — the id was in the manifest and in a built archive first, so a taken id
would have meant a rebuild rather than a form retry. It was free; the risk was taken unknowingly.
Then confirm
`https://marketplace.visualstudio.com/items?itemName=SabhahithWorks.markdown-review-pane` returns 404.

**Done 2026-08-05:** remote added and `main` pushed; the repo is public, so §5's absolute image URLs
will resolve as soon as there are any images to resolve.

### The one-commit rule

`publisher`, `author`, `repository` and `icon` added, `private: true` removed — **one commit**, so no
artifact below is ever built against a half-applied manifest.

Note what this is *not*: a gate. `vsce` 3.9.2 does not read `private` at all, and
`validateManifestForPackaging` deliberately allows a missing publisher ("allow users to package an
extension without a publisher for testing reasons", `out/package.js:972`). Packaging works today;
`publish` is where both bite. The one-commit rule is about identity coherence — an id, an author and
a repository URL that disagree with each other across three commits is how a listing ends up
pointing at the wrong source — not about unblocking a tool.

## 3. Manifest completion

Field by field against the current `package.json`:

| Field | Now | After | Why |
|---|---|---|---|
| `private` | `true` | *removed* | An npm-publish guard that has no business on a package published through `vsce`. It does **not** block `vsce` (§2), so removing it is hygiene, not a fix |
| `publisher` | absent | `"SabhahithWorks"` | §2. Optional for `package`, required by `publish` |
| `author` | absent | `"Nagaraja Sabhahith"` | §2. Distinct from the `markdownReview.author` **setting**, which names comment authors — do not conflate them |
| `repository` | absent | `{ "type": "git", "url": "https://github.com/sabhahithworks/Markdown-Review" }` | PRD §9. Without it `vsce` needs `--allow-missing-repository`, and the listing has no source link |
| `icon` | absent | `"media/icon.png"` | §4 |
| `categories` | `["Other"]` | *unchanged* | PRD §9 says `["Other", "Notebooks"]`; that is wrong — see §13 E3 |
| `engines.node` | `">=20"` | *unchanged* | Not read by `vsce`; harmless, and true of the build |
| `scripts.vscode:prepublish` | absent | `"npm run build"` | §13 E2 — without it `vsce package` ships whatever stale bytes happen to be in `dist/` |
| `scripts.package` | absent | `"npx --yes @vscode/vsce package"` | So the packaging command is recorded in the repo rather than in someone's shell history |

Everything else in PRD §9 — the four commands, both menu contributions, all three configuration
properties, `engines.vscode`, `main`, `license`, `keywords`, and the deliberate absence of
`activationEvents` — already matches exactly. Do not touch them.

**Dependency decision:** `@vscode/vsce` stays **out** of `devDependencies`, invoked as `npx --yes`.
The README's freeze governs runtime dependencies and a dev tool is outside it either way, but vsce
pulls a large tree for something run a handful of times per release, and `~/.mdcm-local-build/reinstall.sh`
already invokes it this way. Recorded here because the README requires dependency decisions to be
written into the phase plan rather than inferred from a lockfile diff.

## 4. Icon

A 128×128 PNG at `media/icon.png`, referenced by the manifest `icon` field.

Source of truth is a new `media/icon.svg` authored at 128×128, taking the two-overlapping-speech-bubbles
geometry from the existing `media/icon-dark.svg` / `media/icon-light.svg`. **Those two stay** — they
are the webview panel's tab icon (`src/panel/ReviewPanel.ts:149-151`), a 16 px monochrome pair that
follows the editor theme. This is a different job with different rules.

Constraints:

- **Legible at 16 px.** The Extensions list renders it small; two bubbles at 128 px can carry detail
  that turns to mud at 16. Check at both sizes before committing.
- **It needs its own background.** The Marketplace renders the icon on both dark and light chrome, so
  a transparent PNG with a light stroke vanishes on one of them. A filled rounded square in a fixed
  colour, with the bubbles knocked out of it, works on both.
- **Literal colours are correct here.** `scripts/check-css-colors.mjs` bans hardcoded colour in
  `media/webview.css` only (its `CSS_TARGET` seam names the file). A brand icon must not follow the
  editor theme — it is the same asset on every machine.

Rasterization has no network path. Try in order, and *look at the result* — a silently empty or
wrongly-scaled PNG is the failure mode:

```sh
rsvg-convert -w 128 -h 128 media/icon.svg -o media/icon.png
# or:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --screenshot=media/icon.png --window-size=128,128 --default-background-color=00000000 \
  "file://$PWD/media/icon.svg"
# or:
qlmanage -t -s 128 -o . media/icon.svg
```

The PNG is a shipped asset, so it is committed. Confirm no `.gitignore` rule swallows it before
assuming it is in the tree.

## 5. README.md — the Marketplace listing

The repo root README *is* the listing body. It does not exist yet.

**Line 1 is the PRD §1 positioning sentence.** The PRD says so in as many words: Antigravity and
Claude Code both have artifact commenting, but only for agent-generated artifacts inside their own
product; this works on *any* markdown file — a PRD, an ADR, a README, a design doc — with *any*
agent. That is the differentiator and it is the first thing a reader sees.

Sections, in order:

1. **What it is** — three sentences. Select a passage, leave a comment, hand the file to an agent.
2. **The loop** — the visual from §6 plus four numbered steps: open the review pane → comment on
   passages → *Copy Review Prompt* and paste it at any agent → the agent edits the prose and comments
   flip to `addressed` for you to confirm.
3. **How detection works** — one honest paragraph, and the most important prose on the page.
   `addressed` is *inferred* from the anchored text changing; it is never authoritative, you confirm
   or reopen it, and **the extension never deletes a comment automatically**. Say this plainly. An
   extension that overclaims here loses trust on the first false positive, and false positives are
   inherent to the design, not a bug in it.
4. **Settings** — a table of the three `markdownReview.*` keys with their manifest descriptions
   verbatim, so the README and the Settings UI cannot drift.
5. **Where comments live** — `.reviews/docs__specs__auth.md.json` beside your repo: one JSON file per
   reviewed document, human-readable, versioned, and shareable through git like any other file. The
   `storageLocation: global` alternative for people who would rather not commit them.
6. **Privacy** — no telemetry, no network calls, no analytics, ever (PRD §2/§13). §8's
   `check-bundles.mjs` is what makes that a checkable claim rather than a promise, and it is worth
   one sentence saying so.
7. **Not in v1** — one line from PRD §2: no threads or replies, no real-time collaboration, no MCP
   server, no editing in the preview. Naming the non-goals sets expectations more cheaply than a
   support thread does.
8. **License** — MIT, linking `LICENSE`.

**Every image URL absolute**, against the raw base in §2 — relative paths break on the Marketplace
(PRD §12), because the listing is rendered off-GitHub. The ordering trap: raw URLs only resolve once
the repo is pushed and public, so push first, then open the README and confirm each image loads from
its raw URL in a browser before treating the package as final.

While here, settle the LICENSE copyright line. It currently reads `Copyright (c) 2026 markdown-review
contributors`, which is a placeholder for a project with one author. `Sabhahith Works` (the legal
entity) or `Nagaraja Sabhahith` are both defensible; pick one deliberately rather than shipping the
placeholder, and make it match the manifest `license` field's implication of a real licensor.

## 6. The loop recording

The one listing asset that cannot be written, only captured.

- **Document: `docs/fixtures/review-run.md`.** Deliberately imperfect prose, asserted against by
  nothing, and meant to be rewritten by an agent. **Never `kitchen-sink.md`** — unit tests and
  `dev/harness/fixture.js` both assert its exact bytes.
- **What to show:** open the pane → select a passage and comment → *Copy Review Prompt* → paste at an
  agent → the card flips to `addressed` with a real before/after → **Looks good**. That is the whole
  product in about twenty seconds, and the before/after is the moment worth landing on.
- **How it should look:** a tidy window (1280×800 is enough), Dark+, and the editor zoom raised a
  step or two — the Marketplace renders the listing in roughly a 1000 px column, so text that reads
  fine on your display is unreadable there. Under ~30 s, under ~4 MB.
- **Where:** `docs/media/loop.gif`, in the repo, excluded from the package by §7, referenced by
  absolute raw URL per §5.

**Plan stills as the committed path and the GIF as the upgrade.** Screen recording on macOS is
straightforward (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>5</kbd>), and `ffmpeg` turns out to be
installed, so the GIF path is open whenever someone drives a real pane. A missing GIF must not block
the release; a missing visual should.

**Done 2026-08-05, by a route this section did not anticipate.** The three stills in `docs/media/`
were captured from **`dev/harness/`**, not from a real pane: serve the repo, open `/dev/harness/`,
hide `#mr-harness`, pick a scenario, screenshot. That gets the real `media/webview.js` rendering
markup from the real renderer — the UI is not a mockup — with the fixture's sample comments restaged
in-page (author and two filler bodies rewritten; no file changed, so the harness stays a test tool).
`pane-commenting.jpg`, `pane-addressed.jpg`, `pane-statuses.jpg`.

**What this route cannot give you is VS Code chrome** — no tab bar, no activity bar, no editor
alongside. The pane is the product, so the shots are honest, but a reader cannot see where it sits.
If a real capture is ever made, replace these three; the README references them by name and nothing
else has to change.

## 7. `.vscodeignore`

Does not exist. Creating it is not housekeeping — see §13 E1 for what its absence does.

`vsce` applies its own `defaultIgnore` list (`out/package.js:1217`) on top of this file, which
already covers `.vscodeignore` itself, `package-lock.json`, `.eslintrc*`, `.github`, `**/*.vsix`,
`**/.DS_Store`, `**/.vscode-test/**` and `**/.git/**`. Those lines are repeated below anyway: they
cost nothing, and a reader should not have to know vsce's internals to know what ships. What
`defaultIgnore` conspicuously does **not** cover is `node_modules`, `src/` or anything else in this
repo — which is E1.

```
# What ships. Everything not listed here does, so additions to the repo default to being packaged.
# vsce's own defaultIgnore is small and does not cover node_modules or src — see 05-ship.md §13 E1.
.vscodeignore

# Sources. The bundles in dist/ and media/ are self-contained.
src/**
media/src/**
media/test/**
scripts/**
esbuild.mjs
tsconfig*.json
vitest.config.mts
eslint.config.mjs

# Dev-only trees.
node_modules/**
dist-test/**
dev/**
docs/**
.vscode/**
.vscode-test/**
.github/**
.reviews/**

# Repo-internal documents, not listing copy.
CLAUDE.md
MARKDOWN_REVIEW_PRD.md

# Build and VCS noise.
**/*.ts
**/*.map
package-lock.json
.gitignore
*.vsix
.DS_Store
```

Ten files should ship: `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`,
`dist/extension.js`, `media/webview.js`, `media/webview.css`, `media/icon.png`,
`media/icon-dark.svg`, `media/icon-light.svg`. (`package.json` and `README.md` are force-included by
vsce regardless — `out/package.js:1271` — so the list cannot go below two.)

`node_modules/**` is the load-bearing line. vsce collects production dependencies deliberately, for
extensions that ship unbundled; esbuild has already inlined all six into the two bundles, so here
they would be several megabytes of duplicate. The `dependencies` block exists for the build, not for
the package.

Verify by reading `vsce ls` output (§8), not by reasoning about glob precedence — vsce rewrites
folder-shaped entries by appending `/**` (`out/package.js:1295`), so what you wrote is not quite what
is matched.

## 8. Package size — the 500 KB budget

The budget is not tight, and the plan should say so rather than schedule a trimming exercise nothing
needs. Measured on the current build:

| | |
|---|---|
| `dist/extension.js` | 172 KB |
| `media/webview.js` | 124 KB |
| `media/webview.css` | 18 KB |
| ≈ raw total | 318 KB |
| `~/.mdcm-local-build/markdown-review-local.vsix` (zip) | **121 KB** |

About a quarter of budget, because a `.vsix` is a zip and minified JS compresses well. `esbuild.mjs`
already prints both bundle sizes on every production build.

Audit steps:

1. `npx --yes @vscode/vsce ls` — read the file list against §7's expected ten. Anything unexpected
   gets ignored; anything missing is a bug in `.vscodeignore`. Run it **before** writing
   `.vscodeignore` once, to see E1 for yourself: the list should be enormous.
2. `npx --yes @vscode/vsce package` → record the size in §12.
3. Only if it regresses: trim highlight.js's registered languages first (Plan 02 §5), then check for
   DOMPurify/markdown-it duplication between the bundles.

### `scripts/check-bundles.mjs`

New guard, wired into `npm run build` beside `lint:css`, following the shape of
`check-css-colors.mjs` and `check-theme-vars.mjs` — read the built artifact, assert, exit non-zero
with a specific message, and expose an env-var seam so the guard itself is testable. It asserts:

- **No network APIs in either bundle** — `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `EventSource`, and in the extension bundle `require("http"|"https"|"net"|"tls"|"dns")`.
  **Ban the APIs, not the string `https://`.** DOMPurify carries XML namespace URIs
  (`http://www.w3.org/1999/xhtml`, `.../2000/svg`) and markdown-it carries URL-handling literals, so
  a blanket URL ban is all false positives and would be switched off within a week. This turns PRD
  §2/§13's "no telemetry, no network requests, no analytics. Ever." into the only thing it has never
  had: a test.
- **`dist/extension.js` contains no highlight.js** — the `hljs` class-name literal survives
  minification. Each bundle must tree-shake its own copy; the extension host has no business
  carrying a syntax highlighter.
- **A per-bundle size ceiling** — 220 KB for `dist/extension.js`, 160 KB for `media/webview.js`.
  Roughly 30% headroom over today, so ordinary growth is fine and an accidental dependency is not.
  A regression then fails the build, where someone can see what caused it, rather than surfacing at
  package time weeks later.

## 9. Verification — what a machine can reach, and what cannot

Automated, and additions to existing suites rather than new harnesses:

- `scripts/check-bundles.mjs` (§8) — the no-network and bundle-composition guarantees.
- **Windows-shaped path inputs** in the existing unit suites — see below.

Manual, and scripted in [05-acceptance-run.md](05-acceptance-run.md): installing the built `.vsix`
into **stable VS Code, not the dev host**, running the loop on a real project, the fresh-profile
lazy-activation check, the listing render, and a theme pass on the installed bytes.

### The Windows problem

PRD §12 requires a Windows pass and names path separators in sidecar naming as the likely bug source.
**No Windows machine or VM is available**, so the pass cannot be performed. What replaces it is a
compensating automated pass, and the box stays open.

Enumerate every place a path is constructed, split or compared, and drive each with Windows-shaped
inputs — `docs\specs\auth.md`, a drive letter, a UNC prefix, and a mixed-separator path:

- sidecar naming and the `/` → `__` flattening (Plan 03 §3 owns the contract)
- `.reviews/` directory creation, and the globalStorage fallback's hashed name
- `FileSystemWatcher` glob patterns
- the `targetPath` relative-path computation, including after a re-link

Then state what this cannot reach, because a green suite that implies more than it tested is worse
than an open box: real filesystem case-insensitivity, watcher event timing and coalescing under a
different FS, and clipboard behaviour. Those remain untested on Windows, recorded as §13 E7, and the
§12 box carries a dated note rather than a tick. `04-acceptance-run.md`'s rule applies — a box left
blank is indistinguishable from one that failed.

## 10. Packaging, and the deferred publish

Everything in 0.1.0's scope, in order:

```sh
npm run check                      # typecheck + lint + unit tests
npm run test:integration           # host-side assertions in a real VS Code
npm run build                      # both bundles + the CSS guards + check-bundles.mjs
npx --yes @vscode/vsce ls          # read the list against §7 — empty output is a FAILURE, not "nothing to report"
npx --yes @vscode/vsce package     # → markdown-review-pane-0.1.0.vsix, record the size
code --install-extension markdown-review-pane-0.1.0.vsix --force
```

Then `05-acceptance-run.md`, against those bytes and not the dev host.

### When you are ready to publish — outside this phase's definition of done

- Azure DevOps organization, and a PAT scoped **Marketplace: Manage**, "all accessible
  organizations" (PRD §12). The scope matters: a narrower PAT fails at upload with an unhelpful error.
- Confirm the manifest `publisher` matches the claimed id exactly.
- `npx --yes @vscode/vsce publish 0.1.0`, or upload the `.vsix` through the web UI for the first
  release — it gives a clearer error surface for the things that only fail on the server.
- Post-publish: install from the Marketplace on a clean machine or profile and run the loop once.
  Tag `v0.1.0`. Open issues for anything deferred, D22 and E7 included.

## 11. CHANGELOG

`CHANGELOG.md` is shipped and the Marketplace renders it as its own tab, so it is listing copy, not
just an engineering log.

Promote `[Unreleased]` — currently ~150 lines of Added/Fixed/Changed accumulated since Phase 1 — to
`## [0.1.0] — <date>`, leave an empty `[Unreleased]` above it, and add the link-reference block at
the foot. Prepend two or three sentences saying what 0.1.0 *is*, so a reader landing on the tab meets
the product before they meet the intra-phase churn. Keep the detail below that: it is honest, it is
already written, and a first release that documents its own defect fixes reads better than one that
pretends it arrived clean.

Note the collision this creates with the shared definition of done, which requires every phase to
append an entry under `Unreleased`: this phase's job is to empty that section, so the Phase 5 entry
lands inside `0.1.0` itself. Recorded as §13 E5.

## 12. Acceptance checklist

Each item records *how* it is verified, following Plan 03 §8 and Plan 04 §9. PRD §10 is the only
phase entry with no *Acceptance:* line of its own — PRD §12 stands in, and every one of its eight
items appears below. Date this section when it passes.

**Status 2026-08-05: 13 of 16 ticked, and every box that a machine or this repo can close is
closed.** `05-acceptance-run.md` Part B is 5/5 — the packaged `.vsix` installs into stable VS Code,
runs the full loop, activates lazily, renders its listing and survives all three themes. The three
that remain are not work items in the ordinary sense:

- **The publisher claim** — a human action at a web form, and the one irreversible step here.
- **The Windows pass** — not performable, recorded as §13 E7 with what stays untested.
- **The publish itself** — explicitly outside this phase's definition of done (see the scope note
  at the top).

So the phase has delivered what it set out to: a verified package. It is not *finished*, because
the publisher id is still unclaimed and that gates everything downstream of it.

- [x] `name` / `displayName` decided: `markdown-review` / "Markdown Review" (§2), already applied
- [x] Publisher id `SabhahithWorks` claimed 2026-08-06; `items?itemName=SabhahithWorks.markdown-review-pane` returns
      404 beforehand
      — **manual**, and the only irreversible step in the phase (PRD §12 item 2)
- [x] `publisher`, `author`, `repository`, `icon` applied and `private: true` removed **in one
      commit** — **2026-08-05**, `558bf29`. `git remote add origin` done and **pushed** (`main` ==
      `origin/main`), so the README's absolute image URLs resolve
      — `git show --stat 558bf29`. The `vsce ls` half of this item as originally written was wrong:
      neither `private` nor a missing `publisher` blocks `package` in vsce 3.9.2 (§2, §13 E4)
- [x] 128×128 `media/icon.png` in place, legible at 16 px, readable on dark and light (PRD §12 item 3)
      — **2026-08-05**. `media/icon.svg` rasterized through headless Chrome; inspected at 128 px and
      again downsampled to 16 px, where the two bubbles and the amber accent still separate
- [x] README leads with the PRD §1 positioning sentence and carries all eight §5 sections
      (PRD §12 item 4)
      — **2026-08-05**. **No image URLs to check yet**: it ships with no images rather than with
      broken ones, so the absolute-URL rule is untested until the visual below lands. The settings
      table is checked against the live Settings UI in `05-acceptance-run.md` C4
- [x] A visual of the loop exists — stills at minimum, GIF preferred (§6)
      — **three stills, 2026-08-05**, in `docs/media/`, excluded from the package and referenced by
      absolute raw URL. Captured from `dev/harness/` rather than a real pane, so they are the real
      `media/webview.js` over the real renderer's markup with restaged sample content — **but no VS
      Code chrome**. Good enough to ship; a real capture would be better, see §6
- [x] LICENSE present with a settled copyright line; CHANGELOG promoted to `0.1.0` with a date
      (PRD §12 item 5)
      — **2026-08-05**. Copyright is `Sabhahith Works`; `[Unreleased]` emptied above a dated
      `[0.1.0]` with a summary paragraph and link references
- [x] `.vscodeignore` present; `vsce ls` lists exactly the ten files in §7 — **no `node_modules/`,
      no `src/`, no `dist-test/`** (PRD §12 item 6)
      — **2026-08-05**, read file by file. `media/icon.svg` was an eleventh until excluded: it is the
      raster's source, not a runtime asset. E1 measured at the same time — 1,849 files without the
      file, 10 with it
- [x] `npx vsce package` succeeds and the `.vsix` is under 500 KB (PRD §12 item 7)
      — **2026-08-05: 129.4 KB** (132,480 bytes, 12 entries incl. vsce's two metadata files).
      About a quarter of budget; the `local-dev` build was 121 KB
- [x] `scripts/check-bundles.mjs` green as part of `npm run build`
      — **2026-08-05**. Both bundles clean of every banned API on the first run, and `hljs` appears
      in `media/webview.js` but not `dist/extension.js`. Teeth confirmed against three probe files
      through the `EXTENSION_BUNDLE` / `WEBVIEW_BUNDLE` seams: a `fetch(`, an `hljs`, and an
      oversized file each exit 1. PRD §2/§13's first automated coverage
- [x] Windows-shaped path inputs green across sidecar naming and `targetPath`
      — **2026-08-05**, `sidecarPath.test.ts` (17 tests). Scope corrected from §9 as written:
      `.reviews/` creation and the watcher globs have **no Windows-specific surface to test** —
      both build patterns with `path.dirname`/`path.basename` and a bare filename, which carry no
      separator. See §13 E8 for the drive-letter case, which turns out to be unreachable
- [ ] **The real Windows pass is NOT done** (PRD §12 item 8) — no machine available; §13 E7 records
      what remains untested. Leave this box unticked deliberately, not blank
- [x] Installed `.vsix`: the full loop passes in stable VS Code (PRD §12 item 7)
      — **passed 2026-08-05**, `05-acceptance-run.md` C1–C2. Comments anchored, prompt copied, a
      real agent's edit flipped a card to `addressed` with a true before/after, **Looks good**
      resolved and **Reopen** reverted — all from the packaged archive, not a build directory
- [x] Lazy activation confirmed on a fresh profile: inactive until first command use, no
      `onStartupFinished` (PRD §9)
      — **passed 2026-08-05**, `05-acceptance-run.md` C3. Absent from *Show Running Extensions* on a
      fresh profile with a Markdown folder open; present only after the command ran. The shipped
      manifest inside the `.vsix` was checked separately and carries no `activationEvents` at all,
      so the inference from `contributes.commands` is doing the work PRD §9 says it should
- [x] Listing renders: README and CHANGELOG tabs, settings table matches the real Settings UI;
      theme pass on the installed bytes
      — **passed 2026-08-05**, `05-acceptance-run.md` C4–C5. No images to resolve yet, so that half
      of PRD §12 item 4 is still untested — see the loop-visual box above
- [ ] *Deferred, outside 0.1.0's definition of done:* PAT scoped Marketplace: Manage (PRD §12 item 1);
      published; clean-machine install works; `v0.1.0` tagged (§10)

## 13. Spec corrections applied in this phase

Recorded so later work does not "restore" them, mirroring Plan 01 §9, Plan 03 §9 and Plan 04 §10.

### Release-blocking — these would have shipped broken

**E1 — with no `.vscodeignore`, `vsce` packages the entire repo and its production dependencies.**
The plan originally recorded the opposite defect — that vsce falls back to `.gitignore`, which lists
`media/webview.js`, and would therefore ship a webview with no script. **That is wrong**, and the
correction matters because it inverts the failure mode. Reading vsce 3.9.2's `collectFiles`
(`out/package.js:1269-1298`): when `.vscodeignore` is absent it uses the `files` property from
`package.json` if present, and otherwise an **empty** ignore list — `Promise.resolve('')`. There is
no `.gitignore` path. The only exclusions left are the built-in `defaultIgnore` (`out/package.js:1217`),
a short list aimed at editor and CI dotfiles.

So the real first `vsce package` produces an archive containing `src/`, `docs/`, `dev/`,
`MARKDOWN_REVIEW_PRD.md`, `.reviews/`, `dist-test/suite.js` — **1.4 MB of unminified integration-test
bundle on its own** — and, via `collectAllFiles` → `getDependencies`, every file of all six
production dependencies, highlight.js included. Against a 500 KB budget that is not a near miss.

**Measured, 2026-08-05**, by moving `.vscodeignore` aside and running `vsce ls`: **1,849 files**,
1,740 of them under `node_modules/` and 55 under `src/`, plus both `dist-test/` bundles, the PRD and
`CLAUDE.md`. With the file in place: **10**.
It is release-blocking for the same reason the original wording was: the first package is silently
wrong, and nothing in `npm run check`, `npm run test:integration` or `dev/harness/` looks at an
archive. It simply fails loudly on size rather than quietly on a blank pane, which is the better of
the two.

Two things follow. `.vscodeignore` is a required deliverable, not tidiness (§7), and its
`node_modules/**` line is the load-bearing one. And §12's box asks to *read* the `vsce ls` output
against §7's expected ten files, because a count alone would not distinguish this from success.
`~/.mdcm-local-build/reinstall.sh` never hit it: it copies four artifacts into a staging directory
and writes its own two-line `.vscodeignore` there, which is why the repo has been producing correct
121 KB local builds while carrying this gap.

**E2 — no `vscode:prepublish`, so `vsce package` ships whatever is in `dist/`.** `vsce` runs
`vscode:prepublish` before packaging precisely so the archive cannot contain stale bytes; the
manifest has no such script, and PRD §9 does not mention one. Without it, packaging after a
`--watch` session silently ships **unminified, inline-sourcemapped** bundles — larger, and built from
whatever the last watch iteration happened to compile. Fixed by `"vscode:prepublish": "npm run
build"`, which also drags `lint:css` and `check-bundles.mjs` in front of every package.

### Corrected in this plan, inline above

**E3 — PRD §9's `categories: ["Other", "Notebooks"]` is wrong.** `Notebooks` is the Marketplace
category for notebook renderers, kernels and serializers. This extension has nothing to do with
notebooks; it renders Markdown files in a webview. A wrong category is not free — it puts the
listing in front of people looking for something else, which costs an install-then-uninstall and a
possible one-star review, and category accuracy is something Marketplace review does look at. The
shipped manifest already has `["Other"]` and it stays. Reported rather than silently resolved,
because `docs/plans/README.md` makes the PRD authoritative when a plan and the PRD conflict — this
is the conflict, stated.

**E4 — PRD §9's manifest is a template, and two of its placeholders hide a real distinction.**
`"publisher": "<your-publisher-id>"` and `"url": "https://github.com/<you>/markdown-review"` are
resolved in §2. The trap is that a publisher has *both* an id (`SabhahithWorks`, permanent,
appears in the extension id and URL) and a display name (`Sabhahith Works`, free text, changeable,
appears on the listing). PRD §9 only has a slot for the first, so the second is easy to never decide
and end up with an id where a company name should be — common enough that vsce has a dedicated error
for it: *"Expected the identifier of a publisher, not its human-friendly name"* (`out/validation.js:54`),
which is what `"Sabhahith Works"` in the `publisher` field would produce, on the space. Also resolved
here: the repository's real name is `Markdown-Review`, not `markdown-review`, so the raw asset URLs
in §5 must carry that exact case.

**E5 — the definition of done requires an `Unreleased` entry this phase must delete.**
`docs/plans/README.md` ends every phase with "a short entry appended to `CHANGELOG.md` under
`Unreleased`", and Phase 5's job (§11) is to promote that whole section to `0.1.0`. Resolved by
letting the Phase 5 entry land inside `0.1.0` itself. Not a defect in either document — just the one
place where a rule written for four phases does not fit the fifth.

### Learned from the local-build script, recorded so it is not re-learned

**E6 — `vsce` can collect zero files and still exit 0.** The header comments of
`~/.mdcm-local-build/reinstall.sh` record it: staging under `/private/tmp`, `vsce ls` printed nothing
and exited 0, and `vsce package` then failed with a misleading "entrypoint missing" — sending the
investigation at the manifest `main` field, which was fine. The likely mechanism, from
`collectAllFiles` (`out/package.js:1253`): it computes `path.relative(cwd, ...)` against directories
returned by `getDependencies`, and on macOS `/tmp` is a symlink to `/private/tmp`, so a resolved
dependency root and an unresolved `cwd` produce relative paths that begin `../..` and match nothing.
Offered as a diagnosis, not a certainty — it was not reproduced under a debugger.

Two rules follow regardless. Package from the repo, not from a temp directory. And treat empty
`vsce ls` output as a hard failure, never as "nothing to report" — which is exactly the reading that
wasted that afternoon, and exactly what §12's box guards against.

### Found while executing the phase

**E8 — `sidecarFileName` has an unstated precondition, and the Windows case that would break it
cannot be reached.** Chasing §9's drive-letter and UNC coverage turned up that `path.win32.relative`
returns an *absolute* path when the two arguments are on different drives — `relative('C:\ws',
'D:\other\file.md')` is `'D:\other\file.md'`, not a `..` chain. Fed to `sidecarFileName` that becomes
`D:__other__file.md.json`, and `:` is illegal in a Windows filename, so the sidecar write would fail
with an error pointing nowhere near the cause.

It is not reachable. `resolveSidecar` (`src/store/ReviewStore.ts:543`) only calls `path.relative`
when `vscode.workspace.getWorkspaceFolder(target)` returned a folder, and that API returns one only
when it *contains* the target — so the relative path can never cross a drive, reach a UNC root, or
even begin with `..`. Nothing was changed: adding a guard for an unreachable input is how a codebase
accumulates defensive code nobody can explain later. What was added is a test that states the
precondition and pins the behaviour, so if a future caller ever does pass an absolute path, the test
is what explains the error message.

The same investigation shrank §9's scope honestly. `.reviews/` creation and the `FileSystemWatcher`
globs were listed there as Windows risks; both construct their pattern from `path.dirname` and
`path.basename` with a bare filename, which contains no separator at all. There is nothing
platform-specific left in them to test.

### Noted, not done

**E7 — PRD §12's Windows pass cannot be performed.** No Windows machine or VM is available. §9's
compensating unit tests cover the thing the PRD actually worries about — separator handling in
sidecar naming and path construction — but three things stay untested on Windows: real filesystem
case-insensitivity, `FileSystemWatcher` event timing under a different filesystem, and clipboard
behaviour. The §12 box stays unticked with this note rather than blank, and rather than ticked on the
strength of the substitute. If a Windows machine becomes available before publish, run
`05-acceptance-run.md` Part B on it; if it does not, this is a known and stated risk of 0.1.0, and
the first Windows bug report is expected to be about a path.

**E9 — extension `name` is globally unique, not per-publisher, and §2 says the opposite.** §2's table
states `name` is *"unique **only within the publisher**, so `markdown-review` being taken elsewhere
does not block us."* That is wrong, and it was load-bearing: it is the sentence that made
`markdown-review` look safe to bake into the manifest, the built archive, the integration suite and
every acceptance record. The Marketplace rejected the upload on 2026-08-06 —

> The extension 'markdown-review' already exists in the Marketplace. Please use a different 'name' in
> the package.json file

— because `JinqiShen.markdown-review` was published on 2026-03-13 under the display name "Markdown
Reader with Copilot". **Renamed to `markdown-review-pane`**, extension id
`SabhahithWorks.markdown-review-pane`. `displayName` "Markdown Review" is unaffected: display names
carry no uniqueness constraint, and §2 is right that they carry the search weight.

Cost: nothing, because it was caught before the first publish. After one, the same fix would have
stranded the listing, its installs and its URL. This is the second identifier this phase assumed and
had corrected by the Marketplace — see §2 on the publisher capitals — and the pattern is worth
naming: **the manifest's public identifiers cannot be verified from inside this repo.** Both were
asserted in a planning document, propagated into built artifacts, and only tested against the
authority at upload time.

**Do not try to pre-check a name from here.** It was attempted and produced a confidently wrong
answer: the gallery's text search (`filterType: 10`) matches display name and description, not the
`name` field, so a query for "markdown-review" returned twenty extensions and missed the exact
collision sitting in front of it. `items?itemName=<publisher>.<name>` is no better — a name reserved
by an unpublished or removed extension returns 404 exactly like a free one. The upload form is the
only authority. Pick a distinctive name, expect a possible bounce, and keep a second choice ready.
