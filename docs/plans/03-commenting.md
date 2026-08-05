# Phase 3 — Commenting

**Delivers:** the full commenting experience — select text, write a comment, see it as a gutter
card, have it persist in a human-readable sidecar and survive window reloads. Status inference and
prompts come in Phase 4; every comment created here is simply `open`.

Spec references: PRD §4 (data model), §6 (commenting interaction, state), §9 (configuration), §11
(sidecar corruption, no-workspace, two-panels failure modes), §10 Phase 3.

## 1. Prerequisites

Phase 2 acceptance checklist (Plan 02 §9) passes. Runtime dep added this phase: `nanoid`.

## 2. Selection capture in the webview → anchor space

The webview must hand the extension a selection already expressed in **anchor space**
(Plan 01 §3). Implementation in `media/src/selection.ts`:

- On `selectionchange` (debounced ~150 ms), if the selection is non-collapsed and entirely inside
  the rendered content (never the front-matter block), compute:
  - `selectedText`: walk the DOM `Range`; concatenate text nodes, inserting `\n` when crossing a
    block-element boundary and collapsing intra-block whitespace runs to single spaces — the
    mirror of Plan 01 §3 rules 4 and 6. Inside `<pre><code>`, take text verbatim (rule 5).
  - `offset`: the selection start's offset into the document's plain text. Compute it by building,
    once per `setContent`, a flat concatenation of the rendered blocks' normalized text (same
    walk), then locating the selection start within it via a pre-computed node→offset index. If
    the mapping fails (shouldn't, but DOM is DOM), send `offset: -1`; the host falls back to
    `hintOffset` from the nearest `data-line` block's span start.
  - `hintLine`: nearest `[data-line]` ancestor of the range start.
- Cross-check invariant (debug builds only): the webview's flat text must equal
  `renderPlainText(source).text`. Assert once per `setContent` in dev mode; log a warning and
  carry on in production. Divergence here is the number-one silent corruption risk in the whole
  design — catching it early is worth the wiring.

## 3. `src/store/ReviewStore.ts` — sidecar persistence (contract owner)

One store instance per target file, owned by a module-level registry (`ReviewStore.for(uri)`), so
**every consumer — however many panels — shares one source of truth** (PRD §11). Panels subscribe
to `onDidChange` and re-post state to their webviews.

### Sidecar location & naming

- `workspace` mode (default): `<workspaceFolder>/.reviews/<relPath with / and \ → __>.json`
  (PRD §4). Compute from the workspace-relative path with separators normalized to `/` **before**
  the `__` substitution — this is the Windows bug the PRD warns about; add a unit test with a
  Windows-style relative path.
- No workspace folder (loose file): fall back to `context.globalStorageUri/reviews/<hash of
  absolute path>.json` and show a one-time warning that comments aren't shareable (PRD §11).
- `global` mode (setting `markdownReview.storageLocation`): always the globalStorage scheme.
- `targetPath` inside the file is the workspace-relative path with forward slashes.

### Behavior

- **Read**: on first access. Corrupt/unparseable JSON, or `version !== 1` and not migratable →
  copy to `<name>.json.bak`, start with an empty `ReviewFile`, `window.showWarningMessage`
  explaining what happened and where the backup is (PRD §11 — never silently drop data). Validate
  shape with a hand-written type guard; entries failing validation are preserved in the `.bak`,
  not resurrected.
- **Write**: atomic — write `<name>.json.tmp` then rename over the target. Debounce writes 250 ms
  (rapid add/edit bursts), flush on panel dispose and extension deactivate. Pretty-print with
  2-space indent: the PRD requires the sidecar be human-readable and hand-editable.
- **External edits**: `FileSystemWatcher` on the sidecar itself; on change not caused by our own
  write (compare against last-written content), re-read, re-validate, emit `onDidChange`. This is
  what makes hand-editing the JSON while the panel is open behave sanely.
- API surface: `getState(): ReviewFile`, `addComment`, `updateCommentBody`, `deleteComment`,
  `setStatus(id, status)`, `onDidChange: Event<ReviewFile>`. Phase 4 adds re-anchor and baseline
  methods; this phase leaves them out rather than stubbing.

## 4. Comment creation flow

1. Webview shows a floating **Comment** button near a valid selection (PRD §6).
2. Click → popover anchored to the selection: `textarea`, author label, `Cmd/Ctrl+Enter` submits,
   `Esc` cancels, focus trapped inside while open, restored to the document after.
3. Submit → `addComment` message with the §2 payload + body.
4. Host: `createAnchor` (Plan 01 §4). On `too-short`/`too-long` → user-facing message
   ("Select at least 3 characters" / "Selection too long to anchor — select under 500
   characters"), nothing persisted. On success → build `Comment` (id `nanoid(8)`, author from
   `markdownReview.author` setting or `os.userInfo().username`, `createdAt` ISO, status `open`),
   `store.addComment`, which round-trips back to all panels via `onDidChange`.

## 5. Comment display

- **Gutter cards** (PRD §6): right margin column (~280 px). Each card aligns its top with its
  anchor span's vertical position; when cards would overlap, stack downward preserving document
  order (single pass over cards sorted by anchor top). Card shows author, relative time, body,
  and a kebab menu with *Edit*, *Delete* (delete = user action, allowed; only *automatic* deletion
  is forbidden), and *Resolve* (sets terminal `resolved`; card moves to a collapsed "Resolved"
  group at the bottom of the margin).
- **Anchored span highlight**: on `setContent`/state change, the webview locates each anchor —
  reusing `locate()` (Plan 01 §5) *in the webview bundle*; it's pure and bundles cleanly — and
  wraps the plain-text range back to DOM ranges via the node→offset index from §2. Subtle
  background highlight; hover card ↔ span emphasis both directions. Confidence < 0.5 renders the
  card with a "position uncertain" badge instead of a confident highlight (PRD §5).
- **Narrow panes** (< 700 px, via `ResizeObserver`): margin collapses; anchors get inline markers
  that expand the card inline on click.
- All interactive elements keyboard-reachable, `aria-label`ed; popover and cards use the themed
  CSS variables per Plan 02 §7 (no new hardcoded colors).

## 6. Message contract — delta to Plan 02 §5

```ts
// extension -> webview (additions)
| { type: 'reviewState'; review: ReviewFile; located: Record<string /*commentId*/, Located | null> }
// webview -> extension (additions)
| { type: 'addComment'; selectedText: string; offset: number; hintLine: number; body: string }
| { type: 'editComment'; id: string; body: string }
| { type: 'deleteComment'; id: string }
| { type: 'resolveComment'; id: string }
```

The host computes `located` (it already holds `PlainTextDoc`); the webview only maps offsets to
DOM. Keeping `locate` results host-computed but *also* bundling `locate` webview-side (for the §5
highlight refresh on resize) is acceptable duplication of *execution*, not of *code* — same
module, two bundles.

## 7. Serializer & webview state — delta to Plan 02

- Serializer state grows to `{ targetPath }` + store re-hydration on `deserializeWebviewPanel`
  (the sidecar is the durable truth; the serializer only needs to know *which file*).
- `getState`/`setState` adds the active status filter (used from Phase 4) alongside scroll
  position. Still no `retainContextWhenHidden` (PRD §6).

## 8. Acceptance checklist

Each item records *how* it is verified. The interactive remainder is scripted in
[03-acceptance-run.md](03-acceptance-run.md) — run that before starting Phase 4 and date this
section when it passes.

- [x] Full create flow works: select → button → popover → card appears, span highlighted
      — `dev/harness/` **Run gestures**: a real `Range` over rendered text, through the real
      `selectionchange` debounce, to a real `addComment` — asserting the body, the selected text,
      and that the offset the *webview* computed equals the offset the *host* computed for the same
      passage. Only the mouse itself is unexercised; acceptance run step 1 still covers the feel
- [x] Selections < 3 or > 500 chars rejected with the exact messages in §4
      — `src/test/notices.test.ts` asserts the wording verbatim; "nothing persisted" is step 2
- [x] Sidecar appears at the correct `.reviews/...` path, pretty-printed; hand-editing the body
      of a comment in the JSON while the panel is open updates the card
      — `store.spec.ts` (placement, 2-space print, nested `__` flattening, external edit adopted);
      the card re-render is step 3
- [ ] Comments persist across window reload (serializer + sidecar)
      — **manual**, step 4. No automated coverage: the serializer path needs a real window reload
- [x] Corrupt the sidecar by hand → warning shown, `.bak` created, panel functions with empty state
      — `store.spec.ts`, both the unparseable and the future-version case, asserting the backup is
      byte-identical. The notification *text* is not observable from inside the host
- [x] Loose file (no workspace) → globalStorage fallback + one-time warning
      — `store.spec.ts`, including the hashed name and the once-per-machine `globalState` flag
- [x] Two panels on the same file … stay in sync through the shared store
      — restated per §9: `activation.spec.ts` asserts one pane per URI; the cross-*window* case is
      the sidecar watcher, covered by `store.spec.ts` and confirmed by hand in step 5
- [x] Overlapping anchors stack cards without overlap; < 700 px pane collapses to inline markers
      — `dev/harness/`, in a real layout engine: cards measured non-overlapping *and* demonstrably
      displaced, narrow collapse producing inline markers. Confirmed by dragging in step 8
- [x] Edit / delete / resolve all round-trip through the sidecar
      — `store.spec.ts`
- [x] Windows-style path naming unit test passes; `npm test` green, no CSP regressions
      — `sidecarPath.test.ts`; 344 unit tests + 18 integration tests green. **CSP is step 6** and
      cannot be automated: it is enforced by VS Code, and the layout harness deliberately does not
      reproduce it

## 9. Spec corrections applied in this phase

Recorded here so later phases don't "restore" them, mirroring Plan 01 §9 and Plan 02 §10.

### Release-blocking — changes the design in §2 and §6 above

**C1 — the webview must not rebuild anchor space from the DOM.** §2 as written asked
`media/src/selection.ts` to reconstruct the document's flat plain text by walking the DOM and
cross-check it against `renderPlainText(source).text`. §2 itself called this "the number-one silent
corruption risk in the whole design", and it was worse than it looks: the two texts derive from
*different substrates* — `plaintext.ts` walks markdown-it **tokens**, a DOM walk sees rendered
**elements** — so three divergences were guaranteed rather than hypothetical:

- **image alt text** is in anchor space (`inlineText` recurses into an image's alt children) but is
  not a DOM text node, so every offset after an image would land early;
- **table cells** join with `' '` rather than `'\n'`, which a DOM walk can only know by re-deriving
  table structure;
- **fenced code** is verbatim rather than collapsed, *and* highlight.js rewrites its text nodes.

Replaced by **host-stamped offsets**. The token walk was extracted from `renderPlainText` into
`walkSpans` (`src/render/plaintext.ts`), and `renderer.ts`'s existing core rule now calls that same
function on its own token stream to stamp `data-ap-start` / `data-ap-end` — each block's exact
offsets into `renderPlainText(source).text` — onto the element that renders it. Block boundaries
therefore cannot drift: it is one function over one token stream, not two implementations kept in
agreement by a test. The webview only maps *within* a block, where the same three cases are handled
explicitly and a mistake shifts a highlight by a few characters instead of corrupting an anchor.

Consequences elsewhere: `renderer.rules.fence` builds markup by hand and forwards the new
attributes explicitly; DOMPurify's `ADD_ATTR` gained both; the carrier for a span is the enclosing
non-`hidden` open token, which is what puts a *tight* list item's offsets on its `<li>` (markdown-it
hides tight-list `paragraph_open`, and `renderToken` emits nothing for a hidden token). R13 and R14
enforce all of it, and `media/test/anchorSpace.test.ts` asserts the DOM walk reproduces
`renderPlainText`'s output exactly across 17 document shapes.

`verifyBlockMap` is kept as a runtime backstop: on a mismatch the webview reports to the output
channel and degrades to `offset: -1`, rather than trusting a number it cannot justify.

**C2 — `locate()` is not bundled into the webview.** §6's closing paragraph justified shipping the
confidence cascade webview-side "for the §5 highlight refresh on resize". Resizing changes layout,
not `doc.text`, so located offsets are invariant under it — there is nothing to recompute, only
rectangles to re-measure. The host computes `located` and posts it, as the rest of §6 already said.
This keeps `diff-match-patch` out of the webview bundle, which grew by ~12 KB this phase against
Phase 5's 500 KB budget instead of ~50 KB.

### Corrected in this plan, inline above

- **Highlights are an overlay, not a wrapper.** §5 says "wraps the plain-text range back to DOM
  ranges". Implemented as absolutely-positioned rectangles from `Range.getClientRects()` instead:
  `surroundContents` splits the text nodes inside the blocks whose offsets anchoring depends on, so
  wrapping a range would silently move every offset taken afterwards. The overlay is
  `pointer-events: none` so text stays selectable, and hover emphasis is done by hit-testing.
- **Two panels on one file** (§8) is not reachable as written. Phase 2's `createOrShow` keys panels
  by URI and reveals the existing one, by design. The shared-store requirement still holds for the
  command layer and Phase 4's watcher, but the *observable* two-panel case is two windows — separate
  extension hosts, separate memory — which is served by the sidecar `FileSystemWatcher`, not by the
  in-memory registry. Verify it that way.
- **The store is split three ways**, not one file. `sidecarPath.ts` (naming) and `reviewFile.ts`
  (validation) are pure and `vscode`-free — they hold the Windows-separator landmine and the
  hand-edited-JSON boundary, which are the parts worth unit-testing — and both are enforced as
  `vscode`-free by `eslint.config.mjs`. `ReviewStore.ts` is the I/O half.
- **External sidecar edits that are invalid are ignored, not quarantined.** §3 says re-read and
  re-validate. A hand-edit in progress is transiently unparseable, so backing it up on every
  keystroke would litter `.bak` files; the store keeps its in-memory state and logs instead.
  Quarantine still applies on the initial read, which is what PRD §11 describes.
- **Two distinct `targetPath`s.** `PanelState.targetPath` and `HostMessage.init` carry an absolute
  `fsPath` (the serializer needs it to reopen the file); `ReviewFile.targetPath` is
  workspace-relative with forward slashes (PRD §4). Both names were already in use; they are not
  the same value.
- **`init` gained an `author` field**, so the popover can show whose name the comment will carry
  without the webview guessing.

### Found by the layout harness, after the phase merged

Both are in `media/`, both only reproduce with a real layout engine, and both were invisible to the
jsdom suite because jsdom has neither `ResizeObserver` nor layout. They are the reason
`dev/harness/` exists.

- **The `ResizeObserver` callback mutated layout from inside the notification.** `reposition()`
  toggles `body.mr-narrow` and writes every card's `top`, so running it directly in the observer
  produced `ResizeObserver loop completed with undelivered notifications` every time the pane
  crossed the 700 px breakpoint. That is not a silent browser warning in this codebase:
  `webview.ts` forwards every `window.error` to the host, so narrowing the pane filed a spurious
  error into the output channel the user is supposed to trust. The work is now deferred to the next
  animation frame, which also coalesces a drag's burst of notifications into one rebuild.
- **The resolved-comments group escaped the pane in narrow mode.** `.mr-narrow #gutter` drops to
  `position: static`, which stops it being a containing block — but `.mr-resolved-group` kept
  `position: absolute; width: 100%`, so it resolved against the page instead and hung 17 px past the
  right edge of a 660 px pane. It now goes static alongside `.mr-narrow .mr-card`.

**Left as a finding, not fixed:** `.mr-highlight` differentiates by `background-color` alone, which
is the weakest signal a high-contrast theme can carry, and under Windows forced-colors mode the
background is stripped by the OS entirely. Changing it to an outline is a design decision and could
not be verified here (the harness cannot emulate forced-colors), so it is called out in the
acceptance run's theme step instead of changed blind.

### Dependency decisions

- **`nanoid` pinned to `^3`**, not `^5`. v5 is ESM-only, and this project compiles with
  `module: node16` to a CJS bundle, so importing it fails typecheck with TS1479. v3 ships a
  `require` condition and is otherwise identical for our use.
- **`jsdom` added as a devDependency** (approved before implementation), plus a second vitest
  project for `media/test`. The webview's intra-block offset walk is exactly the code that fails
  silently, and Phase 2 shipped `media/src` with no automated coverage at all. Dev toolchain sits
  outside the PRD §3 runtime freeze — nothing extra ships in the `.vsix`.
- **A third tsconfig**, `tsconfig.webview-test.json`. The webview tests need the DOM lib *and* node
  types, which is precisely the combination `tsconfig.webview.json` exists to forbid, so folding
  them in would have defeated that project's purpose.
