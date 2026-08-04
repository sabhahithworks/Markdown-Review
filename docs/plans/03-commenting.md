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

- [ ] Full create flow works: select → button → popover → card appears, span highlighted
- [ ] Selections < 3 or > 500 chars rejected with the exact messages in §4
- [ ] Sidecar appears at the correct `.reviews/...` path, pretty-printed; hand-editing the body
      of a comment in the JSON while the panel is open updates the card
- [ ] Comments persist across window reload (serializer + sidecar)
- [ ] Corrupt the sidecar by hand → warning shown, `.bak` created, panel functions with empty state
- [ ] Loose file (no workspace) → globalStorage fallback + one-time warning
- [ ] Two panels on the same file (split editor trick or second window against same store) stay in
      sync through the shared store
- [ ] Overlapping anchors stack cards without overlap; < 700 px pane collapses to inline markers
- [ ] Edit / delete / resolve all round-trip through the sidecar
- [ ] Windows-style path naming unit test passes; `npm test` green, no CSP regressions
