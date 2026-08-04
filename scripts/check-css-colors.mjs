/**
 * Fails the build when the webview stylesheet hardcodes a colour (PRD §6: "Hardcoded colors are a
 * bug"; Plan 02 §7 requires this as a build step).
 *
 * Plan 02 §7 describes it as "a grep". A literal grep is not portable to Windows and false-positives
 * on `content: "#tag"` and `url(data:…)`, so comments, quoted strings and url() payloads are
 * stripped before scanning. `transparent`, `currentColor` and `inherit` carry no colour of their own
 * and stay legal.
 */

import { readFileSync } from 'node:fs';

/** `CSS_TARGET` is a test seam: point it at a probe file to confirm the check still has teeth. */
const TARGETS = [process.env.CSS_TARGET ?? 'media/webview.css'];

const BANNED = [
  { label: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { label: 'colour function', pattern: /\b(?:rgba?|hsla?|hwb|color-mix|color|lab|lch|oklab|oklch)\s*\(/gi },
  {
    // The lookarounds exclude `-`, so a colour word that is only *part* of an identifier does not
    // match: `white-space: pre` is a layout keyword, and `var(--vscode-charts-blue)` is exactly
    // the themed indirection this check exists to encourage.
    label: 'named colour',
    pattern:
      /(?<![\w-])(?:white|black|red|blue|green|yellow|orange|purple|pink|brown|gray|grey|silver|navy|teal|maroon|olive|lime|aqua|cyan|magenta|fuchsia|gold|beige|ivory|khaki|coral|salmon|tan|violet|indigo|turquoise)(?![\w-])/gi,
  },
];

function strip(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/url\([^)]*\)/gi, (m) => 'url(' + ' '.repeat(Math.max(0, m.length - 5)) + ')')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => '"' + ' '.repeat(Math.max(0, m.length - 2)) + '"')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => "'" + ' '.repeat(Math.max(0, m.length - 2)) + "'");
}

let failures = 0;

for (const file of TARGETS) {
  let css;
  try {
    css = readFileSync(file, 'utf8');
  } catch {
    // The stylesheet does not exist yet (early in Phase 2's build sequence). Nothing to check.
    continue;
  }

  // Blanking rather than deleting keeps every offset — and therefore every line number — intact.
  const lines = strip(css).split('\n');

  for (const [index, line] of lines.entries()) {
    for (const { label, pattern } of BANNED) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) {
        console.error(`${file}:${index + 1}: ${label} "${match[0]}" — use a var(--vscode-*) instead`);
        failures += 1;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} hardcoded colour(s). Theming must go through VS Code CSS variables.`);
  process.exit(1);
}
