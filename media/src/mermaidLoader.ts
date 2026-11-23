/**
 * Loads the Mermaid browser build on first need.
 *
 * The file is a separate classic script beside the webview bundle, loaded through a `<script>`
 * element that carries the page's nonce, so the pane's CSP needs no change. The `mermaid` package
 * is never imported here.
 */

export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export const MERMAID_LOAD_TIMEOUT_MS = 10_000;

const MERMAID_FILE = 'mermaid.min.js';
const LOAD_FAILED = 'the diagram renderer failed to load';

/** The Mermaid file in the same folder as `scriptUrl`, or undefined when that is not a URL. */
function siblingUrl(scriptUrl: string): string | undefined {
  try {
    return new URL(MERMAID_FILE, scriptUrl).href;
  } catch {
    return undefined;
  }
}

/**
 * The global the Mermaid script sets, or undefined before it has run. Until then a browser exposes
 * any element with `id="mermaid"` (a `## Mermaid` heading's slug) as `window.mermaid`, so the
 * value must look like the API rather than merely exist.
 */
function mermaidGlobal(): MermaidApi | undefined {
  const value = (globalThis as { mermaid?: Partial<MermaidApi> }).mermaid;
  return typeof value?.initialize === 'function' && typeof value.render === 'function'
    ? (value as MermaidApi)
    : undefined;
}

export function createMermaidLoader(
  scriptUrl: string | undefined,
  nonce: string | undefined,
  doc: Document = document,
): () => Promise<MermaidApi> {
  let pending: Promise<MermaidApi> | null = null;

  return () => {
    if (pending) return pending;

    // A script that outlived the timeout may still have run since: use it rather than load it again.
    const loaded = mermaidGlobal();
    if (loaded) {
      pending = Promise.resolve(loaded);
      return pending;
    }

    const attempt = new Promise<MermaidApi>((resolve, reject) => {
      const src = scriptUrl ? siblingUrl(scriptUrl) : undefined;
      if (!src) {
        reject(new Error(LOAD_FAILED));
        return;
      }

      const script = doc.createElement('script');
      const settle = (): void => {
        clearTimeout(timer);
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onError);
      };
      const onLoad = (): void => {
        settle();
        const api = mermaidGlobal();
        if (api) resolve(api);
        else reject(new Error(LOAD_FAILED));
      };
      const onError = (): void => {
        settle();
        reject(new Error(LOAD_FAILED));
      };

      script.addEventListener('load', onLoad);
      script.addEventListener('error', onError);
      const timer = setTimeout(() => {
        settle();
        reject(new Error(LOAD_FAILED));
      }, MERMAID_LOAD_TIMEOUT_MS);

      if (nonce) script.nonce = nonce;
      script.src = src;
      (doc.head ?? doc.documentElement).append(script);
    });

    pending = attempt;
    attempt.catch(() => {
      if (pending === attempt) pending = null;
    });
    return attempt;
  };
}
