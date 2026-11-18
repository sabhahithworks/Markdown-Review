/**
 * The status bar item and Explorer badge driven by a `ReviewIndex`.
 *
 * Returns the item and provider so tests can read them back; VS Code has no API to read either.
 */

import * as vscode from 'vscode';
import { badgeText, badgeTooltip, statusBarText, statusBarTooltip } from '../panel/notices.js';
import { registryKey } from '../store/registryKey.js';
import type { ReviewIndex } from './reviewIndex.js';

export type IndicatorProvider = vscode.FileDecorationProvider & {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined;
};

export function registerIndicators(index: ReviewIndex): {
  item: vscode.StatusBarItem;
  provider: IndicatorProvider;
  dispose(): void;
} {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const decorationsChanged = new vscode.EventEmitter<vscode.Uri[]>();

  const provider: IndicatorProvider = {
    onDidChangeFileDecorations: decorationsChanged.event,
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
      const counts = index.countsFor(uri);
      if (!counts) return undefined;
      const badge = badgeText(counts);
      if (badge === undefined) return undefined;
      const decoration = new vscode.FileDecoration(badge, badgeTooltip(counts));
      decoration.propagate = false;
      return decoration;
    },
  };

  // The last markdown file shown. A focused review pane is a webview, which makes `activeTextEditor`
  // undefined, so an undefined editor keeps this rather than clearing it (D35).
  let target: vscode.Uri | undefined;

  const refresh = (): void => {
    const counts = target ? index.countsFor(target) : undefined;
    const text = counts ? statusBarText(counts) : null;
    if (!target || !counts || text === null) {
      item.hide();
      return;
    }
    item.text = text;
    item.tooltip = statusBarTooltip(counts);
    item.command = { command: 'markdownReview.open', title: 'Open review', arguments: [target] };
    item.accessibilityInformation = { label: text.replace('$(comment) ', ''), role: 'button' };
    item.show();
  };

  const adopt = (editor: vscode.TextEditor | undefined): void => {
    if (editor) {
      target = editor.document.languageId === 'markdown' ? editor.document.uri : undefined;
    }
    refresh();
  };

  const subscriptions = [
    item,
    decorationsChanged,
    vscode.window.registerFileDecorationProvider(provider),
    vscode.window.onDidChangeActiveTextEditor(adopt),
    index.onDidChange((uris) => {
      decorationsChanged.fire(uris);
      const key = target ? registryKey(target.toString()) : undefined;
      if (key !== undefined && uris.some((uri) => registryKey(uri.toString()) === key)) refresh();
    }),
  ];

  adopt(vscode.window.activeTextEditor);

  return {
    item,
    provider,
    dispose(): void {
      for (const subscription of subscriptions) subscription.dispose();
    },
  };
}
