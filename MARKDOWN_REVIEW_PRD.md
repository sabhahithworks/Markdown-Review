# PRD — Markdown Review Extension for VS Code

**Working name:** `markdown-review` (rename before publishing — check Marketplace availability)
**Status:** Spec for implementation
**Audience:** Claude Code, building this end to end

---

## 1. What this is

A VS Code extension that renders any Markdown file in a review pane where the user can select
passages and leave comments — like Google Docs commenting, but for local `.md` files. The user
then copies a generated prompt, `@`-mentions the file in any AI agent, and the agent revises the
document. The extension detects which comments were addressed by watching the file change.

**The core insight driving the design:** the agent is never asked to write structured data,
follow a comment schema, or preserve annotations. It is only ever asked to edit prose. All
bookkeeping is the extension's job. This is what makes it work with *any* agent — Claude Code,
Copilot, Cursor, Gemini, Codex — with zero integration.

### Positioning

Antigravity and Claude Code both have artifact/plan commenting, but only for agent-generated
artifacts inside their own product. This works on *any* markdown file — a PRD, an ADR, a README,
a design doc — with any agent. That's the Marketplace differentiator and it should be the first
line of the README.

---

## 2. Non-goals (v1)

Do not build these. They are deferred deliberately; adding them will sink the release.

- Comment threads or replies (single comment per anchor only). Agent notes are not threads: one-way, plain text, no reply, never sent back to the agent (release-expansion D42)
- Multi-user identity, avatars, or attribution beyond a configurable display name
- Real-time collaboration or any backend service
- An MCP server (a good v2, explicitly out of scope now)
- Reactions or emoji
- Editing markdown in the preview (read-only rendering)
- Replacing VS Code's built-in Markdown preview as the default
- Any telemetry or network calls whatsoever

---

## 3. Architecture

```
src/
  extension.ts            # activate/deactivate, command registration
  panel/
    ReviewPanel.ts        # webview lifecycle, messaging, serializer
    messages.ts           # typed message contract (extension <-> webview)
  render/
    renderer.ts           # markdown-it setup, data-line injection, sanitize
    plaintext.ts          # rendered DOM -> normalized plain text + offset map
  anchor/
    types.ts              # Anchor, Comment, ReviewFile
    create.ts             # selection -> Anchor
    locate.ts             # Anchor + document -> resolved position | null
    reanchor.ts           # batch relocation + status inference
  store/
    ReviewStore.ts        # sidecar read/write, in-memory cache, change events
  prompt/
    buildPrompt.ts        # comments -> agent prompt string
  test/
    anchor.test.ts        # THE critical test suite
media/
  webview.js              # webview runtime (bundled separately)
  webview.css
```

### Tech decisions — do not deviate without flagging

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true` | |
| Bundler | esbuild, two entry points (extension + webview) | VS Code team's recommendation; webview JS must ship separately |
| Markdown | `markdown-it` | `token.map` gives source line ranges, needed for anchoring |
| Sanitizer | `dompurify` | Webview renders untrusted file content |
| GitHub alerts | `markdown-it-github-alerts` | `> [!NOTE]` blocks render as callouts instead of quotes with a literal marker |
| Footnotes | `markdown-it-footnote` | `[^1]` references render as links to notes at the end of the document |
| Diagrams | `mermaid` | `mermaid` code blocks render as diagrams; shipped as its own lazily loaded file |
| Fuzzy match | `diff-match-patch` (`match_main`) | Purpose-built for relocating text after edits |
| Webview UI | Vanilla TS + CSS. **No framework.** | Bundle size and startup time matter here |
| Tests | `vitest` for units, `@vscode/test-electron` for integration | |

### Data flow

```
.md file  ──render──>  webview (rendered HTML + data-line attrs)
                            │
                     user selects text
                            │
                       create Anchor  ──>  .reviews/<name>.md.json
                            │
                    "Copy review prompt"
                            │
                   clipboard ──> user pastes into any agent
                            │
                    agent edits the .md
                            │
        onDidChangeTextDocument ──> re-anchor ──> status inference
                            │
                    webview re-renders with updated statuses
```

---

## 4. Data model

Sidecar file at `<workspaceFolder>/.reviews/<relative-path-with-slashes-replaced>.json`.
Example: `docs/specs/auth.md` → `.reviews/docs__specs__auth.md.json`.

```ts
interface ReviewFile {
  version: 1;
  targetPath: string;          // workspace-relative, forward slashes
  comments: Comment[];
  /** Rendered plain text at the moment the prompt was last copied. Diff baseline. */
  baselineText?: string;
  baselineAt?: string;         // ISO timestamp
}

