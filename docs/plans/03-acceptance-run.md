# Phase 3 acceptance — the manual run

Plan 03 §8's checklist, reduced to what a machine cannot do. Everything else is now covered by two
harnesses (see `docs/plans/README.md` → *Verification harnesses*), so this should take about ten
minutes rather than an exploratory afternoon.

Run it before starting Phase 4. Record the date and outcome in Plan 03 §8 when it passes.

## Before you start

```sh
npm run check            # typecheck + lint + 344 unit tests
npm run test:integration # 18 host-side assertions in a real VS Code
npm run build            # both bundles + the CSS guards
```

Then <kbd>F5</kbd>. The launch config opens `docs/fixtures/` as the dev-host folder, so
`kitchen-sink.md` is one click away, and its `.reviews/` directory is where sidecars will appear.

Delete `docs/fixtures/.reviews/` first if a previous run left one behind.

## The run

**1 — Create flow.** Open `kitchen-sink.md` → *Markdown Review: Open Review Pane*. Select the
sentence "The authentication service validates every incoming bearer token…". A floating **Comment**
button appears near the selection; click it, type a comment, submit with <kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd>.

> Expect: the popover closes, a card appears in the right margin aligned to that sentence, and the
> sentence gains a subtle highlight. Hovering the card emphasises the highlight and vice versa.

**2 — Rejections.** Select a single word of two characters, then a passage well over 500 characters
(the whole "Fenced code" section will do). Try to comment on each.

> Expect: `Select at least 3 characters` and `Selection too long to anchor — select under 500
> characters`, and **no** new card or sidecar entry either time. The wording itself is asserted by
> `src/test/notices.test.ts`; what is being checked here is that nothing is persisted.

**3 — Hand-edit the sidecar.** Open `docs/fixtures/.reviews/kitchen-sink.md.json` in an editor
beside the pane. Change a comment's `body` and save.

> Expect: the card text updates without touching the pane. (The store half of this is covered by
> `store.spec.ts`; what is manual is that the card re-renders.)

**4 — Reload.** *Developer: Reload Window* with the pane open.

> Expect: the pane comes back against the same file, with the same comments and roughly the same
> scroll position. This is the `WebviewPanelSerializer` path and it has no automated coverage.

**5 — Two windows.** Open `docs/fixtures/` in a second window and open the review pane there too.
Add a comment in one window.

> Expect: it appears in the other within a second or two. This goes through the sidecar's
> `FileSystemWatcher`, not shared memory — two windows are two extension hosts. (Two panes in *one*
> window is not reachable by design; see Plan 03 §9.)

**6 — CSP.** *Developer: Open Webview Developer Tools* on the pane, then reload it.

> Expect: zero `Content Security Policy` violations in the console. Nothing else can check this —
> the CSP is enforced by VS Code, and the layout harness deliberately does not reproduce it.

**7 — Themes.** Switch between Dark+, Light+ and a High Contrast theme with the pane open, with at
least one comment on screen.

> Expect: card, popover, highlight and the "position uncertain" badge all remain legible; no element
> disappears into its background. The layout harness renders approximations of these three and they
> pass, so this is a confirmation against the real palette rather than a first look.
>
> Known weak spot to look at specifically: `.mr-highlight` differentiates by `background-color`
> alone. That is the thing high-contrast themes are least tolerant of, and under Windows
> forced-colors mode the background is stripped by the OS entirely. If it reads poorly, the fix is
> an outline rather than a background — but check before changing it.

**8 — Narrow pane.** Drag the pane's edge until it is under 700 px wide, then back.

> Expect: the margin collapses to small inline markers next to each anchored passage; clicking one
> expands its card inline. Nothing overflows the right edge in either state, and the output channel
> (*View → Output → Markdown Review*) stays empty. Both of the bugs the layout harness found lived
> exactly here, so it is worth doing slowly.

## What this run no longer has to cover

Automated since the harnesses landed, and re-checked by `npm run test:integration`:

- sidecar path, flattening and pretty-printing, including the nested-path `__` case
- add / edit / resolve / delete round-tripping to disk
- corrupt and future-version sidecars → `.bak` with the original bytes, empty state, distinct reason
- loose file outside a workspace → hashed sidecar under globalStorage, warned once
- `markdownReview.storageLocation: global`
- external edits: valid ones adopted, invalid ones ignored without a `.bak`, our own writes not echoed
- pending writes flushed on shutdown
- lazy activation, command registration, one pane per file, target deleted mid-review, the 2 MB guard

And by the layout harness (`dev/harness/`, real browser layout):

- overlapping cards stack without overlap, and are demonstrably displaced by the stacking pass
- highlights land on the text they are anchored to, including inside a syntax-highlighted fence
- "position uncertain" and orphaned states render distinctly
- resolved comments collapse into a group
- the < 700 px collapse, and nothing escaping the content box in either mode
