/**
 * Keeps the layout harness's theme presets honest against the stylesheet they stand in for.
 *
 * `check-css-colors.mjs` proves the pane takes every colour from a `--vscode-*` variable. It cannot
 * prove the variable *exists* — an unresolved `var()` renders as nothing at all, with no warning
 * anywhere, which is the failure mode PRD §6's theming requirement is most exposed to.
 *
 * Nothing here can know VS Code's real colour registry, so `dev/harness/themes.css` stands in for
 * it: it is the transcription of the three default themes the harness renders with. Three claims
 * are checked against it —
 *
 *   1. every variable the pane uses is defined in the base block (a typo'd or invented name fails);
 *   2. every *colour* the base block defines is overridden by both the light and high-contrast
 *      blocks (otherwise a dark value leaks into a light theme — the presets share typography on
 *      purpose, so only colours are required);
 *   3. nothing is defined that the pane never uses (dead entries drift out of date silently).
 */

import { readFileSync } from 'node:fs';

const STYLESHEET = process.env.THEME_STYLESHEET ?? 'media/webview.css';
const PRESETS = process.env.THEME_PRESETS ?? 'dev/harness/themes.css';

const BASE = ":root,\n[data-theme='dark']";
const OVERRIDES = ["[data-theme='light']", "[data-theme='hc']"];

/** Names referenced as `var(--vscode-…)`, ignoring comments. */
function usedVariables(css) {
  const used = new Set();
  for (const match of stripComments(css).matchAll(/var\(\s*(--vscode-[\w-]+)/g)) {
    used.add(match[1]);
  }
  return used;
}

/** Declaration blocks keyed by selector, each a map of custom property → value. */
function declaredBlocks(css) {
  const blocks = new Map();
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    const declarations = new Map();
    for (const declaration of match[2].matchAll(/(--vscode-[\w-]+)\s*:\s*([^;]+);/g)) {
      declarations.set(declaration[1], declaration[2].trim());
    }
    blocks.set(selector, declarations);
  }
  return blocks;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const IS_COLOUR = /^(#|rgb|hsl|color)/i;

const used = usedVariables(readFileSync(STYLESHEET, 'utf8'));
const blocks = declaredBlocks(readFileSync(PRESETS, 'utf8'));

const problems = [];

const base = blocks.get(BASE);
if (!base) {
  problems.push(`${PRESETS}: no base block matching "${BASE.replace(/\n/g, ' ')}"`);
} else {
  for (const name of [...used].sort()) {
    if (!base.has(name)) problems.push(`${STYLESHEET} uses ${name}, which no preset defines`);
  }

  for (const [name, value] of [...base].sort()) {
    if (!used.has(name)) problems.push(`${PRESETS} defines ${name}, which ${STYLESHEET} never uses`);
    if (!IS_COLOUR.test(value)) continue; // typography is deliberately shared across the presets
    for (const selector of OVERRIDES) {
      const override = blocks.get(selector);
      if (!override) {
        problems.push(`${PRESETS}: no block for ${selector}`);
        break;
      }
      if (!override.has(name)) problems.push(`${selector} does not override the colour ${name}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n  Theme variable check failed (${problems.length}):\n`);
  for (const problem of problems) console.error(`    ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`  theme variables: ${String(used.size)} used, all defined and overridden in every preset`);