interface Comment {
  id: string;                  // nanoid, 8 chars
  body: string;
  author: string;              // from config, defaults to os.userInfo().username
  createdAt: string;           // ISO
  status: 'open' | 'addressed' | 'orphaned' | 'resolved';
  anchor?: Anchor;             // absent on a whole-document comment
  /** Set when status flips to 'addressed'. Shown as before/after in the UI. */
  resolution?: {
    previousText: string;
    currentText: string;
    detectedAt: string;
  };
}

interface Anchor {
  /**
   * The selected text, normalized — and the per-comment change-detection baseline:
   * `reanchor` compares the currently located text against this value to infer `addressed`.
   * Never mutated after creation.
   */
  exact: string;
  prefix: string;              // up to 32 chars of normalized text before
  suffix: string;              // up to 32 chars of normalized text after
  hintLine: number;            // source line from nearest [data-line] ancestor
  hintOffset: number;          // char offset into the normalized plain text at creation
}
```

A comment with no `anchor` is a whole-document comment: it is about the document as a whole, not a
passage. It is never located, re-anchored or orphaned, and its status changes only by the user's hand.

**Status semantics:**

- `open` — anchor located, text unchanged since the comment was created
- `addressed` — anchor located but its text differs from `anchor.exact`. *Inferred, not
  authoritative.*
- `orphaned` — anchor could not be located. Needs human triage.
- `resolved` — user explicitly dismissed it. Terminal state, never auto-changed.

The extension must **never** delete a comment automatically. Orphaned comments stay visible in a
dedicated section until the user acts.

---

## 5. The anchoring module — build and test this first

This is the load-bearing piece. It is pure logic with no VS Code dependency, so build it
standalone, test it hard, then wire up the extension around it.

### Anchor space: rendered plain text, not source

Anchors are created and resolved against the **rendered plain text**, not the raw markdown.
Rationale: the user selects rendered text (`**bold**` appears as `bold`), so anchoring in source
space would require inverse-mapping inline markdown syntax — fragile and unnecessary. Relocation
always re-renders the document first, so both ends of the round trip work in the same space.

`plaintext.ts` must produce, from a markdown string:
- the normalized plain text (whitespace collapsed to single spaces, trimmed per block, blocks
  joined by `\n`)
- an index mapping plain-text offsets → source line numbers, derived from `token.map`

### `create(selection, doc): Anchor`

1. Normalize the selected string the same way `plaintext.ts` normalizes — which is **not one rule**:
   whitespace is collapsed in every block *except* code, whose content is preserved verbatim. A
   selection inside a fenced or indented code block therefore keeps its newlines and indentation.
   Applying the collapsing rule to all selections alike produces an `exact` that cannot occur in
   `doc.text`, so the anchor can never match at tiers 1–2 and the comment reports a spurious
   `addressed` off the resulting short fuzzy span (D18).
2. Capture up to 32 chars of normalized context either side.
3. Walk the DOM up from the selection start to the nearest `[data-line]` ancestor → `hintLine`.
4. Record `hintOffset`.

Reject selections shorter than 3 characters or longer than 500 with a user-facing message.

### `locate(anchor, doc): { start: number; end: number; confidence: number } | null`

Try in order, stopping at first success:

1. **Exact + context.** Search for `prefix + exact + suffix`. Confidence `1.0`.
2. **Exact, nearest to hint.** All occurrences of `exact`; pick the one closest to `hintOffset`.
   Confidence `0.9` if unique, `0.7` if disambiguated by proximity.
2b. **A code block matching once whitespace is ignored.** Whole blocks only, same confidences. Code
   is verbatim in anchor space, so an anchor whose newlines have been flattened cannot match above —
   which is the shape of every anchor written before D18, and of any a human writes by hand, since
   §11 invites hand-editing and nobody retypes a fence's indentation.
3. **Fuzzy near hint.** `diff-match-patch.match_main(text, exact, hintOffset)` with
   `Match_Threshold = 0.4`, `Match_Distance = 1000`. Confidence `0.5`.
4. **Fuzzy, whole document.** Same, `hintOffset = 0`, `Match_Threshold = 0.3`, and
   **`Match_Distance = max(1000, text.length / 0.01)`**. Confidence `0.3`.
5. Return `null` → comment becomes `orphaned`.

> **Why tier 4 needs its own `Match_Distance`.** diff-match-patch scores a candidate as
> `errors / pattern.length + |match_loc − expected_loc| / Match_Distance` and accepts only when
> the total is `<= Match_Threshold`. Inheriting `Match_Distance = 1000` from tier 3 means a
> *flawless* match at offset 301 scores `0.301` and is rejected — a "whole document" search that
> can only see the first ~300 characters, silently orphaning everything else.
>
> Tier 4 wants position to be irrelevant, and diff-match-patch offers no switch for that, so the
> proximity term has to be made negligible instead. Note that widening `Match_Distance` to merely
> the document length is *still* not enough: a flawless match at the far end of an N-character
> document would then score `N/N = 1.0`. The divisor is the share of the score budget proximity may
> consume at the furthest point in the document — 1% — which is where `text.length / 0.01` comes
> from. See Phase 1's `fuzzy.ts` for the accompanying size guard that keeps this within the
> performance budget.

Confidence below `0.5` must be surfaced in the UI as "position uncertain" rather than shown as a
confident anchor.

### `reanchor(reviewFile, newDoc): ReviewFile`

For each non-`resolved` comment: locate against the new document. If located and the anchored text
differs from `anchor.exact`, set `addressed` and populate `resolution` with before and after. If
located and identical, keep `open`. If not located, set `orphaned`.

`anchor.exact` — not `baselineText` — is the comparison basis. Copying the prompt twice would
otherwise silently redefine "before" on already-addressed comments, and `anchor.exact` is the text
as it stood when the user made the claim, which is what the comment is actually about.

> **Amended after the first real-agent run (D17).** This rule is correct and stays, but it is not
> the whole story, and shipping it alone made the product look broken.
>
> `anchor.exact` does two jobs: it is the *reference* — the passage the user pointed at — and the
> *evidence* that the comment was acted on. Those coincide only when the fix lands inside the
> selection. They come apart for every comment whose anchor **labels** the thing to fix rather than
> being it: a heading above a section, a list's intro line, any sentence followed by "add a caveat
> after this". The agent does the work, the anchored text never changes, the comment stays `open`
> forever, and the pane is indistinguishable from one where the agent never ran.
>
> The fix is **not** to widen `addressed`, which would trade the one status the user is asked to
> trust for a guess. It is a second, weaker, *derived* signal: the region around the comment — its
> section, for a heading anchor — differs from `baselineText`. The card says so and offers "Looks
> good"; nothing is inferred, nothing is persisted, and no fourth status exists. See §8.
>
> One claim above was also too strong: locating an anchor inside `baselineText` is not
> *unimplementable* — `locate` reads only `doc.text` — it is the block structure that is missing.
> The signal needs none, because it diffs the baseline into the *current* document's coordinates,
> where the block map is the one just rendered.

`baselineText` keeps its own jobs: the "document was rewritten — review the diff" banner, and the
section-change signal above.

### Required test cases (`anchor.test.ts`)

Do not consider this module done until all of these pass:

- Exact unique match
- Repeated identical phrases disambiguated by prefix/suffix
- Repeated identical phrases disambiguated by `hintOffset` when context also repeats
- Text unchanged but content inserted *above* it (line numbers shift, anchor must survive)
- Anchored sentence lightly reworded (fuzzy match succeeds, marked `addressed`)
- Anchored sentence deleted entirely (→ `orphaned`)
- Whole document restructured, anchored text intact but relocated far away
- Whole document rewritten from scratch (all → `orphaned`, no crash, no exception)
- Anchor spanning a markdown link — `[text](url)` renders as `text`
- Anchor spanning inline code and bold
- Anchor inside a table cell
- Anchor inside a fenced code block (code content is preserved verbatim, not normalized)
- Empty document
- Document containing only front matter
- 5 MB document (performance: `reanchor` of 50 comments must complete under 500 ms)
- Unicode: emoji, CJK, combining characters, RTL text

---

## 6. Webview requirements

### Rendering

- markdown-it with `html: false`, `linkify: true`, `typographer: false`
- GFM tables, task lists, strikethrough
- GitHub alerts render as titled callouts; the marker and title are not anchor text
- Footnotes: reference style, rendered at the end, no back arrow
- Fenced code with syntax highlighting (`highlight.js`, lazy-load languages)
- `mermaid` fences render as diagrams, loaded on demand, with a Diagram/Source switch; a reviewer
  comments by switching to Source and selecting text. An invalid diagram stays in Source view with
  one line giving Mermaid's message, and a view choice survives a re-render. Selecting text on a
  rendered diagram shows the hint "Switch to Source to comment on this diagram". The diagram SVG is
  sanitized with DOMPurify before injection
- Every block-level token gets `data-line="<start>"` from `token.map`
- Sanitize the final HTML with DOMPurify before injection
- Front matter (`---` at file start) rendered as a collapsed metadata block, excluded from anchor
  plain text

### Security — non-negotiable

- Strict CSP with a per-load nonce:
  `default-src 'none'; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource};`
- `localResourceRoots` limited to `media/` and the target file's directory
- All local resource URIs via `webview.asWebviewUri()`
- External links open via `vscode.env.openExternal`, never navigate the webview
- Never `eval`, never inject unsanitized file content
- Mermaid ships as a separate file loaded with the page nonce; the CSP allows no connection, which is what enforces no-network for it

### Theming

Use VS Code CSS variables throughout — `--vscode-editor-background`, `--vscode-editor-foreground`,
`--vscode-textLink-foreground`, `--vscode-panel-border`, `--vscode-editorWidget-background`,
`--vscode-focusBorder`. Verify against Dark+, Light+, and a high-contrast theme. Hardcoded colors
are a bug.

### Commenting interaction

- Selecting text shows a floating "Comment" button near the selection
- Clicking opens a popover with a textarea, `Cmd/Ctrl+Enter` to submit, `Esc` to cancel
- Committed comments render as a right-margin gutter card aligned to the anchor's vertical position
- The anchored span gets a subtle highlight; hovering a card emphasises its span and vice versa
- Cards stack without overlapping when anchors are close together
- Narrow panes (< 700 px) collapse the margin into inline expandable markers

### Comment sidebar / header bar

- Count of open / addressed / orphaned
- Filter by status
- **Copy review prompt** button (primary action, disabled when zero open comments)
- **Clear addressed** action
- Orphaned comments in a distinct section with the original text quoted, plus "delete" and
  "re-anchor manually" (select new text to re-attach)

### State

- Use `webview.getState()` / `setState()` for scroll position and filter state
- Do **not** set `retainContextWhenHidden` unless profiling proves it necessary — it's memory-expensive
- Implement `WebviewPanelSerializer` so panels survive a window reload

---

## 7. Prompt generation

`buildPrompt(reviewFile, openComments): string`

```
I've left review comments on `docs/auth.md`. Please revise the document to address them.

