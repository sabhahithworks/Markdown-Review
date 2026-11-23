/**
 * The terminal Send target pastes one pointer line, never the prompt (release-expansion D-q16): the
 * CI run's recorded bytes showed a multi-line paste reaching a Windows terminal as separate lines,
 * because ConPTY does not bracket it. This proves the line reaches a terminal program whole and
 * with no line break, on every platform.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { promptPointerLine } from '../../../prompt/pointer.js';
import { defaultIo } from '../../../commands/promptTargets.js';
import { delay, describe, it, waitFor } from './harness.js';

const PASTE_SETTLE_MS = 500;
const PROBE_READY_TIMEOUT_MS = 20000;
const PASTE_ARRIVAL_TIMEOUT_MS = 10000;
const TAIL_SETTLE_MS = 300;
const OPEN = '\x1b[200~';
const CLOSE = '\x1b[201~';

function stripMarkers(bytes: string): string {
  return bytes.split(OPEN).join('').split(CLOSE).join('');
}

let pointerLine = '';

const PROBE = path.resolve(__dirname, '..', 'src', 'test', 'integration', 'fixtures', 'pasteProbe.cjs');

/**
 * The program that runs the probe. On Windows, Code.exe is a GUI-subsystem binary: run as Node
 * under ConPTY it gets no TTY (`stdin.isTTY` undefined, no `setRawMode`), so the probe needs a
 * console `node.exe` from PATH. Elsewhere the extension host's own binary works as Node.
 */
function probeShell(): string {
  if (process.platform !== 'win32') return process.execPath;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, 'node.exe');
    if (dir && fs.existsSync(candidate)) return candidate;
  }
  throw new Error('the terminal paste probe needs node.exe on PATH on Windows');
}

let recorded: Promise<string | undefined> | undefined;

/** Runs the paste once and returns the bytes the probe saw, or undefined when the clipboard is unavailable. */
function pasteIntoProbe(): Promise<string | undefined> {
  recorded ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-paste-'));
    const recordFile = path.join(dir, 'record.bin');
    const readyFile = path.join(dir, 'ready');
    const terminal = vscode.window.createTerminal({
      name: 'paste probe',
      shellPath: probeShell(),
      shellArgs: [PROBE, recordFile, readyFile],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
    try {
      terminal.show();
      try {
        await waitFor(
          () => vscode.window.activeTerminal === terminal && fs.existsSync(readyFile),
          'the probe terminal to be active and ready',
          PROBE_READY_TIMEOUT_MS,
        );
      } catch (err) {
        const probeError = fs.existsSync(`${readyFile}.err`) ? fs.readFileSync(`${readyFile}.err`, 'utf8') : '<none>';
        const detail = [
          `active=${vscode.window.activeTerminal === terminal}`,
          `activeName=${vscode.window.activeTerminal?.name ?? '<none>'}`,
          `ready=${fs.existsSync(readyFile)}`,
          `exitStatus=${JSON.stringify(terminal.exitStatus)}`,
          `shell=${probeShell()}`,
          `probeError=${probeError}`,
        ].join('; ');
        throw new Error(`${(err as Error).message}; ${detail}`, { cause: err });
      }
      await delay(PASTE_SETTLE_MS);

      const line = promptPointerLine(path.join(dir, 'spec [draft].md.prompt.md'));
      assert.ok(line !== undefined);
      pointerLine = line;
      const text = line;
      await vscode.env.clipboard.writeText(text);
      if ((await vscode.env.clipboard.readText()) !== text) {
        if (process.platform === 'linux') {
          console.log('    - skipped: the clipboard is unavailable on this Linux session');
          return undefined;
        }
        throw new Error('the clipboard did not hold the text just written');
      }

      assert.equal(await defaultIo.toTerminal(), true);
      try {
        await waitFor(
          () => fs.existsSync(recordFile) && stripMarkers(fs.readFileSync(recordFile, 'latin1')).includes(line),
          'the probe to record the pointer line',
          PASTE_ARRIVAL_TIMEOUT_MS,
        );
      } catch (err) {
        const seen = fs.existsSync(recordFile)
          ? JSON.stringify(fs.readFileSync(recordFile, 'latin1'))
          : '<no record file>';
        throw new Error(`${(err as Error).message}; recorded bytes: ${seen}`, { cause: err });
      }
      await delay(TAIL_SETTLE_MS);
      return fs.readFileSync(recordFile, 'latin1');
    } finally {
      terminal.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })();
  return recorded;
}

describe('terminal paste (release-expansion S6)', () => {
  it('the pointer line arrives whole', async () => {
    const bytes = await pasteIntoProbe();
    if (bytes === undefined) return;
    assert.equal(stripMarkers(bytes), pointerLine);
  });

  it('no line break reaches the terminal', async () => {
    const bytes = await pasteIntoProbe();
    if (bytes === undefined) return;
    assert.doesNotMatch(bytes, /[\r\n]/, `a line break in ${JSON.stringify(bytes)}`);
  });
});
