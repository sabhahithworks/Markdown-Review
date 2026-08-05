/**
 * The review pane's Content-Security-Policy (PRD §6, corrected by H6).
 *
 * `vscode`-free so the string itself is unit-testable — the one property that must never regress
 * is that no directive permits a network origin. PRD §6 originally specified `img-src … https:`,
 * which let a reviewed file containing a remote image URL make a real outbound request the moment
 * the pane rendered — document-content-controlled egress, in direct conflict with PRD §2/§13's
 * "no network calls, ever". The PRD is amended; remote images render as their alt text instead
 * (see `renderer.ts`'s image rule).
 *
 * `style-src 'unsafe-inline'` is required by VS Code's own injected theme styles; everything else
 * is locked to the nonce and the webview's resource origin.
 */
export function buildCsp(cspSource: string, nonce: string): string {
  return (
    `default-src 'none'; img-src ${cspSource} data:; ` +
    `script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; ` +
    `font-src ${cspSource};`
  );
}
