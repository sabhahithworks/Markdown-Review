# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The review prompt now says where a quoted passage is when it appears more than once, for example
  `On: "the token" (under "## Refresh", line 42)`. Quotes that appear once are unchanged.
- Each card from the last copied prompt shows its item number, for example `#3`, so a reply that
  mentions item 3 maps to a card.
- A status bar item shows the active Markdown file's review counts, for example
  `3 open · 2 to confirm`, and opens the review pane when clicked. Reviewed files get an Explorer
  badge with the number of comments needing action. Both show as soon as a workspace that holds
  reviews is opened, with no pane open.
- After you copy a prompt, blocks the agent changed are marked with a bar in the margin, and the
  header shows `Show changes (4)`, which opens the side-by-side diff against the copied version.
  When nothing changed it reads `No changes since prompt`. For a document too large to mark
  inline, the button still opens the diff and its tooltip says why there are no marks.

### Changed

- Copying a prompt for a document too large to snapshot now clears the earlier baseline. Before,
  the rewrite diff kept comparing against an older prompt.

## [0.1.0] — 2026-08-06

First release.

Markdown Review renders any Markdown file in a pane where you select passages and leave comments, the
way you would in Google Docs. When you are done, it writes a prompt you paste into whatever AI agent
you already use. The agent edits ordinary prose — it is never asked to follow a schema, write
structured data, or know this extension exists — and the pane works out for itself which of your
comments were addressed, showing you the before and after so you can accept or reopen each one.

Comments live in readable JSON in `.reviews/` beside the file, so they survive edits, rename, and a
window reload, and they can be committed and shared. Nothing is deleted automatically. There is no
telemetry and no network access of any kind.

Below is the full history of how it was built, including the defects found and fixed along the way.

It closes with a full audit of the codebase and the hardening that called for — which changes not
what the extension is for, but how much of it you can reach, how little it can lose, and how honestly
it reports itself.

### Added

- **The pane is usable without a mouse, and audible to a screen reader.** Comment cards announce
  their author and status, take Enter and Space, and mark the active one with `aria-current`.
  Creating, deleting, resolving, reopening and filtering are spoken through a live region. Notices —
  a rewritten document, a file that cannot be read — announce themselves and put focus on the way
  out. Below 700 px, where the inline markers are the only way to open a card, those markers were
  focusable buttons inside an `aria-hidden` container: reachable by Tab, invisible to assistive
  tech. They now live outside it.
- **"Position uncertain" says so.** PRD §5 requires a low-confidence relocation to be surfaced in
  those words; it had only ever been a one-pixel dashed underline on a layer screen readers cannot
  see. The card now carries the phrase.
- **A first run shows you what to do.** With no comments yet, the header hides itself — so the pane
  was a rendered document with no interface at all and nothing saying that selecting text does
  anything. There is now a dismissable hint, a three-step walkthrough, and a
  <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> binding. The ~330 px reserved for the comment
  margin is no longer reserved on a document with no comments in it.
- **High-contrast and reduced-motion support.** Windows forced-colors mode strips `background-color`
  outright, which was the only thing distinguishing an anchor highlight from ordinary text;
  highlights, cards and markers now carry real borders there. Every decorative transition is
  dropped for `prefers-reduced-motion`.
- **Renaming a reviewed file keeps its comments.** The review used to be recoverable only through
  **Locate file…** on an already-open pane, so a rename with no pane open stranded it silently.
- Deleting a single comment now takes a second click. It was the one destructive action with no
  confirmation and no undo, while the bulk clears have had both all along.
- **Clear all** is in the header, where **Clear addressed** already was. The status filter applies
  to the orphan section, which ignored it entirely, and a filter that hides everything now says so
  and offers a way back. The card editor has a visible Save and Cancel, and no longer saves on blur.

### Fixed

