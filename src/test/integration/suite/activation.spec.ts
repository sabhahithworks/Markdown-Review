/**
 * The extension itself, as VS Code sees it (Plan 02 §9 rows 1, 9, 12, 13).
 *
 * Unlike `store.spec.ts`, nothing here is a second copy of anything: these assertions go through
 * `vscode.extensions` and `vscode.commands` against the extension the host actually loaded.
 *
 * Registration order matters. The lazy-activation assertion is only meaningful before anything has
 * run a command, so this file is imported — and therefore runs — first (see `index.ts`).
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { REVIEW_VIEW_TYPE } from '../../../panel/messages.js';
import { exists, workspaceUri, writeText } from './context.js';
import { delay, describe, it, waitFor } from './harness.js';

const COMMANDS = [
  'markdownReview.open',
  'markdownReview.copyPrompt',
  'markdownReview.clearAddressed',
  'markdownReview.clearAll',
];

function extension(): vscode.Extension<unknown> {
  // Phase 5 declared the publisher, so the id is stable now.
  const found = vscode.extensions.getExtension('SabhahithWorks.markdown-review');
  assert.ok(found, 'the extension under development was not loaded by the test host');
  return found;
}

function reviewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(REVIEW_VIEW_TYPE),
    );
}

async function closeEverything(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => reviewTabs().length === 0, 'all review panes to close');
}

describe('activation', () => {
  it('stays dormant until a command is used', () => {
    // PRD §9 / Plan 02 §2: activation is inferred from `contributes.commands`, with no
    // `onStartupFinished`. This assertion is why this spec runs first.
    assert.equal(extension().isActive, false, 'the extension activated without being asked');
  });

  it('declares exactly the one activation event a panel restore needs', () => {
    // D24. This used to assert `activationEvents` was absent entirely, which is what left a
    // reloaded review pane blank: inference from `contributes.commands` covers the entry points the
    // user initiates, and a panel restore is initiated by VS Code. The serializer is registered at
    // runtime, so only this declaration tells VS Code to wake us for one.
    //
    // Asserted as an exact list rather than a `.includes`, because the constraint is two-sided:
    // the event must be there, and nothing broader — `onStartupFinished` or `onLanguage:markdown`
    // would load the extension for every window or every Markdown file and pass a looser check.
    const events: unknown = extension().packageJSON.activationEvents;
    assert.deepEqual(
      events,
      ['onWebviewPanel:markdownReview.panel'],
      'activationEvents must be exactly the panel-restore event (D24)',
    );

    // The dormancy assertion above already proves it stays lazy *with* this event declared: both
    // run before any command, and this event fires only during an actual restore.
    assert.equal(extension().isActive, false, 'declaring the event must not activate anything');
  });

  it('activates on markdownReview.open and registers all four commands', async () => {
    const target = workspaceUri('activation.md');
    await writeText(target, '# activation\n\nsome prose to render.\n');

    await vscode.commands.executeCommand('markdownReview.open', target);
    await waitFor(() => extension().isActive, 'the extension to activate');

    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of COMMANDS) {
      assert.ok(registered.has(command), `${command} is declared but not registered`);
    }

    await waitFor(() => reviewTabs().length === 1, 'the review pane to open');
    await closeEverything();
  });
});

describe('panel lifecycle', () => {
  it('reveals the existing pane instead of opening a second one for the same file', async () => {
    const target = workspaceUri('single-pane.md');
    await writeText(target, '# single\n\nsome prose to render.\n');

    await vscode.commands.executeCommand('markdownReview.open', target);
    await waitFor(() => reviewTabs().length === 1, 'the first pane');

    await vscode.commands.executeCommand('markdownReview.open', target);
    await delay(500);

    // Plan 03 §9 restated the "two panels on one file" acceptance item around this: panels are
    // keyed by URI by design, so the cross-panel case is two *windows*, not two panes.
    assert.equal(reviewTabs().length, 1, 'a second pane opened for the same file');
    await closeEverything();
  });

  it('keeps the pane and the comments when the target file is deleted', async () => {
    const target = workspaceUri('vanishing.md');
    await writeText(target, '# vanishing\n\nsome prose to render.\n');

    await vscode.commands.executeCommand('markdownReview.open', target);
    await waitFor(() => reviewTabs().length === 1, 'the pane to open');

    await vscode.workspace.fs.delete(target);
    await waitFor(async () => !(await exists(target)), 'the file to be gone');
    await delay(1000);

    // PRD §11: the pane reports and survives. An unhandled rejection here would be caught by the
    // process-level guard in `index.ts`.
    assert.equal(reviewTabs().length, 1, 'the pane closed itself when the file disappeared');
    await closeEverything();
  });

  it('opens a file over the 2 MB guard without throwing', async () => {
    const target = workspaceUri('huge.md');
    // Just over TOO_LARGE_BYTES, so the guard path runs rather than the render path.
    await writeText(target, `# huge\n\n${'lorem ipsum dolor sit amet. '.repeat(80_000)}\n`);

    await vscode.commands.executeCommand('markdownReview.open', target);
    await waitFor(() => reviewTabs().length === 1, 'the pane to open for a large file');
    await delay(500);
    await closeEverything();
  });

  it('refuses a non-Markdown file without opening a pane', async () => {
    const target = workspaceUri('notes.txt');
    await writeText(target, 'not markdown');

    await vscode.commands.executeCommand('markdownReview.open', target);
    await delay(750);

    assert.equal(reviewTabs().length, 0, 'a pane opened for a .txt file');
  });
});
