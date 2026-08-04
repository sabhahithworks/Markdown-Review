# Phase 2 — Read-Only Preview Pane

**Delivers:** a working VS Code extension that opens any markdown file in a themed, secure,
read-only review pane with `data-line` attributes ready for anchoring. No commenting yet.

Spec references: PRD §3 (architecture, tech), §6 (webview requirements), §9 (manifest), §11
(large-file failure mode), §10 Phase 2.

## 1. Prerequisites

Phase 1 acceptance checklist (Plan 01 §8) passes. In particular `src/render/markdownIt.ts` exists —
this phase consumes that factory, it does not create its own markdown-it setup.

## 2. Extension scaffold

- Fill `package.json` manifest fields from PRD §9 **as written there** (commands, menus,
  configuration, engines `^1.90.0`, `main: ./dist/extension.js`). Register only
  `markdownReview.open`'s implementation now; declare the other commands but have them show
  "available after review comments exist" info messages until Phases 3–4 implement them — a
  declared-but-dead command is a worse UX than an honest placeholder.
- No `activationEvents` array (PRD §9 note — activation is inferred and must stay lazy).
- Dev deps added: `esbuild`, `@types/vscode` (matching 1.90), `@vscode/test-electron` (used from
  Phase 4, installed now so the harness exists). Runtime deps added: `dompurify`, `highlight.js`.

### Build pipeline (esbuild, two entry points)

`esbuild.mjs` script producing:

| Entry | Output | Platform | Notes |
|---|---|---|---|
| `src/extension.ts` | `dist/extension.js` | `node`, `external: ['vscode']`, cjs | |
| `media/src/webview.ts` | `media/webview.js` | `browser`, iife | bundles DOMPurify + highlight.js subset |

- Scripts: `build` (both, minified, no sourcemaps), `watch` (both, sourcemaps), `test` unchanged.
- `.vscode/launch.json` + `tasks.json` for F5 debugging with the watch task.
- Webview sources live in `media/src/` (TypeScript), compiled output `media/webview.js` +
  hand-written `media/webview.css`. Webview code may import **types only** from
  `src/panel/messages.ts` (per conventions in plans README).

## 3. `src/panel/ReviewPanel.ts`

- `ReviewPanel.createOrShow(context, documentUri)` — **one panel per target file**, keyed by the
  file's URI string in a static map; a second open for the same file reveals the existing panel.
  (Two panels per file is a Phase 3+ store concern — PRD §11 — but the keying decision starts
  here.)
- Panel column: `ViewColumn.Beside`. Title: the file's basename. Panel icon: `$(comment-discussion)`
  equivalent via `iconPath`.
- Lifecycle: dispose cleans the static map and all disposables. Register a
  `WebviewPanelSerializer` **now** with a minimal state `{ targetPath }` so reload survival exists
  from the first release of the panel — Phase 3 extends the state, it does not retrofit the
  serializer.
- Rendering flow per load/refresh:
  1. Read the document text (from the open `TextDocument` if available, else `workspace.fs`).
  2. **Large-file guard** (PRD §11): if > 2 MB, don't render — post a `tooLarge` state that the
     webview shows with the file size and a "render anyway" button (which re-invokes with a
     `force` flag). Choose degrade-over-virtualize for v1; note it in the code.
  3. Render via `renderer.ts` → HTML string; also compute `renderPlainText` (Phase 1) — not used
     yet, but rendering both from the same source string on the same code path is what keeps
     anchor space honest later, so wire it now and assert both succeed.
  4. Post `setContent` to the webview.

## 4. `src/render/renderer.ts` — markdown-it configuration (contract owner)

Single configured instance from the Phase 1 factory `src/render/markdownIt.ts`:

- `html: false`, `linkify: true`, `typographer: false` (PRD §6).
- Default preset gives GFM tables + strikethrough; add `markdown-it-task-lists` for task lists.
- **`data-line` injection**: a core ruler rule that walks tokens; every block-level *open* token
  (and self-closing blocks like `fence`, `hr`) with a non-null `token.map` gets
  `data-line="<map[0] + frontMatterLineOffset>"`. The offset keeps webview line hints consistent
  with the on-disk file when front matter was stripped (Plan 01 §3 rule 1).
- **Front matter**: stripped before rendering (same helper Phase 1 uses — one implementation in
  `src/render/frontMatter.ts`), then rendered as a collapsed `<details class="front-matter">`
  block above the content, excluded from anchor plain text by construction.