- **Reloading the window left the review pane permanently blank.** The tab came back, the contents
  never did, and the only way out was to close the pane and open it again. The extension wakes up
  when you run one of its commands — but restoring a pane after a reload isn't something you run, so
  nothing woke it, and the pane it was supposed to refill sat there empty. It now also wakes for a
  panel restore, and only for that. Opening a window that has no review pane in it still loads
  nothing. The comments were never at risk; they were on disk the whole time.
- **A hidden review pane could stay blank after being shown again.** Messages to the pane are held
  back while it is hidden, and nothing reopened that gate except the pane reloading itself from
  scratch. Found while chasing the reload bug above and fixed separately.
- **A comment could be positioned hundreds of pixels from its own highlight.** Cards were rendered
  in document order but *laid out* in the order they were created, and the stacking pass assumes
  the two agree. Commenting on a late paragraph and then an early one pushed the early card below
  the later one. Every harness scenario happened to declare its comments in document order, which
  is exactly why this survived three phases.
- **Re-linking a review could destroy it.** Two ways: merging into a file that already had a
  comment with the same id wrote a sidecar the extension's own validator rejects — quarantined on
  the next load — and the success check could report a write that had actually failed, after which
  the source was emptied. Both are gone.
- **A comment could be lost between typing it and saving it.** The sidecar watcher could fire
  mid-write, read the pre-write bytes, and adopt them over the state about to be persisted. Writes
  are now serialized and the watcher stands off while one is in flight. Two windows open on one
  workspace also shared a temp filename during that write.
- **A remote image in a reviewed file made a real network request.** PRD §6 specified `img-src …
  https:` verbatim, and PRD §2/§13 promise no network calls, ever. A document containing
  `![](https://…/pixel.png)` phoned home with your IP the moment the pane rendered — content you
  are reviewing deciding to make a request. Remote images now render as their alt text with the URL
  on hover, and the directive is gone. The PRD is amended rather than worked around.
- **An answered comment no longer reads as a lost one.** A comment anchored to text that *states an
  absence* — "the ordering has not been written down" — can only be addressed by deleting that
  text, so answering it correctly made the comment orphan: the one status meaning "come and check
  this by hand", spent on the outcome you wanted. The orphan row now carries the same weaker signal
  the cards use.
- Before/after text no longer ends mid-word. The verified span stopped short by however much the
  text had grown, so an addressed card could read `…so they do no`, which looks like corruption
  rather than a shortened quote.
- On macOS and Windows, opening the same file under two spellings of its path produced two panes
  and two stores writing one review file.
- Opening the rewrite diff once made every later keystroke in that file re-render the whole
  document, for the rest of the session. Scrolling a long document no longer forces a layout pass
  per frame.
- The rewrite banner has a **Dismiss**; it previously stayed until the next render. The
  file-unreadable notice now clears the document it is talking about, instead of leaving stale
  content underneath a message saying the file is gone.
- Changing `markdownReview.storageLocation`, or adding a workspace folder, now takes effect. Both
  used to leave already-open reviews writing to the previous location while new ones went to the
  new one. `markdownReview.author` is read per-folder in a multi-root workspace, as the other two
  settings already were.
- Reviews no longer accumulate a file watcher each for the life of the window.

## [0.1.0] — 2026-08-05

First release. Comment on any Markdown file in a review pane, copy a prompt, hand it to whichever AI
agent you already use, and let the extension work out which comments were addressed by watching the
file change. The agent is only ever asked to edit prose — every piece of bookkeeping stays here,
which is what makes it work with any agent and no integration.

Everything below is the detail of how that got built, including the defects found and fixed on the
way. `addressed` is inferred and never authoritative; nothing is deleted automatically.

### Added

