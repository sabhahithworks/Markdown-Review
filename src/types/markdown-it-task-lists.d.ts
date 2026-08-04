/**
 * `markdown-it-task-lists` ships no type declarations and has no `@types` package.
 * This is the minimal surface the project uses; widen it only when a call site needs more.
 */
declare module 'markdown-it-task-lists' {
  import type MarkdownIt from 'markdown-it';

  interface TaskListsOptions {
    /** render checkboxes as enabled (clickable) — we always leave this false */
    enabled?: boolean;
    /** wrap the item text in a <label> */
    label?: boolean;
    labelAfter?: boolean;
  }

  function taskLists(md: MarkdownIt.MarkdownIt, options?: TaskListsOptions): void;

  export = taskLists;
}
