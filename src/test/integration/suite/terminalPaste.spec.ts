/**
 * The terminal Send target pastes with the workbench paste command (release-expansion S4). A
 * terminal program that enabled bracketed paste must receive the prompt as one paste, so a
 * multi-line prompt does not submit on its first newline.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { defaultIo } from '../../../commands/promptTargets.js';
import { delay, describe, it, waitFor } from './harness.js';

const PASTE_SETTLE_MS = 500;
const PROBE_READY_TIMEOUT_MS = 20000;
const PASTE_ARRIVAL_TIMEOUT_MS = 10000;
const TAIL_SETTLE_MS = 300;
const OPEN = '\x1b[200~';
const CLOSE = '\x1b[201~';
const LINES = ['first line of the prompt', 'second line of the prompt', 'third line of the prompt'];

const PROBE = path.resolve(__dirname, '..', 'src', 'test', 'integration', 'fixtures', 'pasteProbe.cjs');

let recorded: Promise<string | undefined> | undefined;

/** Runs the paste once and returns the bytes the probe saw, or undefined when the clipboard is unavailable. */
function pasteIntoProbe(): Promise<string | undefined> {
  recorded ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-paste-'));
    const recordFile = path.join(dir, 'record.bin');
    const readyFile = path.join(dir, 'ready');
    const terminal = vscode.window.createTerminal({
      name: 'paste probe',
      shellPath: process.execPath,
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
          `execPath=${process.execPath}`,
          `probeError=${probeError}`,
        ].join('; ');
        throw new Error(`${(err as Error).message}; ${detail}`, { cause: err });
      }
      await delay(PASTE_SETTLE_MS);

      const text = LINES.join('\n');
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
          () => fs.existsSync(recordFile) && fs.readFileSync(recordFile, 'latin1').includes(CLOSE),
          'the probe to record the closing paste marker',
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

describe('terminal paste (release-expansion S4)', () => {
  it('paste arrives bracketed and whole', async () => {
    const bytes = await pasteIntoProbe();
    if (bytes === undefined) return;
    const open = bytes.indexOf(OPEN);
    const close = bytes.indexOf(CLOSE);
    assert.ok(open >= 0, `no opening marker in ${JSON.stringify(bytes)}`);
    assert.ok(close > open, `no closing marker after the opening one in ${JSON.stringify(bytes)}`);
    const inner = bytes.slice(open + OPEN.length, close);
    let from = 0;
    for (const line of LINES) {
      const at = inner.indexOf(line, from);
      assert.ok(at >= 0, `line ${JSON.stringify(line)} missing or out of order in ${JSON.stringify(inner)}`);
      from = at + line.length;
    }
  });

  it('no line is submitted outside the paste', async () => {
    const bytes = await pasteIntoProbe();
    if (bytes === undefined) return;
    const open = bytes.indexOf(OPEN);
    const close = bytes.indexOf(CLOSE);
    assert.ok(open >= 0 && close > open, `markers missing in ${JSON.stringify(bytes)}`);
    assert.equal(bytes.slice(0, open), '', 'bytes arrived before the paste');
    assert.equal(bytes.slice(close + CLOSE.length), '', 'bytes arrived after the paste');
    const inner = bytes.slice(open + OPEN.length, close);
    const lineRegex = new RegExp(LINES.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
    const pieces = inner.split(lineRegex);
    assert.equal(pieces.length, LINES.length + 1, `unexpected pieces in ${JSON.stringify(inner)}`);
    pieces.forEach((piece, i) => {
      const edge = i === 0 || i === pieces.length - 1;
      assert.match(piece, edge ? /^[\r\n]*$/ : /^[\r\n]+$/, `bad separator ${JSON.stringify(piece)}`);
    });
  });
});
