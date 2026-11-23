/**
 * The two-bundle build (PRD §3, Plan 02 §2).
 *
 * The extension host and the webview are different runtimes with different globals, so they are
 * two entry points with two platforms — never one bundle shared between them.
 */

import esbuild from 'esbuild';
import { copyFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
/** Builds only the integration-test bundles. They are dev-only and never part of the `.vsix`. */
const integration = process.argv.includes('--integration');

/**
 * Emits the markers `.vscode/tasks.json`'s background problem matcher keys off, so F5 waits for
 * the first successful build instead of launching against a stale `dist/`.
 */
const progress = {
  name: 'progress',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      for (const error of result.errors) {
        console.error(`✘ [ERROR] ${error.text}`);
        const at = error.location;
        if (at) console.error(`    ${at.file}:${at.line}:${at.column}:`);
      }
      console.log('[watch] build finished');
    });
  },
};

const common = {
  bundle: true,
  minify: !watch,
  // Inline in watch mode so no stray .map file lands next to the committed CSS.
  sourcemap: watch ? 'inline' : false,
  logLevel: 'silent',
  plugins: [progress],
};

const MERMAID_SRC = 'node_modules/mermaid/dist/mermaid.min.js';
const MERMAID_OUT = 'media/mermaid.min.js';

/** Mermaid ships as its own file beside the webview bundle; a missing source throws with its path. */
function copyMermaid() {
  copyFileSync(MERMAID_SRC, MERMAID_OUT);
}

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    // Provided by the extension host at runtime; bundling it would break activation.
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: ['media/src/webview.ts'],
    outfile: 'media/webview.js',
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
  },
];

/**
 * Two entry points again, for the same reason: `run.ts` is plain Node and drives the launcher,
 * `suite/index.ts` runs inside the extension host. Never minified — a stack trace from a failing
 * assertion is the entire point of the output.
 */
const integrationBuilds = [
  {
    ...common,
    minify: false,
    sourcemap: 'inline',
    entryPoints: ['src/test/integration/run.ts'],
    outfile: 'dist-test/run.js',
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['vscode', '@vscode/test-electron'],
  },
  {
    ...common,
    minify: false,
    sourcemap: 'inline',
    entryPoints: ['src/test/integration/suite/index.ts'],
    outfile: 'dist-test/suite.js',
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['vscode'],
  },
];

async function main() {
  if (integration) {
    await Promise.all(integrationBuilds.map((config) => esbuild.build(config)));
    return;
  }

  if (watch) {
    copyMermaid();
    const contexts = await Promise.all(builds.map((config) => esbuild.context(config)));
    await Promise.all(contexts.map((context) => context.watch()));
    return;
  }

  await Promise.all(builds.map((config) => esbuild.build(config)));

  copyMermaid();

  // The package budget is 2 MB (release-expansion D11) and the Mermaid file is the main risk to
  // it, so every production build reports the number rather than making someone ask.
  const { statSync } = await import('node:fs');
  for (const outfile of [...builds.map((b) => b.outfile), MERMAID_OUT]) {
    const kb = (statSync(outfile).size / 1024).toFixed(1);
    console.log(`  ${outfile.padEnd(24)} ${kb.padStart(8)} KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