- **The review loop, host side (Phase 4a).** Copy a prompt, let any agent edit the prose, and the
  extension works out which comments were addressed. Nothing is visible in the pane yet — the
  header bar, before/after cards, orphan section and rewrite banner are Phase 4b.
  - `markdownReview.copyPrompt` builds the PRD §7 prompt from the open comments, copies it, and
    snapshots the rendered text as the diff baseline. The format is asserted byte-for-byte against
    the PRD's own worked example, in a unit test and again on the real clipboard in the integration
    suite. Comments are re-anchored first, so a sentence the agent already deleted is never quoted
    back at it.
  - Change detection (PRD §8): `onDidChangeTextDocument` and a `FileSystemWatcher` on the target
    feed one 400 ms coalescer, so an editor edit, a direct write to disk, and a save that is both
    all cost exactly one pass. Statuses flip to `addressed` (with before/after) or `orphaned` on
    their own, and `markdownReview.autoDetectResolution: false` suppresses the inference without
    suppressing orphaning.
  - `markdownReview.clearAddressed` and `markdownReview.clearAll`, each behind a modal naming the
    count. Both write a `.json.bak` first and abandon the whole operation if that backup cannot be
    written — a destructive user action is only defensible while it stays recoverable.
  - Re-linking a review onto a different file (PRD §11), for a target that was renamed or deleted.
    Comments move to the new file's sidecar before the old one is emptied, so a failure leaves them
    somewhere rather than nowhere. The old sidecar is emptied, never deleted.
  - A read-only `markdown-review:` diff behind the rewrite banner, with **both sides rendered as
    plain text**. Plan 04 §6 had it comparing the stored baseline against the Markdown source, which
    would have made every line differ — the baseline is plain text and the file is not.
  - `baselineText` is capped at 256 KB. PRD §4 puts the whole snapshot in the sidecar, which on a
    2 MB document means a multi-megabyte JSON file rewritten on every save and committed to git.
    Over the cap the baseline is skipped and only the rewrite diff is unavailable.
- **The review pane's status UI (Phase 4b).** Everything Phase 4a inferred is now visible and
  actionable.
  - A sticky header bar with per-status counts that double as filter chips, a primary **Copy review
    prompt** button (disabled at zero open comments) and **Clear addressed**. The active filter
    persists through `getState`/`setState`, so a window reload keeps the view you were working in.
  - Addressed cards show the before/after the extension inferred, with **Looks good** and
    **Reopen**. `addressed` is a suggestion the user confirms (PRD §8), and without the evidence on
    the card "Looks good" would be asking for trust in an inference nobody can see.
  - Orphaned comments moved out of the gutter into a section of their own (PRD §6), each quoting the
    text it was attached to, with **Delete** and **Re-anchor**. Re-anchoring arms the pane; the next
    selection re-attaches the comment, keeping its id, body, author and creation time.
  - A banner when a single pass orphans every located comment, offering a diff of the review
    baseline against the document now.
  - "Locate file…" on the unreadable-file notice, for a target that was renamed or deleted.
- Verification harnesses, closing out the Phase 3 acceptance checklist. Two of its ten items were
  machine-checked before; eight are now. Neither harness ships in the `.vsix` and neither is in
  `npm run check` — one launches VS Code, the other needs a browser.
  - `src/test/integration/` — an `@vscode/test-electron` suite (18 assertions) against a real
    extension host: sidecar placement and flattening, add/edit/resolve/delete round-trips, corrupt
    and future-version quarantine, the globalStorage fallback, external hand-edits (adopted when
    valid, ignored when mid-keystroke, not echoed when ours), shutdown flushing, lazy activation,
    one pane per file, and a deleted target mid-review. `npm run test:integration`. Pulled forward
    from Plan 04 §8, which extends it rather than starting over.
  - `dev/harness/` — a page running the real webview bundle over markup from the real renderer, in
    a real layout engine, with three theme presets and in-page geometry checks. Card stacking, the
    < 700 px collapse and highlight alignment had no coverage at all before this: jsdom reports
    every rectangle as zero.
  - `scripts/check-theme-vars.mjs`, wired into `npm run lint:css` — every `--vscode-*` the pane uses
    must exist and every colour must be overridden in all three presets. An unresolved `var()`
    renders as nothing, silently.
  - The rejection wording for over- and under-length selections moved to `src/panel/notices.ts`, so
    the strings Plan 03 §4 specifies are asserted by a test rather than read off a notification.

