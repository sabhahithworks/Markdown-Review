# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
