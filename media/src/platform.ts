/**
 * Host-platform affordances the webview has to phrase for itself.
 *
 * One copy, because two modules show a keyboard hint and a drifting modifier symbol between the
 * comment popover and the card editor would be its own small bug.
 */

/** ⌘ on Apple platforms, Ctrl elsewhere. */
export function modifierLabel(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    // `navigator.platform` is deprecated but remains the only fallback available everywhere the
    // webview runs (H27), so it is read second rather than first.
    navigator.platform;
  return /mac|iphone|ipad/i.test(platform) ? '⌘' : 'Ctrl';
}

/** Honoured wherever the pane moves the viewport or animates (H19). */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
