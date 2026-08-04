/**
 * The single markdown-it configuration for the whole extension.
 *
 * Phase 1 tokenizes with it to build anchor space; Phase 2 renders HTML with it (Plan 02 §4 adds
 * `data-line` injection and image-URI rewriting on top of the instance this factory returns).
 * One config, two consumers — if the two ever diverged, a user's selection in the rendered pane
 * would not correspond to any offset in anchor space.
 */

import MarkdownIt from 'markdown-it';
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

  return md;
}
