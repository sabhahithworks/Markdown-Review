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
| 6 | [06-production-hardening.md](06-production-hardening.md) | Audit-driven hardening: correctness, a11y/UX wave, robustness; ends at publish day | Phase 5 |
| 7 | [product-improvements-2026-11-13.md](product-improvements-2026-11-13.md) | Release polish: quote context, card numbers, indicators, change view, release | Phase 6 |
| 8 | [release-expansion-2026-11-18.md](release-expansion-2026-11-18.md) | Mermaid, alerts, footnotes, send, whole-document comments, agent notes, CI, release | Phase 7 |

**Entry check for every phase:** run the previous phase's acceptance checklist (last section of each
plan) before writing any code. If it doesn't pass, stop and fix that first — do not layer new work
on a broken foundation.

## Verification harnesses

Two harnesses exist so those checklists are mostly machine-checked rather than eyeballed. Both were
built during the Phase 3 → Phase 4 gate pass; **extend them, do not rebuild them.**

| | What it is | Run with |
|---|---|---|
| `src/test/integration/` | `@vscode/test-electron`: real extension host, real `workspace.fs`, real watchers. Pulled forward from Plan 04 §8, which extends it with the change-detection scenario. | `npm run test:integration` |
| `dev/harness/` | A browser page running the real `media/webview.js` over markup from the real renderer, with three theme presets and in-page geometry checks. The only place card layout meets a layout engine — jsdom reports every rectangle as zero. | `node dev/harness/generate.mjs`, then serve the repo and open `/dev/harness/` |

Neither is in `npm run check`: the first launches a VS Code window (and downloads one on first
use), the second needs a browser. `npm run check` stays the fast inner loop.

What remains genuinely manual is written down rather than remembered — see
[03-acceptance-run.md](03-acceptance-run.md) and [04-acceptance-run.md](04-acceptance-run.md) for
the current lists, and keep them to things a machine cannot reach (CSP enforcement, window reload,
real theme palettes, cross-window sync, modal confirms, and above all a *real* agent editing a real
document). The Phase 4 run subsumes the Phase 3 one, which is still that phase's entry gate.
[05-acceptance-run.md](05-acceptance-run.md) adds the one thing none of them touch: the installed
`.vsix` in stable VS Code, rather than the working tree in a dev host.

[manual-run.md](manual-run.md) is those three flattened into one linear runsheet — every open box
that is left, in the order to do it, grouped by which VS Code each needs. It is the **running order,
not the record**: outcomes are still ticked into the phase docs above, and where the two disagree
the phase doc wins, because it carries the reasoning.

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
| Packaging, manifest identity, listing assets | Plan 05 §2–§8 |

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
