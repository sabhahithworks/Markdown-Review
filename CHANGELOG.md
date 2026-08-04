# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Phase 1 — anchoring core: repo toolchain (TypeScript, vitest, ESLint), plain-text rendering with
  a source-line offset map (`src/render/`), and anchor create / locate / reanchor (`src/anchor/`).
  Pure logic, no VS Code dependency. `docs/fixtures/kitchen-sink.md` is shared with Phase 2's
  manual verification passes.

### Changed

- `MARKDOWN_REVIEW_PRD.md` §5 amended for two release-blocking defects found during
  implementation: the tier-4 fuzzy search's `Match_Distance` (as specified it could only see the
  first ~300 characters of any document) and the `addressed` comparison basis, which now reads
  `anchor.exact` rather than the unlocatable `baselineText`. `docs/plans/01-anchoring-core.md` §9
  lists these and the smaller corrections fixed inline.
