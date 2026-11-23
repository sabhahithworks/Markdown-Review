/**
 * The single markdown-it configuration for the whole extension.
 *
 * Phase 1 tokenizes with it to build anchor space; Phase 2 renders HTML with it (Plan 02 §4 adds
 * `data-line` injection and image-URI rewriting on top of the instance this factory returns).
 * One config, two consumers — if the two ever diverged, a user's selection in the rendered pane
 * would not correspond to any offset in anchor space.
 */

import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import githubAlerts from 'markdown-it-github-alerts';
import taskLists from 'markdown-it-task-lists';

export function createMarkdownIt(): MarkdownIt.MarkdownIt {
  const md = new MarkdownIt({
    // PRD §6: raw HTML in the source is never rendered. The webview sanitizes anyway (defense in
    // depth), but not parsing it in the first place keeps anchor space free of markup.
    html: false,
    linkify: true,
    // Must stay false. Typographer rewrites quotes and dashes, which would silently alter the
    // text the user selected — anchor.exact would no longer be what is on screen or on disk.
    typographer: false,
  });

  // PRD §6 requires task lists to render as checkboxes. `enabled: false` keeps them non-interactive:
  // the review pane is read-only.
  md.use(taskLists, { enabled: false, label: false });

  // `> [!NOTE]` blocks become `alert_open` / `alert_close` container tokens. The plugin strips the
  // marker from the first inline token; the title is carried in `token.meta`.
  md.use(githubAlerts, { matchCaseSensitive: false });

  // The plugin retypes the *first* `blockquote_close` after an alert's opening token, which for
  // `> [!NOTE]\n> > inner` is the inner quote's close. Re-pair every close with the open it
  // actually matches so the container tokens nest correctly.
  md.core.ruler.after('github-alerts', 'github-alerts-pairing', (state): void => {
    const stack: MarkdownIt.Token[] = [];
    for (const token of state.tokens) {
      if (token.type === 'alert_open' || token.type === 'blockquote_open') {
        stack.push(token);
      } else if (token.type === 'alert_close' || token.type === 'blockquote_close') {
        const open = stack.pop();
        if (!open) continue;
        const isAlert = open.type === 'alert_open';
        token.type = isAlert ? 'alert_close' : 'blockquote_close';
        token.tag = isAlert ? 'div' : 'blockquote';
      }
    }

    // The plugin leaves an empty paragraph where the marker was when nothing else shared its line.
    for (let i = state.tokens.length - 3; i >= 0; i--) {
      const [open, p, inline, close] = [
        state.tokens[i],
        state.tokens[i + 1],
        state.tokens[i + 2],
        state.tokens[i + 3],
      ];
      if (
        open?.type === 'alert_open' &&
        p?.type === 'paragraph_open' &&
        inline?.type === 'inline' &&
        inline.content.trim() === '' &&
        close?.type === 'paragraph_close'
      ) {
        state.tokens.splice(i + 1, 3);
      }
    }
  });

  // `[^1]` references plus a footnote block at the end of the document. Inline footnotes
  // (`^[text]`) stay literal.
  md.use(footnote);
  md.inline.ruler.disable('footnote_inline');

  return md;
}
