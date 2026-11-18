/**
 * Sending the review prompt to chat or the terminal (release-expansion S2), driven through
 * `deliverPrompt` with a stub `PromptIo` that records its calls.
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { createAnchor } from '../../../anchor/create.js';
import type { Comment, ReviewFile } from '../../../anchor/types.js';
import { deliverPrompt } from '../../../commands/copyPrompt.js';
import { defaultIo, type PromptIo } from '../../../commands/promptTargets.js';
import { renderPlainText } from '../../../render/plaintext.js';
import { REVIEWS_DIR } from '../../../store/sidecarPath.js';
import { readSettledText, stubContext, stubOutput, workspaceUri, writeText } from './context.js';
import { delay, describe, it, waitFor } from './harness.js';

const MARKDOWN = '# Send\n\nThe service retries three times before it gives up.\n';
const NEEDLE = 'retries three times';

interface Recorder extends PromptIo {
  readonly chatPrompts: string[];
  toTerminalCalls: number;
  readonly messages: string[];
  readonly errors: string[];
}

function recorder(chat: () => Promise<boolean>, terminal: () => Promise<boolean>): Recorder {
  const rec: Recorder = {
    chatPrompts: [],
    toTerminalCalls: 0,
    messages: [],
    errors: [],
    toChat(prompt: string): Promise<boolean> {
      rec.chatPrompts.push(prompt);
      return chat();
    },
    toTerminal(): Promise<boolean> {
      rec.toTerminalCalls += 1;
      return terminal();
    },
    notify(message: string): void {
      rec.messages.push(message);
    },
    error(message: string): void {
      rec.errors.push(message);
    },
  };
  return rec;
}

async function seed(name: string, withComment = true): Promise<{ target: vscode.Uri; read: () => Promise<ReviewFile> }> {
  const target = workspaceUri('docs', `${name}.md`);
  const sidecar = workspaceUri(REVIEWS_DIR, `docs__${name}.md.json`);
  await vscode.workspace.fs.createDirectory(workspaceUri('docs'));
  await writeText(target, MARKDOWN);

  const doc = renderPlainText(MARKDOWN);
  const created = createAnchor({ selectedText: NEEDLE, offset: doc.text.indexOf(NEEDLE), doc });
  if (!created.ok) throw new Error(`createAnchor rejected: ${created.reason}`);
  const comment: Comment = {
    id: `${name}-1`,
    body: 'Why three?',
    author: 'integration',
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    anchor: created.anchor,
  };
  const review: ReviewFile = {
    version: 1,
    targetPath: `docs/${name}.md`,
    comments: withComment ? [comment] : [],
  };
  await vscode.workspace.fs.createDirectory(workspaceUri(REVIEWS_DIR));
  await writeText(sidecar, `${JSON.stringify(review, null, 2)}\n`);
  return { target, read: async () => JSON.parse(await readSettledText(sidecar)) as ReviewFile };
}

async function deliver(target: vscode.Uri, kind: 'chat' | 'terminal', io: PromptIo): Promise<void> {
  await deliverPrompt(stubContext().context, stubOutput([]), target, kind, io);
}

async function baselineOf(read: () => Promise<ReviewFile>): Promise<ReviewFile> {
  await waitFor(async () => (await read()).baselineAt !== undefined, 'the baseline to be snapshotted');
  return read();
}

describe('send review prompt (release-expansion S2)', () => {
  it('chat target hands over the prompt', async () => {
    const { target, read } = await seed('send-chat');
    await vscode.env.clipboard.writeText('sentinel');
    const io = recorder(() => Promise.resolve(true), () => Promise.resolve(true));

    await deliver(target, 'chat', io);

    assert.equal(io.chatPrompts.length, 1);
    assert.equal(await vscode.env.clipboard.readText(), io.chatPrompts[0]);
    assert.deepEqual(io.messages, ['1 comment placed in VS Code chat. Press Enter to send.']);
    const saved = await baselineOf(read);
    assert.ok(saved.promptOrder !== undefined && saved.promptOrder.length === 1);
  });

  it('falls back to copy', async () => {
    const chatMessage = 'VS Code chat is not available here. The prompt was copied instead.';
    const terminalMessage = 'No terminal is open. The prompt was copied instead.';
    const cases: { name: string; kind: 'chat' | 'terminal'; io: Recorder; message: string }[] = [
      { name: 'send-fb-chat-false', kind: 'chat', io: recorder(() => Promise.resolve(false), () => Promise.resolve(false)), message: chatMessage },
      { name: 'send-fb-chat-throw', kind: 'chat', io: recorder(() => Promise.reject(new Error('boom')), () => Promise.resolve(false)), message: chatMessage },
      { name: 'send-fb-term-false', kind: 'terminal', io: recorder(() => Promise.resolve(false), () => Promise.resolve(false)), message: terminalMessage },
      { name: 'send-fb-term-throw', kind: 'terminal', io: recorder(() => Promise.resolve(false), () => Promise.reject(new Error('boom'))), message: terminalMessage },
    ];
    for (const item of cases) {
      const { target, read } = await seed(item.name);
      await vscode.env.clipboard.writeText('sentinel');
      await deliver(target, item.kind, item.io);

      const clipboard = await vscode.env.clipboard.readText();
      assert.notEqual(clipboard, 'sentinel', `${item.name}: the prompt must be on the clipboard`);
      assert.ok(clipboard.includes('Why three?'), `${item.name}: clipboard holds the prompt`);
      assert.deepEqual(item.io.messages, [item.message], item.name);
      const saved = await baselineOf(read);
      assert.ok(saved.baselineText !== undefined, `${item.name}: baseline taken`);
    }
  });

  it('second send re-snapshots', async () => {
    const { target, read } = await seed('send-twice');
    const io = recorder(() => Promise.resolve(true), () => Promise.resolve(true));

    await deliver(target, 'chat', io);
    const first = (await baselineOf(read)).baselineAt;
    await delay(25);
    await deliver(target, 'chat', io);

    await waitFor(async () => (await read()).baselineAt !== first, 'baselineAt to advance');
    assert.equal(io.chatPrompts.length, 2);
  });

  it('no open comments sends nothing', async () => {
    const { target } = await seed('send-empty', false);
    const io = recorder(() => Promise.resolve(true), () => Promise.resolve(true));

    await deliver(target, 'chat', io);
    await deliver(target, 'terminal', io);

    assert.equal(io.chatPrompts.length, 0);
    assert.equal(io.toTerminalCalls, 0);
    assert.equal(io.messages.length, 2);
  });

  it('an unreadable target or a bad argument is reported as an error', async () => {
    const { target } = await seed('send-gone');
    await vscode.workspace.fs.delete(target);
    const io = recorder(() => Promise.resolve(true), () => Promise.resolve(true));

    await deliver(target, 'chat', io);
    await deliverPrompt(stubContext().context, stubOutput([]), 42, 'terminal', io);

    assert.equal(io.errors.length, 2, io.errors.join(' | '));
    assert.equal(
      io.errors[0],
      'Markdown Review could not read docs/send-gone.md. Your comments have not been changed.',
    );
    assert.deepEqual(io.messages, []);
    assert.equal(io.chatPrompts.length, 0);
    assert.equal(io.toTerminalCalls, 0);
  });

  it('terminal target with no terminal falls back', async () => {
    for (const terminal of vscode.window.terminals) terminal.dispose();
    await waitFor(() => vscode.window.activeTerminal === undefined, 'no terminal to remain');
    assert.equal(await defaultIo.toTerminal(), false);
  });
});
