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
    { type: 'addComment', selectedText: 'hello', offset: 12, hintLine: 3, body: 'fix this' },
    // `-1` is the documented "webview could not map the selection" sentinel (Plan 03 §2).
    { type: 'addComment', selectedText: 'hello', offset: -1, hintLine: 3, body: '' },
    { type: 'editComment', id: 'abc12345', body: 'reworded' },
    { type: 'deleteComment', id: 'abc12345' },
    { type: 'resolveComment', id: 'abc12345' },
    { type: 'showRewriteDiff' },
    { type: 'relinkTarget' },
    { type: 'copyPrompt' },
    { type: 'clearAddressed' },
    { type: 'reopenComment', id: 'abc12345' },
    { type: 'reanchorComment', id: 'abc12345', selectedText: 'new text', offset: 42, hintLine: 7 },
    // The same "could not map" sentinel `addComment` uses; the host recovers via `hintLine`.
    { type: 'reanchorComment', id: 'abc12345', selectedText: 'new text', offset: -1, hintLine: 7 },
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
    // Host -> webview messages must never be accepted coming back the other way.
    ['a rewriteDetected host message travelling the wrong way', { type: 'rewriteDetected', orphaned: 3 }],
    ['reopenComment without an id', { type: 'reopenComment' }],
    ['reopenComment with a numeric id', { type: 'reopenComment', id: 7 }],
    ['reanchorComment without an id', { type: 'reanchorComment', selectedText: 'a', offset: 1, hintLine: 1 }],
    [
      'reanchorComment with a NaN offset',
      { type: 'reanchorComment', id: 'a', selectedText: 'a', offset: NaN, hintLine: 1 },
    ],
    [
      'reanchorComment with an Infinity hintLine',
      { type: 'reanchorComment', id: 'a', selectedText: 'a', offset: 1, hintLine: Infinity },
    ],
    [
      'reanchorComment with a non-string selectedText',
      { type: 'reanchorComment', id: 'a', selectedText: null, offset: 1, hintLine: 1 },
    ],
    // Pins Plan 04 §9 D4: the filter lives in `setState`, not in a message the host would ignore.
    ['setFilter, which is deliberately not a message', { type: 'setFilter', statuses: ['open'] }],
    ['a reviewState host message travelling the wrong way', { type: 'reviewState', review: {}, located: {} }],
    ['openExternal without url', { type: 'openExternal' }],
    ['openExternal with a non-string url', { type: 'openExternal', url: 42 }],
    ['openExternal with a null url', { type: 'openExternal', url: null }],
    ['error without message', { type: 'error' }],
    ['error with a non-string message', { type: 'error', message: { toString: 'no' } }],
    ['a host message coming back the wrong way', { type: 'setContent', html: '<p>x</p>' }],
    ['addComment without a body', { type: 'addComment', selectedText: 'a', offset: 1, hintLine: 1 }],
    [
      'addComment with a string offset',
      { type: 'addComment', selectedText: 'a', offset: '1', hintLine: 1, body: 'b' },
    ],
    [
      'addComment with a NaN offset',
      { type: 'addComment', selectedText: 'a', offset: Number.NaN, hintLine: 1, body: 'b' },
    ],
    [
      'addComment with an Infinity hintLine',
      {
        type: 'addComment',
        selectedText: 'a',
        offset: 1,
        hintLine: Number.POSITIVE_INFINITY,
        body: 'b',
      },
    ],
    [
      'addComment with a non-string selectedText',
      { type: 'addComment', selectedText: null, offset: 1, hintLine: 1, body: 'b' },
    ],
    ['editComment without a body', { type: 'editComment', id: 'a' }],
    ['editComment with a numeric id', { type: 'editComment', id: 7, body: 'b' }],
    ['deleteComment without an id', { type: 'deleteComment' }],
    ['resolveComment with a null id', { type: 'resolveComment', id: null }],
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
    { targetPath: '/a/b.md', filter: [] },
    { targetPath: '/a/b.md', filter: ['open', 'orphaned'] },
    { targetPath: '/a/b.md', scrollLine: 12, filter: ['resolved'] },
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
    ['a non-array filter', { targetPath: '/a/b.md', filter: 'open' }],
    ['a filter holding an unknown status', { targetPath: '/a/b.md', filter: ['open', 'wontfix'] }],
    ['a filter holding a non-string', { targetPath: '/a/b.md', filter: [1] }],
  ];

  it.each(invalid)('rejects %s', (_label, value) => {
    expect(isPanelState(value)).toBe(false);
  });
});
