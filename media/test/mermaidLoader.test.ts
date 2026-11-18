/**
 * The Mermaid loader: one nonce'd script beside the webview bundle, memoized on success and
 * retried after a failure. The script element is driven by hand-dispatched load and error events.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MERMAID_LOAD_TIMEOUT_MS, createMermaidLoader } from '../src/mermaidLoader.js';
import type { MermaidApi } from '../src/mermaidLoader.js';

const FAILED = 'the diagram renderer failed to load';
const SCRIPT_URL = 'https://webview.example/media/webview.js';

const scripts = (): HTMLScriptElement[] => [...document.querySelectorAll('script')];
const stub = (): MermaidApi => ({ initialize: vi.fn(), render: vi.fn() });

describe('createMermaidLoader', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    delete (globalThis as { mermaid?: unknown }).mermaid;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { mermaid?: unknown }).mermaid;
  });

  it('resolves with the global after load', async () => {
    const api = stub();
    const promise = createMermaidLoader(SCRIPT_URL, 'n1')();
    (globalThis as { mermaid?: MermaidApi }).mermaid = api;
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBe(api);
  });

  it('appends one script for two calls', async () => {
    const load = createMermaidLoader(SCRIPT_URL, 'n1');
    const first = load();
    const second = load();
    expect(scripts()).toHaveLength(1);
    (globalThis as { mermaid?: MermaidApi }).mermaid = stub();
    scripts()[0]!.dispatchEvent(new Event('load'));
    expect(await first).toBe(await second);
    expect(await load()).toBeDefined();
    expect(scripts()).toHaveLength(1);
  });

  it('sets the nonce and a URL beside the webview script', () => {
    void createMermaidLoader(SCRIPT_URL, 'abc123')().catch(() => undefined);
    const [script] = scripts();
    expect(script!.nonce).toBe('abc123');
    expect(script!.src).toBe('https://webview.example/media/mermaid.min.js');
  });

  it('rejects when the script errors', async () => {
    const promise = createMermaidLoader(SCRIPT_URL, 'n1')();
    scripts()[0]!.dispatchEvent(new Event('error'));
    await expect(promise).rejects.toThrow(FAILED);
  });

  it('rejects when the global is missing after load', async () => {
    const promise = createMermaidLoader(SCRIPT_URL, 'n1')();
    scripts()[0]!.dispatchEvent(new Event('load'));
    await expect(promise).rejects.toThrow(FAILED);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const promise = createMermaidLoader(SCRIPT_URL, 'n1')();
    const assertion = expect(promise).rejects.toThrow(FAILED);
    await vi.advanceTimersByTimeAsync(MERMAID_LOAD_TIMEOUT_MS);
    await assertion;
  });

  it('retries after a failure', async () => {
    const load = createMermaidLoader(SCRIPT_URL, 'n1');
    const first = load();
    scripts()[0]!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow(FAILED);
    const api = stub();
    const second = load();
    expect(scripts()).toHaveLength(2);
    (globalThis as { mermaid?: MermaidApi }).mermaid = api;
    scripts()[1]!.dispatchEvent(new Event('load'));
    await expect(second).resolves.toBe(api);
  });

  it('rejects without a script URL', async () => {
    await expect(createMermaidLoader(undefined, 'n1')()).rejects.toThrow(FAILED);
    expect(scripts()).toHaveLength(0);
  });
});
