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
  - **Exception — `fence` uses `map[0] + 1`.** `plaintext.ts` anchors a fenced block's
    `BlockSpan.sourceLineStart` at the first *content* line, skipping the ` ``` ` marker. Using raw
    `map[0]` here desyncs the DOM from anchor space on every fenced block, and Phase 3's
    `hintLine → BlockSpan` lookup then misses them entirely. Indented `code_block` needs no
    adjustment. See §10 and test R7.
  - The rule is attribute-only and walks `state.tokens` alone — never inline children, never
    `token.content`/`children`/`map`. That is what keeps this instance's tokenization identical to
    `plaintext.ts`'s (test R6).
  - The same rule assigns heading `id` slugs, because markdown-it emits none and §5 promises
    in-document `#fragment` links work.
  - Per-document state (`lineOffset`, `resolveImage`, slug counters) travels on `md.render(body,
    env)` under a module-private `Symbol`, **never a factory closure** — the instance is a
    singleton reused across documents (test R10).
- **Front matter**: stripped before rendering (same helper Phase 1 uses — one implementation in
  `src/render/frontMatter.ts`), then rendered as a collapsed `<details class="front-matter">`
  block above the content, excluded from anchor plain text by construction.
- **Fences**: renderer emits `<pre data-line="…"><code class="language-x">` with content
  HTML-escaped, no highlighting in the host. Highlighting happens webview-side (see §5) so the host
  stays free of DOM-shaped concerns and the CSP story stays simple.
  - This requires **overriding `renderer.rules.fence`**, not just setting attributes: markdown-it's
    default fence rule puts token attributes on `<code>` while indented `code_block` puts them on
    `<pre>`, giving two different `[data-line]` ancestor shapes for the same conceptual block.
  - The language is the first info word and is accepted only against `^[\w+#-]{1,24}$`; anything
    else is dropped rather than escaped, so an info string like `"><script` never reaches a class
    attribute.
- Phase 2 therefore owns **three** render-rule overrides: `fence`, `image`, and `link_open` (which
  adds `rel="noopener noreferrer"`).

## 5. Webview runtime (`media/src/webview.ts`) + message contract (contract owner)

`src/panel/messages.ts` — discriminated unions, the **base contract** (Phases 3–4 extend with new
members; they list only their deltas):

```ts
// extension -> webview
type HostMessage =
  | { type: 'init'; targetPath: string }
  | { type: 'setContent'; html: string; frontMatterHtml?: string }
  | { type: 'tooLarge'; sizeBytes: number }
  | { type: 'targetUnreadable'; reason: string };
// webview -> extension
type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openExternal'; url: string }
  | { type: 'renderAnyway' }
  | { type: 'error'; message: string };
// serializer state; also what the webview writes via setState(). Phase 3 extends it.
interface PanelState { targetPath: string; scrollLine?: number }
```

Plus hand-written guards `isWebviewMessage` / `isPanelState` — `onDidReceiveMessage` and
`deserializeWebviewPanel` are untrusted-input boundaries, and the conventions require narrowing
there rather than casting. Three members beyond the original sketch, each earning its place:
`init` (the webview cannot write `setState({targetPath})` without being told which file it is, and
a `tooLarge` document never receives `setContent`), `error` (the webview has no usable console and
`no-console` is repo-wide), and `targetUnreadable` (PRD §11 — the file can vanish while the pane is
open, and the pane must survive it).

Webview behavior:

- On `setContent`: sanitize with DOMPurify —
  `{ USE_PROFILES: { html: true }, FORBID_TAGS: ['style'], ADD_ATTR: ['data-line', 'data-no-anchor'] }`
  — then inject, then run highlight.js. **Sanitize-then-inject is non-negotiable** (PRD §6); the
  host sends rendered HTML, the webview treats it as untrusted anyway (defense in depth).
  `data-no-anchor` must be in `ADD_ATTR`: it is the hook Phase 3's selection capture tests to keep
  front-matter selections unanchorable.