- **Fences**: renderer emits `<pre><code class="language-x">` with content HTML-escaped, no
  highlighting in the host. Highlighting happens webview-side (see §5) so the host stays free of
  DOM-shaped concerns and the CSP story stays simple.

## 5. Webview runtime (`media/src/webview.ts`) + message contract (contract owner)

`src/panel/messages.ts` — discriminated unions, the **base contract** (Phases 3–4 extend with new
members; they list only their deltas):

```ts
// extension -> webview
type HostMessage =
  | { type: 'setContent'; html: string; frontMatterHtml?: string }
  | { type: 'tooLarge'; sizeBytes: number };
// webview -> extension
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openExternal'; url: string }
  | { type: 'renderAnyway' };
```

Webview behavior:

- On `setContent`: sanitize with DOMPurify —
  `{ USE_PROFILES: { html: true }, FORBID_TAGS: ['style'], ADD_ATTR: ['data-line'] }` — then
  inject, then run highlight.js. **Sanitize-then-inject is non-negotiable** (PRD §6); the host
  sends rendered HTML, the webview treats it as untrusted anyway (defense in depth).
- highlight.js: import `highlight.js/lib/core` and explicitly register a curated common set
  (js/ts, json, bash/shell, python, html/xml, css, yaml, markdown, diff, sql, go, rust). This is
  the "lazy-load" spirit within a no-network CSP: unknown languages fall back to plain `<code>`.
  Record the measured contribution to `media/webview.js` size — Phase 5 has a 500 KB package
  budget and this bundle is the main risk to it.
- All link clicks intercepted: `preventDefault()`, post `openExternal`; the host calls
  `vscode.env.openExternal`. Anchor-fragment links (`#heading`) scroll within the webview instead.
- Scroll position preserved across `setContent` via `vscode.getState()/setState` (keyed by nearest
  visible `data-line`, not pixel offset, so it survives re-renders that change layout).

## 6. Security implementation (operationalizes PRD §6)

- CSP meta tag exactly as PRD §6 specifies, nonce regenerated per `getHtmlForWebview` call
  (32 hex chars from `crypto.randomBytes`).
- `localResourceRoots`: `[extensionUri/media, dirname(targetFile)]` — the second entry exists for
  relative images in the markdown.
- Relative image `src` attributes rewritten host-side to `webview.asWebviewUri(...)` URIs before
  sending (a markdown-it render rule, applying only to non-absolute paths inside the target file's
  directory tree; anything escaping the tree is left broken rather than granted access).
- Verification step: open the webview devtools, confirm **zero** CSP violation reports while
  exercising a fixture doc containing images, links, code, and raw `<script>`/`<img onerror>`
  attempts (which must render inert).

## 7. Theming

- `media/webview.css` uses only `var(--vscode-*)` colors (the set listed in PRD §6). A grep for
  `#[0-9a-fA-F]{3,8}` or `rgb(` in the CSS must return nothing (add this as a lint step in
  `npm run build`).
- Layout constants (spacing, radii, max content width ~72ch) are plain values; *colors* are the
  themed part.
- Manual matrix before acceptance: Dark+, Light+, High Contrast — checking body text, links, code
  blocks, tables, blockquotes, the front-matter details block, and the too-large notice.

## 8. Fixtures

Add `docs/fixtures/kitchen-sink.md` (committed): headings, nested lists, task lists, tables,
fenced code in several languages, inline code, bold/italic/strikethrough, links, a relative image,
front matter, an HTML-injection attempt, unicode (emoji, CJK, RTL). Used for §6/§7 verification
and reused by every later phase.

## 9. Acceptance checklist

- [ ] F5 launches the Extension Development Host; `Markdown Review: Open Review Pane` appears in
      the editor title and explorer context menus for `.md` files only
- [ ] Kitchen-sink fixture renders correctly; injection attempts are inert
- [ ] Zero CSP violations in webview devtools console
- [ ] `data-line` present on block elements and matches on-disk line numbers (spot-check against a
      file with front matter)
- [ ] Dark+ / Light+ / High Contrast pass; CSS hardcoded-color grep is clean
- [ ] > 2 MB file shows the guard, "render anyway" works
- [ ] Panel survives window reload (serializer restores it against the same file)
- [ ] `npm run build` produces `dist/extension.js` + `media/webview.js`; `npm test` still green
