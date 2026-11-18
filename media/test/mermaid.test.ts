/**
 * The diagram module (M3) against a stub Mermaid. Rendering is the stub's; what is asserted is the
 * wrapper, the views, the reason lines and when `render` is called again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blockText, resetBlockMaps } from '../src/anchorSpace.js';
import { MERMAID_RETHEME_MS, initMermaid, toHex, type MermaidApi } from '../src/mermaid.js';

const SOURCE = 'graph TD\n  A --> B';

function fence(source: string, start = 0): string {
  return `<pre data-ap-start="${start}" data-ap-end="${start + source.length}"><code class="language-mermaid">${source}</code></pre>`;
}

function setup(html: string, render?: MermaidApi['render']) {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  const root = document.getElementById('root') as HTMLElement;
  const api = {
    initialize: vi.fn(),
    render: vi.fn(render ?? (async (id: string) => ({ svg: `<svg id="${id}"></svg>` }))),
  };
  const onLayout = vi.fn();
  const view = initMermaid({ root, load: async () => api, sanitize: (s) => s, onLayout });
  return { root, api, onLayout, view };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const wrappers = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.mr-mermaid')];

function at<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

const wrapperOf = (root: HTMLElement): HTMLElement => at(wrappers(root), 0);

beforeEach(() => {
  resetBlockMaps();
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('initMermaid', () => {
  it('wraps a mermaid block and keeps the pre untouched', async () => {
    const { root, view } = setup(fence(SOURCE));
    view.refresh();
    await flush();
    const pre = root.querySelector('pre') as HTMLElement;
    expect(pre.getAttribute('data-ap-start')).toBe('0');
    expect(pre.textContent).toBe(SOURCE);
    const wrapper = wrapperOf(root);
    expect(wrapper.getAttribute('data-no-anchor')).toBe('diagram');
    expect(wrapper.nextElementSibling).toBe(pre);
    expect(wrapper.querySelector('[data-ap-start]')).toBeNull();
  });

  it('wrapper text is not anchor text in a list item', async () => {
    const { root, view } = setup(`<ul><li data-ap-start="0" data-ap-end="40">item ${fence(SOURCE)}</li></ul>`);
    const li = root.querySelector('li') as HTMLElement;
    const before = blockText(li);
    resetBlockMaps();
    view.refresh();
    await flush();
    expect(wrappers(root)).toHaveLength(1);
    expect(blockText(li)).toBe(before);
  });

  it('empty mermaid fence', async () => {
    const { root, view, api } = setup(fence('  \n '));
    view.refresh();
    await flush();
    expect(wrappers(root)).toHaveLength(0);
    expect(api.render).not.toHaveBeenCalled();
  });

  it('shows the loading line', async () => {
    document.body.innerHTML = `<div id="root">${fence(SOURCE)}</div>`;
    const root = document.getElementById('root') as HTMLElement;
    let release: (api: MermaidApi) => void = () => undefined;
    const load = () => new Promise<MermaidApi>((resolve) => (release = resolve));
    const view = initMermaid({ root, load, sanitize: (s) => s, onLayout: () => undefined });
    view.refresh();
    expect(root.querySelector('.mr-mermaid-status')?.textContent).toBe('Rendering diagram…');
    release({ initialize: () => undefined, render: async () => ({ svg: '<svg></svg>' }) });
    await flush();
    expect((root.querySelector('.mr-mermaid-status') as HTMLElement).hidden).toBe(true);
  });

  it('shows the diagram after render', async () => {
    const { root, view, onLayout } = setup(fence(SOURCE), async () => ({ svg: '<svg class="x"></svg>' }));
    view.refresh();
    await flush();
    const wrapper = wrapperOf(root);
    expect(wrapper.getAttribute('data-view')).toBe('diagram');
    expect(wrapper.querySelector('.mr-mermaid-diagram svg.x')).not.toBeNull();
    expect(onLayout).toHaveBeenCalled();
  });

  it('render error shows the reason', async () => {
    const { root, view } = setup(fence(SOURCE), async () => {
      throw new Error('Parse error on line 2\n  A -->\n----^');
    });
    view.refresh();
    await flush();
    const wrapper = wrapperOf(root);
    expect(wrapper.getAttribute('data-view')).toBe('source');
    expect((wrapper.querySelector('.mr-mermaid-switch') as HTMLElement).hidden).toBe(true);
    expect(wrapper.querySelector('.mr-mermaid-status')?.textContent).toBe(
      'Mermaid could not render this diagram: Parse error on line 2',
    );
  });

  it('load failure shows the reason', async () => {
    document.body.innerHTML = `<div id="root">${fence(SOURCE)}${fence('graph LR', 100)}</div>`;
    const root = document.getElementById('root') as HTMLElement;
    const view = initMermaid({
      root,
      load: async () => {
        throw new Error('the diagram renderer failed to load');
      },
      sanitize: (s) => s,
      onLayout: () => undefined,
    });
    view.refresh();
    await flush();
    const lines = [...root.querySelectorAll('.mr-mermaid-status')].map((el) => el.textContent ?? '');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.endsWith('the diagram renderer failed to load')).toBe(true);
    expect(wrappers(root).every((w) => w.getAttribute('data-view') === 'source')).toBe(true);
  });

  it('one failing diagram does not stop the next', async () => {
    const { root, view, api } = setup(fence('bad', 0) + fence('good', 100), async (_id, source) => {
      if (source === 'bad') throw new Error('boom');
      return { svg: '<svg class="ok"></svg>' };
    });
    view.refresh();
    await flush();
    const [first, second] = [at(wrappers(root), 0), at(wrappers(root), 1)];
    expect(first.getAttribute('data-view')).toBe('source');
    expect(first.querySelector('.mr-mermaid-status')?.textContent).toBe('Mermaid could not render this diagram: boom');
    expect(second.getAttribute('data-view')).toBe('diagram');
    expect(second.querySelector('svg.ok')).not.toBeNull();
    expect((second.querySelector('.mr-mermaid-status') as HTMLElement).hidden).toBe(true);
    expect(api.render).toHaveBeenCalledTimes(2);
  });

  it('a failed load is retried for a theme change, not for a class change', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="root">${fence(SOURCE)}</div>`;
    const root = document.getElementById('root') as HTMLElement;
    const load = vi.fn(async (): Promise<MermaidApi> => {
      throw new Error('the diagram renderer failed to load');
    });
    const view = initMermaid({ root, load, sanitize: (s) => s, onLayout: () => undefined });
    view.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    document.documentElement.style.setProperty('--vscode-editor-background', '#123456');
    await vi.advanceTimersByTimeAsync(MERMAID_RETHEME_MS + 10);
    expect(load).toHaveBeenCalledTimes(2);
    document.body.classList.add('mr-narrow');
    await vi.advanceTimersByTimeAsync(MERMAID_RETHEME_MS + 10);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('stale render is discarded', async () => {
    const pending: Array<(svg: string) => void> = [];
    const { root, view } = setup(fence(SOURCE), () => new Promise((resolve) => pending.push((svg) => resolve({ svg }))));
    view.refresh();
    await flush();
    view.refresh();
    await flush();
    expect(pending).toHaveLength(2);
    at(pending, 0)('<svg class="first"></svg>');
    await flush();
    at(pending, 1)('<svg class="second"></svg>');
    await flush();
    expect(wrappers(root)).toHaveLength(1);
    expect(root.querySelector('svg.first')).toBeNull();
    expect(root.querySelector('svg.second')).not.toBeNull();
  });

  it('view survives a refresh', async () => {
    const { root, view } = setup(fence(SOURCE));
    view.refresh();
    await flush();
    (wrapperOf(root).querySelectorAll('button')[1] as HTMLButtonElement).click();
    view.refresh();
    await flush();
    expect(wrapperOf(root).getAttribute('data-view')).toBe('source');

    (root.querySelector('code') as HTMLElement).textContent = 'graph LR\n  X --> Y';
    view.refresh();
    await flush();
    expect(wrapperOf(root).getAttribute('data-view')).toBe('diagram');
  });

  it('showSource switches a block to its source', async () => {
    const { root, view } = setup(fence(SOURCE));
    view.refresh();
    await flush();
    view.showSource(root.querySelector('pre') as HTMLElement);
    expect(wrapperOf(root).getAttribute('data-view')).toBe('source');
  });

  it('a body class change does not re-render', async () => {
    vi.useFakeTimers();
    const { api, view } = setup(fence(SOURCE));
    view.refresh();
    await vi.advanceTimersByTimeAsync(0);
    const calls = api.render.mock.calls.length;
    document.body.classList.add('mr-narrow');
    await vi.advanceTimersByTimeAsync(MERMAID_RETHEME_MS + 10);
    expect(api.render.mock.calls.length).toBe(calls);
  });

  it('a theme change re-renders once', async () => {
    vi.useFakeTimers();
    const { api, view } = setup(fence(SOURCE));
    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
    view.refresh();
    await vi.advanceTimersByTimeAsync(0);
    const calls = api.render.mock.calls.length;
    document.documentElement.style.setProperty('--vscode-editor-background', '#1e1e1e');
    await vi.advanceTimersByTimeAsync(MERMAID_RETHEME_MS + 10);
    expect(api.render.mock.calls.length).toBe(calls + 1);
    await vi.advanceTimersByTimeAsync(MERMAID_RETHEME_MS + 10);
    expect(api.render.mock.calls.length).toBe(calls + 1);
  });

  it('switch is keyboard operable', async () => {
    const { root, view } = setup(fence(SOURCE));
    view.refresh();
    await flush();
    const buttons = wrapperOf(root).querySelectorAll('button');
    const diagram = at(buttons, 0);
    const source = at(buttons, 1);
    expect(diagram.tagName).toBe('BUTTON');
    expect(source.tagName).toBe('BUTTON');
    expect(diagram.getAttribute('aria-pressed')).toBe('true');
    source.click();
    expect(source.getAttribute('aria-pressed')).toBe('true');
    expect(diagram.getAttribute('aria-pressed')).toBe('false');
    expect(wrapperOf(root).getAttribute('data-view')).toBe('source');
  });
});

describe('toHex', () => {
  it('converts the forms VS Code emits', () => {
    expect(toHex('#abc')).toBe('#aabbcc');
    expect(toHex('#aabbcc80')).toBe('#aabbcc80');
    expect(toHex('rgb(1, 2, 3)')).toBe('#010203');
    expect(toHex('rgba(1,2,3,.5)')).toBe('#01020380');
    expect(toHex('transparent')).toBeUndefined();
  });
});
