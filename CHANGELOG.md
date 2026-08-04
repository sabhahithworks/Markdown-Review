# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