### Fixed

- **A comment on a heading can now tell you the agent did something.** Anchored to a section
  heading, the natural way to say "this section needs work", it could never be inferred `addressed`:
  the agent rewrites the prose below, the heading is untouched, and `addressed` means *the text you
  selected* changed. The comment stayed `open` forever and the pane looked identical to one where
  the agent had never run. Found by the first real-agent acceptance run, on its first use.

  The cause is not headings. `anchor.exact` does two jobs — the passage you pointed at, and the
  evidence your comment was acted on — and those coincide only when the fix lands inside your
  selection. They come apart for any anchor that *labels* the thing to fix: a heading, a list's
  intro line, a sentence followed by "add a caveat after this".

  Rather than widen `addressed`, which would trade the one status you are asked to trust for a
  guess, an `open` comment whose *region* differs from the review baseline now carries a note —
  "The text around this changed since you copied the prompt" — and a **Looks good**. The region is the
  enclosing section for a heading anchor and the covered blocks otherwise. It is not a status, it is
  recomputed per render and never stored, so there is no sidecar change; it is suppressed with no
  baseline, for comments written after one was taken, and by `autoDetectResolution: false`.
- **A comment on a code block no longer reports itself `addressed` on a document nobody edited.**
  Anchor creation collapsed whitespace in every selection, but anchor space keeps fenced and
  indented code *verbatim* — so a multi-line code anchor could never match exactly. It fell to a
  fuzzy match whose span stopped a few characters short of the block, and that shortfall was read as
  an edit. The card then showed a before/after that looks identical, because apart from the clipped
  tail it is. A false `addressed` is the most expensive bug this design can have: the status is the
  one thing you are asked to trust, and its value is that it is narrow.

  The webview had this right all along — it sends code verbatim — and the host's "defensive
  re-normalize" was throwing that away on arrival. Anchor creation now picks its rule from the block
  the selection starts in. Anchors already written the old way still work: `locate` gained a tier for
  a code block that matches once whitespace is ignored, which also covers sidecars edited by hand,
  since PRD §11 invites that and nobody retypes a fence's indentation.

  It survived Phase 1's test matrix because the required "anchor inside a fenced code block" case
  used a *single line* of code, which has no newline to flatten and passes either way.
- The review prompt now says `On the section "## …"` for an anchor covering *part* of a heading,
  where it previously fell back to `On: "…"` and quoted the fragment. Selecting a heading without
  its manual numbering or list marker is the ordinary gesture, and the old rule — exact span
  equality — meant `buildPrompt` and the change detector disagreed about what a heading anchor
  means. They now share one `scopeOf`, which is also what the section signal above measures.
- Orphaned comments no longer stack on top of each other. Cards are absolutely positioned from their
  anchor's rectangle, and an orphan has no rectangle — so every one of them was skipped before the
  stacking pass ran, never got a `top`, and they all landed at the same point. They now live in a
  section in normal flow, where the problem cannot occur. Placement is decided by *position* rather
  than status, because the two legitimately disagree: an externally hand-edited sidecar reaches the
  pane saying `open` with an anchor that cannot be found.
- Anchor highlights no longer land on the wrong line. The header and orphan sections sit above the
  content, so showing either one moves every block below it — and they were being updated *after*
  the highlights had been measured. Long paragraphs absorbed the offset; short blocks did not.
- The rewrite banner is no longer rendered below the entire document. Its container was the last
  element in the pane, which suited the two states that clear the document first but not this one.
- The review pane no longer files a spurious error into its output channel every time it is dragged
  past the 700 px breakpoint. `reposition()` mutates layout, so calling it directly from the
  `ResizeObserver` callback produced "ResizeObserver loop completed with undelivered notifications",
  which `webview.ts` dutifully forwarded to the host. It now runs on the next animation frame, which
  also coalesces a drag's notifications into one rebuild.
