# Phase 4 — Prompt Generation & Change Detection

**Delivers:** the loop that is the product's reason to exist — copy a review prompt, let any agent
edit the file, watch statuses flip to `addressed`/`orphaned`, confirm with before/after. Also the
header bar (counts, filters), the orphan-triage UI, and the remaining commands.

Spec references: PRD §7 (prompt), §8 (change detection), §4 (status semantics), §11 (rewrite,
rename/delete failure modes), §10 Phase 4.

## 1. Prerequisites

Phase 3 acceptance checklist (Plan 03 §8) passes.

## 2. Store extensions (delta to Plan 03 §3)

`ReviewStore` gains: `snapshotBaseline(plainText: string)` (sets `baselineText`/`baselineAt`),
`applyReanchor(newDoc: PlainTextDoc)` (runs Plan 01 §6 `reanchor`, persists only when
`changed`), and `clearAddressed()` / `clearAll()`.

## 3. `src/prompt/buildPrompt.ts` (operationalizes PRD §7)

Pure function; vitest-covered this phase.

```ts
function buildPrompt(review: ReviewFile, doc: PlainTextDoc): { prompt: string; count: number }
```

- Includes **open comments only**, numbered, in document order (sort by current located offset;
  unlocatable-but-open edge cases sort last by creation time).
- Header and rules exactly per the PRD §7 template, with the workspace-relative `targetPath` in
  the first line.
- Quoted anchor text > 100 chars → middle ellipsis (` … `), keeping ~48 chars each side.
- When an anchor covers an entire heading block (`BlockSpan.kind === 'heading'` and the anchor
  spans it — this is why Plan 01 §3 records `kind`), use `On the section "## Title"` phrasing.
- Tests: numbering/order, truncation boundary (99/100/101 chars), heading phrasing, zero-open
  (returns count 0; command layer handles the disabled state), unicode-safe truncation (don't
  split surrogate pairs).

## 4. `markdownReview.copyPrompt` command + button

- Enabled only when open comments > 0 (header button disabled state webview-side; the palette
  command shows "No open comments on <file>" when empty).
- On invoke: build prompt → `vscode.env.clipboard.writeText` → **snapshot baseline at this
  moment** (PRD §7 — `snapshotBaseline` with the current `renderPlainText().text`) → info message
  `"N comments copied. Paste into your agent and @-mention <targetPath>."`

## 5. Change detection & status lifecycle (contract owner for wiring)

`src/detect/changeWatcher.ts`, one per active store:

- **Two sources, one pipeline** (PRD §8): `workspace.onDidChangeTextDocument` filtered to the
  target, and a `FileSystemWatcher` on the target path (agents write to disk directly). Both feed
  a single 400 ms debounced trigger; a change arriving via both (dirty editor + save) coalesces.
  Read content from the open `TextDocument` when one exists (it's fresher than disk), else from
  disk.
- Pipeline per trigger: read → `renderPlainText` → `store.applyReanchor` → panels re-render
  content **and** state in one `setContent`+`reviewState` pair (avoid the flash of stale
  highlights).
- Gate: setting `markdownReview.autoDetectResolution: false` still re-anchors (positions must
  track edits) but never flips `open → addressed`; orphaning still applies (a gone anchor is gone
  regardless of the setting).
- **Never auto-close** (PRD §8): nothing in this pipeline may set `resolved`.
- `FileSystemWatcher` delete/rename events → "target missing" state in the panel with a re-link
  action (file picker; on re-link, update `targetPath`, keep all comments, re-anchor against the
  new file) (PRD §11). The sidecar is never deleted by this path.

## 6. Status UI — deltas to Plans 02 §5 / 03 §5–6

Message additions:

```ts
// extension -> webview
| { type: 'targetMissing' }
// webview -> extension
| { type: 'confirmAddressed'; id: string }   // "Looks good" -> resolved
| { type: 'reopenComment'; id: string }      // addressed -> open (user disagrees with inference)
| { type: 'reanchorManually'; id: string }   // arms re-anchor mode; next selection re-attaches
| { type: 'copyPrompt' } | { type: 'clearAddressed' }
| { type: 'setFilter'; statuses: CommentStatus[] }
```

- **Header bar**: open / addressed / orphaned counts, status filter chips (persisted via
  `setState`, Plan 03 §7), primary **Copy review prompt** button, **Clear addressed** action.
- **Addressed cards**: show `resolution.previousText` vs `currentText` as a compact inline
  before/after (del/ins styling via themed colors), plus **Looks good** (→ `resolved`) and
  **Reopen** buttons. `addressed` is a suggestion, the user confirms (PRD §8).
- **Orphaned section** (PRD §6): distinct section pinned below the header listing each orphan with
  its original `anchor.exact` quoted, **Delete** and **Re-anchor manually** (arm → user selects
  new text → host runs `createAnchor` with the new selection, resets status to `open`, keeps id,
  body, author, createdAt).
- **Full-rewrite banner** (PRD §11): when a single re-anchor pass orphans every previously-open
  comment and `baselineText` exists, show a banner: "The document was rewritten — N comments
  couldn't be relocated. **Review the diff**." The action opens `vscode.diff` between a readonly
  virtual document (`markdown-review:` `TextDocumentContentProvider` serving `baselineText`) and
  the current file.

## 7. Remaining commands

- `markdownReview.clearAddressed` — moves all `addressed` → `resolved`? **No** — per PRD §6 it
  *clears* them: this is a user-initiated bulk delete of addressed comments. Modal confirm with
  the count first ("Remove 4 addressed comments? Their text changes stay in the document.").
- `markdownReview.clearAll` — modal confirm; deletes all comments for the file (sidecar becomes
  empty `ReviewFile`, file kept).
- Both are user actions, so the never-auto-delete rule is satisfied; both must be undo-friendly to
  the extent possible — write the pre-clear state to `<name>.json.bak` before clearing (reuse the
  Plan 03 §3 backup path).

## 8. Integration test (`@vscode/test-electron`)

One end-to-end scenario, scripted (this is the "full loop against a real agent" acceptance, made
reproducible — a human run with a real agent is still required once before sign-off):

1. Open fixture, add 3 comments programmatically via the store.
2. Copy prompt → assert clipboard content matches `buildPrompt` golden file; baseline set.
3. Simulate the agent: edit the file on disk with `fs` — reword one anchored sentence, delete
   another, leave the third untouched.
4. After debounce: assert statuses are exactly `addressed` / `orphaned` / `open`, and
   `resolution` on the addressed one carries the correct before/after.
5. Rewrite the whole file → assert all non-resolved comments orphaned, no exception, sidecar
   intact.

## 9. Acceptance checklist

- [ ] Copy prompt produces the PRD §7 format byte-for-byte for the golden fixture; baseline
      snapshots at copy time
- [ ] Real-agent manual run: comments flip to `addressed` with correct before/after; "Looks good"
      resolves; "Reopen" reverts
- [ ] Deleting an anchored sentence orphans exactly that comment; orphan section shows the quote;
      manual re-anchor re-attaches it
- [ ] Full rewrite → all orphaned, banner appears, diff view shows baseline vs current, no crash
- [ ] `autoDetectResolution: false` keeps positions tracking but never infers `addressed`
- [ ] Editor edits and direct disk writes both trigger detection; debounce coalesces bursts
- [ ] Rename/delete of target → "target missing" + working re-link; sidecar preserved
- [ ] Clear addressed / clear all confirm, back up, and execute correctly
- [ ] Integration test suite green alongside `npm test`
