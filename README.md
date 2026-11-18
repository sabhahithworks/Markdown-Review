# Markdown Review

[![CI](https://github.com/sabhahithworks/Markdown-Review/actions/workflows/ci.yml/badge.svg)](https://github.com/sabhahithworks/Markdown-Review/actions/workflows/ci.yml)

**Comment on any Markdown file like a Google Doc. Copy one prompt into any agent: no MCP server,
no setup. Your file is never modified with markers, and the pane shows which comments were addressed
and what the agent changed.**

Select a passage in a review pane and leave a comment. When you have said your piece, copy a prompt
and paste it at whichever agent you already use: Claude Code, Copilot, Cursor, Gemini, Codex. It
edits the prose; the extension works out which comments got addressed by watching the file change.

## The loop

![Comments in the review pane, aligned to the passages they are anchored to](https://raw.githubusercontent.com/sabhahithworks/Markdown-Review/main/docs/media/pane-commenting.jpg)

1. **Open the review pane.** *Markdown Review: Open Review Pane*, or the button in the editor title
   bar of any Markdown file.
2. **Comment.** Select rendered text, click **Comment**, type, <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>.
   Comments live in the margin, aligned to the passage they are anchored to.
3. **Copy the prompt** and paste it at your agent, `@`-mentioning the file. You get plain prose:

   ```
   I've left review comments on `docs/auth.md`. Please revise the document to address them.

   Edit the file directly. Don't add annotations, comments, or replies — just make the changes.
   If you disagree with a comment or need clarification, tell me instead of guessing.

   1. On: "retries failed requests up to three times"
      > Three is arbitrary here. Is it configurable? If not, say so explicitly.

   2. On the section "## Error handling"
      > This doesn't cover timeouts at all.

   3. On: "the token" (under "## Refresh", line 42)
      > Which token is this, the access token or the refresh token?
   ```

4. **Confirm.** As the agent edits, cards flip to **addressed** and show you the before and after.
   **Looks good** resolves one; **Reopen** puts it back.

![An addressed comment showing the previous text struck through and the agent's replacement below it, with Looks good and Reopen actions](https://raw.githubusercontent.com/sabhahithworks/Markdown-Review/main/docs/media/pane-addressed.jpg)

The agent is never asked to write structured data, follow a schema, or preserve annotations — only
to edit prose. All the bookkeeping is this extension's job. That is the whole reason it works with
any agent at all.

## Diagrams, alerts and footnotes

A fenced `mermaid` block renders as a diagram, with a **Diagram / Source** switch above it. An invalid
diagram stays in Source view with Mermaid's own message. Comment on a diagram by selecting its source;
if you select text inside the drawn diagram, the pane tells you to switch to Source, because the
drawing is not text. Clicking a card on a diagram's source reveals that source.

GitHub alerts (`> [!NOTE]`, Tip, Important, Warning, Caution) render as titled callouts, and an alert
with its own title keeps it. Footnotes (`[^1]`) render as a `[1]` link to the note at the end of the
document; both the reference and the note can be commented on, and your reading position in the
footnotes survives an agent's edit.

## Send to chat or terminal

Besides copying the prompt, the header's **Send to** menu (and the commands *Send Review Prompt to
Chat* and *Send Review Prompt to Terminal*) delivers it for you. Chat opens VS Code's chat with the
prompt typed in; the terminal gets it pasted into the active terminal. Nothing is submitted: you press
Enter yourself. At a plain shell prompt VS Code shows its own multi-line paste warning, and nothing
runs until you confirm. If the target is unavailable, the prompt is copied instead.

## Whole-document comments

For feedback on the document as a whole, such as "the tone is too formal", click **Comment on
document** in the header. No selection is needed. The card sits first, labelled **Whole document**,
and the prompt lists it as a comment on the document rather than on a passage. It notes when the file
has changed since the prompt.

## Agent notes

When the agent disagrees with a comment or needs clarification, the prompt asks it to say so in plain
words in a notes file, `.reviews/<document>.notes.md`, and to mention the comment's number. The pane
shows what it wrote under **Notes from the agent**, and attaches a note to a card when the agent
mentions that card's number, labelled **Agent note**. This is not a thread: it is one-way, plain text,
you cannot reply to it, and it is never sent back to the agent in a later prompt.

- A note stays until you click **Dismiss** on it, or the agent writes a newer note for the same
  comment. Once dismissed it stays dismissed when the agent adds another note.
- Copying or sending the next prompt deletes the notes file; the agent creates it again if it needs to.
- Agent notes need `workspace` storage and a document inside a workspace folder. With
  `markdownReview.storageLocation` set to `global`, or a file outside every workspace folder, the prompt
  keeps its plain sentence and no notes file is named.
- An agent that ignores the notes file just behaves as before.

## Prompt numbers

Each card from the last prompt you copied shows its item number, for example `#3`. When the agent
replies "on item 3, I changed...", you can find the card. When a quoted passage appears more than
once in the document, the prompt says where, as in item 3 above.

## Status bar and badges

A status bar item shows the active Markdown file's counts, for example `3 open · 2 to confirm`, and
opens the review pane when clicked. Reviewed files get an Explorer badge with the number of comments
needing action. Both show as soon as you open a workspace that holds `.reviews/` files, with no pane
open.

Reviews kept in global storage (`markdownReview.storageLocation` set to `global`) show these
indicators only after their review has been loaded in the current session, for example by opening
its pane. They are not scanned, because the hashed storage names cannot be mapped back to a folder
in a multi-root workspace.

## Changes since prompt

After you copy a prompt, the blocks the agent changed are marked with a bar in the margin, and the
header shows `Show changes (4)`, which opens a side-by-side diff against the version you copied.
When nothing changed it reads `No changes since prompt`. For a document too large to mark inline,
the button still opens the diff and its tooltip says why there are no marks. A document over
262,144 characters (256 K) of rendered text when you copy the prompt gets no baseline, so it shows
neither marks nor the button; the `Markdown Review` output channel says why.

## How detection works — and what it does not promise

`addressed` is **inferred**, by comparing the text an anchor points at against a snapshot taken when
you copied the prompt. It is a suggestion, not a verdict. You confirm it.

That means it is sometimes wrong in both directions: an agent can rewrite a sentence without
addressing the point, and it can address the point somewhere else entirely. Two consequences the
design takes seriously:

- **Nothing is ever deleted automatically.** No comment, no sidecar, ever, for any reason. Comments
  you clear are backed up first.
- **A comment that can no longer be found becomes `orphaned`, not resolved.** It moves to a triage
  section showing the text it used to point at, and you can re-anchor it to a new passage by hand.

If the whole document is replaced, every comment orphans, a banner appears, and you can diff the
snapshot against what is there now. Turn inference off entirely with
`markdownReview.autoDetectResolution` if you would rather resolve everything by hand.

![The header bar showing counts for open, addressed, orphaned and resolved, above an orphaned comment awaiting triage](https://raw.githubusercontent.com/sabhahithworks/Markdown-Review/main/docs/media/pane-statuses.jpg)

Every status is a filter chip in the header, so you can narrow the pane to just what still needs
you.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `markdownReview.author` | *system username* | Name attached to your comments. Defaults to your system username. |
| `markdownReview.storageLocation` | `workspace` | `workspace` writes to `.reviews/` (shareable via git). `global` keeps comments private to your machine. |
| `markdownReview.autoDetectResolution` | `true` | Mark comments as addressed when their anchored text changes. |

## Where your comments live

One JSON file per reviewed document, under `.reviews/` in your workspace, named after the document
with `/` flattened to `__`:

```
docs/specs/auth.md  →  .reviews/docs__specs__auth.md.json
```

Human-readable and versioned, so it diffs and merges like anything else in the repo — commit it and
your review travels with the branch, or add `.reviews/` to `.gitignore` and keep it to yourself. If
a sidecar is ever corrupt, it is backed up to `.json.bak` and you are told, rather than silently
discarded.

Set `storageLocation` to `global` to keep sidecars out of the repo entirely.

## Privacy

**No telemetry, no network requests, no analytics. Ever.** Not opt-out — absent. The only thing that
ever leaves your machine is the prompt you copy, to the agent you chose to paste it into.

Mermaid ships inside the extension, in its own file that the pane loads only when a document contains a
diagram. The pane's Content Security Policy allows no connection of any kind, so even that file cannot
reach the network.

This is checked rather than promised: `scripts/check-bundles.mjs` fails the build if the extension or
the pane bundle so much as contains `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `EventSource`
or a Node networking `require`. The Mermaid file is exempt from that name check, since it is a
third-party library, and is held to a size cap; the CSP is what keeps it offline, and a test pins it.

## Not in v1

No comment threads or replies (one comment per anchor; agent notes are one-way plain text, not threads), no multi-user identity beyond a display
name, no real-time collaboration, no reactions, no editing markdown in the preview, and no MCP
server — that last one is a good v2 and is deliberately out of scope now.

## Requirements

VS Code 1.90 or later.

## License

[MIT](LICENSE).
