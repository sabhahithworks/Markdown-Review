/**
 * The message guards are one of only two places untrusted input crosses into typed code (the other
 * is Phase 3's sidecar parse), so they are tested against hostile shapes, not just valid ones.
 */

import { describe, expect, it } from 'vitest';
import type { PanelState, WebviewMessage } from '../panel/messages.js';
import { isPanelState, isWebviewMessage } from '../panel/messages.js';

describe('isWebviewMessage', () => {
  const valid: WebviewMessage[] = [
    { type: 'ready' },
    { type: 'renderAnyway' },
    { type: 'openExternal', url: 'https://example.com' },
    { type: 'openExternal', url: '' },
    { type: 'error', message: 'boom' },
  ];

  it.each(valid.map((message) => [JSON.stringify(message), message] as const))(
    'accepts %s',
    (_label, message) => {
      expect(isWebviewMessage(message)).toBe(true);
    },
  );

  const invalid: Array<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'ready'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['an unknown type', { type: 'nope' }],
    ['openExternal without url', { type: 'openExternal' }],
    ['openExternal with a non-string url', { type: 'openExternal', url: 42 }],
    ['openExternal with a null url', { type: 'openExternal', url: null }],
    ['error without message', { type: 'error' }],
    ['error with a non-string message', { type: 'error', message: { toString: 'no' } }],
    ['a host message coming back the wrong way', { type: 'setContent', html: '<p>x</p>' }],
  ];

  it.each(invalid)('rejects %s', (_label, value) => {
    expect(isWebviewMessage(value)).toBe(false);
  });

  it('narrows to the member type', () => {
    const raw: unknown = { type: 'openExternal', url: 'https://example.com' };
    if (!isWebviewMessage(raw)) throw new Error('guard rejected a valid message');
    // Reaching `.url` without a cast is the entire point of the guard.
    expect(raw.type === 'openExternal' ? raw.url : '').toBe('https://example.com');
  });

  it('ignores extra properties rather than rejecting them', () => {
    // Forward compatibility: a newer webview bundle may send fields this host does not know about.
    expect(isWebviewMessage({ type: 'ready', future: 'field' })).toBe(true);
  });
});

describe('isPanelState', () => {
  const valid: PanelState[] = [
    { targetPath: '/a/b.md' },
    { targetPath: '/a/b.md', scrollLine: 0 },
    { targetPath: '/a/b.md', scrollLine: 120 },
  ];

  it.each(valid.map((state) => [JSON.stringify(state), state] as const))(
    'accepts %s',
    (_label, state) => {
      expect(isPanelState(state)).toBe(true);
    },
  );

  const invalid: Array<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['an empty object', {}],
    ['a missing targetPath', { scrollLine: 3 }],
    ['a non-string targetPath', { targetPath: 42 }],
    ['a non-number scrollLine', { targetPath: '/a/b.md', scrollLine: '12' }],
    ['a null scrollLine', { targetPath: '/a/b.md', scrollLine: null }],
    ['a string', '/a/b.md'],
  ];

  it.each(invalid)('rejects %s', (_label, value) => {
    expect(isPanelState(value)).toBe(false);
  });
});