- highlight.js: import `highlight.js/lib/core` and explicitly register a curated common set
  (js/ts, json, bash/shell, python, html/xml, css, yaml, markdown, diff, sql, go, rust). This is
  the "lazy-load" spirit within a no-network CSP: unknown languages fall back to plain `<code>`.
  Record the measured contribution to `media/webview.js` size — Phase 5 has a 500 KB package
  budget and this bundle is the main risk to it.
- All link clicks intercepted: `preventDefault()`, post `openExternal`; the host calls
  `vscode.env.openExternal` **after checking the scheme against an `http`/`https`/`mailto`
  allowlist**. That check is security-critical, not hygiene: without it a crafted link in a reviewed
  document becomes `openExternal(Uri.parse('command:…'))`, which is arbitrary command execution
  from file content. Anchor-fragment links (`#heading`) scroll within the webview instead, against
  the heading ids the §4 core rule generates. Relative document links (`./other.md`) are inert — a
  `file:` URI must never reach `openExternal`.
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
- **Fonts are part of theming too**, and neither the PRD nor this plan originally said so. A webview
  inherits none of VS Code's typography, so without `--vscode-font-family` / `--vscode-font-size` on
  `body` and `--vscode-editor-font-family` / `--vscode-editor-font-size` on `code`/`pre`, the pane
  renders in the browser default serif in *every* theme. No colour variable compensates for that.
- **highlight.js needs its own token map.** Its stylesheets are hardcoded hex — unusable under this
  rule, and rejected by the colour lint. `media/webview.css` maps `.hljs-*` classes onto variables
  the colour registry defines for every theme kind (`--vscode-debugTokenExpression-*`,
  `--vscode-charts-*`, `--vscode-descriptionForeground`), so highlighting follows the user's theme.
- The colour check is `scripts/check-css-colors.mjs`, not a shell `grep`: grep is not portable to
  Windows, and it false-positives on `content: "#tag"`, `url(data:…)`, `white-space` and
  `var(--vscode-charts-blue)`. The script strips comments/strings/`url()` first and requires a named
  colour to be a whole identifier.
- Manual matrix before acceptance: Dark+, Light+, High Contrast — checking body text, links, code
  blocks, tables, blockquotes, the front-matter details block, and the too-large notice.

## 8. Fixtures

`docs/fixtures/kitchen-sink.md` **already exists** — Phase 1 created it (headings, nested lists,
task lists, tables, fenced code in several languages, inline code, bold/italic/strikethrough,
links, relative images, front matter, HTML-injection attempts, unicode incl. emoji/CJK/RTL). Do not
recreate it. Used for §6/§7 verification and by every later phase.

Its `./diagram.png` and `./flow.png` targets are intentionally absent: the manual pass verifies
that the *`src` was rewritten* to a `vscode-webview://` URI (devtools Elements), which a broken
image still demonstrates.

## 9. Acceptance checklist

Annotated 2026-08-04 during the Phase 3 → Phase 4 gate pass. Items still marked `[ ]` need the
Extension Development Host and are folded into [03-acceptance-run.md](03-acceptance-run.md).

- [ ] F5 launches the Extension Development Host; `Markdown Review: Open Review Pane` appears in
      the editor title and explorer context menus for `.md` files only — **manual** (the `when`
      clauses are UI state); the command's own validation is covered by `activation.spec.ts`
- [ ] Kitchen-sink fixture renders correctly; injection attempts are inert — **manual** for the
      rendering; sanitization is covered by `renderer.test.ts`
- [ ] Zero CSP violations in webview devtools console — **manual**, acceptance run step 6
- [x] `data-line` present on block elements and matches on-disk line numbers (spot-check against a
      file with front matter) — `renderer.test.ts` (R1–R14), including the front-matter offset
- [x] Dark+ / Light+ / High Contrast pass; CSS hardcoded-color grep is clean
      — `check-css-colors.mjs` and the new `check-theme-vars.mjs`; all three themes render in
      `dev/harness/`. Confirmed against real palettes in acceptance run step 7
- [x] > 2 MB file shows the guard — `activation.spec.ts` opens one without throwing. "Render
      anyway" is a webview button and stays manual
- [ ] Panel survives window reload (serializer restores it against the same file) — **manual**,
      acceptance run step 4
