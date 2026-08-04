# Implementation Plans — Markdown Review

Index and shared conventions for the phase plans. Each phase plan is self-contained enough to be
executed in a fresh session with only three inputs: `MARKDOWN_REVIEW_PRD.md`, this file, and the
phase plan itself. The PRD is the authoritative spec; plans add the engineering detail the PRD
deliberately leaves out. If a plan and the PRD conflict, the PRD wins — and the conflict must be
reported, not silently resolved.

## Phase map

| # | Plan | Delivers | Depends on |
|---|------|----------|------------|
| 1 | [01-anchoring-core.md](01-anchoring-core.md) | Toolchain scaffold + pure anchoring/plaintext modules, fully tested | nothing |
| 2 | [02-preview-pane.md](02-preview-pane.md) | Extension scaffold, webview panel, secure read-only rendering | Phase 1 |
| 3 | [03-commenting.md](03-commenting.md) | Selection→comment UI, sidecar persistence, reload survival | Phase 2 |
| 4 | [04-prompt-and-detection.md](04-prompt-and-detection.md) | Prompt generation, change watching, re-anchoring, status UI | Phase 3 |
| 5 | [05-ship.md](05-ship.md) | Packaging, docs, Marketplace release | Phase 4 |

**Entry check for every phase:** run the previous phase's acceptance checklist (last section of each
plan) before writing any code. If it doesn't pass, stop and fix that first — do not layer new work
on a broken foundation.

## Contract ownership — the no-duplication rule

Every cross-cutting contract is specified in exactly one place. Other plans link to it and never
restate it. When a contract must change, edit its owning document and list the change in the
consuming phase's plan as a delta.

| Contract | Owner |
|---|---|
| Data model (`Anchor`, `Comment`, `ReviewFile`, status semantics) | PRD §4 (types transcribed once into `src/anchor/types.ts`) |
| Plain-text normalization spec + offset map | Plan 01 §3 |
| Anchor create/locate/reanchor APIs and confidence tiers | Plan 01 §4–6 |
| markdown-it configuration + `data-line` injection | Plan 02 §4 |
| Webview security (CSP, resource roots, sanitization) | PRD §6, operationalized in Plan 02 §6 |
| Extension ⇄ webview message contract | Plan 02 §5 (base), extended by deltas in Plans 03 §6 and 04 §6 |
| Sidecar storage, naming, corruption handling | Plan 03 §3 |
| Prompt format | PRD §7, operationalized in Plan 04 §3 |
| Status lifecycle wiring (who flips what, when) | Plan 04 §5 |
| Toolchain (tsconfig, ESLint, vitest, scripts) | Plan 01 §2 |

## Shared engineering conventions

These apply to every phase and are not repeated in the phase plans.

- **TypeScript `strict: true`**, no `any` except at validated I/O boundaries (sidecar JSON parse,
  webview messages), where input is narrowed by a type guard before use.
- **Dependencies are frozen** to the PRD §3 list plus `nanoid` (mandated by PRD §4) and
  `markdown-it-task-lists` (mandated by PRD §6 task-list rendering). Anything else requires asking
  the user first — record the approval in the phase plan before adding it. This governs *runtime*
  dependencies (what ships in the `.vsix`); the dev toolchain listed in Plan 01 §2 — ESLint and its
  TypeScript plugin, approved for Phase 1 — is not shipped and is not part of the freeze.
- **Errors are values at module boundaries.** Pure modules (`anchor/`, `render/`, `prompt/`) return
  discriminated unions (`{ ok: true, ... } | { ok: false, reason: ... }`) and never throw for
  expected failures. Only the extension layer converts failures into `vscode.window` messages.
- **User-facing failure principle** (from PRD §11): fail soft, keep the user's data, say what
  happened. Never delete or silently rewrite a comment or sidecar.
- **Naming:** files match their primary export; webview-side code lives under `media/` and never
  imports from `src/` except the shared `panel/messages.ts` types (type-only imports are safe —
  they vanish at compile time).
- **Testing:** every pure module gets vitest coverage in the same phase it's written. VS Code
  integration behavior gets an `@vscode/test-electron` smoke test by the end of Phase 4. A phase is
  not done while `npm test` is red.
- **Definition of done for a phase:** acceptance checklist green, `npm run check` (typecheck + lint
  + test) and `npm run build` clean, no new TypeScript or ESLint suppressions, and a short entry
  appended to `CHANGELOG.md` under `Unreleased`. ESLint is set up in Phase 1 (Plan 01 §2).
- **Flag-don't-workaround:** if implementing reveals a wrong decision in the PRD or a plan, stop
  and surface it (PRD §13).
