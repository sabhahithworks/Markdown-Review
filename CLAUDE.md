# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A VS Code extension (working name `markdown-review`) that renders any Markdown file in a review pane where the user selects passages and leaves comments — Google Docs-style commenting for local `.md` files. The user copies a generated prompt into any AI agent, the agent edits the file as plain prose, and the extension detects which comments were addressed by watching the file change.

**The core design principle:** the agent is never asked to write structured data or follow a schema — it only edits prose. All bookkeeping (anchoring, status tracking, sidecar storage) is the extension's job. This is what makes it agent-agnostic.

`MARKDOWN_REVIEW_PRD.md` is the authoritative spec. Read it before implementing anything. The rest of this file is orientation, not a substitute.

## Current state

**Phases 1–4 are built.** Anchoring core (`src/anchor/`, `src/render/`), the read-only preview pane (`src/panel/`, `media/`), commenting (`src/store/`, `media/src/{anchorSpace,selection,comments}.ts`) and the review loop (`src/prompt/`, `src/detect/`, `src/commands/`) are implemented and tested — `npm run check` = typecheck (three tsconfig projects) + lint + the vitest suites, plus the host-side assertions in `npm run test:integration`.

**Phase 5 (ship) is executed; Phase 6 (production hardening) has landed its code.** A verified `markdown-review-pane-0.1.0.vsix` exists (~139 KB against the 500 KB budget). `docs/plans/06-production-hardening.md` is the current plan and the ledger for the 2026-08-05 full-codebase audit — H0–H37, all fixed or explicitly accepted in its §4. That closed D21 and D22 from Plan 04's ledger.

**What is still open is manual and cannot be automated:** `docs/plans/05-acceptance-run.md` Part A — the Phase 4 acceptance remainder, including a blind real-agent run and the B4 re-link flow that has never once been exercised — and then the publisher claim, which is the single irreversible step. Phase 5 was scoped *package, not publish*; the Marketplace publish is written down and still outside a definition of done.

Per-phase execution plans live under `docs/plans/` — start at `docs/plans/README.md` (phase map, shared conventions, contract-ownership table, verification harnesses), then execute the plan for the current phase. Run the previous phase's acceptance checklist before starting a new phase. The 2026-08-05 full-codebase audit recorded its findings (H-numbers) and their fixes in `docs/plans/06-production-hardening.md`, which is the current phase.

Commands are in `package.json`; the ones with non-obvious behaviour: `npm run check` is what the definition-of-done maps to, `npm run build` also runs the CSS colour + theme-variable checks and the bundle guard, and `PERF=0 npm test` skips the 5 MB performance suite. Tests are split into two vitest projects — `--project node` for `src/test/`, `--project webview` for the jsdom suites in `media/test/`.

**Two verification harnesses sit outside `npm run check`**, because one launches VS Code and the other needs a browser. Extend them; don't rebuild them.

- `npm run test:integration` — `@vscode/test-electron` against a real extension host (`src/test/integration/`). This is where store I/O, activation, command argument handling and panel lifecycle are actually verified; the vitest suites cannot import `vscode`. Plan 04 §8's change-detection scenario lives here.
- `dev/harness/` — the real webview bundle in a real layout engine, over markup from the real renderer, with three theme presets. `node dev/harness/generate.mjs`, then serve the repo root and open `/dev/harness/`. Card geometry has no other coverage: jsdom reports every rectangle as zero, which is why `media/test/comments.test.ts` can only test the pure `stackTops`. Both of the bugs found after Phase 3 merged were here, and so was H1.

  **The harness page carries its own copy of the webview shell** (`dev/harness/index.html`), which must stay in step with `ReviewPanel.getHtmlForWebview`. `webview.ts` calls `requireElement` per id and throws on the first one missing, so a stale shell does not degrade — the bundle never boots and every scenario reports "ALL PASS" while testing nothing. Plan 06 H33; the `no uncaught errors` check is what makes a drift loud.

Two release-blocking PRD defects were found and fixed during Phase 1 — see `docs/plans/01-anchoring-core.md` §9 for the full list, and read it before touching `src/anchor/fuzzy.ts`. Phase 3 corrected its own plan the same way; read `docs/plans/03-commenting.md` §9 before touching anchor-space plumbing. Phase 4's `docs/plans/04-prompt-and-detection.md` §10 is the longest of these lists (D1–D22) and is required reading before touching the prompt, the baseline snapshot or status inference; D21 and D22 are recorded as not yet fixed (D19 was fixed 2026-08-05).

**The load-bearing invariant added in Phase 3:** `walkSpans` in `src/render/plaintext.ts` is called by *both* `renderPlainText` and `renderer.ts`'s core rule, which is what makes the `data-ap-start` / `data-ap-end` offsets on rendered blocks agree with anchor space by construction. The webview reads those attributes and never re-derives block boundaries. Do not give the webview its own opinion about where blocks begin — that was the design Phase 3 removed, and `media/test/anchorSpace.test.ts` exists to keep it removed.

## Build order (PRD §10 — binding)

Phases must be completed in order; each has acceptance criteria that must pass before starting the next. PRD §10 lists them, `docs/plans/README.md` maps them to plans.

## Tech stack (PRD §3 — do not deviate without flagging)

The versions are in `package.json`; what it can't tell you is why each one is there:

- `markdown-it` — its `token.map` provides the source-line ranges anchoring depends on
- `diff-match-patch` — `match_main` specifically, for fuzzy anchor relocation
- `dompurify` sanitizes all rendered HTML
- Webview UI is vanilla TS + CSS — **no framework**
- No new dependencies beyond these without asking first

## Architecture

`src/anchor/` is the critical module (create/locate/reanchor); `src/store/ReviewStore.ts` is the single source of truth for a review even with two panels open. Key architectural facts that span multiple modules:

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
- Activation must be lazy — inferred from `contributes.commands`, and no `onStartupFinished`. Exactly two explicit `activationEvents` entries are permitted and required: `onWebviewPanel:markdownReview.panel` and `workspaceContains:.reviews/*.json`. Inference covers commands, which is every entry point the *user* initiates; a panel restore after a window reload is initiated by VS Code, and without the first event the extension never wakes to revive a pane (Plan 04 §10 D24). The second wakes it only in a workspace that already holds reviews, so the status bar item and Explorer badges show without a pane open (product-improvements D3). It stays lazy — the first fires only when a panel of that view type is actually being restored, the second only where `.reviews/*.json` exists. No `onStartupFinished`, no language event. Do not add others.
- PRD §2 lists explicit v1 non-goals (threads, MCP server, real-time collab, editing in preview, etc.) — ask before adding any of them.
- When a PRD design decision turns out to be wrong during implementation, stop and say so rather than silently working around it.
- Performance target: `reanchor` of 50 comments on a 5 MB document under 500 ms.
- Watch Windows path separators in sidecar file naming — flagged in the PRD as a likely bug source.
