/**
 * Builds the data the layout harness renders.
 *
 * The point of this script is that **nothing here is hand-written HTML**. The page has to see the
 * same markup the extension produces — the same `data-ap-start` / `data-ap-end` attributes, the
 * same table and fence handling — or it would be testing a fiction. So the real host modules are
 * bundled with esbuild and called directly: `renderMarkdown` for the HTML, `renderPlainText` for
 * anchor space, `createAnchor` for the anchors and `createLocator` for where they currently sit.
 *
 * Output is `fixture.js` (gitignored), which assigns `window.__FIXTURE__`.
 *
 * Usage: node dev/harness/generate.mjs
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/**
 * The anchors the scenarios are built from, as literal passages of `docs/fixtures/kitchen-sink.md`.
 *
 * Written out rather than picked programmatically so a scenario means something specific: the
 * stacking case needs three anchors a few pixels apart, and only the document knows where those
 * are. If the fixture changes and a passage disappears, generation fails loudly.
 */
const PASSAGES = {
  paragraph: 'validates every incoming bearer token',
  emphasis: 'structured audit entry',
  tableCell: 'Space-delimited list',
  fence: 'export function verify',
  listA: 'Rotate the signing key',
  listB: 'Document the rotation procedure',
  listC: 'Add an expiry alert',
  quote: 'Nested quotes are rendered as a distinct level.',
};

async function loadHostModules() {
  // One bundle re-exporting the four entry points, so the harness data is produced by exactly the
  // code the extension ships rather than a reimplementation of it.
  const entry = `
    export { renderMarkdown } from '${posix(path.join(root, 'src/render/renderer.ts'))}';
    export { renderPlainText } from '${posix(path.join(root, 'src/render/plaintext.ts'))}';
    export { createAnchor } from '${posix(path.join(root, 'src/anchor/create.ts'))}';
    export { createLocator } from '${posix(path.join(root, 'src/anchor/locate.ts'))}';
  `;

  const outfile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mdr-harness-')), 'host.cjs');
  await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    logLevel: 'silent',
  });

  // Resolved against the repo's package.json so the bundle's own requires find node_modules.
  return createRequire(path.join(root, 'package.json'))(outfile);
}

function posix(value) {
  return value.split(path.sep).join('/');
}

/** A comment whose anchor is created from a real offset in real anchor space. */
function makeComment(host, doc, id, passage, overrides = {}) {
  const offset = doc.text.indexOf(passage);
  if (offset < 0) throw new Error(`passage not found in anchor space: ${JSON.stringify(passage)}`);

  const result = host.createAnchor({ selectedText: passage, offset, doc });
  if (!result.ok) throw new Error(`createAnchor rejected ${JSON.stringify(passage)}: ${result.reason}`);

  return {
    id,
    body: 'This needs a second look before we ship it.',
    author: 'harness',
    createdAt: '2026-08-01T09:30:00.000Z',
    status: 'open',
    ...overrides,
    anchor: { ...result.anchor, ...(overrides.anchor ?? {}) },
  };
}

function review(comments) {
  return { version: 1, targetPath: 'docs/fixtures/kitchen-sink.md', comments };
}

