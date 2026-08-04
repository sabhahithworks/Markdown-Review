/**
 * Shared fixtures for the integration specs.
 *
 * `ReviewStore` takes an `ExtensionContext` but touches only two things on it — `globalStorageUri`
 * and `globalState` — so the specs hand it a stub rather than reaching into the running extension
 * for the real one. Everything that matters is still real: `vscode.workspace.fs`, the configuration
 * store, and the `FileSystemWatcher` all come from the live host. Stubbing the context bag keeps
 * the extension's `activate` free of a test-only export.
 */

import * as vscode from 'vscode';

/** Set by `run.ts` before launching VS Code. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} was not set by the integration runner`);
  return value;
}

export const WORKSPACE_DIR = requireEnv('MDR_WORKSPACE');
/** A directory outside every workspace folder, for the loose-file / globalStorage path. */
export const LOOSE_DIR = requireEnv('MDR_LOOSE_DIR');
export const GLOBAL_STORAGE_DIR = requireEnv('MDR_GLOBAL_STORAGE');

export function workspaceUri(...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(WORKSPACE_DIR), ...segments);
}

export function looseUri(...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(LOOSE_DIR), ...segments);
}

export interface StubContext {
  readonly context: vscode.ExtensionContext;
  /** What `warnLooseFile` wrote, so a spec can assert the once-per-machine behaviour. */
  readonly memory: Map<string, unknown>;
}

export function stubContext(): StubContext {
  const memory = new Map<string, unknown>();

  const globalState = {
    get: (key: string, fallback?: unknown) => memory.get(key) ?? fallback,
    update: (key: string, value: unknown) => {
      memory.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...memory.keys()],
    setKeysForSync: () => undefined,
  };

  // Only the two members `ReviewStore` reads are provided; anything else it starts using should
  // fail loudly here rather than silently read `undefined`.
  const context = {
    globalStorageUri: vscode.Uri.file(GLOBAL_STORAGE_DIR),
    globalState,
  } as unknown as vscode.ExtensionContext;

  return { context, memory };
}

/** A no-op output channel, so store logging does not need the real one. */
export function stubOutput(lines: string[]): vscode.OutputChannel {
  return {
    name: 'test',
    append: (value: string) => lines.push(value),
    appendLine: (value: string) => lines.push(value),
    replace: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  } as unknown as vscode.OutputChannel;
}

export async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

export async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
