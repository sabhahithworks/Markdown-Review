/**
 * H6 — the one property of the CSP that must never regress: no directive permits a network
 * origin. PRD §2/§13 say no network calls, ever; `img-src … https:` (PRD §6 as originally
 * written) let a reviewed file containing a remote image URL phone home the moment the pane
 * rendered.
 */

import { describe, expect, it } from 'vitest';
import { buildCsp } from '../panel/csp.js';

const CSP_SOURCE = 'vscode-webview://test-origin';
const NONCE = 'abc123';

describe('buildCsp (H6)', () => {
  const csp = buildCsp(CSP_SOURCE, NONCE);

  it('permits no network origin in any directive', () => {
    // `https:`/`http:` as a *source* would allow fetching from anywhere. The webview's own
    // resource origin is a vscode-webview:// URI, so matching ` https:` (a bare scheme source,
    // preceded by a space) catches the regression without tripping on the origin itself.
    expect(csp).not.toMatch(/ https?:(?![/])/);
    expect(csp).not.toContain('*');
  });

  it('locks images to the webview origin and data URIs', () => {
    expect(csp).toContain(`img-src ${CSP_SOURCE} data:;`);
  });

  it('locks scripts to the nonce and defaults to none', () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${NONCE}'`);
  });
});
