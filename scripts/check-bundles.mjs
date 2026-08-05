/**
 * Fails the build when a shipped bundle grows a network call, swallows the wrong dependency, or
 * quietly outgrows the package budget (Plan 05 §8).
 *
 * PRD §2 and §13 both state the same absolute — "no telemetry, no network requests, no analytics.
 * Ever." — and until this script it was the one product claim with no test behind it. The webview's
 * CSP would block a fetch at runtime, but the extension host has no CSP, and neither would tell
 * anyone before a user noticed.
 *
 * **Why the bans name APIs and not URLs.** The obvious check is to grep for `https://`, and it is
 * useless: DOMPurify carries XML namespace URIs (`http://www.w3.org/1999/xhtml`, `.../2000/svg`) and
 * markdown-it carries URL-handling literals, so a URL ban is all false positives and would be
 * switched off within a week. Banning the handful of things that can actually open a socket costs no
 * false positives and is what the PRD means.
 *
 * `EXTENSION_BUNDLE` / `WEBVIEW_BUNDLE` are test seams: point either at a probe file to confirm the
 * check still has teeth.
 */

import { statSync, readFileSync } from 'node:fs';

/** Anything here can open a socket. `require` forms cover the CJS extension bundle. */
const NETWORK = [
  'fetch(',
  'XMLHttpRequest',
  'WebSocket',
  'sendBeacon',
  'EventSource',
  'require("http")',
  'require("https")',
  'require("net")',
  'require("tls")',
  'require("dns")',
  'require("node:http")',
  'require("node:https")',
  'require("node:net")',
  'require("node:tls")',
  'require("node:dns")',
];

const BUNDLES = [
  {
    file: process.env.EXTENSION_BUNDLE ?? 'dist/extension.js',
    // ~30% over today's 172 KB: ordinary growth is fine, an accidental dependency is not.
    maxKB: 220,
    // The extension host has no business carrying a syntax highlighter. If this fires, the two
    // bundles have stopped tree-shaking independently and the webview's copy has leaked across.
    banned: [{ needle: 'hljs', why: 'highlight.js belongs to the webview bundle only' }],
  },
  {
    file: process.env.WEBVIEW_BUNDLE ?? 'media/webview.js',
    // ~30% over today's 124 KB.
    maxKB: 160,
    banned: [],
  },
];

/** Minified bundles are one or two enormous lines, so a line number tells nobody anything. */
function context(source, index, needle) {
  const from = Math.max(0, index - 40);
  const to = Math.min(source.length, index + needle.length + 40);
  return `${from > 0 ? '…' : ''}${source.slice(from, to).replace(/\n/g, ' ')}${to < source.length ? '…' : ''}`;
}

let failures = 0;

function fail(message) {
  console.error(message);
  failures += 1;
}

for (const { file, maxKB, banned } of BUNDLES) {
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    fail(`${file}: not built. Run \`npm run build\` before this check.`);
    continue;
  }

  for (const needle of NETWORK) {
    const at = source.indexOf(needle);
    if (at !== -1) {
      fail(`${file}: network API "${needle}" — PRD §2/§13 permit no network calls at all.`);
      fail(`    ${context(source, at, needle)}`);
    }
  }

  for (const { needle, why } of banned) {
    const at = source.indexOf(needle);
    if (at !== -1) {
      fail(`${file}: contains "${needle}" — ${why}.`);
      fail(`    ${context(source, at, needle)}`);
    }
  }

  const kb = statSync(file).size / 1024;
  if (kb > maxKB) {
    fail(
      `${file}: ${kb.toFixed(1)} KB exceeds its ${maxKB} KB ceiling. ` +
        `Find what was added, or raise the ceiling deliberately — the package budget is 500 KB (Plan 05 §8).`,
    );
  }
}

if (failures > 0) {
  process.exit(1);
}
