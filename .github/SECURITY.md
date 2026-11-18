# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub's private vulnerability reporting: open the repository's
**Security** tab and choose **Report a vulnerability**
(https://github.com/sabhahithworks/Markdown-Review/security/advisories/new). Include the steps to
reproduce it, the extension and VS Code versions, and, where it helps, a Markdown file that
triggers it.

The conversation, and any fix, happens in that private advisory.

## Security model

Markdown Review renders Markdown files from your workspace in a webview. It is built around these
rules:

- **No network calls.** The extension makes no network requests of its own: no telemetry, no
  analytics, no update checks. Reviews are stored locally, in `.reviews/` sidecar files in your
  workspace (or VS Code's local extension storage for a file outside any workspace).
- **Strict Content Security Policy.** The review pane runs under a CSP with a fresh nonce on every
  load. Only the extension's own scripts run; inline scripts and `eval` are not allowed.
- **Sanitized rendering.** All rendered Markdown passes through DOMPurify before it reaches the
  page, so HTML embedded in a Markdown file cannot run script.
- **Limited file access.** The webview can load local resources only from the extension's `media/`
  folder and the reviewed file's own directory.
- **External links open outside the pane**, through VS Code's own link handling.

A way to break any of these rules is a vulnerability, and we want to hear about it.
