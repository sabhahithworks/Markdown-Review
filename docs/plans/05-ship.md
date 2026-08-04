# Phase 5 — Ship

**Delivers:** a publishable `.vsix` under 500 KB, Marketplace-ready listing assets, and a verified
release. No feature work in this phase — feature gaps discovered here go back to their owning
phase.

Spec references: PRD §9 (manifest), §12 (release checklist), §10 Phase 5, §1 (positioning).

## 1. Prerequisites

Phase 4 acceptance checklist (Plan 04 §9) passes, including the manual real-agent run.

## 2. Name & identity (do first — it gates everything else)

- PRD §1: `markdown-review` is a working name. Check Marketplace availability; pick the final
  `name`/`displayName` and a publisher id, update `package.json`, README, and this repo's
  references in one commit. Every artifact below uses the final name.
- Icon: 128×128 PNG at `media/icon.png`, legible at 16 px, works on dark and light Marketplace
  backgrounds. Referenced from the manifest `icon` field.

## 3. Listing assets

- **README.md** (repo root = Marketplace listing):
  - First line is the PRD §1 positioning sentence: works on *any* markdown file with *any* agent —
    that's the differentiator, lead with it.
  - Animated GIF of the full loop (open pane → comment → copy prompt → agent edits → status flips
    → confirm). Record in the Extension Development Host at a tidy window size; keep under ~4 MB.
  - **All image URLs absolute** (raw.githubusercontent.com) — relative paths break on the
    Marketplace (PRD §12). The GIF lives in the repo but is excluded from the package (§4).
  - Sections: what it is (3 sentences), the loop (GIF + 4 numbered steps), how detection works
    (one honest paragraph: `addressed` is inferred, you confirm), settings table, sidecar format
    note (where comments live, that they're git-shareable), non-goals/roadmap line, license.
- **CHANGELOG.md**: promote the `Unreleased` entries accumulated since Phase 1 to `0.1.0` with a
  date.
- **LICENSE**: MIT, matching the manifest `license` field.

## 4. Package size — the 500 KB budget

`.vscodeignore` excluding: `src/`, `media/src/`, `docs/`, `node_modules/` (esbuild output is
self-contained), tests, fixtures, `.vscode/`, `.vscode-test/`, config files, the README GIF
(referenced by absolute URL, not shipped).

Audit steps:

1. `npx @vscode/vsce ls` — review the exact file list; anything unexpected gets ignored.
2. `npx @vscode/vsce package` → record the size. The known heavy item is `media/webview.js`
   (highlight.js subset, Plan 02 §5). If over budget, trim registered languages first, then check
   DOMPurify/markdown-it duplication between the two bundles (each bundle must tree-shake its own
   copy; the extension bundle should not contain highlight.js at all).
3. Both bundles built minified, without sourcemaps, `NODE_ENV=production`.

## 5. Pre-publish verification

- Install the built `.vsix` locally (`code --install-extension`) in **stable VS Code, not the dev
  host**, and run the full loop once end-to-end on a real project (PRD §12).
- **Windows pass** (PRD §12 calls this the likely bug source): on a Windows machine or VM —
  sidecar naming with backslash-relative paths, `.reviews` creation, watcher events on save,
  clipboard, reload survival. The Plan 03 §3 unit test covers the naming logic; this pass covers
  the real filesystem.
- Fresh-profile activation check: extension activates only on first command use (lazy activation,
  PRD §9), not on startup — verify with the Running Extensions view + startup profile.
- Grep the shipped bundles for `http://`, `https://` fetches: the only network-shaped strings
  permitted are `openExternal` passthroughs of user-document links. No telemetry, no update
  checks, nothing (PRD §2/§13).

## 6. Publish

- Azure DevOps org + PAT scoped **Marketplace: Manage**, all accessible organizations (PRD §12).
- Create the publisher; `publisher` field must match exactly.
- `npx @vscode/vsce publish 0.1.0` (or upload the `.vsix` via the web UI for the first release —
  it gives a clearer error surface).
- Post-publish: install from the Marketplace on a clean machine/profile, run the loop once. Tag
  `v0.1.0` in git; open issues for anything deferred.

## 7. Acceptance checklist

- [ ] Final name/publisher applied everywhere; Marketplace name confirmed available
- [ ] `npx @vscode/vsce package` succeeds; `.vsix` < 500 KB; `vsce ls` output reviewed
- [ ] README leads with the positioning line; GIF plays; all image URLs absolute
- [ ] LICENSE + CHANGELOG(0.1.0) + 128×128 icon in place
- [ ] Local `.vsix` install: full loop passes in stable VS Code
- [ ] Windows verification pass complete
- [ ] Lazy-activation and no-network greps verified on the shipped bundles
- [ ] Published; clean-machine install from the Marketplace works; `v0.1.0` tagged
