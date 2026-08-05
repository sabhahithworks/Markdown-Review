# Phase 5 — Ship

**Delivers:** a publishable `.vsix` under 500 KB, Marketplace-ready listing assets, and a verified
release. No feature work in this phase — feature gaps discovered here go back to their owning
phase.

Spec references: PRD §9 (manifest), §12 (release checklist), §10 Phase 5, §1 (positioning).

## 1. Prerequisites

Phase 4 acceptance checklist (Plan 04 §9) passes, including the manual real-agent run.

## 2. Name & identity (do first — it gates everything else)

It gates everything else because two of the three identifiers are effectively permanent: the
extension is addressed as `publisher.name`, and changing either after the first publish means a new
listing, with installs, ratings and URLs left behind on the old one. `displayName` can change
whenever you like.

Starting point: `package.json` today has **no `publisher` and `private: true`**, which is why
`vsce` refuses to package the repo as-is. `~/.mdcm-local-build/reinstall.sh` fabricates
`local-dev` for local installs — a placeholder, and not a candidate.

### The three identifiers

| Field | Rules | Where it appears |
| --- | --- | --- |
| `publisher` | **Globally unique.** Lowercase letters, digits, hyphens. Claimed once at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage) and never renamed | Extension id, listing URL, "More info" panel |
| `name` | Unique **only within the publisher**, so `markdown-review` being taken elsewhere does not block us. Lowercase, no spaces | Extension id, listing URL, `code --install-extension <id>` |
| `displayName` | Free text, aim for under ~40 characters so it is not truncated in the Extensions view. Freely changeable | Marketplace title, Extensions view, search results |

### How to check availability

- **Publisher** — the only hard collision. Try to claim it in the Marketplace management portal; the
  form rejects a taken id immediately. Do this before writing the id anywhere else.
- **Extension id** — `https://marketplace.visualstudio.com/items?itemName=<publisher>.<name>` returns
  404 if free. Only meaningful once the publisher is settled.
- **Display name** — not enforced, so this is a judgement call rather than a check. Search the
  Marketplace for the candidate and for "markdown comment" / "markdown review". If something in the
  first page of results has a near-identical title, pick differently: the cost is being mistaken for
  another extension in a list of twenty, not a rejected upload.

### Choosing

`name` should match the repo directory so the two cannot drift; keeping `markdown-review` is the
cheap and correct default unless the display name moves far away from it.

`displayName` carries the discovery weight — Marketplace search ranks over display name, description
and `keywords` — so it should contain the words someone would actually type. For this extension that
is *markdown*, plus *review* or *comment*. Constraints worth applying, in order:

1. Says what it does to someone who has never heard of it. "Markdown Review" passes; an invented
   word does not.
2. Contains at least one high-traffic search term, and is not confusable with the several existing
   *Markdown Preview* extensions — the word *preview* is worth avoiding for that reason alone.
3. No other product's trademark, including "VS Code" and "Visual Studio" (Microsoft's Marketplace
   naming rules prohibit implying an official relationship).
4. Survives the PRD §1 positioning sentence sitting directly under it without redundancy.

**Decided: `markdown-review` / "Markdown Review".** The alternatives considered were *Review
Markdown with AI* and *Comment & Review for Markdown*; both buy search coverage at the cost of
reading like a category rather than a product, and the second also dates badly. The working name was
already the shortest option that satisfies all four constraints, so PRD §1's "working name" becomes
the final one.

Both fields already hold these values, so there is nothing to rename. The discovery coverage the
longer candidates would have bought is bought instead through `description` and `keywords`, which
are ranked alongside `displayName` and cost nothing in the title.

### Still outstanding

The publisher id, which is the only globally-unique identifier and the only one that has to be
claimed. Apply it together with removing `private: true` — **one commit**, so no artifact below is
ever built against a half-applied manifest. Until then `vsce` cannot package the repo, and local
installs go on using the `local-dev` placeholder.

Icon: 128×128 PNG at `media/icon.png`, legible at 16 px, works on dark and light Marketplace
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
- The publisher was claimed in §2; confirm the `publisher` field matches it exactly.
- `npx @vscode/vsce publish 0.1.0` (or upload the `.vsix` via the web UI for the first release —
  it gives a clearer error surface).
- Post-publish: install from the Marketplace on a clean machine/profile, run the loop once. Tag
  `v0.1.0` in git; open issues for anything deferred.

## 7. Acceptance checklist

- [x] `name` / `displayName` decided: `markdown-review` / "Markdown Review" (§2), already applied
- [ ] Publisher id claimed; `items?itemName=<publisher>.markdown-review` returns 404; `publisher`
      applied and `private: true` removed, in one commit
- [ ] `npx @vscode/vsce package` succeeds; `.vsix` < 500 KB; `vsce ls` output reviewed
- [ ] README leads with the positioning line; GIF plays; all image URLs absolute
- [ ] LICENSE + CHANGELOG(0.1.0) + 128×128 icon in place
- [ ] Local `.vsix` install: full loop passes in stable VS Code
- [ ] Windows verification pass complete
- [ ] Lazy-activation and no-network greps verified on the shipped bundles
- [ ] Published; clean-machine install from the Marketplace works; `v0.1.0` tagged
