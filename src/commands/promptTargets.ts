/**
 * Where a built review prompt is delivered: VS Code chat or the active terminal.
 *
 * The prompt is already on the clipboard when these run. The terminal path pastes it with the
 * workbench paste command; this file never types text into a terminal itself (release-expansion D35).
 */

import * as vscode from 'vscode';

export interface PromptIo {
  toChat(prompt: string): Promise<boolean>;
  toTerminal(): Promise<boolean>;
  notify(message: string): void;
}

const CHAT_OPEN_COMMAND = 'workbench.action.chat.open';
const TERMINAL_PASTE_COMMAND = 'workbench.action.terminal.paste';

export const defaultIo: PromptIo = {
  async toChat(prompt: string): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(CHAT_OPEN_COMMAND)) return false;
    await vscode.commands.executeCommand(CHAT_OPEN_COMMAND, { query: prompt, isPartialQuery: true });
    return true;
  },

  async toTerminal(): Promise<boolean> {
    const terminal = vscode.window.activeTerminal;
    if (terminal === undefined) return false;
    // `false`: take focus, so the paste lands in this terminal.
    terminal.show(false);
    await vscode.commands.executeCommand(TERMINAL_PASTE_COMMAND);
    return true;
  },

  notify(message: string): void {
    void vscode.window.showInformationMessage(message);
  },
};
