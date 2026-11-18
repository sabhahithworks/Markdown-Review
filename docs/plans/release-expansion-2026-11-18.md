# Release expansion: Mermaid, send, whole-document comments, agent notes, alerts, footnotes, CI (0.1.0)

Status: approved 2026-11-18, executing. Branch `release-expansion`. No PR.
Format: 3

## Context

Markdown Review 0.1.0 is built and verified but not published (`main` at `2198574`). The owner does not want to release and then release again soon with features that were already discussed, and has no deadline. This plan adds the four deferred features, two rendering gaps, CI and listing polish to 0.1.0, then re-runs the manual acceptance and the packaged checks once.

Evidence, checked this session:

- A ```` ```mermaid ```` fence renders as a plain code block: `src/render/renderer.ts:136` (`md.renderer.rules.fence`) has no Mermaid case, and the webview only highlights (`media/src/webview.ts:205`, `highlightAll`).
- The prompt can only be copied: `src/commands/copyPrompt.ts` writes the clipboard and nothing else.
- Every comment needs a passage: `addComment` requires `selectedText` and `offset` (`src/panel/messages.ts:128`), and `Comment.anchor` is required (`src/anchor/types.ts`).
- Pushback is lost: the prompt says "tell me instead of guessing" (`src/prompt/buildPrompt.ts:64`), so it lands only in the agent's chat.
- `mermaid@12.3.0`: `dist/mermaid.min.js` is 5,537,838 bytes raw and 1,586,019 gzipped (downloaded and measured). It contains 28 `fetch(` matches (mostly its math parser's own `fetch` method), so the name-based network guard (`scripts/check-bundles.mjs:23`, `NETWORK`) cannot pass on it. It defines `globalThis.mermaid`.
- The pane's CSP already allows inline styles (`src/panel/csp.ts:14`, `buildCsp`: `style-src … 'unsafe-inline'`) and allows no connection (`default-src 'none'`, no `connect-src`).
- Competitors (read 2026-11-18): MD Feedback and md-redline both render Mermaid; both need an MCP server or write markers into the file. Neither states whole-document comments or send-to-chat. md-redline has threads and a multi-file hand-off prompt. The check added no feature and removed none (D10).
- `Terminal.sendText` turns every newline into Enter (VS Code `terminalInstance.ts`), so a multi-line prompt must be pasted, never sent as text.
- Inside a tight list item the `<li>` carries the anchor offsets (`src/render/renderer.ts:285`, `carrierFor`), and the webview counts every non-block child's text as that block's anchor text (`media/src/anchorSpace.ts:90`, `buildBlockMap`). Any UI text placed inside such an item must therefore be skipped explicitly (D27).
- No `.github/` directory exists; `package.json` has `categories: ["Other"]` and 5 keywords.

An independent review (2026-11-18) found one blocker and eleven majors in the first draft. They are fixed here: D35, D27, D47–D52, and the briefs they touch.

## Decisions (binding)

From the discussion notes (`~/.claude/plans/mdcm/release-expansion/discussion.md`):

- **D1** Mermaid diagrams render in 0.1.0, and `mermaid` is an approved runtime dependency. Reason: AI-written specs contain them.
- **D2** Send-to-chat/terminal, whole-document comments and agent pushback all go into 0.1.0. Reason: one release, not two.
- **D3** The version stays 0.1.0 and a release delay is acceptable. Reason: nothing is tagged or published.
- **D4** O1 and O2 run after the new code lands. Reason: code changes invalidate the archive, so the manual runs are paid once.
- **D5** Pushback is added by amending PRD §2, not by working around it. Reason: CLAUDE.md "stop and say so".
- **D6** The blind acceptance run covers Claude Code, Copilot Chat, Cursor and Codex. Reason: agent-agnosticism is the core claim.
- **D7** GitHub Actions CI: `npm run check` on push and PR, plus a `windows-latest` job running the unit and integration suites. Reason: no CI exists and the manual Windows pass is impossible.
- **D8** GitHub alerts and footnotes render; one markdown-it plugin for each is approved.
- **D9** Listing and repo polish: the Marketplace `AI` category, better keywords, issue templates, `SECURITY.md`, a CI badge.
- **D10** The competitor check is done (Context). It changed nothing in the feature set.

Owner answers, 2026-11-18:

- **D11** Mermaid ships in full as a separate file, loaded only when a document contains a Mermaid block. The package budget rises from 500 KB to 2 MB.
- **D12** A diagram shows by default with a Diagram/Source switch. A reviewer comments by switching to Source and selecting text, as in any code block. A diagram whose source has comments shows a marker.
- **D13** Send targets are VS Code chat (prefilled) and the active terminal (pasted in one piece). Nothing is submitted; the user presses Enter. `Copy review prompt` stays the main button, and the prompt is also left on the clipboard.
- **D14** Pushback: the prompt asks the agent to write disagreements or questions in plain words into one notes file under `.reviews/`. The pane shows that text as "Notes from the agent" and attaches a note to its card when the agent mentions the comment's number.
- **D15** A whole-document comment stays `open` until the user resolves it. Its card is first in the column, labelled "Whole document". It is listed first in the prompt under "On the document as a whole:". Once the file has changed since the prompt it shows the hint "Document changed since the prompt".
- **D16** Of the extra candidates only "close D22 and B3c with tests" is in. Declined: a prompt for all files, KaTeX, a remote check box, web (vscode.dev) support.
- **D17** An invalid diagram stays in Source view with one line above it: `Mermaid could not render this diagram: <Mermaid's message>`.
- **D18** Wording, set 1 (verbatim):
  - Mermaid: switch `Diagram` / `Source`; loading `Rendering diagram…`; marker `2 comments in source` (`1 comment in source`).
  - Send: menu `Send to` with items `VS Code chat` and `Active terminal`; `3 comments placed in VS Code chat. Press Enter to send.`; `3 comments pasted into the terminal. Press Enter to send.`; `No terminal is open. The prompt was copied instead.`
  - Whole-document comment: button `Comment on document`; card label `Whole document`; hint `Document changed since the prompt`; prompt line `On the document as a whole:`.
  - Agent notes: section `Notes from the agent`; card label `Agent note`; prompt sentence ``If you disagree with a comment or need clarification, write that in plain words in `<notes file>` instead of guessing, and mention the comment's number.``
- **D19** An agent note stays until the user clicks Dismiss on it or the agent writes a newer note for the same comment. Copying or sending the next prompt only empties the notes file.
- **D20** Agent notes are off when `storageLocation` is `global` or the document is outside every workspace folder. The prompt then keeps today's sentence. The README and the setting's description say agent notes need `workspace` storage.
- **D21** The Mermaid file is exempt from the network name ban and gets a size cap only. The CSP enforces no-network for it; a unit test pins the CSP, and the layout harness gets the same CSP so a blocked request fails a check. The other two bundles keep the name ban.
- **D22** Wording, set 2 (verbatim):
  - Commands `Markdown Review: Send Review Prompt to Chat` and `Markdown Review: Send Review Prompt to Terminal`.
  - `VS Code chat is not available here. The prompt was copied instead.`
  - `Mermaid could not render this diagram: the diagram renderer failed to load`
  - Agent notes: `Dismiss` on a card's note and on the section; `Notes cut at 16,000 characters.`; setting description gains `Agent notes need \`workspace\` storage.`
  - Alert titles `Note`, `Tip`, `Important`, `Warning`, `Caution`.
  - Footnotes: `[1]` in the text linking to the note at the end of the document; no back arrow.
  - Composer heading `Comment on the whole document`, with the same buttons as a passage comment (`Comment`, `Cancel`).
- **D48** Words after an alert marker (`> [!NOTE] Read this first`) are shown as the callout's title in place of the default. Like the default title they are not anchor text.
- **D49** Wording, set 3 (verbatim): the hint `Switch to Source to comment on this diagram` when text on a rendered diagram is selected; the screen-reader announcement `The agent left notes.` when notes arrive.

Planner decisions:

- **D23** Packages: `mermaid@^12.3.0`; `markdown-it-github-alerts@^1.0.1` (no dependencies, 15 KB unpacked, peer `markdown-it >=13`; the repo is on `markdown-it@^15`); `markdown-it-footnote@^4.0.0` (no dependencies, 47 KB). `@mdit/plugin-alert` was rejected because it pulls a helper package.
- **D24** One lane, no contract phase. The only cross-boundary shape is `src/panel/messages.ts`, compiled into both bundles and type-checked by three tsconfig projects.
- **D25** The sidecar stays `version: 1`. Nothing was ever released, so no older build exists to read a new field. Every new field is optional and its guard accepts its absence. rule: `src/anchor/types.ts`, `src/store/reviewFile.ts`
- **D26** A whole-document comment is a `Comment` with no `anchor`. `anchor` becomes optional, and `isDocumentComment(comment)` is the one test for it. Reason: honest JSON, and the compiler flags every consumer.
- **D27** Mermaid does not change anchor space. The fence's source stays the block and `walkSpans` is untouched. The diagram wrapper is a sibling of the source `<pre>` and is marked `data-no-anchor="diagram"`; `buildBlockMap` skips every `[data-no-anchor]` subtree (B1), so its text never enters anchor space even inside a list item whose `<li>` carries the offsets. rule: `media/src/mermaid.ts`
- **D28** Mermaid loading: the build copies `node_modules/mermaid/dist/mermaid.min.js` to `media/mermaid.min.js` (no re-bundle). The webview loads it with a `<script>` element carrying the page nonce, from a URL relative to its own script. The CSP string and the shell are unchanged. Config: `startOnLoad: false`, `securityLevel: 'strict'`, `suppressErrorRendering: true`, `theme: 'base'`, `htmlLabels: false`. The SVG is sanitized again with DOMPurify before it reaches `innerHTML`. rule: `media/src/mermaidLoader.ts`
- **D29** Mermaid colours are read at runtime with `getComputedStyle` from VS Code theme variables that the harness presets already define, converted to hex, and passed as `themeVariables`. Diagrams re-render only when those computed values actually change, not on every class change.
- **D30** Footnotes: reference style only. Inline `^[…]` is disabled (GitHub does not support it, and its tokens carry no source line). The back arrow is not rendered, because its text would sit inside a block but outside anchor space. The `[1]` label is anchor text and comes from one helper shared by `plaintext.ts` and `renderer.ts`.
- **D31** Alerts use the plugin only to recognise the block. Our own renderer rule emits the markup: the default titles (D22) or the author's words (D48), escaped, with no icon and no plugin HTML. The `[!NOTE]` marker and the title are outside anchor space, and the title element is marked `data-no-anchor="title"`.
- **D32** The notes file is `.reviews/<sidecar base>.notes.md`, for example `.reviews/docs__specs__auth.md.notes.md`. It does not match `.reviews/*.json`, so activation and the review index ignore it.
- **D33** Attaching a note to a card. Input: the notes text, NFC-normalized, `\r\n` → `\n`. Chunks: split at blank lines and before every list-item line (`^[ \t]*(?:[-*+]|\d+[.)])[ \t]+`); each chunk is trimmed and holds no blank line. A chunk's numbers are every match of `#(\d{1,3})\b`, `\bcomments?\s+#?(\d{1,3})\b`, `\bitems?\s+#?(\d{1,3})\b` (case-insensitive) and a leading `^[ \t]*(\d{1,3})[.)][ \t]`, parsed to integers. A number attaches when `1 ≤ n ≤ promptOrder.length` (integers on both sides) and `promptOrder[n - 1]` is still a comment. A chunk with no attaching number is unattached. Nothing is dropped. rule: `src/detect/agentNotes.ts`
- **D34** `NOTES_MAX_CHARS = 16_000`. Longer notes are cut there and the D22 line is shown. Notes are rendered with `textContent` only, never as markup.
- **D35** Send mechanics. Chat: `workbench.action.chat.open` with `{ query, isPartialQuery: true }`. Terminal: write the clipboard, focus the terminal, then `workbench.action.terminal.paste`. `Terminal.sendText` is never used, in any fallback: in a shell without bracketed paste it would run each prompt line as a command. The baseline snapshot is taken after a successful hand-off, as for copy. Any failure falls back to copy with the approved message, and the baseline is still taken because the prompt is on the clipboard. If S4 cannot prove the paste, it stops for the owner. rule: `src/commands/promptTargets.ts`
- **D36** New commands `markdownReview.sendPromptToChat` and `markdownReview.sendPromptToTerminal`, available in the palette. Activation stays inferred from `contributes.commands`.
- **D37** "No network calls" binds shipped code only (L-no-network's scope is `src/**`, `media/src/**`), so CI on GitHub is allowed. CI jobs: `ubuntu-latest` (check, build, integration under `xvfb-run`) and `windows-latest` (unit, build, integration). Both set `PERF=0`: the 5 MB timing suite is not meaningful on a shared runner and stays a local gate.
- **D38** `SECURITY.md` lives at `.github/SECURITY.md` and points to GitHub private vulnerability reporting, so no email address is published. O2 enables that repo setting.
- **D39** `categories` becomes `["AI", "Other"]`. Keywords: `markdown`, `review`, `comments`, `ai`, `agent`, `annotations`, `feedback`, `mermaid`, `spec`, `prd`, `copilot`, `claude`, `cursor`, `codex`.
- **D40** `Comment on document` is in the header and also in the empty-state box, because the header is hidden at zero comments. In a narrow pane a whole-document comment gets a marker at the top of the document (D15).
- **D41** Law and doc amendments, each made in the phase that makes it true: L-no-network (D21), L-bundle-size (D11), L-innerhtml-sanitized-only (sanitized Mermaid SVG), L-prompt-prose-only and L-prd-non-goals (D14, D42), and the matching CLAUDE.md lines. rule: `.claude/laws.md`, `CLAUDE.md`
- **D42** Agent notes are not threads: one-way, plain text, no reply from the user, and never sent back to the agent in a later prompt. This is the PRD §2 amendment (D5).
- **D43** D22's code fix landed in Plan 06. Coverage is added in the layout harness (Dismiss sticks; an unreadable target leaves only **Locate file…**) and in `src/test/rewrite.test.ts`, so Part C opens no issue for D22 or B3c.
- **D44** `reanchor` skips whole-document comments: never `addressed`, never `orphaned`. Rewrite detection counts anchored comments only.
- **D45** Whole-document comments are numbered first in the prompt and are part of `promptOrder`.
- **D46** No new diagram size limit: Mermaid's own text limit produces its message through D17. `MERMAID_LOAD_TIMEOUT_MS = 10_000` covers a load that hangs.
- **D47** The notes lifecycle, refining D19. A "round" runs from one prompt to the next.
  - "Empties the notes file" is done by deleting it; the agent creates it again. It is deleted only when the content just read from it has been ingested.
  - Dismissing records the dismissed chunks' exact text. A recorded chunk is filtered out of every later read in the same round, so a dismissed note does not come back when the agent appends to the file.
  - A note the user has not dismissed is never removed by a new read: a comment's note is replaced only by a newer note for that comment, and unattached notes from earlier rounds are carried and shown ahead of the current round's.
  - Ending a round clears the stored raw text and the dismissed record, so the same words written again in the next round count as new.
- **D50** Scroll position survives the new blocks. Footnote blocks carry no `data-line`, because their source lines are earlier than their place in the page. A hidden diagram source is left out of the scroll line index and of `restoreScroll`. After each diagram settles the pane restores the saved line again, until the user's first wheel, touch, pointer or key input.
- **D51** CI1 runs right after phase 0, so every push during the work is checked on Linux and Windows. CI2, the recorded green run on the final code, stays after F.
- **D52** A diagram keeps its Diagram or Source view across re-renders, keyed by its position and source text. Clicking the card of a comment whose source is hidden reveals the source, in a wide pane as well as a narrow one.

Rejected (discussion): shipping 0.1.0 now and deferring Mermaid; a "not rendered" label only.

## UNCONFIRMED

- **U1** `workbench.action.terminal.paste` delivers multi-line text as one bracketed paste to a program that enabled bracketed-paste mode. Confirmed by S4's extension-host test. Blocks S4. There is no code fallback (D35): if it fails, S4 stops as `blocked` for the owner.
- **U2** The VS Code version that introduced `isPartialQuery`, and whether Cursor supports the command (a forum post says no). Not chased: S2 falls back to copy with the D22 message whenever the command is missing or throws, and O1 checks it in current VS Code and in Cursor.
- **U3** Mermaid runs under the pane's CSP without `'unsafe-eval'`. The bundle has three `Function("return this")()` fallbacks behind short-circuits and no `eval(`. Confirmed by M2's probe in a real browser, before anything is built on it. Blocks M2. Fallback: none is acceptable; `'unsafe-eval'` is never added, and M2 stops for the owner.
- **U4** `htmlLabels: false` yields SVG text labels. Confirmed by the same M2 probe (flowchart and sequence diagram) and again per theme in M6. Fallback in M4's brief: add `ADD_TAGS: ['foreignobject']` and `HTML_INTEGRATION_POINTS: { foreignobject: true }` to the sanitize options, mirroring Mermaid's own DOMPurify config.
- **U5** Plugin token shapes, read from source and not from an install: `alert_open` / `alert_close` with `meta.type` and `meta.title` (the default title, or the words after the marker), the option `matchCaseSensitive`, and `footnote_ref`, `footnote_block_open`, `footnote_open`, `footnote_anchor`, `footnote_close`, `footnote_block_close`. A1 and A2 print the token stream first; a difference is a `BRIEF GAP`.
- **U6** The integration suite passes on `windows-latest` and under `xvfb-run` on `ubuntu-latest`. First seen when the branch is pushed after CI1; recorded in CI2. Failures become new rows.
- **U7** The packaged `.vsix` lands near 1.7 MB. Measured in O2 against the 2 MB budget.
- **U8** When the terminal's program has not enabled bracketed paste (a plain shell), VS Code's own multi-line paste warning (`terminal.integrated.enableMultiLinePasteWarning`, default `auto`) asks before anything is typed. No code depends on it; O1 has a box for it.

## Edge matrix

| id | category | flow | case | expected | visible | phase | test |
|---|---|---|---|---|---|---|---|
| E1 | empty | render document | a `mermaid` fence with no content | plain code block, no switch, no error line (D12) | yes | M3 | `empty mermaid fence` |
| E2 | empty | render document | an alert with only its marker line | the title shows with no body; anchor space gains nothing (D31) | yes | A1 | `marker-only alert` |
| E3 | empty | render document | `[^x]` with no definition | stays literal text (D30) | yes | A2 | `undefined reference stays literal` |
| E4 | empty | agent notes | the notes file is empty or whitespace | nothing changes; notes already shown stay (D19) | yes | N3 | `blank notes file is ignored` |
| E5 | empty | copy or send prompt | only whole-document comments are open | the prompt lists them under "On the document as a whole:" (D15) | yes | W2 | `only document comments` |
| E6 | limit | agent notes | notes longer than 16,000 characters | cut there, with "Notes cut at 16,000 characters." (D22, D34) | yes | N1 | `cuts at NOTES_MAX_CHARS` |
| E7 | limit | render document | a diagram over Mermaid's own text limit; many diagrams in one document | Mermaid's message through the D17 line; diagrams render one after another | yes | M3 | `render error shows the reason` |
| E8 | limit | render document | a shipped bundle outgrows its cap | the build fails naming the file and the cap | no | M1 | `MERMAID_BUNDLE` |
| E9 | invalid | render document | invalid Mermaid syntax | Source view plus the reason line (D17) | yes | M3 | `render error shows the reason` |
| E10 | invalid | render document | words after an alert marker; a quote nested in an alert | the words become the title (D48); the nested quote renders inside the alert | yes | A1 | `words after the marker become the title` |
| E11 | invalid | agent notes | a note cites `#99`, or a comment that was deleted | the chunk goes to "Notes from the agent" (D14, D33) | yes | N1 | `out-of-range number stays unattached` |
| E12 | invalid | whole-document comment | the webview posts a non-string or blank body | the guard rejects it; a blank body adds nothing | no | W3 | `rejects a non-string body` |
| E13 | invalid | comment on a diagram | a commented source is edited until the diagram is invalid | Source view with the reason line; the comment is highlighted on the visible source (D17) | yes | M5 | `rectFor returns undefined in Source view` |
| E14 | failure | render document | `mermaid.min.js` fails to load | Source view plus the D22 load-failure line | yes | M3 | `load failure shows the reason` |
| E15 | failure | copy or send prompt | the chat command is missing or throws (Cursor, old VS Code); no terminal is open | the prompt is copied and the exact D18 or D22 fallback message shows | yes | S2 | `falls back to copy` |
| E16 | failure | agent notes | the notes file cannot be read or deleted | logged with the path; the prompt is still delivered; shown notes stay | no | N3 | `unreadable notes file is logged` |
| E17 | partial | copy or send prompt | the clipboard is written but the chat or terminal step fails | fallback message; the baseline is taken because the prompt is on the clipboard (D13, D35) | yes | S2 | `falls back to copy` |
| E18 | partial | agent notes | the agent saves the notes file several times in one round | each change is read again; a comment's note follows its newest chunk (D19) | yes | N3 | `re-ingest replaces` |
| E19 | retry | copy or send prompt | Send twice in a row | each send delivers again and re-snapshots, as copying twice does (D13) | yes | S2 | `second send re-snapshots` |
| E20 | retry | agent notes | a note is dismissed, then the agent appends an unrelated note | the dismissed chunk does not return; the new chunk shows (D19, D47) | yes | N3 | `dismissed chunk stays dismissed when the file grows` |
| E21 | retry | comment on a diagram | the pane re-renders after a comment was made in Source view | the block stays in Source view (D52) | yes | M3 | `view survives a refresh` |
| E22 | concurrency | agent notes | the agent writes between the pre-prompt read and the end of the round | the file is read again and ingested against the old numbering before it is deleted (D47) | no | N3 | `late write is ingested before the round ends` |
| E23 | concurrency | agent notes | two panes on one file while the agent writes notes | one store ingests and both panes show the same notes | no | N3 | review: single store owns ingest |
| E24 | interrupt | render document | new content arrives while diagrams are rendering | the stale render is discarded and never painted | no | M3 | `stale render is discarded` |
| E25 | interrupt | render document | the pane re-renders while the reader is in the footnotes or below a diagram | the reading position is kept (D50) | yes | A2 | `footnote blocks carry no data-line` |
| E26 | timeout | render document | the Mermaid script never finishes loading | after `MERMAID_LOAD_TIMEOUT_MS` the D22 load-failure line shows | yes | M2 | `times out` |
| E27 | permission | agent notes | `storageLocation` is `global`, or the file is outside the workspace | notes are off and the prompt keeps today's sentence (D20) | yes | N2 | `no notes path keeps the old sentence` |
| E28 | old-state | whole-document comment | a sidecar written before this change; a sidecar holding a comment with no anchor | both load and round-trip; `version` stays 1 (D25) | no | W1 | `comment without an anchor is valid` |
| E29 | old-state | agent notes | unattached notes from the last round that were not dismissed | carried into the next round and shown first (D19, D47) | yes | N3 | `unattached notes carry over` |
| E30 | environment | agent notes | a Windows-style document path | the notes path in the prompt uses forward slashes | no | N2 | `uses forward slashes on Windows` |
| E31 | environment | agent notes | a multi-root workspace | the notes path is relative to the same folder as the document path on the prompt's first line | no | N2 | review: same base as targetPath |
| E32 | environment | copy or send prompt | the terminal's program has no bracketed paste (cmd.exe, plain sh) | the extension only pastes; VS Code's own multi-line warning asks first, and no prompt line is typed as a command (D35) | yes | S2 | `sendText` |
| E33 | time | agent notes | the agent wrote notes while the extension was not running | they are ingested on load against the stored `promptOrder`, before any new snapshot (D19) | yes | N4 | `ingests before the snapshot` |
| E34 | time | agent notes | a note for prompt N is written after prompt N+1 was copied | it is read against the current numbering; the note's own words are shown, so nothing is lost (D14, D33) | yes | N3 | review: cannot be told apart |
| E35 | security | render document | a diagram label containing `<script>` or an event handler | removed by `securityLevel: 'strict'` and the second sanitize | no | M4 | `script in a label is removed` |
| E36 | security | agent notes | notes text containing HTML | shown as text, never parsed | no | N5 | `renders markup as text` |
| E37 | security | copy or send prompt | prompt text reaching a shell | never typed by the extension; pasted only (D35) | no | S2 | `sendText` |
| E38 | feedback | render document | a diagram is still rendering | "Rendering diagram…" shows until it is replaced (D18) | yes | M3 | `shows the loading line` |
| E39 | feedback | comment on a diagram | text on the rendered diagram is selected | the hint "Switch to Source to comment on this diagram" (D49) | yes | W4 | `a selection on a diagram shows the diagram hint` |
| E40 | feedback | copy or send prompt | a send succeeds | the D18 message for that target | yes | S1 | `promptSentMessage` |
| E41 | accessibility | render document | the Diagram/Source switch by keyboard and screen reader | two buttons with `aria-pressed`, reachable by Tab (D12) | yes | M3 | `switch is keyboard operable` |
| E42 | accessibility | copy or send prompt | the Send menu by keyboard | opens with Enter, moves with arrows, closes with Escape and returns focus (D18) | yes | S3 | `menu opens with Enter and closes with Escape` |
| E43 | accessibility | whole-document comment | a narrow pane with no margin | a marker at the top of the document opens the card (D15, D40) | yes | W5 | `narrow pane shows a marker at the top` |
| E44 | accessibility | agent notes | notes arrive while a screen reader is in the pane | "The agent left notes." is announced once (D49) | yes | N5 | `announces new notes once` |

## Execution model

- Branch `release-expansion` off `main`; it later PRs into `main`. The commit subject tag is `(release-expansion <phase>)`.
- There is one lane, `app` (repo root), so phases run one after another and there is no contract phase. Each phase is briefed for the `plan-engine:implementer` agent. Only F, which has no CHANGE, is run by Opus. Opus reviews every diff against its brief.
- Repo rules come from `.claude/laws.md` (via `laws.py`) plus `CLAUDE.md`. Every code phase carries L-no-new-suppressions, L-changelog-unreleased, L-starter-tests-assert-values, L-starter-no-swallowed-errors, L-starter-error-path, L-starter-no-duplicate-helper, L-starter-limits-in-config, L-no-vsce-publish and L-no-ovsx-publish; each brief adds the ones specific to its files.
- The profile has no `docs.check` and no `docs.feature_index`, so F runs `cite-shift.py` and the gates only.
- `CHANGELOG.md` gets its entry in the phase that makes a feature visible to the user, named in that phase's CHANGE.
- To resume, run `/plan-engine:run-phase`. It picks the next row in §Progress by the rule there.

## Phases

### 0: Branch and plan (lane: docs, kind: docs)

GOAL: The plan is committed on a fresh branch, so every later phase starts from a recorded plan.
READ FIRST: `docs/plans/README.md:9-20`, for the phase-map table to extend.
CHANGE:
- First run `git switch -c release-expansion` from `main`.
- `docs/plans/release-expansion-2026-11-18.md`: a copy of this plan, taken from the approved plan-mode file `~/.claude/plans/spicy-frolicking-acorn.md`.
- `docs/plans/README.md`: add the row `| 8 | [release-expansion-2026-11-18.md](release-expansion-2026-11-18.md) | Mermaid, alerts, footnotes, send, whole-document comments, agent notes, CI, release | Phase 7 |`.
MIRROR: `docs/plans/README.md:19`.
INVARIANTS: L-no-vsce-publish, L-no-ovsx-publish.
DECIDED: D3.
OUT OF SCOPE: all code.
ACCEPTANCE: `git log -1 --stat` shows the two files; `git branch --show-current` prints `release-expansion`.
FAILURE PATHS: none: this phase only copies and commits documents.
Depends on: none.
Entry check: `git status --porcelain docs/plans/README.md | wc -l` prints 0, and `git rev-parse --abbrev-ref HEAD` is `main`.
Done: committed, tracker row updated.

### CI1: GitHub Actions workflow and repo files (lane: infra)

GOAL: Every push to `main` and every pull request runs the checks on Linux and the unit and integration suites on Windows, and the repo has issue templates and a security policy.
READ FIRST: `package.json:140-160` (`scripts`); `docs/plans/06-production-hardening.md:236-240` (E7); `src/test/integration/run.ts`; `.vscodeignore` (`.github/**` is already excluded from the package).
CHANGE:
- `.github/workflows/ci.yml`: new. `on: push` (branch `main`) and `pull_request`; `permissions: contents: read`; `env: PERF: '0'` at workflow level. Job `check` on `ubuntu-latest`: `actions/checkout@v4`, `actions/setup-node@v4` (Node 20, npm cache), `npm ci`, `npm run check`, `npm run build`, `xvfb-run -a npm run test:integration`. Job `windows` on `windows-latest`: the same setup, then `npm test`, `npm run build`, `npm run test:integration`. A comment states that the no-network rule binds the shipped extension, not CI, and why `PERF` is off (D37).
- `.github/ISSUE_TEMPLATE/bug_report.yml`: fields for what happened, what was expected, steps, the extension version, the VS Code version and OS, and which agent was used.
- `.github/ISSUE_TEMPLATE/feature_request.yml`: the problem, the proposed behaviour, alternatives.
- `.github/ISSUE_TEMPLATE/config.yml`: `blank_issues_enabled: false`, and a contact link to the repository's security advisories page for vulnerabilities.
- `.github/SECURITY.md`: supported version (0.1.x), how to report through GitHub private vulnerability reporting, and the extension's security model (no network calls, strict CSP, sanitized rendering). No email address.
MIRROR: none: the repo has no `.github/` yet.
INVARIANTS: L-no-vsce-publish and L-no-ovsx-publish (the workflow never publishes and holds no token); L-no-network (unchanged: it scopes shipped code).
DECIDED: D7, D9, D37, D38, D51. Expected decision: Node version. Default: 20, matching the `node20` build target in `esbuild.mjs`.
OUT OF SCOPE: release or publish jobs; a macOS job; the README badge and the manifest (P1).
ACCEPTANCE: `ruby -ryaml -e 'y = YAML.load_file(".github/workflows/ci.yml"); abort("jobs") unless y["jobs"].keys.sort == ["check", "windows"]'` exits 0; `ruby -ryaml -e 'Dir[".github/ISSUE_TEMPLATE/*.yml"].each { |f| YAML.load_file(f) }'` exits 0; `grep -c "xvfb-run -a npm run test:integration" .github/workflows/ci.yml` prints 1; `grep -c "vsce\|ovsx" .github/workflows/ci.yml` prints 0; `grep -c "@" .github/SECURITY.md` prints 0.
FAILURE PATHS: A failing step fails its job and the run; no step uses `continue-on-error`. The first recorded green run is CI2.
Depends on: 0.
Entry check: `ls .github 2>/dev/null | wc -l` prints 0.
Done: committed, tracker row updated.

### B1: Text marked no-anchor is skipped inside a block (lane: app)

GOAL: Text inside an element marked `data-no-anchor` is never counted as anchor text, wherever the element sits; nothing visible changes yet.
READ FIRST: `media/src/anchorSpace.ts:90-170` (`buildBlockMap` and its `walk`); `media/src/selection.ts:226-245` (`capture`, the `data-no-anchor` check); `media/src/selection.ts:335-342` (the rejection hints); `src/render/renderer.ts:277-295` (`carrierFor`: a tight list item's `<li>` carries the offsets); `media/test/anchorSpace.test.ts`; `docs/plans/03-commenting.md` §9 (L-anchor-space-corrections-first).
CHANGE:
- `media/src/anchorSpace.ts`: in `walk`, skip any child element that has the `data-no-anchor` attribute, before the `isBlock` check.
- `media/src/selection.ts`: `capture` returns the `front-matter` rejection only when the closest `[data-no-anchor]` element's value is `true`; for any other value it returns `{ ok: false, reason: undefined }`.
- `media/test/anchorSpace.test.ts`: the two tests in ACCEPTANCE.
- `docs/plans/03-commenting.md`: one line in §9 recording the rule and why (release-expansion D27).
MIRROR: `media/src/anchorSpace.ts:140-160` (the `isBlock` and image branches of `walk`).
INVARIANTS: L-block-offsets-single-source (no boundary is derived; a subtree is only left out of a block's text); L-anchor-space-corrections-first; L-webview-imports-messages-only.
DECIDED: D27, D31. Front matter keeps the value `true` and its hint.
OUT OF SCOPE: marking anything `data-no-anchor` (A1 and M3 do); a new hint (M4). Importers checked and not edited in this phase unless the compiler or a failing test names them: `roundTrip.test.ts`, `generate.mjs`, `changes.ts`, `comments.ts`, `webview.ts`, `create.ts`.
ACCEPTANCE: `npx vitest run --project webview media/test/anchorSpace.test.ts`, then `npm run check`, which also runs the round-trip suite. New tests:
- `no-anchor subtree inside a block is skipped`: for an `<li data-ap-start="0" data-ap-end="4">` holding `item`, then a `<div>` with `<p data-no-anchor="title">Note</p>` and a nested block `<p data-ap-start="5" data-ap-end="9">Body</p>`, `blockText(li)` is `item`.
- `a nested block beside a no-anchor subtree keeps its own text`: `blockText` of the nested `<p>` is `Body`.
FAILURE PATHS: none: a pure DOM walk. An element with the attribute and no text changes nothing.
Depends on: CI1.
Entry check: `grep -c "data-no-anchor" media/src/anchorSpace.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### A1: GitHub alerts render as callouts (lane: app)

GOAL: A `> [!NOTE]` block renders as a titled callout (Note, Tip, Important, Warning, Caution, or the author's own words after the marker) instead of a quote starting with a literal `[!NOTE]`.
READ FIRST: `src/render/markdownIt.ts:13-30` (`createMarkdownIt`); `src/render/plaintext.ts:77-218` (`walkSpans`: every `nesting === 1` token pushes a frame, so a container token needs no case); `src/render/renderer.ts:97-160` (`createRenderMarkdownIt`, the `fence` rule as a hand-built rule that forwards attributes); `src/render/renderer.ts:256-295` (`stampAnchorSpace`, `carrierFor`); `src/types/markdown-it-task-lists.d.ts` (how a plugin without types is declared); `docs/plans/03-commenting.md` §9 (L-anchor-space-corrections-first).
CHANGE:
- `package.json`: add `"markdown-it-github-alerts": "^1.0.1"` to `dependencies`, and run `npm install` so `package-lock.json` follows.
- `package-lock.json`: updated by that install.
- `src/render/markdownIt.ts`: `md.use(githubAlerts, { matchCaseSensitive: false })` after the task-lists plugin. First print `md.parse('> [!NOTE] Read this\n> Body', {})` once to confirm U5, including what `meta.title` holds.
- `src/render/renderer.ts`: in `createRenderMarkdownIt`, set `md.renderer.rules.alert_open` and `md.renderer.rules.alert_close`. `alert_open` returns `<div class="mr-alert mr-alert-<type>"` + the forwarded `data-line` attribute + `><p class="mr-alert-title" data-no-anchor="title"><Title></p>`. `<type>` is `token.meta.type` lower-cased and accepted only from `ALERT_TITLES`, a module constant `{ note: 'Note', tip: 'Tip', important: 'Important', warning: 'Warning', caution: 'Caution' }`; an unknown type is rendered as `note`. `<Title>` is `token.meta.title` trimmed when it is not empty, else `ALERT_TITLES[type]`, passed through `md.utils.escapeHtml`. `alert_close` returns `</div>\n`. No icon and no plugin HTML.
- `media/webview.css`: `.mr-alert` (left border, padding, block margin) and `.mr-alert-title` (bold). The border and title colour per type: note `--vscode-charts-blue`, tip `--vscode-charts-green`, important `--vscode-charts-purple`, warning `--vscode-editorWarning-foreground`, caution `--vscode-charts-red`. All five already exist in `dev/harness/themes.css`.
- `docs/fixtures/rich-blocks.md`: a new fixture with a heading, one paragraph, one alert of each of the five types (one with two paragraphs, one with words after the marker), and one alert inside a tight list item.
- `src/test/plaintext.test.ts`: a `describe('alerts (release-expansion D31)')` block with the tests in ACCEPTANCE.
- `src/test/renderer.test.ts`: add the `rich-blocks` fixture to the three fixture lists (`:86`, `:297`, `:321`), plus the markup tests in ACCEPTANCE.
- `media/test/roundTrip.test.ts`: add the `rich-blocks` fixture wherever it iterates fixtures, so the webview's block text is compared with the host's for the list-nested alert.
- `MARKDOWN_REVIEW_PRD.md`: §3 dependency table gains the plugin row; §6 Rendering gains "GitHub alerts render as titled callouts; the marker and title are not anchor text".
- `CHANGELOG.md`: `Unreleased` → Added entry.
MIRROR: `src/render/renderer.ts:136` (the `fence` rule) for a hand-built rule; `src/test/plaintext.test.ts` existing `describe` blocks.
INVARIANTS: L-block-offsets-single-source (`walkSpans` is not given an alert case unless the printed tokens require one); L-anchor-space-corrections-first; L-webview-security (the title is escaped); L-theme-vars-only; L-state-not-by-colour-alone (the title text names the type); L-vscode-free-core; L-errors-as-values; L-no-new-deps (approved in D8, D23); L-bundle-size; L-reanchor-perf.
DECIDED: D8, D22 (default titles), D23, D31, D48.
OUT OF SCOPE: footnotes; Mermaid; icons; `docs/fixtures/kitchen-sink.md` (its bytes are asserted). `src/render/plaintext.ts` is expected to need no change; if the printed tokens show otherwise, stop with `BRIEF GAP`. Importers checked and not edited in this phase unless the compiler or a failing test names them: `markdownIt.test.ts`, `anchorSpace.test.ts`, `changes.test.ts`, `generate.mjs`, `ReviewPanel.ts`, `csp.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/plaintext.test.ts src/test/renderer.test.ts`, `npx vitest run --project webview media/test/roundTrip.test.ts`, then `npm run check`, `node esbuild.mjs`, `npm run lint:css` and `npm run lint:bundles`. New tests:
- `alert marker and title are outside anchor space`: `renderPlainText('> [!NOTE]\n> Keep this.\n').text` equals `Keep this.`.
- `marker-only alert`: `renderPlainText('> [!TIP]\n')` has empty `text` and no blocks. If the plugin leaves a marker-only quote as a blockquote, assert that parse instead and say so in the tracker note.
- `lowercase marker is an alert`: `> [!warning]\n> x` gives text `x`.
- `ordinary blockquote is unchanged`: `> plain quote` gives text `plain quote`.
- `words after the marker become the title`: `> [!NOTE] Read this first\n> Body` gives text `Body` and HTML containing `<p class="mr-alert-title" data-no-anchor="title">Read this first</p>`.
- `a nested quote stays inside the alert`: `> [!NOTE]\n> > inner` gives text `inner` and a `<blockquote>` inside the `mr-alert` div.
- `alert renders its own markup`: the HTML contains `<div class="mr-alert mr-alert-warning"`, `>Warning</p>` and no `<svg`.
- `alert body carries anchor offsets`: the body `<p>` has `data-ap-start="0"`.
- `title text is escaped`: `> [!NOTE] <b>x</b>` renders `&lt;b&gt;x&lt;/b&gt;` in the title.
FAILURE PATHS: An unknown alert type renders as `note`. An alert with no body renders the title alone. Empty input is unchanged from today.
Depends on: B1.
Entry check: `grep -c "markdown-it-github-alerts" package.json` prints 0.
Done: tests pass, committed, tracker row updated.

### A2: Footnotes render (lane: app)

GOAL: `[^1]` renders as a `[1]` link to the footnote text at the end of the document, and both the label and the footnote text can be commented on.
READ FIRST: `src/render/plaintext.ts:233-262` (`inlineText`, where an inline child type adds text); `src/render/plaintext.ts:77-218` (`walkSpans`, frames inherit `map`); `src/render/renderer.ts:97-125` (`createRenderMarkdownIt`, the `markdown_review_data_line` core rule); `media/src/anchorSpace.ts:90-170` (`buildBlockMap`: every DOM text node inside a block must also be in anchor space); `media/src/webview.ts:397-407` (`restoreScroll` stops at the first `data-line` above the saved line); `media/src/selection.ts:276-286` (`nearestDataLine`); `docs/plans/03-commenting.md` §9.
CHANGE:
- `package.json`: add `"markdown-it-footnote": "^4.0.0"`, and run `npm install`.
- `package-lock.json`: updated by that install.
- `src/types/markdown-it-footnote.d.ts`: a module declaration, only if the package ships no types.
- `src/render/markdownIt.ts`: `md.use(footnote)`, then `md.inline.ruler.disable('footnote_inline')` (D30). First print the token stream of `'A[^1].\n\n[^1]: Note.\n'` to confirm U5.
- `src/render/plaintext.ts`: export `footnoteCaption(token: MarkdownIt.Token): string`, returning `[<meta.id + 1>]`, or `[<meta.id + 1>:<meta.subId>]` when `meta.subId > 0`. `inlineText` gains `case 'footnote_ref': out += footnoteCaption(child)`.
- `src/render/renderer.ts`: `md.renderer.rules.footnote_caption = (tokens, idx) => footnoteCaption(tokens[idx])` and `md.renderer.rules.footnote_anchor = () => ''` (no back arrow). The `markdown_review_data_line` rule sets no `data-line` on tokens between `footnote_block_open` and `footnote_block_close` (D50); `data-ap-start` and `data-ap-end` are still stamped there.
- `media/webview.css`: `.footnotes` (smaller text, top border from `--vscode-panel-border`), `.footnote-ref` (superscript link).
- `docs/fixtures/rich-blocks.md`: append a section with two footnote references, one of them repeated, and their definitions placed before the last paragraph.
- `src/test/plaintext.test.ts`: `describe('footnotes (release-expansion D30)')`.
- `src/test/renderer.test.ts`: the markup tests in ACCEPTANCE.
- `MARKDOWN_REVIEW_PRD.md`: §3 table row; §6 Rendering line "Footnotes: reference style, rendered at the end, no back arrow".
- `CHANGELOG.md`: `Unreleased` → Added entry.
MIRROR: `src/render/plaintext.ts:233` (`inlineText`'s `image` case) for an inline child that adds text.
INVARIANTS: L-block-offsets-single-source (one caption helper feeds both the plain text and the DOM); L-anchor-space-corrections-first; L-webview-security; L-theme-vars-only; L-vscode-free-core; L-errors-as-values; L-no-new-deps (D8, D23); L-bundle-size; L-reanchor-perf (`npx vitest run --project node src/test/perf.test.ts` stays green).
DECIDED: D8, D22 (footnote wording), D23, D30, D50. Expected decision: whether footnote blocks need a `BlockKind` of their own. Default: no, they are `text`.
OUT OF SCOPE: inline footnotes; a back arrow; reordering footnote text into source order. Known and accepted: a footnote's blocks sit last in anchor space while their source lines are earlier, so `create.ts`'s `hintLine` fallback can pick another block, and a selection inside a footnote reports whatever line `nearestDataLine` returns with no `[data-line]` ancestor; `locate` still finds the text by its content and offset. Importers checked and not edited in this phase unless the compiler or a failing test names them: `markdownIt.test.ts`, `anchorSpace.test.ts`, `changes.test.ts`, `roundTrip.test.ts`, `anchor.test.ts`, `changedRanges.test.ts`, `helpers.ts`, `detection.spec.ts`, `store.spec.ts`, `generate.mjs`, `locate.ts`, `reanchor.ts`, `copyPrompt.ts`, `baselineDocuments.ts`, `changedRanges.ts`, `scope.ts`, `ReviewPanel.ts`, `buildPrompt.ts`, `frontMatter.ts`, `csp.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/plaintext.test.ts src/test/renderer.test.ts`, then `npm run check` (which also runs the round-trip and timing suites), `node esbuild.mjs`, `npm run lint:css` and `npm run lint:bundles`. New tests:
- `footnote reference label is anchor text`: `'Text[^1] more.\n\n[^1]: The note.\n'` gives text `Text[1] more.\nThe note.`.
- `footnote text sits at the end of anchor space`: a definition written before a later paragraph still comes last.
- `undefined reference stays literal`: `See [^nope].` gives `See [^nope].`.
- `inline footnote syntax is not parsed`: `A^[inline] b` is literal.
- `repeated reference`: the second reference to one note reads `[1:1]`.
- `footnote reference links to its note`: the HTML contains `href="#fn1"` and `id="fn1"`.
- `no back arrow`: the HTML does not contain `footnote-backref`.
- `footnote blocks carry no data-line`: inside `<section class="footnotes">` no element has `data-line`, and the footnote's `<p>` has `data-ap-start`.
FAILURE PATHS: An undefined reference and an unused definition both render as the plugin leaves them (literal text, or no entry) without an error. Empty input is unchanged.
Depends on: A1.
Entry check: `grep -c "markdown-it-footnote" package.json` prints 0, and `grep -c "mr-alert" media/webview.css` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### M1: Ship Mermaid as its own file, with a size cap (lane: app)

GOAL: `npm run build` produces `media/mermaid.min.js` beside the webview bundle, guarded by a size cap, with the no-network rule for it stated and enforced by the CSP.
READ FIRST: `esbuild.mjs:40-60` (`builds`) and `esbuild.mjs:100-112` (the size report); `scripts/check-bundles.mjs:1-56` (why bans name APIs; `NETWORK`, `BUNDLES`) and `:72-104` (the loop); `src/panel/csp.ts:1-20` (`buildCsp`); `src/test/csp.test.ts:14-32`; `.gitignore`; `.vscodeignore`.
CHANGE:
- `package.json`: add `"mermaid": "^12.3.0"` to `dependencies`, and run `npm install`.
- `package-lock.json`: updated by that install.
- `esbuild.mjs`: after the builds (and once at start in watch mode), copy `node_modules/mermaid/dist/mermaid.min.js` to `media/mermaid.min.js` with `copyFileSync`; include that file in the size report; update the "500 KB package budget" comment to 2 MB (D11).
- `.gitignore`: add `media/mermaid.min.js` under `media/webview.js`.
- `scripts/check-bundles.mjs`: a third `BUNDLES` entry `{ file: process.env.MERMAID_BUNDLE ?? 'media/mermaid.min.js', maxKB: 6144, banned: [], network: false }`. Entries default to `network: true`; the loop skips the `NETWORK` needles when it is `false`, with a comment citing D21. Add `{ needle: 'mermaidAPI', why: 'Mermaid ships as its own lazily loaded file' }` to the `banned` list of the extension and webview bundles. Change the failure text's "the package budget is 500 KB" to 2 MB.
- `src/test/csp.test.ts`: add `has no connect-src and no wildcard`, asserting the built string contains `default-src 'none'`, does not contain `connect-src`, and has no `*` source.
- `.claude/laws.md`: L-no-network's rule gains "The Mermaid file is exempt from the name ban; the pane's CSP blocks every connection (release-expansion D21)" and its `enforced_by` gains `src/test/csp.test.ts`. L-bundle-size's `why` gains "the package budget is 2 MB (release-expansion D11)".
- `CLAUDE.md`: the tech-stack list gains `mermaid` (diagram rendering, lazy-loaded), `markdown-it-github-alerts` and `markdown-it-footnote`; the size sentence in "Current state" names the 2 MB budget.
- `MARKDOWN_REVIEW_PRD.md`: §3 table row for `mermaid`; §10's "under 500 KB" (`:492`) becomes "under 2 MB"; §6 Security gains "Mermaid ships as a separate file loaded with the page nonce; the CSP allows no connection, which is what enforces no-network for it".
MIRROR: `scripts/check-bundles.mjs:41-56` (`BUNDLES` entries and their comments).
INVARIANTS: L-no-network (as amended by D21); L-bundle-size; L-webview-security (the CSP string is not changed); L-no-new-deps (D1, D23); L-lazy-activation (`package.json` `activationEvents` untouched).
DECIDED: D1, D11, D21, D23, D28, D41. Expected decision: the cap for the Mermaid file. Default: 6144 KB, about 10% over today's 5.4 MB.
OUT OF SCOPE: loading or rendering (M2–M4); `src/panel/csp.ts` and `src/panel/ReviewPanel.ts` (unchanged by design); `.vscodeignore` (everything unlisted ships, so the file ships). Importers checked and not edited in this phase unless the compiler or a failing test names them: `eslint.config.mjs`.
ACCEPTANCE: `node esbuild.mjs` prints a size line for the Mermaid file and exits 0; `npm run lint:bundles` exits 0; `MERMAID_BUNDLE=scripts/check-bundles.mjs npm run lint:bundles` still exits 0 (a small file under the cap), and `WEBVIEW_BUNDLE=media/mermaid.min.js npm run lint:bundles` exits non-zero (the name ban and the webview cap still have teeth); `npx vitest run --project node src/test/csp.test.ts`; `git check-ignore -q media/mermaid.min.js` exits 0.
FAILURE PATHS: A missing source file makes `copyFileSync` throw with the path, which fails the build; this is checked by reading the code, not by a test. A file over the cap fails `lint:bundles` naming the file and the cap. No input can be empty here.
Depends on: A2.
Entry check: `grep -c '"mermaid"' package.json` prints 0, and `grep -c "markdown-it-footnote" package.json` prints ≥ 1.
Done: build and tests pass, committed, tracker row updated.

### M2: Load Mermaid on demand, and prove it under the pane's CSP (lane: app)

GOAL: The webview can obtain Mermaid on first need without a CSP change, and a real browser shows Mermaid loading and rendering under the pane's exact CSP before anything is built on it.
READ FIRST: `media/src/webview.ts:1-110` (module header, imports, `requireElement`); `src/panel/ReviewPanel.ts:763-816` (`getHtmlForWebview`: one nonce'd classic script); `src/panel/csp.ts:14-20` (`buildCsp`: `script-src 'nonce-…'` only); `media/test/changes.test.ts:1-40` (a jsdom suite's setup); `dev/harness/index.html:1-80` (head, script tags, the shell copy) and `:502-520` (a check to mirror); `dev/harness/generate.mjs:118-125` and `:352-366` (`loadHostModules`, the payload).
CHANGE:
- `media/src/mermaidLoader.ts`: new. Exports `interface MermaidApi { initialize(config: Record<string, unknown>): void; render(id: string, text: string): Promise<{ svg: string }> }`, `const MERMAID_LOAD_TIMEOUT_MS = 10_000`, and `createMermaidLoader(scriptUrl: string | undefined, nonce: string | undefined, doc: Document = document): () => Promise<MermaidApi>`. The returned function appends `<script src="<mermaid.min.js beside scriptUrl>" nonce="<nonce>">` once, resolves with `globalThis.mermaid` on `load`, and rejects with `Error('the diagram renderer failed to load')` on `error`, on timeout, when `scriptUrl` is undefined, or when the global is missing after load. The promise is memoized on success and cleared on failure, so a later call tries again. It never imports the `mermaid` package.
- `media/src/webview.ts`: at module top, capture `const SELF = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null` and build `const loadMermaid = createMermaidLoader(SELF?.src, SELF?.nonce)`. Nothing calls it yet.
- `media/test/mermaidLoader.test.ts`: new jsdom suite. Each test finds the appended `<script>` in the document, sets `globalThis.mermaid` where the case needs it, and dispatches `new Event('load')` or `new Event('error')` on that element; timeouts use fake timers.
- `dev/harness/generate.mjs`: the payload gains `expectedCsp`, the output of the host's `buildCsp("'self'", 'harness')`.
- `dev/harness/index.html`: add `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; script-src 'nonce-harness'; style-src 'self' 'unsafe-inline'; font-src 'self';">` and `nonce="harness"` on every script element; record `securitypolicyviolation` events; add the three checks in ACCEPTANCE. The shell elements are not changed.
MIRROR: `media/test/changes.test.ts:1-40`; `dev/harness/index.html:502-520`.
INVARIANTS: L-webview-security (the script carries the page nonce; no `eval`; the CSP is untouched); L-bundle-size (the `mermaidAPI` ban from M1 must stay green); L-webview-imports-messages-only; L-no-network; L-harness-shell-in-step (the shell elements are untouched; the `no uncaught errors` check must still pass); L-extend-harnesses.
DECIDED: D11, D21, D28, D46. Expected decisions: whether a failed load is retried (default: yes, on the next call); a CSP violation that comes from the harness's own tooling is fixed in the harness, and one that comes from Mermaid needing `'unsafe-eval'` stops the phase with `BRIEF GAP` (U3).
OUT OF SCOPE: rendering in the pane (M3, M4); the pane's shell (`ReviewPanel.getHtmlForWebview`) is not changed. Importers checked and not edited in this phase unless the compiler or a failing test names them: `eslint.config.mjs`, `header.test.ts`, `comments.ts`.
ACCEPTANCE: `npx vitest run --project webview media/test/mermaidLoader.test.ts`, then `npm run check`, `node esbuild.mjs`, `npm run lint:bundles` and `node dev/harness/generate.mjs`. Serve the repo root (for example `npx --yes http-server -p 8080 .`) and open `http://localhost:8080/dev/harness/`; run scenario `basic`; it reports `ALL CHECKS PASSED`. The run-phase executor drives this with the Chrome tools, reading page text, and records the result lines in the tracker note. New unit tests:
- `resolves with the global after load`.
- `appends one script for two calls`.
- `sets the nonce and a URL beside the webview script`: a webview script under `/media/` on any origin gives the Mermaid file in the same folder on that origin.
- `rejects when the script errors`, with the message `the diagram renderer failed to load`.
- `times out`: no event within `MERMAID_LOAD_TIMEOUT_MS` rejects with the same message.
- `retries after a failure`: a second call appends a second script.
- `rejects without a script URL`.
New harness checks:
- `the harness CSP equals buildCsp`: the meta's content equals `fixture.expectedCsp`.
- `no CSP violations`: the recorded list is empty at the end of the run.
- `mermaid renders under the pane's CSP`: the check appends a nonce'd script for the Mermaid file, calls `initialize` with D28's config, renders one flowchart and one sequence diagram, and passes when both SVG strings contain their label text in `<text` elements and no `foreignObject` (U3, U4).
FAILURE PATHS: Load error, timeout, missing global and missing URL all reject with one message, which M3 shows. There is no empty input.
Depends on: M1.
Entry check: `ls media/src/mermaidLoader.ts 2>/dev/null | wc -l` prints 0.
Done: tests pass, harness green, committed, tracker row updated.

### M3: The diagram module (lane: app)

GOAL: A self-contained webview module turns a `mermaid` code block into a diagram with a Diagram/Source switch, a loading line and an error line; the pane does not use it yet.
READ FIRST: `media/src/mermaidLoader.ts` (M2); `media/src/changes.ts` (a small webview module with a jsdom suite); `media/src/anchorSpace.ts:55-90` (blocks are `[data-ap-start]` elements) and `:140-150` (the `data-no-anchor` skip from B1); `media/src/comments.ts:233-240` (`reposition` toggles `mr-narrow` and `mr-no-cards` on `body`, which must not trigger a re-render); `dev/harness/themes.css` (the variables that exist).
CHANGE:
- `media/src/mermaid.ts`: new. Exports `initMermaid(options: { root: HTMLElement; load: () => Promise<MermaidApi>; sanitize: (svg: string) => string; onLayout: () => void }): MermaidView` with `refresh(): void` and `showSource(pre: HTMLElement): void`.
  - `refresh()` finds each `pre > code.language-mermaid` under `root` whose trimmed text is not empty. For each it inserts, before the `<pre>`, `div.mr-mermaid[data-view][data-no-anchor="diagram"]` built with `createElement`: two buttons `Diagram` and `Source` with `aria-pressed`, a status line `p.mr-mermaid-status` reading `Rendering diagram…`, and `div.mr-mermaid-diagram` with `role="img"` and `aria-label="Mermaid diagram"`. The `<pre>` is not moved and not altered.
  - It then loads Mermaid once, calls `initialize` with D28's config, `fontFamily` from the body's computed style and `themeVariables` from `readThemeVariables()`, and renders the blocks one after another with `render('mr-mermaid-<n>', source)`. On success the diagram element's `innerHTML` is `options.sanitize(svg)`, the status line is hidden and `data-view` is the block's remembered view, `diagram` by default.
  - The remembered view is a `Map` keyed by `<block index>:<source text>`, set when the user uses the switch or `showSource` is called, and read by every `refresh()` (D52).
  - On a thrown render error `data-view` is `source`, the switch is hidden, and the status line reads `Mermaid could not render this diagram: <first line of the message, cut to MERMAID_ERROR_MAX_CHARS = 200 with …>`. On a load failure the same line carries the loader's message for every block.
  - A generation counter is bumped by each `refresh()`; a render that finishes for an older generation is discarded. `options.onLayout()` runs after each block settles.
  - `readThemeVariables()` reads `--vscode-editor-background`, `--vscode-editor-foreground`, `--vscode-editorWidget-background`, `--vscode-panel-border`, `--vscode-textBlockQuote-background` and `--vscode-textCodeBlock-background` with `getComputedStyle(document.documentElement)`, converts each with `toHex` (accepts `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`; returns `undefined` otherwise) and maps them to `background`, `primaryTextColor` / `lineColor` / `textColor`, `primaryColor`, `primaryBorderColor`, `secondaryColor`, `tertiaryColor`. `darkMode` is true when the background's luminance is below 0.5. An unreadable variable is left out.
  - A `MutationObserver` on `document.documentElement` and `document.body` (attributes `class`, `style`, `data-theme`, `data-vscode-theme-kind`), debounced by `MERMAID_RETHEME_MS = 150`, recomputes `readThemeVariables()` and calls `refresh()` only when the result differs from the one the last render used (D29).
- `media/test/mermaid.test.ts`: new jsdom suite with a stub `load` and an identity `sanitize`.
- `.claude/laws.md`: L-innerhtml-sanitized-only's rule becomes "`innerHTML` is assigned only the sanitized renderer output or a Mermaid SVG that has been through DOMPurify; …".
MIRROR: `media/src/changes.ts` and `media/test/changes.test.ts`.
INVARIANTS: L-webview-security (`securityLevel: 'strict'`; the caller's sanitize runs before `innerHTML`); L-innerhtml-sanitized-only (as amended, D41); L-block-offsets-single-source (the wrapper carries no `data-ap-*` and is skipped by `buildBlockMap`; no offset is computed here); L-state-not-by-colour-alone; L-webview-imports-messages-only; L-bundle-size; L-no-network.
DECIDED: D12, D17, D18, D22, D27, D28, D29, D41, D46, D52.
OUT OF SCOPE: wiring into the pane, CSS and the real sanitizer (M4); comment placement and the marker (M5); pan and zoom. `src/render/**` is not touched.
ACCEPTANCE: `npx vitest run --project webview media/test/mermaid.test.ts`, then `npm run check`. New tests:
- `wraps a mermaid block and keeps the pre untouched`: the `<pre>` keeps `data-ap-start` and its text, and the wrapper has `data-no-anchor="diagram"`.
- `wrapper text is not anchor text in a list item`: with the block inside an `<li data-ap-start>`, `blockText(li)` is unchanged by `refresh()`.
- `empty mermaid fence`: no wrapper is added.
- `shows the loading line` until the stub resolves.
- `shows the diagram after render`: `data-view` is `diagram` and the diagram element holds the SVG.
- `render error shows the reason`: `data-view` is `source` and the status line equals `Mermaid could not render this diagram: Parse error on line 2`.
- `load failure shows the reason`: the line ends with `the diagram renderer failed to load`.
- `stale render is discarded`: a second `refresh()` before the first resolves leaves one wrapper per block and paints only the second result.
- `view survives a refresh`: after `Source` is pressed, a second `refresh()` over the same source leaves `data-view` as `source`; a changed source starts in `diagram`.
- `a body class change does not re-render`: toggling `mr-narrow` on `body` calls the stub's `render` no more times.
- `a theme change re-renders once`: changing `--vscode-editor-background` on the root calls `render` again.
- `switch is keyboard operable`: both controls are `<button>` elements, `aria-pressed` flips, and `Source` sets `data-view` to `source`.
- `toHex` cases: `#abc`, `#aabbcc80`, `rgb(1, 2, 3)`, `rgba(1,2,3,.5)`, `transparent` (undefined).
FAILURE PATHS: Render error, load failure and timeout each leave the source visible with a reason line (D17, D22). An empty fence is left alone. A document with many diagrams renders them in sequence and each failure is independent. A theme variable that cannot be read is omitted and Mermaid's default is used.
Depends on: M2.
Entry check: `ls media/src/mermaid.ts 2>/dev/null | wc -l` prints 0.
Done: tests pass, committed, tracker row updated.

### M4: Diagrams in the pane (lane: app)

GOAL: A `mermaid` block in a reviewed document shows as a diagram with the Diagram/Source switch, the reading position holds while diagrams render, and selecting text on a diagram says how to comment.
READ FIRST: `media/src/webview.ts:179-216` (`SANITIZE_OPTIONS`, `setContent`, `highlightAll`: the sanitize → inject → highlight order); `media/src/webview.ts:357-407` (`rebuildLineIndex`, `currentScrollLine`, `restoreScroll`); `media/src/mermaid.ts` (M3); `media/src/selection.ts:226-245` (`capture`) and `:335-342` (the hints); `media/webview.css` (the `pre` and button rules).
CHANGE:
- `media/src/webview.ts`:
  - `const MERMAID_SANITIZE_OPTIONS = { USE_PROFILES: { svg: true, svgFilters: true } }`; create the view with `load: loadMermaid`, `sanitize: (svg) => DOMPurify.sanitize(svg, MERMAID_SANITIZE_OPTIONS)` and `onLayout` as below; call `mermaid.refresh()` in `setContent` straight after `highlightAll()`.
  - `rebuildLineIndex` and `restoreScroll` skip an element with no layout box (`getClientRects().length === 0`): a hidden diagram source reports a zero rectangle, which would break the ascending order `currentScrollLine`'s binary search relies on and make `scrollIntoView` a no-op.
  - `setContent` remembers the line it restored as `pinnedLine`. `onLayout` restores that line again when `pinnedLine` is still set, then calls `rebuildLineIndex()` and `comments?.reposition()`. `pinnedLine` is cleared by the first `wheel`, `touchstart`, `pointerdown` or `keydown` after `setContent` (D50).
- `media/src/selection.ts`: the rejection type gains `'diagram'`, returned by `capture` when the closest `[data-no-anchor]` value is `diagram`, with the hint `Switch to Source to comment on this diagram`.
- `media/webview.css`: `.mr-mermaid`, its switch (pressed state shown by border and weight, not colour alone), `.mr-mermaid-status`, `.mr-mermaid-diagram svg { max-width: 100%; height: auto; }`, and `.mr-mermaid[data-view='diagram'] + pre { display: none; }`.
- `media/test/mermaid.test.ts`: add the sanitize test in ACCEPTANCE.
- `docs/fixtures/rich-blocks.md`: append a valid flowchart, a valid sequence diagram, one invalid diagram, and one diagram inside a list item.
- `MARKDOWN_REVIEW_PRD.md`: §6 Rendering gains the Mermaid behaviour (D12, D17, D52).
- `CHANGELOG.md`: `Unreleased` → Added entry.
MIRROR: `media/src/webview.ts:205` (`highlightAll`) for a per-block pass run from `setContent`.
INVARIANTS: L-webview-security (sanitize before `innerHTML`); L-innerhtml-sanitized-only; L-block-offsets-single-source; L-theme-vars-only (CSS colours come from theme variables; diagram colours are derived from them at runtime, D29); L-state-not-by-colour-alone; L-webview-imports-messages-only; L-bundle-size; L-no-network.
DECIDED: D12, D17, D18, D28, D29, D49, D50. Expected decision: the fallback for U4, if the M2 probe passed but a label is missing in the pane: add `ADD_TAGS: ['foreignobject']` and `HTML_INTEGRATION_POINTS: { foreignobject: true }` to `MERMAID_SANITIZE_OPTIONS`.
OUT OF SCOPE: comment placement and the marker (M5); the harness scenarios (M6). `src/render/**` is not touched. Importers checked and not edited in this phase unless the compiler or a failing test names them: `header.test.ts`, `comments.ts`.
ACCEPTANCE: `npx vitest run --project webview media/test/mermaid.test.ts`, then `npm run check`, `node esbuild.mjs`, `npm run lint:css` and `npm run lint:bundles`. New test:
- `script in a label is removed`: a stub SVG containing `<script>` and an `onclick` attribute, passed through the real DOMPurify with `{ USE_PROFILES: { svg: true, svgFilters: true } }`, reaches the diagram element without either.
The scroll behaviour has no layout in jsdom and is checked in M6's harness; the hint is unit-tested in W4, where the selection suite is created, and checked in O1.
FAILURE PATHS: A hidden source block is left out of the scroll line index and of scroll restore. With no saved line, `onLayout` only repositions. A selection on a diagram never opens the composer; it shows the hint.
Depends on: M3.
Entry check: `grep -c "initMermaid" media/src/webview.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### M5: Comments on a diagram's source (lane: app)

GOAL: A comment made in a diagram's Source view keeps its card beside the diagram, the diagram shows "N comments in source", and clicking the card reveals the source.
READ FIRST: `media/src/changes.ts:92-125` (`changeBarRects`); `media/src/comments.ts:25-60` (`CommentsOptions`, `CommentsView`); `media/src/comments.ts:212-232` (`toggleExpanded`: in a wide pane it only scrolls to the highlight); `media/src/comments.ts:233-330` (`reposition`: a range with no rects is skipped and its card is never placed); `media/src/mermaid.ts` (M3); `media/src/webview.ts:520-560` (the `reviewState` case).
CHANGE:
- `media/src/comments.ts`: `CommentsOptions` gains optional `fallbackRect?(range: Range): DOMRect | undefined` and `onReveal?(range: Range): boolean`. In `reposition`, when `rects` is empty and `fallbackRect` returns a rect, that rect places the card and the narrow marker, and no highlight is drawn. `toggleExpanded` first calls `onReveal` with the comment's range, in a wide pane and a narrow one; when it returns true the view calls `reposition()` before it scrolls to the highlight or expands the card.
- `media/src/mermaid.ts`: `MermaidView` gains `rectFor(range: Range): DOMRect | undefined` (the wrapper's rect when the range starts inside a Mermaid `<pre>` that is hidden; `undefined` in Source view and elsewhere), `showSourceFor(range: Range): boolean` (true when it switched a block to Source), and `setMarkers(located: Record<string, { start: number; end: number } | null>): void`. `setMarkers` counts, per Mermaid `<pre>`, the located entries whose `start` lies within the `<pre>`'s own `data-ap-start`/`data-ap-end` attributes, and shows a `button.mr-mermaid-marker` reading `1 comment in source` or `N comments in source`; zero hides it. Clicking the marker switches that block to Source.
- `media/src/webview.ts`: pass `fallbackRect: (range) => mermaid.rectFor(range)` and `onReveal: (range) => mermaid.showSourceFor(range)`; call `mermaid.setMarkers(message.located)` in the `reviewState` case and after each `onLayout`.
- `media/src/changes.ts`: in `changeBarRects`, a changed element with no layout box takes its rectangle from its previous sibling when that sibling is a `.mr-mermaid` wrapper, and is skipped otherwise, so a changed diagram still gets its bar in Diagram view.
- `media/webview.css`: `.mr-mermaid-marker` (text plus an outline, not colour alone).
- `media/test/mermaid.test.ts`: the marker and `rectFor` tests.
- `media/test/comments.test.ts`: the fallback placement and reveal tests.
MIRROR: `media/src/comments.ts:300-312` (the narrow marker branch) for placing from one rect.
INVARIANTS: L-block-offsets-single-source (the count reads the stamped attributes and derives no boundary); L-state-not-by-colour-alone; L-uncertain-position-shown (unchanged for cards placed by the fallback); L-innerhtml-sanitized-only; L-webview-imports-messages-only.
DECIDED: D12, D18 (marker wording), D27, D52. Expected decision: whether switching to Source by the marker scrolls. Default: no scroll; the block stays where it is.
OUT OF SCOPE: commenting on the rendered diagram itself; the harness. Importers checked and not edited in this phase unless the compiler or a failing test names them: `cards.test.ts`, `changes.test.ts`, `orphans.ts`, `header.test.ts`, `esbuild.mjs`.
ACCEPTANCE: `npx vitest run --project webview media/test/mermaid.test.ts media/test/comments.test.ts`, then `npm run check`. The existing cards and changes suites must pass unmodified; the hidden-source bar is checked in M6's harness, because jsdom reports every rectangle as zero. New tests:
- `marker counts comments inside the block`: two located entries inside and one outside give `2 comments in source`; one gives `1 comment in source`; none hides the marker.
- `marker click shows the source`.
- `rectFor returns the wrapper rect for a hidden pre`.
- `rectFor returns undefined in Source view`, and for a range outside any diagram.
- `card is placed from the fallback rect`: `reposition` with a rect-less range and a `fallbackRect` adds the card to the placed set (asserted through `stackTops` inputs as the existing suite does).
- `a card click reveals a hidden source in a wide pane`: `onReveal` is called once with the comment's range when the card is clicked with `isNarrow` false.
FAILURE PATHS: Without `fallbackRect`, or when it returns `undefined`, behaviour is today's (the card is not placed). A `located` entry of `null` is skipped. An empty `located` hides every marker. A changed block with no layout box and no wrapper before it gets no bar, as today.
Depends on: M4.
Entry check: `grep -c "initMermaid" media/src/webview.ts` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### M6: Harness: the rich-blocks scenarios (lane: app)

GOAL: Alerts, footnotes and Mermaid are verified in a real layout engine in all three themes, under the pane's CSP.
READ FIRST: `dev/harness/generate.mjs:118-134` and `:352-366` (one document, one `html`, the payload); `dev/harness/index.html:140-162` (`reviewStateOf`, `loadScenario`); `dev/harness/index.html:502-520` (a check to mirror); `docs/fixtures/rich-blocks.md`.
CHANGE:
- `dev/harness/generate.mjs`: render `docs/fixtures/rich-blocks.md` as a second document and add scenarios `rich` (comments on an alert body, a footnote's text and a line of the flowchart source, plus `changes` computed with `changeStateOf` from a baseline whose flowchart source differs) and `rich-clean` (no comments). A scenario may carry its own `html`, `frontMatterHtml`, `plainText` and `targetPath`; scenarios without them use the kitchen-sink document as today.
- `dev/harness/index.html`: `loadScenario` posts `scenario.html ?? fixture.html`; add the checks in ACCEPTANCE, each skipping outside its scenario. The shell elements are not changed.
MIRROR: `dev/harness/index.html:502-520`.
INVARIANTS: L-harness-shell-in-step (the shell is untouched; the `no uncaught errors` and `no CSP violations` checks must still pass); L-extend-harnesses.
DECIDED: D12, D17, D29, D50, D52.
OUT OF SCOPE: new harness pages; product code. A failing check that shows a product defect stops the phase with `BRIEF GAP` and the failing output. Importers checked and not edited in this phase unless the compiler or a failing test names them: `eslint.config.mjs`.
ACCEPTANCE: `node dev/harness/generate.mjs`, then `npm run check` and `node esbuild.mjs`. Serve the repo root (for example `npx --yes http-server -p 8080 .`) and open `http://localhost:8080/dev/harness/`. Run scenarios `rich` and `rich-clean` in each of the three theme presets, and scenario `basic` once. Each run reports `ALL CHECKS PASSED`. The run-phase executor drives this with the Chrome tools, reading page text, and records the result lines in the tracker note. New checks:
- `mermaid diagrams render`: the valid blocks are `.mr-mermaid[data-view="diagram"]` and each holds an `svg` with a non-zero box.
- `invalid diagram shows its reason`: that block is in Source view with a status line starting `Mermaid could not render this diagram:`.
- `diagram text is readable`: a diagram label's computed fill differs from the diagram background in every theme.
- `alerts are titled`: the alert titles read Note, Tip, Important, Warning, Caution and the author's own words where the fixture has them.
- `block offsets agree with the host`: for every `[data-ap-start]` element, including the list items that hold an alert or a diagram, the webview's block text equals `plainText.slice(start, end)`.
- `a diagram comment sits beside its diagram`: the card's top is within the wrapper's box, and the marker reads `1 comment in source`.
- `clicking that card shows the source`: after a click on the card the block is in Source view and the comment has a highlight.
- `the view survives a re-render`: with a block in Source view, posting the same `setContent` again leaves it in Source view.
- `footnote text is anchorable`: the footnote comment has a highlight.
- `a changed diagram has a change bar`: in Diagram view one change bar vertically overlaps the flowchart's wrapper.
- `scroll position holds while diagrams render`: with the page scrolled to the last paragraph before `setContent` is posted again, that paragraph's top is within 4 px of where it was once every diagram has settled.
FAILURE PATHS: none: this is a test harness. A failing check reports `N CHECK(S) FAILED` by design.
Depends on: M5.
Entry check: `grep -c "rich-clean" dev/harness/generate.mjs` prints 0.
Done: harness green in three themes, committed, tracker row updated.

### W1: A comment may have no anchor (lane: app)

GOAL: The data model, the sidecar guard and re-anchoring accept a whole-document comment; nothing visible changes yet.
READ FIRST: `src/anchor/types.ts` (`Comment`, `Anchor`); `src/store/reviewFile.ts:59-112` (`isAnchor`, `isComment`, `isReviewFile`); `src/anchor/reanchor.ts:28-110` (`reanchor`, `relocate`); `src/detect/rewrite.ts` (`detectRewrite`); `src/panel/messages.ts:19-58` (the type re-exports, `toReviewSummary`); `docs/plans/04-prompt-and-detection.md` §10 (L-detection-corrections-first).
CHANGE:
- `src/anchor/types.ts`: `Comment.anchor` becomes `anchor?: Anchor`, documented as "absent on a whole-document comment (release-expansion D26)". Export `isDocumentComment(comment: Pick<Comment, 'anchor'>): boolean`.
- `src/panel/messages.ts`: re-export `isDocumentComment` beside the existing value re-exports.
- `src/store/reviewFile.ts`: `isComment` accepts a missing `anchor` and still requires `isAnchor` when one is present.
- `src/anchor/reanchor.ts`: `reanchor` returns a whole-document comment unchanged, as it does a `resolved` one.
- `src/detect/rewrite.ts`: `detectRewrite` ignores whole-document comments on both sides.
- `src/prompt/buildPrompt.ts`: leave whole-document comments out of `open` for now (W2 lists them).
- `src/panel/ReviewPanel.ts`: `postReviewState` sets no `located` entry for a whole-document comment; `sectionChanged` and `reanchor` skip it.
- `media/src/comments.ts`: `belongsInOrphans` returns false for a whole-document comment; `anchorStart` treats it as position -1.
- `media/src/orphans.ts`: skip whole-document comments.
- `src/test/reviewFile.test.ts`, `src/test/reanchor.test.ts`, `src/test/rewrite.test.ts`: the tests in ACCEPTANCE; `reanchor.test.ts` also gets the narrowing the compiler asks for where it reads `anchor` on a comment it built with one.
- `src/test/integration/suite/detection.spec.ts`, `src/test/integration/suite/store.spec.ts`: the same narrowing where they read `anchor` (2 and 4 sites today), with no change to what they assert.
MIRROR: `src/anchor/reanchor.ts:40` (the `resolved` early return).
INVARIANTS: L-never-auto-delete-comment; L-version-skew-refused and L-corrupt-sidecar-backup (the guard still rejects a malformed anchor); L-vscode-free-core; L-detection-corrections-first; L-errors-as-values; L-single-review-store; L-message-guard; L-reanchor-perf; L-no-new-suppressions (narrow with a check or a typed helper, never a suppression).
DECIDED: D15, D25, D26, D44. Every edit outside `types.ts`, `reviewFile.ts`, `reanchor.ts` and `rewrite.ts` is a guard the compiler asks for once `anchor` is optional; fix exactly the sites `npm run typecheck` reports. Expected decision: any further site the compiler reports. Default: skip whole-document comments there and name the file in the tracker note.
OUT OF SCOPE: creating such a comment (W3), the prompt (W2), the UI (W4, W5). `SIDECAR_VERSION` stays 1. Importers checked and not edited in this phase unless the compiler or a failing test names them: `cards.test.ts`, `comments.test.ts`, `changes.ts`, `webview.ts`, `perf.test.ts`, `scope.ts`, `ReviewStore.ts`, `roundTrip.test.ts`, `buildPrompt.test.ts`, `changedRanges.test.ts`, `helpers.ts`, `indicators.spec.ts`, `notices.test.ts`, `scope.test.ts`, `counts.ts`, `create.ts`, `locate.ts`, `changedRanges.ts`, `notices.ts`, `plaintext.ts`, `reviewIndex.ts`, `eslint.config.mjs`, `extension.ts`, `changes.test.ts`, `header.test.ts`, `activation.spec.ts`, `messages.test.ts`, `header.ts`, `selection.ts`, `text.ts`, `copyPrompt.ts`, `index.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/reviewFile.test.ts src/test/reanchor.test.ts src/test/rewrite.test.ts`, then `npm run check`. New tests:
- `comment without an anchor is valid`: `isComment` accepts it, and `parseReviewFile(serializeReviewFile(review))` round-trips it with `version` 1.
- `a malformed anchor is still rejected`.
- `reanchor leaves a document comment untouched`: status, body and the absence of `anchor` are unchanged after the text it could never match is edited, with `inferAddressed` on.
- `rewrite detection ignores document comments`: two anchored comments orphaned plus one whole-document comment gives `{ rewritten: true, orphaned: 2 }`.
FAILURE PATHS: A comment with `anchor: null` or a malformed anchor fails the guard, so the existing corrupt-sidecar path (backup, start empty, tell the user) applies. An empty comments list is unchanged.
Depends on: M6.
Entry check: `grep -c "anchor: Anchor;" src/anchor/types.ts` prints 1.
Done: tests pass, committed, tracker row updated.

### W2: Whole-document comments in the prompt (lane: app)

GOAL: The copied prompt lists open whole-document comments first, under "On the document as a whole:", numbered with the rest.
READ FIRST: `src/prompt/buildPrompt.ts:45-110` (`buildPrompt`, `byDocumentOrder`, `anchorStart`, `createdAt`); `src/prompt/buildPrompt.ts:115-141` (`describeAnchor`); `src/prompt/buildPrompt.ts:251-261` (`quoteBody`); `src/test/buildPrompt.test.ts:31-64` (the golden test); `MARKDOWN_REVIEW_PRD.md:338-375` (§7); `docs/plans/04-prompt-and-detection.md` §10.
CHANGE:
- `src/prompt/buildPrompt.ts`: remove W1's temporary exclusion. Open whole-document comments come first, ordered by `createdAt` then `id`; each item is `<n>. On the document as a whole:` followed by a newline and the existing `quoteBody(body)` output (each body line as `   > <line>`), then a newline. Anchored comments follow in document order as today, and the numbering runs through both groups. `order` holds every listed id in that order.
- `src/test/buildPrompt.test.ts`: a `describe('buildPrompt — whole-document comments (D15)')` block.
- `MARKDOWN_REVIEW_PRD.md`: §4 notes that `anchor` is optional and what its absence means; §7 gains the item form and its position.
MIRROR: `src/test/buildPrompt.test.ts:31-64`.
INVARIANTS: L-prompt-prose-only (the line is prose; no id or marker); L-detection-corrections-first; L-vscode-free-core; L-errors-as-values.
DECIDED: D15, D18 (the prompt line), D45. The changelog entry for this feature is W5's.
OUT OF SCOPE: the header sentence about disagreeing (N2 changes it); the UI. Importers checked and not edited in this phase unless the compiler or a failing test names them: `copyPrompt.ts`, `reviewLoop.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/buildPrompt.test.ts`, then `npm run check`. New tests, each asserting exact prompt text:
- `document comments come first and are numbered`: one whole-document comment with body `Tighten the tone.` and two anchored comments give items 1, 2, 3, and item 1 is exactly `1. On the document as a whole:\n   > Tighten the tone.\n`.
- `only document comments`: the prompt has the header and those items, and `count` equals their number.
- `order includes document comments first`.
- `resolved document comment is not listed`.
- The golden test at `:32` passes unmodified.
FAILURE PATHS: No open comments of either kind returns `{ prompt: '', count: 0, order: [] }` as today. Two whole-document comments with one timestamp are ordered by id, so the numbering is stable.
Depends on: W1.
Entry check: `grep -c "isDocumentComment" src/prompt/buildPrompt.ts` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### W3: Host: add a whole-document comment (lane: app)

GOAL: The host accepts an `addDocumentComment` message and stores a comment with no anchor.
READ FIRST: `src/panel/messages.ts:113-148` (`WebviewMessage`) and `:171-212` (`isWebviewMessage`); `src/panel/ReviewPanel.ts:259-312` (the message switch); `src/panel/ReviewPanel.ts:591-624` (`addComment`); `src/store/ReviewStore.ts:265-267` (`addComment`); `src/test/messages.test.ts`; `src/test/integration/suite/store.spec.ts:1-60` (how a store is seeded).
CHANGE:
- `src/panel/messages.ts`: `WebviewMessage` gains `{ type: 'addDocumentComment'; body: string }`; `isWebviewMessage` accepts it only when `body` is a string.
- `src/panel/ReviewPanel.ts`: a `case 'addDocumentComment'` calling a new private `addDocumentComment(body: string): Promise<void>`: trim, return on blank, `await this.store.ensureLoaded()`, return if disposed, then `this.store.addComment({ id: nanoid(8), body, author: authorName(this.target), createdAt: new Date().toISOString(), status: 'open' })`, as `addComment` builds its comment.
- `src/test/messages.test.ts`: the guard tests.
- `src/test/integration/suite/store.spec.ts`: one test that a comment with no anchor is written, reloaded and survives an `applyReanchor`.
MIRROR: `src/panel/ReviewPanel.ts:591-624` (`addComment`).
INVARIANTS: L-message-guard; L-single-review-store; L-never-auto-delete-comment; L-vscode-free-core (`messages.ts`); L-baseline-stays-on-host.
DECIDED: D15, D26.
OUT OF SCOPE: the webview side (W4, W5). Importers checked and not edited in this phase unless the compiler or a failing test names them: `extension.ts`, `cards.test.ts`, `changes.test.ts`, `header.test.ts`, `activation.spec.ts`, `eslint.config.mjs`, `changes.ts`, `comments.ts`, `header.ts`, `orphans.ts`, `selection.ts`, `webview.ts`, `text.ts`, `reviewFile.ts`, `detection.spec.ts`, `index.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/messages.test.ts`, then `npm run check`, `node esbuild.mjs` and `node esbuild.mjs --integration && node dist-test/run.js` (the integration suite has no per-spec filter, so the whole suite is this phase's related test). New tests:
- `accepts addDocumentComment with a string body`.
- `rejects a non-string body` and a missing body.
- integration `a whole-document comment persists and survives a re-anchor`: the reloaded sidecar holds one comment with no `anchor` key and status `open` after the document is edited.
FAILURE PATHS: A blank body adds nothing. A message that fails the guard is dropped by the existing guard path. A disposed panel returns before writing.
Depends on: W2.
Entry check: `grep -c "addDocumentComment" src/panel/messages.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### W4: Pane: the "Comment on document" composer (lane: app)

GOAL: The header and the empty-state box offer "Comment on document", which opens the comment composer and posts the new message.
READ FIRST: `media/src/header.ts:135-200` (`initHeader`, the action buttons); `media/src/selection.ts:38-60` (`SelectionOptions`, `SelectionController`); `media/src/selection.ts:362-476` (`Popover`, `createPopover`, `open`); `media/src/webview.ts:474-510` (the empty state); `media/test/header.test.ts`.
CHANGE:
- `media/src/header.ts`: `HeaderOptions` gains `onCommentOnDocument(button: HTMLElement): void`; a secondary button `Comment on document` is added to the actions row and calls it with itself.
- `media/src/selection.ts`: `SelectionOptions` gains `onDocumentSubmit(body: string): void`; `SelectionController` gains `openDocumentComposer(at: DOMRect, restoreFocusTo: Element): void`. The popover gets a heading element that reads `Comment on the whole document` in this mode and is hidden for a passage comment, and its `aria-label` follows. A submit in this mode calls `onDocumentSubmit`, not `onSubmit`.
- `media/src/webview.ts`: wire the header button and a second `Comment on document` button in the empty-state box to `openDocumentComposer`, and post `{ type: 'addDocumentComment', body }`.
- `media/webview.css`: the popover heading.
- `media/test/header.test.ts`: the button test, and `onCommentOnDocument` added to the options literals it builds.
- `media/test/selection.test.ts`: a new suite (no selection suite exists today) for the composer mode and the rejections.
MIRROR: `media/src/header.ts:162-178` (the `copy` and `clear` buttons).
INVARIANTS: L-innerhtml-sanitized-only (all UI through `createElement` and `textContent`); L-webview-imports-messages-only; L-theme-vars-only; L-state-not-by-colour-alone.
DECIDED: D15, D18, D22 (composer heading and buttons), D40, D49 (the diagram hint's test lands here).
OUT OF SCOPE: the card (W5); a command-palette entry. Importers checked and not edited in this phase unless the compiler or a failing test names them: `comments.ts`, `orphans.ts`, `esbuild.mjs`.
ACCEPTANCE: `npx vitest run --project webview media/test/header.test.ts media/test/selection.test.ts`, then `npm run check`. New tests:
- `header has a Comment on document button` that calls the handler with the button.
- `document composer shows its heading` and the passage composer does not.
- `submitting the document composer calls onDocumentSubmit` with the trimmed body, and not `onSubmit`.
- `Escape closes the document composer and restores focus`.
- `a selection in front matter still shows the front-matter hint`.
- `a selection on a diagram shows the diagram hint`: a selection inside an element marked `data-no-anchor="diagram"` shows `Switch to Source to comment on this diagram` and no Comment button.
FAILURE PATHS: A blank body keeps the submit button disabled, as today. Cancel and Escape close without posting.
Depends on: W3.
Entry check: `grep -c "openDocumentComposer" media/src/selection.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### W5: Pane: the whole-document card (lane: app)

GOAL: A whole-document comment's card sits first in the column, labelled "Whole document", and shows "Document changed since the prompt" once the file has changed.
READ FIRST: `media/src/comments.ts:143-155` (`setState`); `media/src/comments.ts:161-206` (`render`); `media/src/comments.ts:233-330` (`reposition`); `media/src/comments.ts:465-548` (`buildCard`, its `signals`); `media/src/comments.ts:583-600` (`sectionNote`, `badge`); `media/src/webview.ts:520-560` (the `reviewState` case); `media/test/cards.test.ts`.
CHANGE:
- `media/src/comments.ts`: `setState` gains a fourth parameter `documentChanged = false`, so its 22 existing calls in `cards.test.ts` stay valid. `render` puts whole-document comments first, ordered by `createdAt`. `buildCard`'s signals gain optional `wholeDocument` and `documentChanged`: the card shows a `Whole document` badge, and the note `Document changed since the prompt` when the comment is `open`, has a prompt number and `documentChanged` is true. `reposition` places these cards at top 0 through `stackTops`, and in narrow mode adds a marker at the top of the content.
- `media/src/webview.ts`: pass `message.changes.state === 'changed'` as `documentChanged`.
- `media/webview.css`: the badge and the note reuse the existing badge and section-note styles; add only what is missing.
- `media/test/cards.test.ts`: the tests in ACCEPTANCE.
- `CHANGELOG.md`: `Unreleased` → Added entry for whole-document comments.
MIRROR: `media/src/comments.ts:583` (`sectionNote`) and `:590` (`badge`).
INVARIANTS: L-state-not-by-colour-alone; L-innerhtml-sanitized-only; L-uncertain-position-shown (unaffected: these cards have no position); L-never-auto-delete-comment; L-webview-imports-messages-only.
DECIDED: D15, D18, D40. Expected decision: where the resolved group sits when only whole-document cards exist. Default: below them, as after any last card.
OUT OF SCOPE: the harness (H1); the prompt. Importers checked and not edited in this phase unless the compiler or a failing test names them: `comments.test.ts`, `changes.ts`, `orphans.ts`, `header.test.ts`.
ACCEPTANCE: `npx vitest run --project webview media/test/cards.test.ts`, then `npm run check`, `node esbuild.mjs` and `npm run lint:css`. New tests:
- `whole-document card is first and labelled`: with one anchored and one whole-document comment, the first card holds the text `Whole document`.
- `hint shows after the document changed`: `documentChanged` true plus a prompt number gives the note `Document changed since the prompt`; without a prompt number, or with `documentChanged` false, there is no note.
- `resolved whole-document comment has no hint`.
- `narrow pane shows a marker at the top`: in narrow mode the marker layer holds a marker for the whole-document comment.
FAILURE PATHS: With no document rendered the card still shows, without a hint. A `changes` state of `too-large` or `no-baseline` gives no hint, because nothing can be said.
Depends on: W4.
Entry check: `grep -c "openDocumentComposer" media/src/webview.ts` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### N1: Agent notes: model and parsing (lane: app)

GOAL: The notes text an agent writes can be split into per-comment chunks and unattached chunks by a pure, tested function, and the sidecar can hold the result.
READ FIRST: `src/anchor/types.ts` (`ReviewFile`, `Comment`); `src/store/reviewFile.ts:59-112` (the guards); `src/panel/messages.ts:19-58` (the `export type` list, `ReviewSummary`, `toReviewSummary`); `src/detect/scope.ts:1-40` (a pure `detect` module's shape); `eslint.config.mjs:60-80` (the restricted-import list).
CHANGE:
- `src/anchor/types.ts`: export `interface AgentNote { text: string; receivedAt: string }`. `Comment` gains `agentNote?: AgentNote`. `ReviewFile` gains `agentNotes?: { raw: string; carried: string; unattached: string; cut: boolean; receivedAt: string; dismissed: string[] }`, documented field by field per D47 (`unattached` is the text shown; `carried` is the part of it that came from earlier rounds).
- `src/store/reviewFile.ts`: `isComment` and `isReviewFile` validate the two optional fields when present.
- `src/detect/agentNotes.ts`: new, `vscode`-free. Exports `NOTES_MAX_CHARS = 16_000`, `NOTE_CHUNK_SEPARATOR = '\n\n'`, `joinChunks(chunks: readonly string[]): string`, `splitChunks(text: string): string[]` (the inverse, dropping empties), and `splitAgentNotes(raw: string, promptCount: number): { byNumber: Map<number, string[]>; unattached: string[]; cut: boolean }`, implementing D33 and D34: normalize, cut, chunk, collect numbers, attach when `1 ≤ n ≤ promptCount`.
- `eslint.config.mjs`: add `src/detect/agentNotes.ts` to the restricted-import list if the list names files.
- `src/panel/messages.ts`: add `AgentNote` to the `export type` list; `ReviewSummary` becomes `Omit<ReviewFile, 'baselineText' | 'agentNotes'> & { agentNotes?: { unattached: string; cut: boolean; receivedAt: string } }`, and `toReviewSummary` keeps only those three fields.
- `src/test/agentNotes.test.ts`: new.
- `src/test/reviewFile.test.ts`, `src/test/messages.test.ts`: the guard and summary tests.
MIRROR: `src/detect/scope.ts` and `src/test/scope.test.ts`.
INVARIANTS: L-vscode-free-core; L-errors-as-values; L-version-skew-refused (`version` stays 1); L-baseline-stays-on-host (the raw notes text and the dismissed record stay on the host too); L-starter-bounded-list (a cut is reported through `cut`); L-starter-limits-in-config.
DECIDED: D14, D25, D33, D34, D47. Normalization on both sides of the number match: integers parsed from the chunk against the integer range `1..promptCount`.
OUT OF SCOPE: reading the file, the store, the prompt, the UI. Importers checked and not edited in this phase unless the compiler or a failing test names them: `changedRanges.ts`, `buildPrompt.ts`, `roundTrip.test.ts`, `anchor.test.ts`, `buildPrompt.test.ts`, `changedRanges.test.ts`, `helpers.ts`, `detection.spec.ts`, `indicators.spec.ts`, `store.spec.ts`, `notices.test.ts`, `perf.test.ts`, `counts.ts`, `create.ts`, `locate.ts`, `reanchor.ts`, `rewrite.ts`, `ReviewPanel.ts`, `notices.ts`, `plaintext.ts`, `cards.test.ts`, `changes.test.ts`, `header.test.ts`, `activation.spec.ts`, `changes.ts`, `comments.ts`, `header.ts`, `orphans.ts`, `selection.ts`, `webview.ts`, `text.ts`, `extension.ts`, `reviewIndex.ts`, `ReviewStore.ts`, `reanchor.test.ts`, `rewrite.test.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/agentNotes.test.ts src/test/reviewFile.test.ts src/test/messages.test.ts`, then `npm run check`. New tests, each asserting the exact maps and arrays:
- `attaches a chunk by #N`, `by "comment 2"`, `by "Item 3"`, and `by a leading "2."`.
- `a chunk naming two numbers attaches to both`.
- `out-of-range number stays unattached`: `#99` with `promptCount` 3.
- `a chunk with no number is unattached`, and unattached chunks keep their order.
- `list items split into chunks`.
- `CRLF and NFD input normalize`.
- `cuts at NOTES_MAX_CHARS`: 16,001 characters gives `cut: true` and a result built from the first 16,000.
- `blank input gives empty results`.
- `joinChunks and splitChunks round-trip`.
- `summary drops the raw notes`: `toReviewSummary` output has `agentNotes.unattached` and no `raw`, `carried` or `dismissed`.
- `review file with agent notes is valid` and `a non-string note text is rejected`.
FAILURE PATHS: Blank input returns empty results and `cut: false`. `promptCount` 0 makes every chunk unattached. Malformed stored notes fail the guard and take the existing corrupt-sidecar path.
Depends on: W5.
Entry check: `ls src/detect/agentNotes.ts 2>/dev/null | wc -l` prints 0.
Done: tests pass, committed, tracker row updated.

### N2: Agent notes: the prompt sentence and the rule amendments (lane: app)

GOAL: With workspace storage the prompt tells the agent where to write disagreements; elsewhere it keeps today's sentence. The PRD, the laws and CLAUDE.md say why this is not a thread.
READ FIRST: `src/prompt/buildPrompt.ts:23-79` (`PromptResult`, `BuildPromptOptions`, the header); `src/store/sidecarPath.ts:16-52` (`REVIEWS_DIR`, `sidecarFileName`, `backupFileName`); `src/test/sidecarPath.test.ts:1-40`; `MARKDOWN_REVIEW_PRD.md:30-44` (§2) and `:338-375` (§7); `.claude/laws.md` (L-prompt-prose-only, L-prd-non-goals); `docs/plans/04-prompt-and-detection.md` §10.
CHANGE:
- `src/store/sidecarPath.ts`: export `notesFileName(sidecarName: string): string`, which replaces a trailing `.json` with `.notes.md`, and `notesPromptPath(sidecarName: string): string`, returning `REVIEWS_DIR + '/' + notesFileName(sidecarName)` built by string concatenation, never `path.join`.
- `src/prompt/buildPrompt.ts`: `BuildPromptOptions` gains `notesPath?: string`. With it, the header's third line is the D18 sentence with the path in backticks; without it the line is unchanged.
- `src/test/buildPrompt.test.ts`, `src/test/sidecarPath.test.ts`: the tests in ACCEPTANCE.
- `MARKDOWN_REVIEW_PRD.md`: §2's "Comment threads or replies" line gains "Agent notes are not threads: one-way, plain text, no reply, never sent back to the agent (release-expansion D42)". §7 documents the sentence, the notes file, D20 and the lifecycle (D47).
- `.claude/laws.md`: L-prompt-prose-only's rule becomes "The review prompt never asks the agent for markers, ids or structured output. Its one request beyond editing the document is a free-prose notes file for disagreements (release-expansion D14)". L-prd-non-goals' rule notes that agent notes are not threads (D42).
- `CLAUDE.md`: the core design principle paragraph gains one sentence stating the notes file is free prose and all matching is the extension's job.
MIRROR: `src/store/sidecarPath.ts:51` (`backupFileName`); `src/test/buildPrompt.test.ts:31-64`.
INVARIANTS: L-prompt-prose-only (as amended, D41); L-prd-non-goals (as amended, D42); L-sidecar-path-separators; L-detection-corrections-first; L-vscode-free-core; L-errors-as-values.
DECIDED: D5, D14, D18, D20, D32, D41, D42. In a multi-root workspace the path is relative to the same folder as `review.targetPath` on the prompt's first line; nothing new is added for it.
OUT OF SCOPE: passing `notesPath` from the command (N4); reading notes. Importers checked and not edited in this phase unless the compiler or a failing test names them: `copyPrompt.ts`, `detection.spec.ts`, `indicators.spec.ts`, `store.spec.ts`, `eslint.config.mjs`, `clearComments.ts`, `reviewIndex.ts`, `ReviewStore.ts`, `reviewLoop.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/buildPrompt.test.ts src/test/sidecarPath.test.ts`, then `npm run check`. New tests:
- `notes path changes the third header line`: the exact D18 sentence with `.reviews/docs__specs__auth.md.notes.md` in backticks.
- `no notes path keeps the old sentence`: the header is byte-identical to today's.
- `notesFileName replaces the json suffix`: `docs__specs__auth.md.json` gives `docs__specs__auth.md.notes.md`.
- `uses forward slashes on Windows`: `notesPromptPath(sidecarFileName('docs\\specs\\auth.md'))` equals `.reviews/docs__specs__auth.md.notes.md`.
- The golden test at `:32` passes unmodified.
FAILURE PATHS: An empty or undefined `notesPath` keeps today's sentence. A sidecar name without `.json` gets `.notes.md` appended.
Depends on: N1.
Entry check: `grep -c "notesPromptPath" src/store/sidecarPath.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### N3: Agent notes: the store reads, keeps and dismisses them (lane: app)

GOAL: The review store reads the notes file, keeps each note until it is dismissed, and ends a round without losing a late write.
READ FIRST: `src/store/ReviewStore.ts:105-135` (`for`, `resolveSidecar` use) and `:689-705` (`resolveSidecar`: `loose`, `storageLocation`); `src/store/ReviewStore.ts:512-536` (`load`); `src/store/ReviewStore.ts:629-672` (`watchSidecar`, `rereadExternal`: no debounce today); `src/detect/changeWatcher.ts:22-40` (`CHANGE_DEBOUNCE_MS`, `createCoalescer`); `src/detect/agentNotes.ts` (N1); `src/test/integration/suite/store.spec.ts:195-230` (an external-write test).
CHANGE:
- `src/store/ReviewStore.ts`:
  - `notesPromptPath(): string | undefined`, defined only when the review is in a workspace folder and `storageLocation` is `workspace` (D20). Every method below is a no-op when it is undefined.
  - `ingestAgentNotes(raw: string, now?: () => string): void`. A blank `raw`, or one equal to `state.agentNotes?.raw`, is a no-op. Otherwise: run `splitAgentNotes(raw, promptOrder.length)`; drop every chunk whose text is in `agentNotes.dismissed`; for each number whose comment `promptOrder[n - 1]` still exists and that has chunks left, set that comment's `agentNote` to `{ text: joinChunks(chunks), receivedAt }`, keeping the old `receivedAt` when the text is unchanged (a number whose comment is gone moves its chunks to the unattached list); set `unattached` to `joinChunks([carried, ...unattached chunks])`; store `raw` and `cut`; commit. A comment that has a note and gets no chunk in this read keeps its note (D47).
  - `dismissAgentNote(id?: string): void`. With an id: add `splitChunks(comment.agentNote.text)` to `dismissed` and remove that comment's `agentNote`. Without: add `splitChunks(unattached)` to `dismissed`, and set `unattached` and `carried` to `''`.
  - `settleNotes(): Promise<void>` reads the notes file if it exists and ingests it.
  - `endNotesRound(): Promise<void>` reads the file once more and ingests it (still against the old `promptOrder`), deletes the file only when the text it just read equals the stored `raw`, then sets `carried = unattached`, `raw = ''` and `dismissed = []` and commits. A "not found" is silent; any other read or delete failure is logged with the path and the round still ends.
  - `watchNotes()`, started where `watchSidecar()` is: a `FileSystemWatcher` on the notes file whose create and change events call `settleNotes()` through `createCoalescer(CHANGE_DEBOUNCE_MS, …)`. `load()` calls `settleNotes()` once.
- `src/test/integration/suite/notes.spec.ts`: new, driving the store directly.
- `src/test/integration/suite/index.ts`: import the new spec.
MIRROR: `src/store/ReviewStore.ts:629-672` (`watchSidecar`, `rereadExternal`); `src/test/integration/suite/store.spec.ts:205` (`adopts a valid external rewrite and fires onDidChange`).
INVARIANTS: L-single-review-store (only the store ingests); L-watcher-and-debounce; L-never-auto-delete-comment (only the notes file is deleted, and only after its content was ingested); L-corrupt-sidecar-backup; L-starter-no-swallowed-errors (a read or delete failure is logged with the path); L-lazy-activation (`activationEvents` untouched).
DECIDED: D14, D19, D20, D32, D33, D47. Expected decision: if importing from `changeWatcher.ts` would create an import cycle with the store, import the constant and the coalescer from the module `changeWatcher.ts` itself takes them from, and say so in the tracker note. Residual, accepted: a write that lands in the few milliseconds between `endNotesRound`'s read and its delete is lost.
OUT OF SCOPE: calling these from the prompt command, the message and the panel (N4); the UI (N5, N6). Importers checked and not edited in this phase unless the compiler or a failing test names them: `eslint.config.mjs`, `clearComments.ts`, `copyPrompt.ts`, `baselineDocuments.ts`, `extension.ts`, `ReviewPanel.ts`, `reviewIndex.ts`, `sidecarPath.ts`, `activation.spec.ts`.
ACCEPTANCE: `npm run check`, `node esbuild.mjs`, then `node esbuild.mjs --integration && node dist-test/run.js` (the integration suite has no per-spec filter, so the whole suite is this phase's related test). New integration tests in `notes.spec.ts`:
- `ingests a notes file written to disk`: with a `promptOrder` of two comments, an external write of `Comment 1: I left this as is because…` gives the first comment an `agentNote.text` equal to that chunk.
- `blank notes file is ignored`: existing notes are unchanged.
- `re-ingest replaces`: a second write with different text for comment 1 replaces its note; a comment whose chunk is absent from the second write keeps its note.
- `dismissed note stays dismissed`: after `dismissAgentNote(id)`, a write of the same content leaves the comment without a note.
- `dismissed chunk stays dismissed when the file grows`: after dismissing comment 1's note, appending an unrelated unattached chunk shows that chunk and does not bring the note back.
- `unattached notes carry over`: an undismissed unattached note is still in `unattached` after `endNotesRound()` and after a new round's file adds another chunk, with the carried text first.
- `late write is ingested before the round ends`: a file changed after `settleNotes()` is attached by the old `promptOrder` during `endNotesRound()`, and the file is gone afterwards.
- `the same words count as new in the next round`: after `endNotesRound()`, writing the earlier text again attaches it again.
- `unreadable notes file is logged`: a directory at the notes path produces an output-channel line containing the path, and `endNotesRound()` still resolves.
- `global storage has no notes path`: `notesPromptPath()` is undefined, and a notes file on disk is never read.
FAILURE PATHS: A missing notes file is normal and silent. An unreadable file or a failed delete is logged with its path and never blocks the round. A blank file changes nothing. Notes longer than the limit are cut by `splitAgentNotes` and flagged.
Depends on: N2.
Entry check: `grep -c "endNotesRound" src/store/ReviewStore.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### N4: Agent notes: the prompt command and the dismiss message (lane: app)

GOAL: Copying a prompt names the notes file, reads any pending notes first and ends the round; the pane can dismiss a note.
READ FIRST: `src/commands/copyPrompt.ts:1-90` (`copyPrompt`: the order of re-anchor, build, clipboard, snapshot); `src/store/ReviewStore.ts` (the four notes methods N3 added: settle, end the round, the prompt path, dismiss); `src/panel/messages.ts:113-148` and `:171-212`; `src/panel/ReviewPanel.ts:259-312` (the message switch); `package.json:126-137` (the `storageLocation` setting).
CHANGE:
- `src/commands/copyPrompt.ts`: call `await store.settleNotes()` before the re-anchor and `buildPrompt`; pass `notesPath: store.notesPromptPath()`; after the clipboard write call `await store.endNotesRound()`, then `snapshotBaseline` as today.
- `src/panel/messages.ts`: `WebviewMessage` gains `{ type: 'dismissAgentNote'; id?: string }`, guarded (`id` absent or a string).
- `src/panel/ReviewPanel.ts`: `case 'dismissAgentNote'` calls `this.store.dismissAgentNote(raw.id)`.
- `src/test/messages.test.ts`: the guard tests.
- `src/test/integration/suite/notes.spec.ts`: the two command-level tests in ACCEPTANCE.
- `package.json`: the `markdownReview.storageLocation` description gains `Agent notes need \`workspace\` storage.`
MIRROR: `src/commands/copyPrompt.ts` (the existing sequence and its comments on ordering).
INVARIANTS: L-detection-corrections-first (the snapshot stays after the clipboard write); L-message-guard; L-single-review-store; L-baseline-stays-on-host; L-lazy-activation (`activationEvents` untouched); L-starter-no-swallowed-errors.
DECIDED: D14, D19, D20, D47. The order is fixed: settle, re-anchor, build, clipboard, end the round, snapshot.
OUT OF SCOPE: the UI (N5, N6); sending (S2 keeps this order). Importers checked and not edited in this phase unless the compiler or a failing test names them: `extension.ts`, `cards.test.ts`, `changes.test.ts`, `header.test.ts`, `activation.spec.ts`, `eslint.config.mjs`, `changes.ts`, `comments.ts`, `header.ts`, `orphans.ts`, `selection.ts`, `webview.ts`, `text.ts`, `reviewFile.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/messages.test.ts`, then `npm run check`, `node esbuild.mjs` and `node esbuild.mjs --integration && node dist-test/run.js` (the integration suite has no per-spec filter, so the whole suite is this phase's related test). New tests:
- `accepts dismissAgentNote with and without an id`, `rejects a non-string id`.
- integration `ingests before the snapshot`: with a notes file present and no store alive, the next `copyPrompt` attaches the note by the old `promptOrder`, the copied prompt names `.reviews/<name>.notes.md`, and the file is gone afterwards.
- integration `global storage keeps the old sentence`: the copied prompt holds "tell me instead of guessing" and no notes path.
FAILURE PATHS: A failure inside `settleNotes` or `endNotesRound` is logged by the store and the prompt is still copied and the baseline taken. With notes off both calls do nothing.
Depends on: N3.
Entry check: `grep -c "dismissAgentNote" src/panel/messages.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### N5: Pane: "Notes from the agent" (lane: app)

GOAL: Notes the agent did not tie to a comment appear in a "Notes from the agent" section with a Dismiss button, and their arrival is announced.
READ FIRST: `src/panel/ReviewPanel.ts:763-816` (`getHtmlForWebview`); `dev/harness/index.html:60-78` (the shell copy that must match); `media/src/webview.ts:82-135` (`requireElement` per id, `announce`); `media/src/orphans.ts:52-120` (`initOrphans`: a section module that hides itself when empty); `media/src/webview.ts:520-560` (the `reviewState` case).
CHANGE:
- `src/panel/ReviewPanel.ts`: add `<section id="agent-notes" hidden aria-label="Notes from the agent"></section>` to the shell, directly after `#orphans`.
- `dev/harness/index.html`: the same element in the same place.
- `media/src/agentNotes.ts`: new. Exports `initAgentNotes(options: { root: HTMLElement; onDismiss(): void }): { setState(notes: ReviewSummary['agentNotes']): void }`. With non-blank `unattached` it shows a heading `Notes from the agent`, the text in a `pre`-wrapped element set through `textContent`, the line `Notes cut at 16,000 characters.` when `cut` is true, and a `Dismiss` button; otherwise the section is hidden. Also exports `notesKey(review: ReviewSummary): string`, the sorted `receivedAt` values of the review's notes and of every comment's `agentNote`, joined.
- `media/src/webview.ts`: `requireElement('agent-notes')`; create the view; call `setState(message.review.agentNotes)` in the `reviewState` case; `onDismiss` posts `{ type: 'dismissAgentNote' }`. Call the existing `announce('The agent left notes.')` when `notesKey` is non-empty and differs from the last state's key, except on the first `reviewState` after the pane loads.
- `media/webview.css`: the section, using existing notice and border variables.
- `media/test/agentNotes.test.ts`: new.
MIRROR: `media/src/orphans.ts:52` (`initOrphans`).
INVARIANTS: L-harness-shell-in-step (both shells change together; the harness's `no uncaught errors` check must pass); L-innerhtml-sanitized-only (`textContent` only); L-theme-vars-only; L-state-not-by-colour-alone; L-webview-imports-messages-only; L-baseline-stays-on-host.
DECIDED: D14, D18, D19, D22, D34, D49.
OUT OF SCOPE: the note on a card (N6). Importers checked and not edited in this phase unless the compiler or a failing test names them: `header.test.ts`, `comments.ts`, `extension.ts`.
ACCEPTANCE: `npx vitest run --project webview media/test/agentNotes.test.ts`, then `npm run check`, `node esbuild.mjs`, `npm run lint:css` and `node dev/harness/generate.mjs`; `grep -c 'id="agent-notes"' src/panel/ReviewPanel.ts dev/harness/index.html` prints 1 for each file. New tests:
- `shows unattached notes under the heading`.
- `renders markup as text`: `<img src=x onerror=1>` appears as text and the section contains no `img` element.
- `shows the cut line when cut`.
- `hidden when there is nothing unattached`.
- `Dismiss calls the handler`.
- `announces new notes once`: `notesKey` is equal for two states with the same notes and differs when a comment gains a note or the unattached notes change.
FAILURE PATHS: Undefined notes, or a blank `unattached`, hide the section. A cut is always stated. Notes present when the pane opens are shown but not announced.
Depends on: N4.
Entry check: `grep -c "agent-notes" src/panel/ReviewPanel.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### N6: Pane: the agent's note on a card (lane: app)

GOAL: A card whose comment the agent pushed back on shows the note under "Agent note", with Dismiss, in the column and in the orphan section.
READ FIRST: `media/src/comments.ts:465-548` (`buildCard`); `media/src/comments.ts:550-582` (`buildDiff`: an optional block on a card); `media/src/comments.ts:25-60` (`CommentsOptions`); `media/src/orphans.ts:52-120` (`initOrphans`, how an orphan's card is built); `src/panel/messages.ts:19-40` (the agent-note type N1 re-exports is imported from here); `media/test/cards.test.ts`.
CHANGE:
- `media/src/comments.ts`: `CommentsOptions` gains `onDismissNote(id: string): void`. Export `buildAgentNote(note: AgentNote, onDismiss: () => void): HTMLElement`: a block with the label `Agent note`, the note through `textContent`, and a `Dismiss` button with `aria-label` "Dismiss the agent's note". `buildCard` appends it when `comment.agentNote` exists.
- `media/src/orphans.ts`: `OrphansOptions` gains `onDismissNote(id: string): void`, and an orphan's card appends `buildAgentNote` too, so a note is never hidden by its comment losing its anchor.
- `media/src/webview.ts`: `onDismissNote` posts `{ type: 'dismissAgentNote', id }`, for both the gutter and the orphan section.
- `media/webview.css`: the note block (a left border and the label, not colour alone).
- `media/test/cards.test.ts`: the tests in ACCEPTANCE, and `onDismissNote` added to the options literals it builds.
- `media/test/comments.test.ts`: add `onDismissNote` to any `CommentsOptions` literal it builds.
- `CHANGELOG.md`: `Unreleased` → Added entry for agent notes.
MIRROR: `media/src/comments.ts:550` (`buildDiff`).
INVARIANTS: L-innerhtml-sanitized-only; L-state-not-by-colour-alone; L-webview-imports-messages-only (`AgentNote` comes through `messages.ts`); L-theme-vars-only.
DECIDED: D14, D18, D19, D22.
OUT OF SCOPE: the "Notes from the agent" section (N5); the harness (H1). Importers checked and not edited in this phase unless the compiler or a failing test names them: `changes.ts`, `header.test.ts`.
ACCEPTANCE: `npx vitest run --project webview media/test/cards.test.ts media/test/comments.test.ts`, then `npm run check`, `node esbuild.mjs` and `npm run lint:css`. New tests:
- `card shows the agent note with its label`.
- `note text is not parsed as markup`.
- `Dismiss on a note calls onDismissNote with the id`.
- `card without a note has no note block`.
- `an orphaned comment still shows its note`.
FAILURE PATHS: No note, no block. A resolved comment keeps its note until dismissed.
Depends on: N5.
Entry check: `grep -c "initAgentNotes" media/src/webview.ts` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### S1: Send: the message and the wording (lane: app)

GOAL: The message contract and the user-facing strings for sending a prompt exist and are tested.
READ FIRST: `src/panel/messages.ts:113-148` and `:171-212`; `src/panel/notices.ts:19-45` (`promptCopiedMessage`, `noOpenCommentsMessage`, `plural`); `src/test/notices.test.ts`; `src/test/messages.test.ts`.
CHANGE:
- `src/panel/messages.ts`: export `type SendTarget = 'chat' | 'terminal'`; `WebviewMessage` gains `{ type: 'sendPrompt'; target: SendTarget }`; the guard accepts only those two values.
- `src/panel/notices.ts`: `promptSentMessage(count: number, target: SendTarget): string` and `sendFallbackMessage(target: SendTarget): string`, returning the D18 and D22 strings exactly.
- `src/test/messages.test.ts`, `src/test/notices.test.ts`: the tests in ACCEPTANCE.
MIRROR: `src/panel/notices.ts:31` (`promptCopiedMessage`).
INVARIANTS: L-message-guard; L-vscode-free-core.
DECIDED: D13, D18, D22.
OUT OF SCOPE: commands and delivery (S2); the menu (S3). Importers checked and not edited in this phase unless the compiler or a failing test names them: `cards.test.ts`, `changes.test.ts`, `header.test.ts`, `activation.spec.ts`, `eslint.config.mjs`, `changes.ts`, `comments.ts`, `header.ts`, `orphans.ts`, `selection.ts`, `webview.ts`, `text.ts`, `extension.ts`, `ReviewPanel.ts`, `clearComments.ts`, `copyPrompt.ts`, `indicators.ts`, `reviewFile.ts`.
ACCEPTANCE: `npx vitest run --project node src/test/messages.test.ts src/test/notices.test.ts`, then `npm run check`. New tests:
- `promptSentMessage`: `(3, 'chat')` is `3 comments placed in VS Code chat. Press Enter to send.`; `(1, 'chat')` is `1 comment placed in VS Code chat. Press Enter to send.`; `(1, 'terminal')` is `1 comment pasted into the terminal. Press Enter to send.`
- `sendFallbackMessage`: `'terminal'` is `No terminal is open. The prompt was copied instead.`; `'chat'` is `VS Code chat is not available here. The prompt was copied instead.`
- `accepts sendPrompt for chat and terminal`, `rejects an unknown target`.
FAILURE PATHS: none: pure strings and a guard. An unknown target fails the guard.
Depends on: N6.
Entry check: `grep -c "sendPrompt" src/panel/messages.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### S2: Send: deliver the prompt to chat or the terminal (lane: app)

GOAL: Two commands, and the pane's `sendPrompt` message, place the prompt in VS Code chat or paste it into the active terminal without submitting, and fall back to copy when they cannot.
READ FIRST: `src/commands/copyPrompt.ts:1-90` (`copyPrompt`, after N4); `src/extension.ts:53-67` (command registration); `src/panel/ReviewPanel.ts:259-312` (the message switch; `copyPrompt` runs the command so the palette and the pane share one path); `package.json:44-62` (`contributes.commands`); `src/test/integration/suite/activation.spec.ts:75-90` (`registers all four commands`); `src/test/integration/suite/detection.spec.ts:53-95` (`seedReview`).
CHANGE:
- `src/commands/copyPrompt.ts`: export `type PromptTarget = 'clipboard' | 'chat' | 'terminal'` and `deliverPrompt(context, output, arg, target: PromptTarget, io: PromptIo = defaultIo): Promise<void>`, holding today's body with every user message sent through `io.notify`. After the clipboard write it calls `io.toChat(prompt)` or `io.toTerminal()` for those targets. `true` notifies `promptSentMessage`; `false` or a throw notifies `sendFallbackMessage` (a throw is also logged). `endNotesRound` and the baseline snapshot run in every one of those cases, in N4's order. `copyPrompt` becomes `deliverPrompt(…, 'clipboard')`.
- `src/commands/promptTargets.ts`: new. Exports `interface PromptIo { toChat(prompt: string): Promise<boolean>; toTerminal(): Promise<boolean>; notify(message: string): void }` and `defaultIo`. `toChat` returns false when `workbench.action.chat.open` is not in `vscode.commands.getCommands(true)`, else executes it with `{ query: prompt, isPartialQuery: true }` and returns true. `toTerminal` returns false when `vscode.window.activeTerminal` is undefined, else calls `show(false)` on it so it takes focus, executes `workbench.action.terminal.paste`, and returns true. `notify` calls `vscode.window.showInformationMessage`. This file never types text into a terminal itself (D35).
- `src/extension.ts`: register `markdownReview.sendPromptToChat` and `markdownReview.sendPromptToTerminal`.
- `package.json`: the two commands with the D22 titles.
- `src/panel/ReviewPanel.ts`: `case 'sendPrompt'` executes the matching command with `this.target`.
- `src/test/integration/suite/send.spec.ts`: new, driving `deliverPrompt` with a stub `PromptIo` that records its calls.
- `src/test/integration/suite/index.ts`: import the new spec.
- `src/test/integration/suite/activation.spec.ts`: the registered-commands assertion covers six commands.
- `MARKDOWN_REVIEW_PRD.md`: §7 gains sending (D13, D35); §9 lists the two commands.
- `CHANGELOG.md`: `Unreleased` → Added entry.
MIRROR: `src/commands/copyPrompt.ts` (the existing flow); `src/extension.ts:57` (the `copyPrompt` registration).
INVARIANTS: L-lazy-activation (`activationEvents` unchanged; commands are inferred); L-no-network (the chat command hands text to another extension inside VS Code; this extension opens no connection); L-single-review-store; L-detection-corrections-first (the snapshot stays after the hand-off); L-message-guard; L-starter-no-swallowed-errors.
DECIDED: D13, D22, D35, D36. Expected decision: whether the chat command is awaited to completion. Default: await it; a rejection is a fallback.
OUT OF SCOPE: the header menu (S3); the bracketed-paste proof (S4); agent-specific commands for Cursor, Claude Code or Codex panels. Importers checked and not edited in this phase unless the compiler or a failing test names them: `store.spec.ts`.
ACCEPTANCE: `npm run check`, `node esbuild.mjs`, then `node esbuild.mjs --integration && node dist-test/run.js` (the integration suite has no per-spec filter, so the whole suite is this phase's related test); `grep -c "sendText" src/commands/promptTargets.ts` prints 0. New tests in `send.spec.ts`:
- `chat target hands over the prompt`: the stub receives the prompt, the clipboard holds it, the sidecar has a baseline and `promptOrder`, and `notify` received `1 comment placed in VS Code chat. Press Enter to send.`
- `falls back to copy`: a stub returning false, and one that throws, both leave the prompt on the clipboard and a baseline in the sidecar, and `notify` received exactly `VS Code chat is not available here. The prompt was copied instead.` (chat) or `No terminal is open. The prompt was copied instead.` (terminal).
- `second send re-snapshots`: `baselineAt` advances on the second delivery.
- `no open comments sends nothing`: neither `toChat` nor `toTerminal` is called.
- `terminal target with no terminal falls back`: the real `defaultIo.toTerminal()` returns false when no terminal exists.
- activation: `registers all six commands`.
FAILURE PATHS: No open comments: the existing message, nothing delivered. A missing chat command, a throwing command and a missing terminal: the prompt stays on the clipboard, the fallback message shows, the baseline is taken. An unreadable target: today's error, nothing delivered. A terminal whose program has no bracketed paste gets a paste, never typed text (U8).
Depends on: S1.
Entry check: `grep -c "promptSentMessage" src/panel/notices.ts` prints ≥ 1.
Done: tests pass, committed, tracker row updated.

### S3: Send: the "Send to" menu in the header (lane: app)

GOAL: The header has a "Send to" menu with "VS Code chat" and "Active terminal" beside "Copy review prompt".
READ FIRST: `media/src/header.ts:52-56` (`copyPromptLabel`); `media/src/header.ts:135-262` (`initHeader`, `paint`); `media/src/selection.ts:478-493` (`trapFocus`); `media/test/header.test.ts`; `media/webview.css` (the header and button rules).
CHANGE:
- `media/src/header.ts`: `HeaderOptions` gains `onSendPrompt(target: SendTarget): void`. A secondary button `Send to` with `aria-haspopup="menu"` and `aria-expanded` opens a `role="menu"` list of two `role="menuitem"` buttons, `VS Code chat` and `Active terminal`. Enter, Space or a click opens it and focuses the first item; ArrowDown and ArrowUp move between the items and wrap; Escape or an outside click closes it and returns focus to the button; choosing an item calls `onSendPrompt` and closes. The button is disabled exactly when `copyPromptLabel(open).disabled` is.
- `media/src/webview.ts`: `onSendPrompt` posts `{ type: 'sendPrompt', target }`.
- `media/webview.css`: the menu, from existing widget and border variables.
- `media/test/header.test.ts`: the tests in ACCEPTANCE, and `onSendPrompt` added to the options literals it builds.
MIRROR: `media/src/header.ts:162-178`.
INVARIANTS: L-innerhtml-sanitized-only; L-state-not-by-colour-alone; L-theme-vars-only; L-webview-imports-messages-only.
DECIDED: D13, D18. Expected decision: where the menu opens in a narrow pane. Default: below the button, clamped to the pane's width.
OUT OF SCOPE: a status line after sending (the host shows the message); remembering the last target. Importers checked and not edited in this phase unless the compiler or a failing test names them: `comments.ts`, `orphans.ts`.
ACCEPTANCE: `npx vitest run --project webview media/test/header.test.ts`, then `npm run check`, `node esbuild.mjs` and `npm run lint:css`. New tests:
- `Send to is disabled with no open comments`.
- `menu opens with Enter and closes with Escape`, and focus returns to the button.
- `arrow keys move between the two items and wrap`.
- `choosing Active terminal calls onSendPrompt('terminal')` and closes the menu.
- `aria-expanded follows the menu`.
FAILURE PATHS: With zero open comments the button is disabled. Closing without a choice posts nothing.
Depends on: S2.
Entry check: `grep -c "onSendPrompt" media/src/header.ts` prints 0.
Done: tests pass, committed, tracker row updated.

### S4: Send: prove the terminal paste does not submit early (lane: app)

GOAL: A multi-line prompt pasted into a terminal program that enabled bracketed paste arrives as one paste with no early Enter, shown by a test in the real extension host.
READ FIRST: `src/commands/promptTargets.ts` (S2); `src/test/integration/suite/harness.ts:37-175` (`describe`, `it`, `waitFor`); `src/test/integration/run.ts` (launch settings); `esbuild.mjs:62-90` (the integration builds).
CHANGE:
- `src/test/integration/suite/terminalPaste.spec.ts`: new. It creates a terminal with `vscode.window.createTerminal({ shellPath: process.execPath, shellArgs: [<probe script>, <record file>, <ready file>], env: { ELECTRON_RUN_AS_NODE: '1' } })`, calls `show()`, waits until `vscode.window.activeTerminal` is that terminal and the ready file exists, waits a further `PASTE_SETTLE_MS = 500` so the terminal has processed the mode switch, writes a three-line string to the clipboard, runs `defaultIo.toTerminal()`, and polls the record file with `waitFor`. It disposes the terminal afterwards.
- `src/test/integration/fixtures/pasteProbe.cjs`: new. It writes `\x1b[?2004h` to stdout, sets stdin raw, appends every chunk it receives to the record file, and then touches the ready file.
- `src/test/integration/suite/index.ts`: import the new spec.
MIRROR: `src/test/integration/suite/detection.spec.ts:53-95` (seeding and waiting).
INVARIANTS: L-extend-harnesses (the proof lives in the existing integration suite); L-no-network; L-starter-tests-assert-values.
DECIDED: D13, D35; U1 is settled here. There is no alternative mechanism to switch to: if the proof fails the phase stops. Expected decision: what to do on Linux if the clipboard is unavailable under `xvfb-run`. Default: the spec prints a skip line with the reason on Linux only, and O1's terminal box covers it.
OUT OF SCOPE: real agent CLIs (O1 checks Claude Code and Codex in a terminal); changing `src/commands/promptTargets.ts`; a plain shell without bracketed paste (U8, checked in O1). Importers checked and not edited in this phase unless the compiler or a failing test names them: `activation.spec.ts`.
ACCEPTANCE: `node esbuild.mjs`, then `node esbuild.mjs --integration && node dist-test/run.js` (the integration suite has no per-spec filter, so the whole suite is this phase's related test). New tests:
- `paste arrives bracketed and whole`: the recorded bytes contain `\x1b[200~`, then the three lines in order, then `\x1b[201~`.
- `no line is submitted outside the paste`: the lines are separated only by `\r` or `\n` between the two markers, and nothing but the probe's own output follows the closing marker.
FAILURE PATHS: If the paste does not arrive as one bracketed paste, the phase stops as `blocked:terminal paste unproven` with the recorded bytes in `~/.claude/plans/mdcm/release-expansion/S4.md`, and the terminal target is not shipped until a new row resolves it.
Depends on: S3.
Entry check: `ls src/test/integration/suite/terminalPaste.spec.ts 2>/dev/null | wc -l` prints 0.
Done: tests pass, committed, tracker row updated.

### T1: Coverage for Dismiss and the unreadable target (lane: app)

GOAL: The rewrite banner's Dismiss and the unreadable-target state have automated coverage, so D22 and B3c need no GitHub issue.
READ FIRST: `media/src/webview.ts:545-570` (the `rewriteDetected` case and its `Dismiss` action); `dev/harness/index.html:140-165` (`loadScenario`, how `rewriteDetected` is posted); `dev/harness/index.html:502-520` (`the rewrite banner offers the diff`); `src/test/rewrite.test.ts:30-50`; `docs/plans/04-prompt-and-detection.md:586-600` (D22).
CHANGE:
- `dev/harness/index.html`: add the two checks in ACCEPTANCE. The second posts `{ type: 'targetUnreadable', reason: 'harness' }` after loading scenario `orphans`.
- `src/test/rewrite.test.ts`: add `does not fire again once every comment is already orphaned`, asserting `detectRewrite(before, after)` is `{ rewritten: false, … }` when `before` already has every comment orphaned.
- `docs/plans/04-prompt-and-detection.md`: D22's entry gains "Covered 2026-11: harness checks and `rewrite.test.ts` (release-expansion T1)".
MIRROR: `dev/harness/index.html:502-520`.
INVARIANTS: L-extend-harnesses; L-harness-shell-in-step; L-starter-tests-assert-values.
DECIDED: D16, D43.
OUT OF SCOPE: changing the banner or the unreadable notice; the B4 re-link dialog (it needs a real file picker and stays in O1).
ACCEPTANCE: `npx vitest run --project node src/test/rewrite.test.ts`, then `node dev/harness/generate.mjs` and `npm run check`. Serve the repo root and open `http://localhost:8080/dev/harness/`; run scenarios `rewrite` and `orphans`; each reports `ALL CHECKS PASSED`. The run-phase executor drives this with the Chrome tools, reading page text. New checks:
- `the rewrite banner dismisses and stays dismissed`: clicking `Dismiss` hides `#notice`, and re-posting the same `reviewState` leaves it hidden.
- `an unreadable target leaves only Locate file`: after `targetUnreadable`, `#orphans` is hidden, the gutter has no cards, and the notice has a button whose text contains `Locate file`.
FAILURE PATHS: none: tests only. If the existing behaviour fails a new check, that is a product defect: stop with `BRIEF GAP` and the failing output.
Depends on: S4.
Entry check: `grep -c "stays dismissed" dev/harness/index.html` prints 0.
Done: tests and harness green, committed, tracker row updated.

### H1: Harness: whole-document comment, agent notes and the Send menu (lane: app)

GOAL: The new cards, the notes section and the Send menu are verified in a real layout engine in all three themes.
READ FIRST: `dev/harness/generate.mjs:100-134` (`makeComment`, `review`, the scenarios) and `:345-366`; `dev/harness/index.html:140-165`; `dev/harness/index.html:502-520`.
CHANGE:
- `dev/harness/generate.mjs`: scenario `document` (one whole-document comment and two anchored comments, with `promptOrder` and a `changes` state of `changed`) and scenario `notes` (one comment with `agentNote`, plus `agentNotes` with unattached text and `cut: true`).
- `dev/harness/index.html`: the checks in ACCEPTANCE, each skipping outside its scenario.
MIRROR: `dev/harness/index.html:502-520`.
INVARIANTS: L-harness-shell-in-step; L-extend-harnesses.
DECIDED: D15, D18, D19, D22.
OUT OF SCOPE: new harness pages; product code. Importers checked and not edited in this phase unless the compiler or a failing test names them: `eslint.config.mjs`.
ACCEPTANCE: `node dev/harness/generate.mjs`, then `npm run check`. Serve the repo root and open `http://localhost:8080/dev/harness/`; run `document` and `notes` in each of the three theme presets; each reports `ALL CHECKS PASSED`. The run-phase executor drives this with the Chrome tools, reading page text; for the narrow case it resizes the window to 600 px wide (the pane's narrow layout starts below 700 px). New checks:
- `the whole-document card is first`: its top is the smallest card top, and it does not overlap the next card.
- `the whole-document card says the document changed`.
- `agent notes section is visible above the document`, with the cut line.
- `a card shows its agent note`, and the card's height includes it (no overlap with the next card).
- `the Send menu stays inside the pane`: opened, its box lies within the viewport, at the default width and at 600 px.
- `no CSP violations` still passes.
FAILURE PATHS: none: this is a test harness.
Depends on: T1.
Entry check: `grep -c "agent-notes" dev/harness/index.html` prints ≥ 1.
Done: harness green in three themes, committed, tracker row updated.

### P1: Listing polish (lane: app, kind: docs)

GOAL: The Marketplace listing is findable under AI, and the README shows the CI badge.
READ FIRST: `package.json:1-30` (`categories`, `keywords`, `repository`); `README.md:1-12`; `.github/workflows/ci.yml` (the workflow file the badge names).
CHANGE:
- `package.json`: `categories` becomes `["AI", "Other"]`; `keywords` becomes the D39 list.
- `README.md`: a CI badge under the title, built from the `repository` URL in `package.json` and the workflow file `ci.yml`.
MIRROR: none.
INVARIANTS: L-lazy-activation (`activationEvents` untouched); L-no-vsce-publish; L-no-ovsx-publish.
DECIDED: D9, D39.
OUT OF SCOPE: the README's feature sections (R1); the `.github` files (CI1); publishing.
ACCEPTANCE: `node -e "const p=require('./package.json'); if(p.categories.join()!=='AI,Other'||p.keywords.length!==14) process.exit(1)"` exits 0; `npm run check`; `node esbuild.mjs`; `grep -c "badge.svg" README.md` prints 1.
FAILURE PATHS: none: static documents and manifest metadata.
Depends on: H1.
Entry check: `grep -c '"AI"' package.json` prints 0.
Done: committed, tracker row updated.

### R1: README, changelog and the acceptance runsheet (lane: docs, kind: docs)

GOAL: The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and for each of the four agents.
READ FIRST: `README.md:1-140` (all sections); `CHANGELOG.md:1-40`; `docs/plans/05-acceptance-run.md:44-100` (Part A) and `:300-314` (Part C's tag line); `docs/media/RECORDING.md`; `CLAUDE.md` ("Current state").
CHANGE:
- `README.md`: four new sections with these headings: `## Diagrams, alerts and footnotes`, `## Send to chat or terminal`, `## Whole-document comments`, `## Agent notes` (including that notes need `workspace` storage, that the prompt names a notes file, and how Dismiss works). "Privacy" states that Mermaid ships inside the extension and the pane's CSP allows no connection. "Not in v1" is brought in line (threads stay out; agent notes are not threads).
- `CHANGELOG.md`: check that `Unreleased` holds one entry per feature from A1, A2, M4, W5, N6 and S2, and fold them into the `0.1.0` entry's wording.
- `docs/plans/05-acceptance-run.md`: Part A gains boxes for: a Mermaid diagram in Dark+, Light+ and high contrast; an invalid diagram; a comment on a diagram's source, the card click that reveals it, and the hint when diagram text is selected; alerts (including one with its own title) and footnotes; reading position kept in the footnotes across an agent edit; send to VS Code chat; send to a terminal running Claude Code and one running Codex; send to a terminal at a plain shell prompt, where VS Code's own multi-line paste warning appears and nothing runs (U8); the fallback in Cursor; a whole-document comment through a full round; agent notes with each of Claude Code, Copilot Chat, Cursor and Codex (the blind run, D6); Dismiss on a note, and the note staying dismissed when the agent adds another. Part B's budget becomes 2 MB. Part C's tag line drops the issues for D22 and B3c and keeps E7 only "if the Windows CI job is not green", and gains "enable private vulnerability reporting".
- `docs/media/RECORDING.md`: note which new feature the demo shows, if the script changes.
- `CLAUDE.md`: "Current state" names this plan as the current one and lists what is still manual.
MIRROR: `docs/plans/05-acceptance-run.md:72-98` (the "New in this release" boxes).
INVARIANTS: L-no-vsce-publish; L-no-ovsx-publish; L-changelog-unreleased.
DECIDED: D4, D6, D11, D16, D20, D38, D41, D42, D43.
OUT OF SCOPE: code; running the boxes.
ACCEPTANCE: `grep -c "^## Diagrams, alerts and footnotes$\|^## Send to chat or terminal$\|^## Whole-document comments$\|^## Agent notes$" README.md` prints 4; `grep -c "Codex" docs/plans/05-acceptance-run.md` prints ≥ 2; `grep -c "2 MB" docs/plans/05-acceptance-run.md` prints ≥ 1; `grep -c "multi-line paste warning" docs/plans/05-acceptance-run.md` prints ≥ 1; `grep -c "issues opened for D22" docs/plans/05-acceptance-run.md` prints 0.
FAILURE PATHS: none: documents only.
Depends on: P1.
Entry check: `grep -c "badge.svg" README.md` prints 1.
Done: committed, tracker row updated.

### F: Final checks (lane: app, Opus)

GOAL: The branch is green on every gate, and every cited line still points at what it claims.
READ FIRST: §Progress; the Edge matrix.
CHANGE: none.
MIRROR: none.
INVARIANTS: all laws in scope above. The profile has no `docs.check` and no `docs.feature_index`, so both steps are skipped.
DECIDED: none.
OUT OF SCOPE: fixes; anything found becomes a new row.
ACCEPTANCE: `npm test && npm run typecheck && npm run lint && npm run build && npm run test:integration`, and `cite-shift.py --base $(git merge-base HEAD origin/main || git merge-base HEAD main) --require-symbol` prints `shift=0 review=0 nosym=0`.
For `/plan-engine:verify-work`, the user flows changed are:
- render document (alerts, footnotes, Mermaid diagrams, the Diagram/Source switch, an invalid diagram, the reading position across a re-render);
- comment on a diagram's source (card placement, marker, the card click that reveals the source, the selection hint);
- whole-document comment (composer, card, prompt, hint);
- copy or send prompt (chat, terminal, fallbacks);
- agent notes (write the notes file, section, card note, Dismiss, the next prompt removes the file and carries undismissed notes).

Seams to exercise live: the host→webview `reviewState` (`review.agentNotes`, comments with no `anchor`, `comment.agentNote`), the webview→host `addDocumentComment`, `dismissAgentNote` and `sendPrompt`, and the lazy load of the Mermaid file under the real CSP.
FAILURE PATHS: none: this phase only runs checks.
Depends on: R1.
Entry check: `git status --porcelain | grep -v '^??' | wc -l` prints 0.
Done: gates pass, tracker row updated.

### CI2: A recorded green CI run on the final code (lane: infra, kind: owner)

GOAL: The branch is pushed and both CI jobs pass on the final code, which settles U6.
READ FIRST: `.github/workflows/ci.yml`.
CHANGE: none.
MIRROR: none.
INVARIANTS: L-no-vsce-publish; L-no-ovsx-publish.
DECIDED: D7, D37, D51. The branch can be pushed at any point after CI1 to see the jobs early. A failing job becomes a new row (lane app, depends on F) with the failing output saved to `~/.claude/plans/mdcm/release-expansion/CI2.md`; F is re-run after it.
OUT OF SCOPE: publishing.
ACCEPTANCE: the Actions run for the branch's last commit shows `check` and `windows` green; the owner records the run URL in the tracker note.
FAILURE PATHS: none: an owner run. A red job stops the release until its row is done.
Depends on: F.
Entry check: `ls .github/workflows/ci.yml | wc -l` prints 1.
Done: run recorded, tracker row updated.

### O1: Manual acceptance with four agents (lane: docs, kind: owner)

GOAL: Plan 05 Part A is green, including the Plan 04 boxes, the B4 re-link, every new-feature box, and the blind run with Claude Code, Copilot Chat, Cursor and Codex.
READ FIRST: `docs/plans/05-acceptance-run.md` Part A as rewritten in R1.
CHANGE: none.
MIRROR: none.
INVARIANTS: Part A stops the release if it is not green.
DECIDED: D4, D6. An agent that ignores the notes file is recorded, not failed: the feature degrades to today's behaviour for that agent. An agent that breaks the document because of the notes sentence is a red box and becomes a new row. If the plain-shell box shows prompt lines being run (U8 false), that is a red box.
OUT OF SCOPE: packaging. `docs/plans/04-acceptance-run.md` is ticked by the owner during the run. It isn't a CHANGE file, because owner phases have none.
ACCEPTANCE: every Part A box is checked in `docs/plans/05-acceptance-run.md`; `grep -c "\- \[ \]" docs/plans/04-acceptance-run.md` prints 0.
FAILURE PATHS: none: an owner run. A red box stops the release and becomes a new row.
Depends on: CI2.
Entry check: `grep -c "Codex" docs/plans/05-acceptance-run.md` prints ≥ 2.
Done: boxes checked and committed by the owner, tracker row updated.

### O2: Package, record, publish (lane: docs, kind: owner)

GOAL: 0.1.0 is live on the Marketplace and Open VSX, with a demo video and a `v0.1.0` tag.
READ FIRST: `docs/plans/05-acceptance-run.md` Parts B and C; `docs/media/RECORDING.md`.
CHANGE: none.
MIRROR: none.
INVARIANTS: L-no-vsce-publish, L-no-ovsx-publish. The owner runs both.
DECIDED: D3, D11, D38.
OUT OF SCOPE: code. `docs/plans/05-acceptance-run.md` is ticked by the owner; it isn't a CHANGE file, because owner phases have none.
ACCEPTANCE: `npm run package` produces the archive under the 2 MB budget (U7); C1–C5 are checked; private vulnerability reporting is enabled on the repository; `git tag` lists `v0.1.0`.
FAILURE PATHS: none: an owner run. A failed packaged check stops before publish.
Depends on: O1.
Entry check: `grep -c "\- \[x\]" docs/plans/05-acceptance-run.md` prints ≥ 1.
Done: the owner records the publish, tracker row updated.

## Lanes and the contract

There is one lane (`app`, repo root; runner `npm (run )?(test|check)` / `npx vitest`), plus `docs` for 0, R1 and two owner rows, and `infra` for CI1 and CI2. There is no contract phase (D24): `messages.ts` is compiled into both bundles and type-checked by `npm run typecheck`, so drift fails the build. Shared files touched in several phases are all on the one sequential chain:

- `package.json` and `package-lock.json` (A1, A2, M1; `package.json` again in N4, S2, P1)
- `MARKDOWN_REVIEW_PRD.md` (A1, A2, M1, M4, W2, N2, S2)
- `.claude/laws.md` (M1, M3, N2) and `CLAUDE.md` (M1, N2, R1)
- `CHANGELOG.md` (A1, A2, M4, W5, N6, S2, R1)
- `src/anchor/types.ts` (W1, N1) and `src/store/reviewFile.ts` (W1, N1)
- `src/panel/messages.ts` (W1, W3, N1, N4, S1)
- `src/panel/ReviewPanel.ts` (W1, W3, N4, N5, S2)
- `src/store/ReviewStore.ts` (N3 only)
- `src/prompt/buildPrompt.ts` (W1, W2, N2) and `src/commands/copyPrompt.ts` (N4, S2)
- `media/src/webview.ts` (M2, M4, M5, W4, W5, N5, N6, S3) and `media/src/comments.ts` (M5, W1, W5, N6)
- `media/src/selection.ts` (B1, M4, W4) and `media/src/anchorSpace.ts` (B1 only)
- `media/src/header.ts` (W4, S3) and `media/webview.css` (A1, A2, M4, M5, W4, W5, N5, N6, S3)
- `dev/harness/index.html` (M2, M6, N5, T1, H1) and `dev/harness/generate.mjs` (M2, M6, H1)
- `docs/fixtures/rich-blocks.md` (A1, A2, M4)

## Decision coverage

Built from the independent review of 2026-11-18 and updated for the fixes made after it. No row is `contradicts`. The one contradiction the review found (D35 against S4's old `sendText` fallback) is removed: S4 now has no code fallback. Each quote is from the named phase's brief.

| decision | phase | verdict | quote |
|---|---|---|---|
| D1 | M1 | applies | L-no-new-deps (D1, D23); L-lazy-activation (`package.json` `activationEvents` untouched). |
| D2 | W5 | applies | A whole-document comment's card sits first in the column, labelled "Whole document", and shows "Document changed since the … |
| D2 | N6 | applies | A card whose comment the agent pushed back on shows the note under "Agent note", with Dismiss, in the column and in the orphan … |
| D2 | S2 | applies | Two commands, and the pane's `sendPrompt` message, place the prompt in VS Code chat or paste it into the active terminal without … |
| D3 | 0 | applies | The plan is committed on a fresh branch, so every later phase starts from a recorded plan. |
| D3 | O2 | applies | 0.1.0 is live on the Marketplace and Open VSX, with a demo video and a `v0.1.0` tag. |
| D4 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D4 | O1 | applies | Plan 05 Part A is green, including the Plan 04 boxes, the B4 re-link, every new-feature box, and the blind run with Claude Code, … |
| D5 | N2 | applies | With workspace storage the prompt tells the agent where to write disagreements; elsewhere it keeps today's sentence. The PRD, the … |
| D6 | R1 | applies | agent notes with each of Claude Code, Copilot Chat, Cursor and Codex (the blind run, D6); Dismiss on a note, and the note staying … |
| D6 | O1 | applies | Plan 05 Part A is green, including the Plan 04 boxes, the B4 re-link, every new-feature box, and the blind run with Claude Code, … |
| D7 | CI1 | applies | Every push to `main` and every pull request runs the checks on Linux and the unit and integration suites on Windows, and the repo … |
| D7 | CI2 | applies | The branch is pushed and both CI jobs pass on the final code, which settles U6. |
| D8 | A1 | applies | L-no-new-deps (approved in D8, D23); L-bundle-size; L-reanchor-perf. |
| D8 | A2 | applies | L-no-new-deps (D8, D23); L-bundle-size; L-reanchor-perf (`npx vitest run --project node src/test/perf.test.ts` stays green). |
| D9 | CI1 | applies | Every push to `main` and every pull request runs the checks on Linux and the unit and integration suites on Windows, and the repo … |
| D9 | P1 | applies | The Marketplace listing is findable under AI, and the README shows the CI badge. |
| D10 | - | n/a | The competitor check changed no phase; it is recorded in Context. |
| D11 | M1 | applies | update the "500 KB package budget" comment to 2 MB (D11). |
| D11 | M2 | applies | The webview can obtain Mermaid on first need without a CSP change, and a real browser shows Mermaid loading and rendering under … |
| D11 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D11 | O2 | applies | 0.1.0 is live on the Marketplace and Open VSX, with a demo video and a `v0.1.0` tag. |
| D12 | M3 | applies | A self-contained webview module turns a `mermaid` code block into a diagram with a Diagram/Source switch, a loading line and an … |
| D12 | M4 | applies | `MARKDOWN_REVIEW_PRD.md`: §6 Rendering gains the Mermaid behaviour (D12, D17, D52). |
| D12 | M5 | applies | A comment made in a diagram's Source view keeps its card beside the diagram, the diagram shows "N comments in source", and … |
| D12 | M6 | applies | Alerts, footnotes and Mermaid are verified in a real layout engine in all three themes, under the pane's CSP. |
| D13 | S1 | applies | The message contract and the user-facing strings for sending a prompt exist and are tested. |
| D13 | S2 | applies | `MARKDOWN_REVIEW_PRD.md`: §7 gains sending (D13, D35); §9 lists the two commands. |
| D13 | S3 | applies | The header has a "Send to" menu with "VS Code chat" and "Active terminal" beside "Copy review prompt". |
| D13 | S4 | applies | A multi-line prompt pasted into a terminal program that enabled bracketed paste arrives as one paste with no early Enter, shown … |
| D14 | N1 | applies | The notes text an agent writes can be split into per-comment chunks and unattached chunks by a pure, tested function, and the … |
| D14 | N2 | applies | Its one request beyond editing the document is a free-prose notes file for disagreements (release-expansion D14)". … |
| D14 | N3 | applies | The review store reads the notes file, keeps each note until it is dismissed, and ends a round without losing a late write. |
| D14 | N4 | applies | Copying a prompt names the notes file, reads any pending notes first and ends the round; the pane can dismiss a note. |
| D14 | N5 | applies | Notes the agent did not tie to a comment appear in a "Notes from the agent" section with a Dismiss button, and their arrival is … |
| D14 | N6 | applies | A card whose comment the agent pushed back on shows the note under "Agent note", with Dismiss, in the column and in the orphan … |
| D15 | W1 | applies | The data model, the sidecar guard and re-anchoring accept a whole-document comment; nothing visible changes yet. |
| D15 | W2 | applies | `src/test/buildPrompt.test.ts`: a `describe('buildPrompt — whole-document comments (D15)')` block. |
| D15 | W3 | applies | The host accepts an `addDocumentComment` message and stores a comment with no anchor. |
| D15 | W4 | applies | The header and the empty-state box offer "Comment on document", which opens the comment composer and posts the new message. |
| D15 | W5 | applies | A whole-document comment's card sits first in the column, labelled "Whole document", and shows "Document changed since the … |
| D15 | H1 | applies | The new cards, the notes section and the Send menu are verified in a real layout engine in all three themes. |
| D16 | T1 | applies | The rewrite banner's Dismiss and the unreadable-target state have automated coverage, so D22 and B3c need no GitHub issue. |
| D16 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D17 | M3 | applies | Render error, load failure and timeout each leave the source visible with a reason line (D17, D22). An empty fence is left alone. … |
| D17 | M4 | applies | `MARKDOWN_REVIEW_PRD.md`: §6 Rendering gains the Mermaid behaviour (D12, D17, D52). |
| D17 | M6 | applies | Alerts, footnotes and Mermaid are verified in a real layout engine in all three themes, under the pane's CSP. |
| D18 | M3 | applies | A self-contained webview module turns a `mermaid` code block into a diagram with a Diagram/Source switch, a loading line and an … |
| D18 | M4 | applies | A `mermaid` block in a reviewed document shows as a diagram with the Diagram/Source switch, the reading position holds while … |
| D18 | M5 | applies | A comment made in a diagram's Source view keeps its card beside the diagram, the diagram shows "N comments in source", and … |
| D18 | W2 | applies | The copied prompt lists open whole-document comments first, under "On the document as a whole:", numbered with the rest. |
| D18 | W4 | applies | The header and the empty-state box offer "Comment on document", which opens the comment composer and posts the new message. |
| D18 | W5 | applies | A whole-document comment's card sits first in the column, labelled "Whole document", and shows "Document changed since the … |
| D18 | N2 | applies | With it, the header's third line is the D18 sentence with the path in backticks; without it the line is unchanged. |
| D18 | N5 | applies | Notes the agent did not tie to a comment appear in a "Notes from the agent" section with a Dismiss button, and their arrival is … |
| D18 | N6 | applies | A card whose comment the agent pushed back on shows the note under "Agent note", with Dismiss, in the column and in the orphan … |
| D18 | S1 | applies | … string and sendFallbackMessage(target: SendTarget): string, returning the D18 and D22 strings exactly. |
| D18 | S3 | applies | The header has a "Send to" menu with "VS Code chat" and "Active terminal" beside "Copy review prompt". |
| D18 | H1 | applies | The new cards, the notes section and the Send menu are verified in a real layout engine in all three themes. |
| D19 | N3 | applies | The review store reads the notes file, keeps each note until it is dismissed, and ends a round without losing a late write. |
| D19 | N4 | applies | Copying a prompt names the notes file, reads any pending notes first and ends the round; the pane can dismiss a note. |
| D19 | N5 | applies | Notes the agent did not tie to a comment appear in a "Notes from the agent" section with a Dismiss button, and their arrival is … |
| D19 | N6 | applies | A card whose comment the agent pushed back on shows the note under "Agent note", with Dismiss, in the column and in the orphan … |
| D19 | H1 | applies | The new cards, the notes section and the Send menu are verified in a real layout engine in all three themes. |
| D20 | N2 | applies | §7 documents the sentence, the notes file, D20 and the lifecycle (D47). |
| D20 | N3 | applies | … only when the review is in a workspace folder and `storageLocation` is `workspace` (D20). Every method below is a no-op when it … |
| D20 | N4 | applies | Copying a prompt names the notes file, reads any pending notes first and ends the round; the pane can dismiss a note. |
| D20 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D21 | M1 | applies | the loop skips the NETWORK needles when it is false, with a comment citing D21. Add { needle: 'mermaidAPI', why: 'Mermaid … |
| D21 | M2 | applies | The webview can obtain Mermaid on first need without a CSP change, and a real browser shows Mermaid loading and rendering under … |
| D22 | A1 | applies | A `> [!NOTE]` block renders as a titled callout (Note, Tip, Important, Warning, Caution, or the author's own words after the … |
| D22 | A2 | applies | `[^1]` renders as a `[1]` link to the footnote text at the end of the document, and both the label and the footnote text can be … |
| D22 | M3 | applies | … error, load failure and timeout each leave the source visible with a reason line (D17, D22). An empty fence is left alone. A … |
| D22 | W4 | applies | The header and the empty-state box offer "Comment on document", which opens the comment composer and posts the new message. |
| D22 | N5 | applies | Notes the agent did not tie to a comment appear in a "Notes from the agent" section with a Dismiss button, and their arrival is … |
| D22 | N6 | applies | A card whose comment the agent pushed back on shows the note under "Agent note", with Dismiss, in the column and in the orphan … |
| D22 | S1 | applies | … string and sendFallbackMessage(target: SendTarget): string, returning the D18 and D22 strings exactly. |
| D22 | S2 | applies | `package.json`: the two commands with the D22 titles. |
| D22 | H1 | applies | The new cards, the notes section and the Send menu are verified in a real layout engine in all three themes. |
| D23 | A1 | applies | L-no-new-deps (approved in D8, D23); L-bundle-size; L-reanchor-perf. |
| D23 | A2 | applies | L-no-new-deps (D8, D23); L-bundle-size; L-reanchor-perf (`npx vitest run --project node src/test/perf.test.ts` stays green). |
| D23 | M1 | applies | L-no-new-deps (D1, D23); L-lazy-activation (`package.json` `activationEvents` untouched). |
| D24 | - | n/a | Structural: one lane and no contract phase; see "Lanes and the contract". |
| D25 | W1 | applies | The data model, the sidecar guard and re-anchoring accept a whole-document comment; nothing visible changes yet. |
| D25 | N1 | applies | The notes text an agent writes can be split into per-comment chunks and unattached chunks by a pure, tested function, and the … |
| D26 | W1 | applies | … `anchor?: Anchor`, documented as "absent on a whole-document comment (release-expansion D26)". Export … |
| D26 | W3 | applies | The host accepts an `addDocumentComment` message and stores a comment with no anchor. |
| D27 | B1 | applies | … one line in §9 recording the rule and why (release-expansion D27). |
| D27 | M3 | applies | A self-contained webview module turns a `mermaid` code block into a diagram with a Diagram/Source switch, a loading line and an … |
| D27 | M5 | applies | A comment made in a diagram's Source view keeps its card beside the diagram, the diagram shows "N comments in source", and … |
| D28 | M1 | applies | `npm run build` produces `media/mermaid.min.js` beside the webview bundle, guarded by a size cap, with the no-network rule for it … |
| D28 | M2 | applies | … CSP: the check appends a nonce'd script for the Mermaid file, calls initialize with D28's config, renders one flowchart and … |
| D28 | M3 | applies | It then loads Mermaid once, calls `initialize` with D28's config, `fontFamily` from the body's computed style and … |
| D28 | M4 | applies | A `mermaid` block in a reviewed document shows as a diagram with the Diagram/Source switch, the reading position holds while … |
| D29 | M3 | applies | … and calls `refresh()` only when the result differs from the one the last render used (D29). |
| D29 | M4 | applies | diagram colours are derived from them at runtime, D29); L-state-not-by-colour-alone; L-webview-imports-messages-only; … |
| D29 | M6 | applies | Alerts, footnotes and Mermaid are verified in a real layout engine in all three themes, under the pane's CSP. |
| D30 | A2 | applies | … md.use(footnote), then md.inline.ruler.disable('footnote_inline') (D30). First print the token stream of 'A[^1].\n\n[^1]: … |
| D31 | B1 | applies | Text inside an element marked `data-no-anchor` is never counted as anchor text, wherever the element sits; nothing visible … |
| D31 | A1 | applies | `src/test/plaintext.test.ts`: a `describe('alerts (release-expansion D31)')` block with the tests in ACCEPTANCE. |
| D32 | N2 | applies | With workspace storage the prompt tells the agent where to write disagreements; elsewhere it keeps today's sentence. The PRD, the … |
| D32 | N3 | applies | The review store reads the notes file, keeps each note until it is dismissed, and ends a round without losing a late write. |
| D33 | N1 | applies | cut: boolean }, implementing D33 and D34: normalize, cut, chunk, collect numbers, attach when 1 ≤ n ≤ promptCount. |
| D33 | N3 | applies | The review store reads the notes file, keeps each note until it is dismissed, and ends a round without losing a late write. |
| D34 | N1 | applies | cut: boolean }, implementing D33 and D34: normalize, cut, chunk, collect numbers, attach when 1 ≤ n ≤ promptCount. |
| D34 | N5 | applies | Notes the agent did not tie to a comment appear in a "Notes from the agent" section with a Dismiss button, and their arrival is … |
| D35 | S2 | applies | This file never types text into a terminal itself (D35). |
| D35 | S4 | applies | A multi-line prompt pasted into a terminal program that enabled bracketed paste arrives as one paste with no early Enter, shown … |
| D36 | S2 | applies | Two commands, and the pane's `sendPrompt` message, place the prompt in VS Code chat or paste it into the active terminal without … |
| D37 | CI1 | applies | A comment states that the no-network rule binds the shipped extension, not CI, and why `PERF` is off (D37). |
| D37 | CI2 | applies | The branch is pushed and both CI jobs pass on the final code, which settles U6. |
| D38 | CI1 | applies | Every push to `main` and every pull request runs the checks on Linux and the unit and integration suites on Windows, and the repo … |
| D38 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D38 | O2 | applies | 0.1.0 is live on the Marketplace and Open VSX, with a demo video and a `v0.1.0` tag. |
| D39 | P1 | applies | `package.json`: `categories` becomes `["AI", "Other"]`; `keywords` becomes the D39 list. |
| D40 | W4 | applies | The header and the empty-state box offer "Comment on document", which opens the comment composer and posts the new message. |
| D40 | W5 | applies | A whole-document comment's card sits first in the column, labelled "Whole document", and shows "Document changed since the … |
| D41 | M1 | applies | `npm run build` produces `media/mermaid.min.js` beside the webview bundle, guarded by a size cap, with the no-network rule for it … |
| D41 | M3 | applies | L-innerhtml-sanitized-only (as amended, D41); L-block-offsets-single-source (the wrapper carries no `data-ap-*` and is skipped by … |
| D41 | N2 | applies | L-prompt-prose-only (as amended, D41); L-prd-non-goals (as amended, D42); L-sidecar-path-separators; … |
| D41 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D42 | N2 | applies | … threads: one-way, plain text, no reply, never sent back to the agent (release-expansion D42)". §7 documents the sentence, the … |
| D42 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D43 | T1 | applies | The rewrite banner's Dismiss and the unreadable-target state have automated coverage, so D22 and B3c need no GitHub issue. |
| D43 | R1 | applies | The README, changelog and acceptance runsheet describe the release as it now is, and Part A has a box for every new feature and … |
| D44 | W1 | applies | The data model, the sidecar guard and re-anchoring accept a whole-document comment; nothing visible changes yet. |
| D45 | W2 | applies | The copied prompt lists open whole-document comments first, under "On the document as a whole:", numbered with the rest. |
| D46 | M2 | applies | The webview can obtain Mermaid on first need without a CSP change, and a real browser shows Mermaid loading and rendering under … |
| D46 | M3 | applies | A self-contained webview module turns a `mermaid` code block into a diagram with a Diagram/Source switch, a loading line and an … |
| D47 | N1 | applies | dismissed: string[] }, documented field by field per D47 (unattached is the text shown; carried is the part of it that came … |
| D47 | N3 | applies | A comment that has a note and gets no chunk in this read keeps its note (D47). |
| D47 | N4 | applies | Copying a prompt names the notes file, reads any pending notes first and ends the round; the pane can dismiss a note. |
| D48 | A1 | applies | A `> [!NOTE]` block renders as a titled callout (Note, Tip, Important, Warning, Caution, or the author's own words after the … |
| D49 | M4 | applies | A `mermaid` block in a reviewed document shows as a diagram with the Diagram/Source switch, the reading position holds while … |
| D49 | W4 | applies | The header and the empty-state box offer "Comment on document", which opens the comment composer and posts the new message. |
| D49 | N5 | applies | Notes the agent did not tie to a comment appear in a "Notes from the agent" section with a Dismiss button, and their arrival is … |
| D50 | A2 | applies | … sets no `data-line` on tokens between `footnote_block_open` and `footnote_block_close` (D50); `data-ap-start` and `data-ap-end` … |
| D50 | M4 | applies | `pinnedLine` is cleared by the first `wheel`, `touchstart`, `pointerdown` or `keydown` after `setContent` (D50). |
| D50 | M6 | applies | Alerts, footnotes and Mermaid are verified in a real layout engine in all three themes, under the pane's CSP. |
| D51 | CI1 | applies | Every push to `main` and every pull request runs the checks on Linux and the unit and integration suites on Windows, and the repo … |
| D51 | CI2 | applies | The branch is pushed and both CI jobs pass on the final code, which settles U6. |
| D52 | M3 | applies | … when the user uses the switch or `showSource` is called, and read by every `refresh()` (D52). |
| D52 | M5 | applies | A comment made in a diagram's Source view keeps its card beside the diagram, the diagram shows "N comments in source", and … |
| D52 | M6 | applies | Alerts, footnotes and Mermaid are verified in a real layout engine in all three themes, under the pane's CSP. |

coverage-hash: 0300423e

## §Progress (resume here: the next phase, by the rule below)

| phase | lane | depends on | scope | state | commits | note |
|---|---|---|---|---|---|---|
| 0 | docs | - | branch, plan copy | done | 760d3c7 | - |
| CI1 | infra | 0 | workflow, issue templates, security policy | todo | - | - |
| B1 | app | CI1 | no-anchor subtrees skipped | todo | - | - |
| A1 | app | B1 | GitHub alerts | todo | - | - |
| A2 | app | A1 | footnotes | todo | - | - |
| M1 | app | A2 | Mermaid file, size cap, guard | todo | - | - |
| M2 | app | M1 | lazy loader, CSP probe in the harness | todo | - | - |
| M3 | app | M2 | diagram module | todo | - | - |
| M4 | app | M3 | diagrams in the pane, scroll, hint | todo | - | - |
| M5 | app | M4 | comments on diagram source | todo | - | - |
| M6 | app | M5 | harness rich-blocks scenarios | todo | - | - |
| W1 | app | M6 | optional anchor in the model | todo | - | - |
| W2 | app | W1 | document comments in the prompt | todo | - | - |
| W3 | app | W2 | host message and store | todo | - | - |
| W4 | app | W3 | composer and buttons | todo | - | - |
| W5 | app | W4 | whole-document card | todo | - | - |
| N1 | app | W5 | notes model and parsing | todo | - | - |
| N2 | app | N1 | prompt sentence, rule amendments | todo | - | - |
| N3 | app | N2 | store: ingest, dismiss, rounds | todo | - | - |
| N4 | app | N3 | prompt command, dismiss message | todo | - | - |
| N5 | app | N4 | notes section and shell | todo | - | - |
| N6 | app | N5 | note on a card | todo | - | - |
| S1 | app | N6 | send message and wording | todo | - | - |
| S2 | app | S1 | commands and delivery | todo | - | - |
| S3 | app | S2 | Send menu | todo | - | - |
| S4 | app | S3 | terminal paste proof | todo | - | - |
| T1 | app | S4 | Dismiss and unreadable coverage | todo | - | - |
| H1 | app | T1 | harness for new cards and menu | todo | - | - |
| P1 | app | H1 | listing polish | todo | - | - |
| R1 | docs | P1 | README, changelog, runsheet | todo | - | - |
| F | app | R1 | final checks | todo | - | - |
| CI2 | infra | F | recorded green CI run | todo | - | - |
| O1 | docs | CI2 | manual acceptance, four agents | todo | - | - |
| O2 | docs | O1 | package, record, publish | todo | - | - |

**Order:** `0 → CI1 → B1 → A1 → A2 → M1 → M2 → M3 → M4 → M5 → M6 → W1 → W2 → W3 → W4 → W5 → N1 → N2 → N3 → N4 → N5 → N6 → S1 → S2 → S3 → S4 → T1 → H1 → P1 → R1 → F → CI2 → O1 → O2`

The next phase is the first row whose state is not `done`, `skipped` or `dropped` and whose `depends on` rows are all `done`.
