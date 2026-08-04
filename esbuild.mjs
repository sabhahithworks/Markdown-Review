/**
 * The two-bundle build (PRD §3, Plan 02 §2).
 *
 * The extension host and the webview are different runtimes with different globals, so they are
 * two entry points with two platforms — never one bundle shared between them.
 */

import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

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

async function main() {
  if (watch) {
    const contexts = await Promise.all(builds.map((config) => esbuild.context(config)));
    await Promise.all(contexts.map((context) => context.watch()));
    return;
  }

  await Promise.all(builds.map((config) => esbuild.build(config)));

  // Phase 5 has a 500 KB package budget and the webview bundle (DOMPurify + highlight.js) is the
  // main risk to it, so every production build reports the number rather than making someone ask.
  const { statSync } = await import('node:fs');
  for (const { outfile } of builds) {
    const kb = (statSync(outfile).size / 1024).toFixed(1);
    console.log(`  ${outfile.padEnd(24)} ${kb.padStart(8)} KB`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