- The resolved-comments group no longer hangs off the right edge of a narrow pane. In narrow mode
  `#gutter` stops being a containing block, so the group's `position: absolute; width: 100%`
  resolved against the page instead.

- Phase 3 — commenting: select rendered text, leave a comment, and have it persist. Selections are
  captured in anchor space (`media/src/anchorSpace.ts`), turned into durable anchors host-side, and
  stored in a human-readable, hand-editable sidecar at `.reviews/<flattened-path>.json`
  (`src/store/`). Comments render as gutter cards aligned to their anchors, with the anchored span
  highlighted, edit / delete / resolve, a collapsed group for resolved comments, and a collapse to
  inline markers below 700 px. Every comment created in this phase is `open`; status inference and
  prompts arrive with Phase 4.
  - Block elements now carry `data-ap-start` / `data-ap-end`, their exact offsets into the
    normalized plain text. Both the HTML and the plain text are produced by one shared token walk
    (`walkSpans`), so the DOM and anchor space cannot disagree about where a block begins — see the
    `docs/plans/03-commenting.md` §9 note below.
  - `nanoid` (v3, for CommonJS) is the comment-id source, as specified by PRD §4. `jsdom` is added
    as a devDependency for the new webview test project; nothing extra ships in the `.vsix`.
- Phase 2 — read-only review pane: extension manifest and a two-bundle esbuild pipeline,
  `markdownReview.open` opening a themed, CSP-locked webview beside the editor, `data-line`
  injection and front-matter rendering (`src/render/renderer.ts`), the extension⇄webview message
  contract (`src/panel/messages.ts`), webview-side sanitization and syntax highlighting, a 2 MB
  size guard, and reload survival via `WebviewPanelSerializer`. The other three commands are
  declared with honest placeholders until commenting ships.
  - `highlight.js` is added as a runtime dependency: mandated by PRD §6 but absent from the PRD §3
    table, so it is recorded as an approved exception alongside `markdown-it-task-lists`. Measured
    at 70.6 KB of the 102.9 KB `media/webview.js` (34.4 KB gzipped); the whole gzipped payload is
    ≈ 88 KB against Phase 5's 500 KB budget.
- Phase 1 — anchoring core: repo toolchain (TypeScript, vitest, ESLint), plain-text rendering with
  a source-line offset map (`src/render/`), and anchor create / locate / reanchor (`src/anchor/`).
  Pure logic, no VS Code dependency. `docs/fixtures/kitchen-sink.md` is shared with Phase 2's
  manual verification passes.

### Changed

- `docs/plans/03-commenting.md` §9 records the corrections Phase 3 applied to its own plan. The
  release-blocking one: the webview no longer rebuilds anchor space by walking the DOM. That design
  would have diverged from the host on image alt text, table-cell joining and fenced code — the
  plan itself named it the design's biggest silent-corruption risk — so offsets are now computed
  once, host-side, and stamped onto the rendered elements. `locate()` is correspondingly *not*
  bundled into the webview, keeping `diff-match-patch` out of that payload.
- `docs/plans/02-preview-pane.md` §10 records the corrections Phase 2 applied to its own plan. The
  release-blocking one: a fenced block's `data-line` must be `token.map[0] + 1`, matching the first
  content line `plaintext.ts` anchors its `BlockSpan` to — as originally specified it pointed at the
  ``` ``` ``` marker, desyncing the DOM from anchor space on every code block. Also a missing scheme
  allowlist on `openExternal`, which was arbitrary command execution from file content.
- `MARKDOWN_REVIEW_PRD.md` §5 amended for two release-blocking defects found during
  implementation: the tier-4 fuzzy search's `Match_Distance` (as specified it could only see the
  first ~300 characters of any document) and the `addressed` comparison basis, which now reads
  `anchor.exact` rather than the unlocatable `baselineText`. `docs/plans/01-anchoring-core.md` §9
  lists these and the smaller corrections fixed inline.

[Unreleased]: https://github.com/sabhahithworks/Markdown-Review/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sabhahithworks/Markdown-Review/releases/tag/v0.1.0
