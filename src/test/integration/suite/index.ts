/**
 * The entry point `@vscode/test-electron` calls inside the extension host.
 *
 * Import order is the run order: `activation.spec` must come first, because its first assertion is
 * that the extension has *not* activated yet, and running any command would spoil it.
 */

import './activation.spec.js';
import './target.spec.js';
import './store.spec.js';
import './detection.spec.js';
import './indicators.spec.js';
import './notes.spec.js';
import './send.spec.js';
import './terminalPaste.spec.js';
import { runAll } from './harness.js';

export async function run(): Promise<void> {
  // PRD §11's "no unhandled rejection" acceptance item, made mechanical. Several code paths here
  // are fire-and-forget (`void this.addComment(...)`, `void store.warnLooseFile()`), so a rejection
  // would otherwise vanish into the host log rather than failing the run.
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', onRejection);

  try {
    await runAll();
  } finally {
    process.off('unhandledRejection', onRejection);
  }

  if (rejections.length > 0) {
    for (const reason of rejections) console.error(`  unhandled rejection: ${String(reason)}`);
    throw new Error(`${String(rejections.length)} unhandled rejection(s) during the run`);
  }
}