Edit the file directly. Don't add annotations, comments, or replies — just make the changes.
If you disagree with a comment or need clarification, tell me instead of guessing.

1. On: "retries failed requests up to three times"
   > Three is arbitrary here. Is it configurable? If not, say so explicitly.

2. On: "processes requests in parallel"
   > Concurrent or genuinely parallel? These aren't the same claim.

3. On the section "## Error handling"
   > This doesn't cover timeouts at all.
```

Rules:
- **Whole-document comments.** An open comment with no anchor is listed first, ordered by creation
  time then id, as `N. On the document as a whole:` followed by the body quoted as above. Anchored
  comments follow in document order, and the numbering runs through both groups.
- Truncate quoted anchor text over 100 chars with a middle ellipsis
- When an anchor covers an entire heading block, use the "On the section" phrasing
- **Repeated quotes (D1).** When the quoted text occurs more than once in the document (exact,
  case-sensitive; for a truncated quote the visible head is checked too), the line gains
  ` (under "<nearest preceding heading>", line N)`, or ` (line N)` with no preceding heading — e.g.
  `On: "the token" (under "## Refresh", line 42)`. `N` is the 1-based source line of the block (front
  matter counted). A repeated section heading names its parent heading and its own line:
  `On the section "## Examples" (under "# Auth", line 40)`. When the copies share one block the hint
  adds `, occurrence N of M in this paragraph` (`code block` in fenced code). Unique quotes and
  unlocatable comments keep the bare form above.
- **Agent notes (release-expansion D14, D18, D20, D47).** With `workspace` storage and a target inside
  a workspace folder, the third header line becomes
  ``If you disagree with a comment or need clarification, write that in plain words in `.reviews/<sidecar name without .json>.notes.md` instead of guessing, and mention the comment's number.``
  Otherwise (`global` storage, or a document outside every workspace folder) the sentence above is
  unchanged (D20). The notes file is free prose; the extension matches a mention of a comment's
  number to that comment and shows the rest as "Notes from the agent". The path is relative to the
  same folder as the target path on the prompt's first line. A "round" runs from one prompt to the
  next: copying the next prompt reads the file once more, deletes it only if what was read has been
  ingested, and clears the stored raw text and the dismissed record. A note stays until the user
  dismisses it or the agent writes a newer note for the same comment; dismissed chunks stay
  filtered within the round; unattached notes carry into the next round.
- Include the workspace-relative path so the user's `@`-mention is unambiguous
- Copy to clipboard via `vscode.env.clipboard.writeText`, then show an info message:
  *"3 comments copied. Paste into your agent and @-mention docs/auth.md."*
- **Snapshot `baselineText` at this moment** — this is what change detection diffs against
- **Sending:** `Send Review Prompt to Chat` opens VS Code chat with the prompt prefilled (`workbench.action.chat.open`, `isPartialQuery: true`); `Send Review Prompt to Terminal` focuses the active terminal and pastes the clipboard with `workbench.action.terminal.paste`. Nothing is submitted; the user presses Enter. The prompt is always on the clipboard first. Text is never typed into a terminal. If the target is unavailable the prompt stays copied, a message says so, and the baseline is still snapshotted.

---

## 8. Change detection

- Subscribe to `vscode.workspace.onDidChangeTextDocument`, filtered to the target file
- Debounce 400 ms
- Also handle `onDidChangeTextDocument` for files not open in an editor: agents may write to disk
  directly, so additionally use a `FileSystemWatcher` on the target path
- On change: re-render → re-anchor → persist sidecar → post updated state to webview
- Never auto-close comments. `addressed` is a *suggestion* the user confirms; the card shows the
  before/after text and a "Looks good" button that moves it to `resolved`
- **The section-change signal (D17).** An `open` comment whose *region* differs from `baselineText`,
  while its own anchored text does not, carries a note — "The text around this changed since you copied the
  prompt" — and the same "Looks good". The region is the enclosing section when the anchor lies in a
  heading, and the block(s) it covers otherwise; one shared rule decides this and PRD §7's "On the
  section" phrasing, so the prompt and the detector cannot disagree about what a heading anchor
  means.

  It is **not a status** and is never stored: it is recomputed per render from the baseline and the
  document, so there is no sidecar change and nothing to migrate. It is suppressed when there is no
  baseline, for comments created after the baseline was taken, and by
  `markdownReview.autoDetectResolution: false`.

  Deliberately weaker than `addressed`, in wording and in styling. `addressed` claims the text you
  selected changed; this claims only that something near your comment moved, and leaves the judgement
  to the reader — which is the honest thing to say, and keeps the strong claim worth trusting.

---

## 9. Manifest

```jsonc
{
  "name": "markdown-review",
  "displayName": "Markdown Review",
  "description": "Comment on markdown documents and hand your review to any AI agent.",
  "version": "0.1.0",
  "publisher": "<your-publisher-id>",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Other", "Notebooks"],
  "keywords": ["markdown", "review", "comments", "ai", "agent"],
  "icon": "media/icon.png",
  "repository": { "type": "git", "url": "https://github.com/<you>/markdown-review" },
  "license": "MIT",
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "markdownReview.open", "title": "Markdown Review: Open Review Pane", "icon": "$(comment-discussion)" },
      { "command": "markdownReview.copyPrompt", "title": "Markdown Review: Copy Review Prompt" },
      { "command": "markdownReview.sendPromptToChat", "title": "Markdown Review: Send Review Prompt to Chat" },
      { "command": "markdownReview.sendPromptToTerminal", "title": "Markdown Review: Send Review Prompt to Terminal" },
      { "command": "markdownReview.clearAddressed", "title": "Markdown Review: Clear Addressed Comments" },
      { "command": "markdownReview.clearAll", "title": "Markdown Review: Clear All Comments" }
    ],
    "menus": {
      "editor/title": [
        { "command": "markdownReview.open", "when": "resourceLangId == markdown", "group": "navigation" }
      ],
      "explorer/context": [
        { "command": "markdownReview.open", "when": "resourceLangId == markdown", "group": "navigation" }
      ]
    },
    "configuration": {
      "title": "Markdown Review",
      "properties": {
        "markdownReview.author": {
          "type": "string", "default": "",
          "description": "Name attached to your comments. Defaults to your system username."
        },
        "markdownReview.storageLocation": {
          "type": "string", "enum": ["workspace", "global"], "default": "workspace",
          "markdownDescription": "`workspace` writes to `.reviews/` (shareable via git). `global` keeps comments private to your machine."
        },
        "markdownReview.autoDetectResolution": {
          "type": "boolean", "default": true,
          "description": "Mark comments as addressed when their anchored text changes."
        }
      }
    }
  }
}
```

Note: modern VS Code infers activation from `contributes.commands`, which covers every entry point
the user initiates. Activation must stay lazy, so the manifest declares exactly these two explicit
`activationEvents`, and no others:

- `onWebviewPanel:markdownReview.panel`, so a review pane restored after a window reload wakes the
  extension (Plan 04 §10 D24).
- `workspaceContains:.reviews/*.json`, so a workspace that already holds reviews shows its status
  bar item and Explorer badges without a pane open (product-improvements D3). Every other
  workspace stays unwoken.

Do **not** use `onStartupFinished` or a language event such as `onLanguage:markdown`: both would
wake the extension for every window or every Markdown file.

---

## 10. Build order

Each phase must be independently verifiable. Do not start a phase before the previous one's
acceptance criteria pass.

**Phase 1 — Anchoring core.** `anchor/` and `render/plaintext.ts` only, no VS Code imports.
*Acceptance:* every test in §5 passes; `npm test` is green.

**Phase 2 — Read-only preview.** Webview panel, rendering, CSP, theming, `data-line` attributes.
*Acceptance:* opens on any `.md`, renders correctly in Dark+/Light+/high-contrast, no CSP
violations in the webview devtools console.

**Phase 3 — Commenting.** Selection → anchor → card, sidecar persistence, reload survival.
*Acceptance:* comments persist across window reload; sidecar JSON is human-readable and
hand-editable.

**Phase 4 — Prompt + detection.** Copy prompt, baseline snapshot, change watcher, re-anchor,
status inference, before/after display.
*Acceptance:* full loop works against a real agent editing the file; comments correctly flip to
`addressed`; a full document rewrite produces orphaned comments and no crash.

**Phase 5 — Ship.** Icon, README with an animated GIF of the loop, CHANGELOG, LICENSE,
`.vscodeignore`, `npx @vscode/vsce package` under 2 MB.

---

## 11. Failure modes to handle explicitly

| Scenario | Required behaviour |
|---|---|
| Agent rewrites the whole document | All comments orphan gracefully; banner offers "review the diff" |
| Sidecar JSON is corrupt or hand-edited badly | Fail soft — log, back up to `.json.bak`, start empty, tell the user |
| Target file deleted or renamed | Keep the sidecar; show "target missing" state; offer to re-link |
| No workspace folder open (single loose file) | Fall back to `globalStorageUri`, warn that comments aren't shareable |
| Two panels open on the same file | Single source of truth in `ReviewStore`; both panels receive updates |
| Very large file (> 2 MB) | Warn before rendering; consider virtualized rendering, or degrade to "too large" |
| Version skew in sidecar `version` field | Migrate forward if possible, otherwise refuse and explain — never silently drop data |

---

## 12. Marketplace release checklist

- [ ] Azure DevOps org + PAT scoped to **Marketplace: Manage**, "all accessible organizations"
- [ ] Publisher created; `publisher` field matches exactly
- [ ] 128×128 PNG icon
- [ ] README images use absolute URLs (relative paths break on the Marketplace)
- [ ] LICENSE file present
- [ ] `.vscodeignore` excludes `src/`, `node_modules/`, tests, `.vscode-test/`
- [ ] `npx @vscode/vsce package` → install the `.vsix` locally and test the full loop
- [ ] Verify on Windows (path separators in sidecar naming are a likely bug source)

---

## 13. Instructions to the implementing agent

- Build Phase 1 completely, with tests passing, before touching any VS Code API. The anchoring
  logic is where this extension succeeds or fails.
- Prefer boring, readable code over cleverness. This is a codebase a solo maintainer will return
  to in six months.
- No new dependencies beyond those listed in §3 without asking first.
- No telemetry, no network requests, no analytics. Ever.
- When a design decision here turns out to be wrong during implementation, stop and say so rather
  than silently working around it.
- Ask before adding anything from the §2 non-goals list.
