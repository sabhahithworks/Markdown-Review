/**
 * Where a built review prompt is delivered: VS Code chat or the active terminal.
 *
 * The prompt is already on the clipboard when these run. For the terminal, the caller saves the
 * prompt to the prompt file and puts the one pointer line on the clipboard, so the terminal receives
 * that line and never the prompt (D-q16). The line is pasted with the workbench paste command; this
 * file never types text into a terminal itself (release-expansion D35).
 */

import * as vscode from 'vscode';

export interface PromptIo {
  toChat(prompt: string): Promise<boolean>;
  toTerminal(): Promise<boolean>;
  writePromptFile(file: vscode.Uri, text: string): Promise<void>;
  notify(message: string): void;
  /** A failure the user has to act on: nothing was copied or sent. */
  error(message: string): void;
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

  async writePromptFile(file: vscode.Uri, text: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
  },

  notify(message: string): void {
    void vscode.window.showInformationMessage(message);
  },

  error(message: string): void {
    void vscode.window.showErrorMessage(message);
  },
};
