/** `markdown-it-footnote` ships no types. This is the minimal surface in use. */
declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it';

  function footnote(md: MarkdownIt.MarkdownIt): void;

  export default footnote;
}
