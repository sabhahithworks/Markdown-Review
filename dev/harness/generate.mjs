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
  heading: 'Prose and inline formatting',
};

async function loadHostModules() {
  // One bundle re-exporting the host entry points, so the harness data is produced by exactly the
  // code the extension ships rather than a reimplementation of it.
  const entry = `
    export { renderMarkdown } from '${posix(path.join(root, 'src/render/renderer.ts'))}';
    export { renderPlainText } from '${posix(path.join(root, 'src/render/plaintext.ts'))}';
    export { createAnchor } from '${posix(path.join(root, 'src/anchor/create.ts'))}';
    export { createLocator } from '${posix(path.join(root, 'src/anchor/locate.ts'))}';
    export { buildCsp } from '${posix(path.join(root, 'src/panel/csp.ts'))}';
    export { changeStateOf, changedRanges } from '${posix(path.join(root, 'src/detect/changedRanges.ts'))}';
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

/**
 * What the document looked like when the prompt was copied, for the `changed` scenario: the real
 * fixture with one paragraph and one fenced code block rewound. Each edit must apply exactly once,
 * or the scenario would silently stop exercising the block kind it exists for.
 */
const BASELINE_EDITS = [
  // A paragraph. The commented passage in it is untouched, so the comment stays `open` and its card
  // sits beside a marked block — the case where a bar and a highlight share a block.
  ['including\n*rejections*, and it never logs the raw token.', 'including\n*rejections*, and it never stores the raw token.'],
  // The longest fence line, so the `pre` is the one most likely to scroll horizontally (D30).
  ['curl -sS -H "Authorization: Bearer $TOKEN" https://example.com/whoami', 'curl -sS https://example.com/whoami'],
];

function baselineSource(source) {
  let text = source;
  for (const [current, previous] of BASELINE_EDITS) {
    if (text.split(current).length !== 2) throw new Error(`baseline edit does not apply exactly once: ${JSON.stringify(current)}`);
    text = text.replace(current, previous);
  }
  return text;
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
    addressed: {
      label: 'Addressed',
      description:
        'Two comments the extension believes were addressed, showing before/after. One carries a long rewrite, to check the diff wraps inside the card instead of overflowing it.',
      review: review([
        comment('addr0001', PASSAGES.paragraph, {
          status: 'addressed',
          body: 'Say what happens when the key set cannot be fetched.',
          resolution: {
            previousText: PASSAGES.paragraph,
            currentText: `${PASSAGES.paragraph} If the key set cannot be fetched the request fails closed, and the previous set is never reused.`,
            detectedAt: '2026-08-01T10:15:00.000Z',
          },
        }),
        comment('addr0002', PASSAGES.emphasis, {
          status: 'addressed',
          body: 'Does "structured" mean JSON here?',
          resolution: {
            previousText: PASSAGES.emphasis,
            currentText: 'JSON',
            detectedAt: '2026-08-01T10:16:00.000Z',
          },
        }),
      ]),
    },
    orphans: {
      label: 'Orphans',
      description:
        'Three orphaned comments. Before Phase 4b these all rendered at the same point in the gutter, because an orphan never reached the stacking pass and so never got a `top` (Plan 04 §9 D6). This scenario is the regression guard.',
      review: review([
        comment('orphA001', PASSAGES.paragraph, {
          status: 'orphaned',
          body: 'The sentence this was attached to has been deleted.',
          anchor: { exact: 'a sentence that appears nowhere in this document at all' },
        }),
        comment('orphA002', PASSAGES.emphasis, {
          status: 'orphaned',
          body: 'This whole section was rewritten.',
          anchor: { exact: 'another string that is definitely not present anywhere' },
        }),
        comment('orphA003', PASSAGES.tableCell, {
          status: 'orphaned',
          body: 'And the table it referred to is gone too.',
          anchor: { exact: 'a third absent passage, also nowhere to be found here' },
        }),
      ]),
    },
    filtered: {
      label: 'One of each status',
      description:
        'One comment per status, for the header counts and the filter chips. Toggling `open` should remove both its card and its highlight.',
      review: review([
        comment('filt0001', PASSAGES.paragraph, { body: 'Still open.' }),
        comment('filt0002', PASSAGES.emphasis, {
          status: 'addressed',
          body: 'Reworded already.',
          resolution: {
            previousText: PASSAGES.emphasis,
            currentText: 'JSON',
            detectedAt: '2026-08-01T10:16:00.000Z',
          },
        }),
        comment('filt0003', PASSAGES.tableCell, {
          status: 'orphaned',
          body: 'Anchor is gone.',
          anchor: { exact: 'a passage that no longer exists in the document' },
        }),
        comment('filt0004', PASSAGES.fence, { status: 'resolved', body: 'Dealt with.' }),
      ]),
    },
    rewrite: {
      label: 'Rewritten document',
      description:
        'Every comment orphaned in one pass, with a baseline recorded — the banner case. The page posts `rewriteDetected` directly, since only the host can detect the transition.',
      rewriteDetected: 3,
      review: {
        ...review([
          comment('rewr0001', PASSAGES.paragraph, {
            status: 'orphaned',
            body: 'This point still stands.',
            anchor: { exact: 'none of this survived the rewrite, first' },
          }),
          comment('rewr0002', PASSAGES.emphasis, {
            status: 'orphaned',
            body: 'So does this one.',
            anchor: { exact: 'none of this survived the rewrite, second' },
          }),
          comment('rewr0003', PASSAGES.tableCell, {
            status: 'orphaned',
            body: 'And this.',
            anchor: { exact: 'none of this survived the rewrite, third' },
          }),
        ]),
        baselineAt: '2026-08-01T09:00:00.000Z',
      },
    },
    outOfOrder: {
      label: 'Out of document order',
      description:
        'The same three consecutive task-list items as "Overlapping", but declared in reverse — the order they would have if the user commented bottom-up. Comments are stored in insertion order, so this is what the webview really receives; every other scenario happens to declare them in document order, which is why H1 (the stacking pass reading store order while the render pass read document order) was invisible here for two phases. The cards must still land in document order, each beside its own highlight.',
      review: review([
        comment('oord0003', PASSAGES.listC, { body: 'Commented third, but it is highest.' }),
        comment('oord0002', PASSAGES.listB, { body: 'Commented second.' }),
        comment('oord0001', PASSAGES.listA, { body: 'Commented last, but it is lowest.' }),
      ]),
    },
    nearby: {
      label: 'Section changed',
      description:
        'The D17 case: a comment anchored on a heading whose section the agent rewrote. The anchored text itself is untouched, so the comment is still `open` and nothing was inferred \u2014 the card carries a note and a "Looks good" rather than a before/after. Deliberately shown beside an addressed card and an ordinary open one, because the whole point is that the three read differently.',
      sectionChanged: ['near0001'],
      review: {
        ...review([
          comment('near0001', PASSAGES.heading, { body: 'How do we choose the name?' }),
          comment('near0002', PASSAGES.listA, { body: 'Untouched \u2014 no note belongs on this one.' }),
          comment('near0003', PASSAGES.fence, {
            status: 'addressed',
            body: 'Should this throw instead of returning?',
            resolution: {
              previousText: PASSAGES.fence,
              currentText: 'export function verifyOrThrow',
              detectedAt: '2026-08-01T10:15:00.000Z',
            },
          }),
        ]),
        baselineAt: '2026-08-01T09:00:00.000Z',
      },
    },
    changed: {
      label: 'Changed since prompt',
      description:
        'The change view (D28/D30): a baseline that differs from the document in one paragraph and one fenced code block, so exactly those blocks carry a bar, and two comments numbered by the prompt that was copied. `changes` comes from the real `changeStateOf`, as `ReviewPanel.changeState` computes it.',
      changes: (() => {
        const baseline = host.renderPlainText(baselineSource(source)).text;
        const state = host.changeStateOf(baseline, doc, host.changedRanges(baseline, doc.text));
        if (state.state !== 'changed' || state.blocks.length === 0) {
          throw new Error(`the changed scenario produced ${JSON.stringify(state)}, expected changed blocks`);
        }
        return state;
      })(),
      review: {
        ...review([
          comment('chng0001', PASSAGES.paragraph, { body: 'Say what happens when the key set cannot be fetched.' }),
          comment('chng0002', PASSAGES.listA, { body: 'Not in the prompt, so it carries no number.' }),
          comment('chng0003', PASSAGES.fence, { body: 'Should this throw instead of returning?' }),
        ]),
        baselineAt: '2026-08-01T09:00:00.000Z',
        // Prompt order, not document order: the fence comment was listed first.
        promptOrder: ['chng0003', 'chng0001'],
      },
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
    // Anchor space itself, so the gesture suite can assert that the offset the *webview* computed
    // for a selection is the offset the *host* would have computed for the same text. That equality
    // is the whole contract between `anchorSpace.ts` and `plaintext.ts`, and nothing else in the
    // harness is in a position to check it.
    plainText: doc.text,
    // The pane's real CSP string, so the harness page's meta tag can be held to it.
    expectedCsp: host.buildCsp("'self'", 'harness'),
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
