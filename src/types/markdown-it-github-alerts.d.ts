/**
 * `markdown-it-github-alerts` ships ESM-only types, which the CommonJS-typed extension project
 * cannot import (TS1479); esbuild bundles it regardless. This is the minimal surface in use.
 */
declare module 'markdown-it-github-alerts' {
  import type MarkdownIt from 'markdown-it';

  interface GithubAlertsOptions {
    /** match markers case sensitively; the plugin default is false */
    matchCaseSensitive?: boolean;
  }

  function githubAlerts(md: MarkdownIt.MarkdownIt, options?: GithubAlertsOptions): void;

  export default githubAlerts;
}
