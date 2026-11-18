/**
 * Turns `mermaid` code blocks into diagrams with a Diagram/Source switch.
 *
 * The fence's `<pre>` is left where it is. The diagram wrapper is a sibling inserted before it and
 * is marked `data-no-anchor="diagram"`, so `anchorSpace` skips its text. This module computes no
 * offsets.
 */

import type { MermaidApi } from './mermaidLoader.js';

export type { MermaidApi };

export const MERMAID_ERROR_MAX_CHARS = 200;
export const MERMAID_RETHEME_MS = 150;

type View = 'diagram' | 'source';

export interface MermaidOptions {
  root: HTMLElement;
  load: () => Promise<MermaidApi>;
  sanitize: (svg: string) => string;
  onLayout: () => void;
}

export interface MermaidView {
  refresh(): void;
  showSource(pre: HTMLElement): void;
  /** The wrapper's rect when `range` starts inside a Mermaid `<pre>` that is hidden. */
  rectFor(range: Range): DOMRect | undefined;
  /** Switches the block holding `range` to Source; true when it did. */
  showSourceFor(range: Range): boolean;
  setMarkers(located: Record<string, { start: number; end: number } | null>): void;
}

export interface ThemeVariables {
  darkMode: boolean;
  background?: string;
  primaryTextColor?: string;
  lineColor?: string;
  textColor?: string;
  primaryColor?: string;
  primaryBorderColor?: string;
  secondaryColor?: string;
  tertiaryColor?: string;
}

const LOADING_TEXT = 'Rendering diagram…';
const ERROR_PREFIX = 'Mermaid could not render this diagram: ';

function hex2(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

/** `#rrggbb` (or `#rrggbbaa`) for a CSS colour in a form VS Code emits, otherwise undefined. */
export function toHex(value: string | null | undefined): string | undefined {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return undefined;

  const hash = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hash) {
    const digits = hash[1] ?? '';
    if (digits.length === 3) return `#${[...digits].map((d) => d + d).join('')}`;
    if (digits.length === 6 || digits.length === 8) return `#${digits}`;
    return undefined;
  }

  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(text);
  if (!fn) return undefined;
  const parts = (fn[1] ?? '').split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const channels = parts.slice(0, 3).map((part) => Number(part));
  if (channels.some((n) => !Number.isFinite(n))) return undefined;
  let result = `#${channels.map(hex2).join('')}`;
  if (parts.length === 4) {
    const raw = parts[3] ?? '';
    const alpha = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    if (!Number.isFinite(alpha)) return undefined;
    if (alpha < 1) result += hex2(alpha * 255);
  }
  return result;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function readThemeVariables(): ThemeVariables {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): string | undefined => toHex(style.getPropertyValue(name));

  const background = read('--vscode-editor-background');
  const foreground = read('--vscode-editor-foreground');
  const widget = read('--vscode-editorWidget-background');
  const border = read('--vscode-panel-border');
  const quote = read('--vscode-textBlockQuote-background');
  const code = read('--vscode-textCodeBlock-background');

  const vars: ThemeVariables = { darkMode: background ? luminance(background) < 0.5 : false };
  const set = (key: keyof Omit<ThemeVariables, 'darkMode'>, value: string | undefined): void => {
    if (value) vars[key] = value;
  };
  set('background', background);
  set('primaryTextColor', foreground);
  set('lineColor', foreground);
  set('textColor', foreground);
  set('primaryColor', widget);
  set('primaryBorderColor', border);
  set('secondaryColor', quote);
  set('tertiaryColor', code);
  return vars;
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = (message.split(/\r?\n/)[0] ?? '').trim();
  return first.length > MERMAID_ERROR_MAX_CHARS
    ? `${first.slice(0, MERMAID_ERROR_MAX_CHARS - 1)}…`
    : first;
}

interface Block {
  pre: HTMLElement;
  source: string;
  key: string;
  wrapper: HTMLElement;
  diagram: HTMLElement;
  status: HTMLElement;
  switchEl: HTMLElement;
  diagramButton: HTMLButtonElement;
  sourceButton: HTMLButtonElement;
  marker: HTMLButtonElement;
}