- [x] `npm run build` produces `dist/extension.js` + `media/webview.js`; `npm test` still green
- [x] Delete the target while the pane is open → "could not be read" notice, no unhandled rejection
      — `activation.spec.ts`; the suite fails the run on any unhandled rejection
- [ ] Type continuously for ~5 s → renders settle, scroll holds, no out-of-order flicker — **manual**
- [x] Palette invocation with no editor / with a `.txt` → distinct, clean errors — `.txt` is covered
      by `activation.spec.ts` (no pane opens); the no-editor case needs an empty window
- [x] Opening the same file twice reveals the existing pane; closing and reopening still works
      — `activation.spec.ts`
- [x] `Developer: Show Running Extensions` on a fresh window → not activated until first command use
      — `activation.spec.ts` asserts `isActive === false` before any command runs, which is why that
      spec is registered first

## 10. Spec corrections applied in this phase

Recorded here so later phases don't "restore" them, mirroring Plan 01 §9.

**Release-blocking.** Fence `data-line` had to become `map[0] + 1` (§4). As originally written,
every fenced block's `data-line` pointed at the ` ``` ` marker while its `BlockSpan.sourceLineStart`
pointed at the first content line — a silent anchor-space desync that would have made Phase 3's
hint lookup miss every code block. Verified both ways against the kitchen-sink fixture; test R7
asserts the covering relation and fails without the carve-out.

**Security.** `openExternal` had no scheme validation in §5/§6; unvalidated it is arbitrary command
execution from file content (§6).

**Corrected in this plan, inline above:** fence needs a render-rule *override* because markdown-it
puts its attrs on `<code>` while `code_block` uses `<pre>` (§4); heading `id`s must be generated or
§5's `#fragment` links have no targets (§4); per-document render state must ride on `env`, not a
factory closure (§4); `data-no-anchor` must be in DOMPurify's `ADD_ATTR` (§5); `init`, `error` and
`targetUnreadable` messages (§5); webview typography (§7); the highlight.js `--vscode-*` token map
(§7); a node script rather than a shell grep for the colour check (§7); the fixture already exists
(§8).

**Deviations from PRD §9's manifest**, contrary to §2's "as written there":

- `publisher`, `repository.url` and `icon` are omitted. All three are literal placeholders in the
  PRD (`<your-publisher-id>`, `<you>`, and `media/icon.png`, which Plan 05 §2 creates); shipping
  them breaks `vsce`. Plan 05 fills them in.
- `categories` is `["Other"]`. PRD §9's `"Notebooks"` means Jupyter support on the Marketplace,
  which this extension does not have.

**Dependency exception.** `highlight.js` is mandated by PRD §6 but absent from the PRD §3 table the
plans README freezes against. Treated as an approved exception in the same class as
`markdown-it-task-lists`. Measured contribution: **70.6 KB** minified of `media/webview.js`
(DOMPurify 28.2 KB, our code 3.4 KB; 102.9 KB total, 34.4 KB gzipped). Whole-extension gzipped
payload ≈ 88 KB against Phase 5's 500 KB budget.

**Unimplementable as written.** §3's "assert both succeed" — neither `renderMarkdown` nor
`renderPlainText` returns a result union, so there is nothing to assert. Replaced with the check
that actually protects anchor space: `rendered.lineOffset === plain.frontMatterLineOffset`, logged
to the output channel on mismatch.

**API correction.** §3's panel icon: `WebviewPanel.iconPath` takes image files, not a codicon
string. `media/icon-{light,dark}.svg` are drawn for this project, so no third-party icon licence
applies.

**Left for Plan 04, deliberately.** Live refresh here is a single debounced
`onDidChangeTextDocument` listener filtered to the target URI — no `FileSystemWatcher`, so there is
only ever one watch design. Plan 04 §5 supersedes it. The `targetUnreadable` *notice* ships now; the
re-link action is Phase 4's.

**Noted, not built.** `.vscodeignore` belongs to Plan 05 §2, but without it `dependencies` would
ship `node_modules` into the `.vsix` — the one way the size projection above could still go wrong.
