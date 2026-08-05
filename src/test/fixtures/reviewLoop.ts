/**
 * The PRD §7 worked example, as a runnable fixture.
 *
 * PRD §7 specifies the prompt by showing one. That example is the only place the format is pinned
 * down, so it is transcribed here once and asserted byte-for-byte — by `buildPrompt.test.ts` against
 * the pure function, and later by the integration spec against what actually lands on the clipboard.
 * Two copies of a golden file drift; this one cannot.
 *
 * `vscode`-free and file-I/O-free on purpose: the integration suite runs from a separate esbuild
 * bundle in `dist-test/`, where reading a fixture off disk would mean resolving paths relative to a
 * build output. Importing a module works in both bundles for free.
 */

/** Contains all three anchored passages, in the order PRD §7 numbers them. */
export const AUTH_MARKDOWN = `# Auth service

The client retries failed requests up to three times before giving up.

It processes requests in parallel across the worker pool.

## Error handling

Errors surface as structured problem documents.
`;

/** Workspace-relative, forward slashes — matches PRD §7's first line and info message. */
export const AUTH_TARGET_PATH = 'docs/auth.md';

/**
 * The exact text each comment is anchored to, in anchor space.
 *
 * The heading reads `Error handling` rather than `## Error handling`: markdown syntax is not part of
 * the rendered plain text an anchor lives in, which is precisely why `buildPrompt` has to rebuild
 * the `##` from `BlockSpan.headingLevel` for the "On the section" phrasing.
 */
export const AUTH_ANCHORS = {
  retries: 'retries failed requests up to three times',
  parallel: 'processes requests in parallel',
  heading: 'Error handling',
} as const;

export const AUTH_BODIES = {
  retries: 'Three is arbitrary here. Is it configurable? If not, say so explicitly.',
  parallel: "Concurrent or genuinely parallel? These aren't the same claim.",
  heading: "This doesn't cover timeouts at all.",
} as const;

/**
 * PRD §7's example output, verbatim.
 *
 * Note the details that are load-bearing and easy to lose to an editor: straight ASCII apostrophes
 * throughout, a real em dash (U+2014) in the second paragraph, exactly three spaces before each
 * `>`, one blank line between items, and a single trailing newline.
 */
export const AUTH_EXPECTED_PROMPT = `I've left review comments on \`docs/auth.md\`. Please revise the document to address them.

Edit the file directly. Don't add annotations, comments, or replies — just make the changes.
If you disagree with a comment or need clarification, tell me instead of guessing.

1. On: "retries failed requests up to three times"
   > Three is arbitrary here. Is it configurable? If not, say so explicitly.

2. On: "processes requests in parallel"
   > Concurrent or genuinely parallel? These aren't the same claim.

3. On the section "## Error handling"
   > This doesn't cover timeouts at all.
`;