export function initMermaid(options: MermaidOptions): MermaidView {
  const { root, load, sanitize, onLayout } = options;
  const remembered = new Map<string, View>();
  const blocks = new Map<HTMLElement, Block>();
  let generation = 0;
  let renderCounter = 0;
  let lastLocated: Record<string, { start: number; end: number } | null> = {};
  let lastTheme = JSON.stringify(readThemeVariables());

  function applyView(block: Block, view: View): void {
    block.wrapper.setAttribute('data-view', view);
    block.diagramButton.setAttribute('aria-pressed', String(view === 'diagram'));
    block.sourceButton.setAttribute('aria-pressed', String(view === 'source'));
  }

  function choose(block: Block, view: View): void {
    remembered.set(block.key, view);
    applyView(block, view);
    onLayout();
  }

  function build(pre: HTMLElement, source: string, index: number): Block {
    const wrapper = document.createElement('div');
    wrapper.className = 'mr-mermaid';
    wrapper.setAttribute('data-no-anchor', 'diagram');

    const switchEl = document.createElement('div');
    switchEl.className = 'mr-mermaid-switch';
    switchEl.hidden = true;
    const diagramButton = document.createElement('button');
    diagramButton.type = 'button';
    diagramButton.textContent = 'Diagram';
    const sourceButton = document.createElement('button');
    sourceButton.type = 'button';
    sourceButton.textContent = 'Source';
    switchEl.append(diagramButton, sourceButton);

    const status = document.createElement('p');
    status.className = 'mr-mermaid-status';
    status.textContent = LOADING_TEXT;

    const diagram = document.createElement('div');
    diagram.className = 'mr-mermaid-diagram';
    diagram.setAttribute('role', 'img');
    diagram.setAttribute('aria-label', 'Mermaid diagram');

    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'mr-mermaid-marker';
    marker.hidden = true;

    wrapper.append(switchEl, marker, status, diagram);
    pre.before(wrapper);

    const block: Block = {
      pre,
      source,
      key: `${index}:${source}`,
      wrapper,
      diagram,
      status,
      switchEl,
      diagramButton,
      sourceButton,
      marker,
    };
    marker.addEventListener('click', () => choose(block, 'source'));
    diagramButton.addEventListener('click', () => choose(block, 'diagram'));
    sourceButton.addEventListener('click', () => choose(block, 'source'));
    applyView(block, 'source');
    return block;
  }

  function fail(block: Block, reason: string): void {
    block.switchEl.hidden = true;
    block.status.hidden = false;
    block.status.textContent = `${ERROR_PREFIX}${reason}`;
    block.diagram.textContent = '';
    applyView(block, 'source');
  }

  async function run(list: Block[], mine: number): Promise<void> {
    let api: MermaidApi;
    try {
      api = await load();
    } catch (error) {
      if (mine !== generation) return;
      for (const block of list) {
        fail(block, reasonOf(error));
        onLayout();
      }
      return;
    }
    if (mine !== generation) return;

    const theme = readThemeVariables();
    lastTheme = JSON.stringify(theme);
    try {
      api.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        htmlLabels: false,
        fontFamily: getComputedStyle(document.body).fontFamily,
        themeVariables: theme,
      });
    } catch (error) {
      for (const block of list) {
        fail(block, reasonOf(error));
        onLayout();
      }
      return;
    }

    for (const block of list) {
      try {
        renderCounter += 1;
        const { svg } = await api.render(`mr-mermaid-${renderCounter}`, block.source);
        if (mine !== generation) return;
        block.diagram.innerHTML = sanitize(svg);
        block.status.hidden = true;
        block.switchEl.hidden = false;
        applyView(block, remembered.get(block.key) ?? 'diagram');
      } catch (error) {
        if (mine !== generation) return;
        fail(block, reasonOf(error));
      }
      onLayout();
    }
  }

  function refresh(): void {
    generation += 1;
    const mine = generation;

    for (const stale of root.querySelectorAll('.mr-mermaid[data-no-anchor="diagram"]')) stale.remove();
    blocks.clear();

    const list: Block[] = [];
    let index = 0;
    for (const code of root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
      const pre = code.parentElement;
      const source = code.textContent ?? '';
      if (!pre || !source.trim()) continue;
      const block = build(pre, source, index);
      index += 1;
      blocks.set(pre, block);
      list.push(block);
    }
    applyMarkers();
    if (list.length === 0) return;
    void run(list, mine);
  }

  /**
   * A theme change re-renders the blocks in place: each shown diagram stays until its new one is
   * ready, so the source does not reappear and the reading position holds (D29, D50).
   */
  function retheme(): void {
    const list = [...blocks.values()];
    if (list.length === 0 || list.some((block) => !block.wrapper.isConnected)) {
      refresh();
      return;
    }
    generation += 1;
    void run(list, generation);
  }

  function showSource(pre: HTMLElement): void {
    const block = blocks.get(pre);
    if (block) choose(block, 'source');
  }

  function blockHolding(range: Range): Block | undefined {
    for (const block of blocks.values()) {
      if (block.pre.contains(range.startContainer)) return block;
    }
    return undefined;
  }

  function rectFor(range: Range): DOMRect | undefined {
    const block = blockHolding(range);
    if (!block || block.wrapper.getAttribute('data-view') !== 'diagram') return undefined;
    return block.wrapper.getBoundingClientRect();
  }

  function showSourceFor(range: Range): boolean {
    const block = blockHolding(range);
    if (!block || block.wrapper.getAttribute('data-view') !== 'diagram') return false;
    choose(block, 'source');
    return true;
  }

  function applyMarkers(): void {
    for (const block of blocks.values()) {
      const start = Number(block.pre.getAttribute('data-ap-start'));
      const end = Number(block.pre.getAttribute('data-ap-end'));
      let count = 0;
      if (block.pre.hasAttribute('data-ap-start') && block.pre.hasAttribute('data-ap-end')) {
        for (const position of Object.values(lastLocated)) {
          if (position && position.start >= start && position.start < end) count += 1;
        }
      }
      block.marker.hidden = count === 0;
      block.marker.textContent = count === 1 ? '1 comment in source' : `${String(count)} comments in source`;
    }
  }

  function setMarkers(located: Record<string, { start: number; end: number } | null>): void {
    lastLocated = located;
    applyMarkers();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = JSON.stringify(readThemeVariables());
      if (next !== lastTheme) {
        lastTheme = next;
        retheme();
      }
    }, MERMAID_RETHEME_MS);
  });
  const watch = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-vscode-theme-kind'] };
  observer.observe(document.documentElement, watch);
  if (document.body) observer.observe(document.body, watch);

  return { refresh, showSource, rectFor, showSourceFor, setMarkers };
}
