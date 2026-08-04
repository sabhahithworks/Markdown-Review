# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A VS Code extension (working name `markdown-review`) that renders any Markdown file in a review pane where the user selects passages and leaves comments — Google Docs-style commenting for local `.md` files. The user copies a generated prompt into any AI agent, the agent edits the file as plain prose, and the extension detects which comments were addressed by watching the file change.

**The core design principle:** the agent is never asked to write structured data or follow a schema — it only edits prose. All bookkeeping (anchoring, status tracking, sidecar storage) is the extension's job. This is what makes it agent-agnostic.

`MARKDOWN_REVIEW_PRD.md` is the authoritative spec. Read it before implementing anything. The rest of this file is orientation, not a substitute.

## Current state

**Phases 1–3 are complete and green.** Anchoring core (`src/anchor/`, `src/render/`), the read-only preview pane (`src/panel/`, `media/`), and commenting (`src/store/`, `media/src/{anchorSpace,selection,comments}.ts`) are implemented and tested — `npm run check` = typecheck (three tsconfig projects) + lint + 341 vitest tests. Phase 4 (prompt generation + change detection) is next.

Per-phase execution plans live under `docs/plans/` — start at `docs/plans/README.md` (phase map, shared conventions, contract-ownership table), then execute the plan for the current phase. Run the previous phase's acceptance checklist before starting a new phase.

Commands: `npm run check` (the one command the definition-of-done maps to), `npm test`, `npm run test:watch`, `npm run typecheck`, `npm run lint`, `npm run build` (also runs the hardcoded-colour check). `PERF=0 npm test` skips the 5 MB performance suite. Tests are split into two vitest projects — `--project node` for `src/test/`, `--project webview` for the jsdom suites in `media/test/`.

Two release-blocking PRD defects were found and fixed during Phase 1 — see `docs/plans/01-anchoring-core.md` §9 for the full list, and read it before touching `src/anchor/fuzzy.ts`. Phase 3 corrected its own plan the same way; read `docs/plans/03-commenting.md` §9 before touching anchor-space plumbing.

**The load-bearing invariant added in Phase 3:** `walkSpans` in `src/render/plaintext.ts` is called by *both* `renderPlainText` and `renderer.ts`'s core rule, which is what makes the `data-ap-start` / `data-ap-end` offsets on rendered blocks agree with anchor space by construction. The webview reads those attributes and never re-derives block boundaries. Do not give the webview its own opinion about where blocks begin — that was the design Phase 3 removed, and `media/test/anchorSpace.test.ts` exists to keep it removed.

## Build order (PRD §10 — binding)

Phases must be completed in order; each has acceptance criteria that must pass before starting the next:

1. **Anchoring core** — `src/anchor/` + `src/render/plaintext.ts`, pure logic, zero VS Code imports, full test suite (PRD §5) green via `npm test`
2. **Read-only preview** — webview panel, rendering, CSP, theming, `data-line` attributes
3. **Commenting** — selection → anchor → card, sidecar persistence, reload survival
4. **Prompt + detection** — copy prompt, baseline snapshot, file watcher, re-anchor, status inference
5. **Ship** — packaging via `npx @vscode/vsce package` (< 500 KB)

Phase 1 is the load-bearing piece. Build and test it completely before touching any VS Code API.

## Tech stack (PRD §3 — do not deviate without flagging)

- TypeScript with `strict: true`
- esbuild, two entry points (extension host + webview; webview JS ships separately in `media/`)
- `markdown-it` (its `token.map` provides the source-line ranges anchoring depends on)
- `dompurify` for sanitizing rendered HTML
- `diff-match-patch` (`match_main`) for fuzzy anchor relocation
- Webview UI is vanilla TS + CSS — **no framework**
- Tests: `vitest` for units, `@vscode/test-electron` for integration
- No new dependencies beyond these without asking first

## Architecture

Planned layout under `src/`: `extension.ts` (activation, commands), `panel/` (webview lifecycle + typed message contract), `render/` (markdown-it setup, rendered-DOM → normalized plain text + offset map), `anchor/` (create/locate/reanchor — the critical module), `store/ReviewStore.ts` (sidecar persistence, single source of truth even with two panels open), `prompt/buildPrompt.ts`.

Key architectural facts that span multiple modules:

- **Anchors live in rendered-plain-text space, not markdown source.** The user selects rendered text (`**bold**` reads as `bold`), so both anchor creation and relocation operate on the normalized plain text produced by `render/plaintext.ts` (whitespace collapsed per block, blocks joined by `\n`, with an offset → source-line index from `token.map`). Fenced code content is preserved verbatim, not normalized.
- **Locate is a confidence cascade** (PRD §5): exact+context (1.0) → exact nearest to hint (0.9/0.7) → fuzzy near hint (0.5) → fuzzy whole-document (0.3) → null. Confidence < 0.5 must be shown as "position uncertain".
- **Comment statuses:** `open` / `addressed` (inferred, never authoritative) / `orphaned` (needs human triage) / `resolved` (user-confirmed, terminal, never auto-changed). The extension must **never delete a comment automatically**.
- **Sidecar storage:** `.reviews/<relative-path-with-/-replaced-by-__>.json` per reviewed file (e.g. `docs/specs/auth.md` → `.reviews/docs__specs__auth.md.json`), human-readable, versioned (`version: 1`). Corrupt sidecars fail soft: back up to `.json.bak`, start empty, tell the user.
- **Change detection:** `onDidChangeTextDocument` (debounced 400 ms) plus a `FileSystemWatcher`, because agents may write to disk without the file being open in an editor. `baselineText` is snapshotted at the moment the review prompt is copied — that is the diff baseline for `addressed` inference.

## Hard constraints

- **No telemetry, no network calls, no analytics. Ever.**
- Webview security is non-negotiable (PRD §6): strict CSP with per-load nonce, `localResourceRoots` limited to `media/` + the target file's directory, DOMPurify on all rendered content, external links via `vscode.env.openExternal`, no `eval`.
- Theming uses VS Code CSS variables exclusively — hardcoded colors are a bug. Verify against Dark+, Light+, and high-contrast.
- Don't set `retainContextWhenHidden` unless profiling proves it necessary; implement `WebviewPanelSerializer` for reload survival instead.
- Activation must be lazy — inferred from `contributes.commands`; no `onStartupFinished`, no explicit `activationEvents`.
- PRD §2 lists explicit v1 non-goals (threads, MCP server, real-time collab, editing in preview, etc.) — ask before adding any of them.
- When a PRD design decision turns out to be wrong during implementation, stop and say so rather than silently working around it.
- Performance target: `reanchor` of 50 comments on a 5 MB document under 500 ms.
- Watch Windows path separators in sidecar file naming — flagged in the PRD as a likely bug source.
