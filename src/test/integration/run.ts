/**
 * Launcher for the integration suite.
 *
 * Runs in plain Node (not the extension host): it downloads a VS Code build on first use, creates
 * the throwaway directories the specs need, and starts the host pointed at `suite/index.js`.
 *
 * Every directory is under `os.tmpdir()` rather than in the repo, so a run leaves nothing behind
 * and a re-run never sees a previous run's sidecars. The paths reach the specs through
 * `extensionTestsEnv`, which is the only channel across the process boundary.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // `__dirname` is `dist-test/` — the bundle location, not the source location.
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite.js');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdr-integration-'));
  const workspace = path.join(root, 'workspace');
  // Outside `workspace`, so `getWorkspaceFolder` returns undefined for files in it — the loose-file
  // case the globalStorage fallback exists for.
  const loose = path.join(root, 'loose');
  const globalStorage = path.join(root, 'global-storage');
  const userData = path.join(root, 'user-data');

  for (const directory of [workspace, loose, globalStorage, userData]) {
    await fs.mkdir(directory, { recursive: true });
  }

  console.log(`  scratch: ${root}`);

  let failure: unknown;
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        MDR_WORKSPACE: workspace,
        MDR_LOOSE_DIR: loose,
        MDR_GLOBAL_STORAGE: globalStorage,
      },
      launchArgs: [
        workspace,
        // Other extensions are noise; the one under development still loads.
        '--disable-extensions',
        // Otherwise the window opens in restricted mode and never activates anything.
        '--disable-workspace-trust',
        `--user-data-dir=${userData}`,
        '--skip-welcome',
        '--skip-release-notes',
      ],
    });
  } catch (error) {
    failure = error;
  }

  if (failure === undefined) {
    await fs.rm(root, { recursive: true, force: true });
  } else {
    // Left in place on purpose: the sidecars and backups are the evidence.
    console.error(`\n  scratch kept for inspection: ${root}\n`);
    throw failure;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