async function main() {
  const host = await loadHostModules();
  const source = await fs.readFile(path.join(root, 'docs/fixtures/kitchen-sink.md'), 'utf8');

  const rendered = host.renderMarkdown(source, {});
  const doc = host.renderPlainText(source);
  const locate = host.createLocator(doc);

  const comment = (id, passage, overrides) => makeComment(host, doc, id, passage, overrides);

  const scenarios = {
    basic: {
      label: 'Spread out',
      description: 'Four anchors far apart — a paragraph, inline emphasis, a table cell and a fence.',
      review: review([
        comment('basic001', PASSAGES.paragraph),
        comment('basic002', PASSAGES.emphasis, { body: 'Does "structured" mean JSON here?' }),
        comment('basic003', PASSAGES.tableCell, { body: 'Delimited by one space, or any run?' }),
        comment('basic004', PASSAGES.fence, { body: 'Should this throw instead of returning?' }),
      ]),
    },
    stacking: {
      label: 'Overlapping',
      description:
        'Three anchors on consecutive task-list items. Their natural tops are ~25 px apart and a card is far taller, so every card after the first must be pushed down.',
      review: review([
        comment('stack001', PASSAGES.listA, { body: 'Rotated on the 1st, or 30 days after issue?' }),
        comment('stack002', PASSAGES.listB, { body: 'Link the runbook here.' }),
        comment('stack003', PASSAGES.listC, { body: 'Alert how long before expiry?' }),
      ]),
    },
    uncertain: {
      label: 'Uncertain + orphaned',
      description:
        'One anchor whose text has drifted (fuzzy match, below UNCERTAIN_BELOW → "position uncertain") and one whose text is gone entirely (orphaned, no highlight at all).',
      review: review([
        // Tier 4 (0.3, "position uncertain") needs two things at once: a passage edited enough to
        // miss the exact tiers but still fuzzy-matchable, *and* a hint far enough away that tier
        // 3's proximity term rejects it — tier 3's threshold (0.4) is looser than tier 4's (0.3),
        // so text alone can never fall through to it. That is what a heavily rewritten document
        // looks like, which is exactly the case the badge exists for.
        comment('unc00001', PASSAGES.quote, {
          body: 'This wording changed under us.',
          anchor: {
            exact: PASSAGES.quote.replace('distinct', 'separate'),
            hintOffset: 0,
          },
        }),
        comment('orph0001', PASSAGES.paragraph, {
          body: 'The sentence this was attached to has been deleted.',
          anchor: { exact: 'a sentence that appears nowhere in this document at all' },
        }),
      ]),
    },
    mixed: {
      label: 'Resolved + long body',
      description:
        'A resolved comment (collapsed group at the bottom) beside an open one carrying a very long body, to check card overflow.',
      review: review([
        comment('mix00001', PASSAGES.paragraph, {
          body: [
            'The paragraph asserts the token is validated against the issuer key set before the',
            'request is forwarded, but it does not say what happens when the key set itself cannot',
            'be fetched — do we fail closed, serve from the last known good set, or fall through to',
            'the secondary issuer? All three are defensible and the choice is load-bearing for the',
            'availability numbers in the SLO section, so it should be stated here rather than left',
            'to the reader to infer from the code.',
          ].join(' '),
        }),
        comment('mix00002', PASSAGES.emphasis, { status: 'resolved', body: 'Clarified, thanks.' }),
        comment('mix00003', PASSAGES.tableCell, { status: 'resolved', body: 'Fixed in the table.' }),
      ]),
    },
  };

  // `located` is computed the same way `ReviewPanel.postReviewState` computes it, per scenario.
  for (const scenario of Object.values(scenarios)) {
    scenario.located = {};
    for (const item of scenario.review.comments) {
      scenario.located[item.id] = locate(item.anchor);
    }
  }

  const payload = {
    html: rendered.html,
    frontMatterHtml: rendered.frontMatterHtml ?? '',
    targetPath: 'docs/fixtures/kitchen-sink.md',
    author: 'harness',
    scenarios,
  };

  await fs.writeFile(
    path.join(here, 'fixture.js'),
    `// Generated by dev/harness/generate.mjs — do not edit.\nwindow.__FIXTURE__ = ${JSON.stringify(payload, null, 2)};\n`,
  );

  const report = Object.entries(scenarios).map(([key, scenario]) => {
    const confidences = Object.values(scenario.located).map((found) =>
      found === null ? 'orphaned' : found.confidence.toFixed(1),
    );
    return `    ${key.padEnd(10)} ${confidences.join(', ')}`;
  });
  console.log(`  dev/harness/fixture.js written\n${report.join('\n')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
