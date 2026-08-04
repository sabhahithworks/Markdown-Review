---
title: Kitchen Sink
owner: platform-team
tags: [fixture, testing]
---

# Kitchen Sink

This fixture exercises every construct the renderer and the anchoring core have to survive. It is
shared deliberately: Phase 1 asserts against it in unit tests, and Phase 2 uses the same document
for the manual CSP, theming and `data-line` verification passes. One artifact, so the two cannot
drift apart.

## Prose and inline formatting

The authentication service validates every incoming bearer token against the issuer key set before
forwarding the request onward. It writes a **structured audit entry** for each decision, including
*rejections*, and it never logs the raw token. Legacy behaviour is ~~documented below~~ removed.

Call `refreshCredentials()` before the first request. See the [auth guide](https://example.com/auth)
for the full flow, or the bare URL https://example.com/status for current health.

A line break in the source
should read as one continuous sentence, and a hard break follows here  
on its own visual line.

## Nested lists

- Deployment prerequisites
  - A configured issuer key set
  - Network egress to the token endpoint
    - Port 443 only
- Runtime requirements
  1. Node 20 or newer
  2. A writable cache directory

## Task list

- [x] Rotate the signing key
- [ ] Document the rotation procedure
- [ ] Add an expiry alert

## Blockquotes

> Tokens are validated at the edge, never inside the service mesh.
>
> > Nested quotes are rendered as a distinct level.

## Table

| Field | Type | Required | Notes |
|---|---|---|---|
| `sub` | string | yes | Subject identifier |
| `exp` | number | yes | Expiry, seconds since epoch |
| `scope` | string | no | Space-delimited list |

## Fenced code

```ts
export function verify(token: string, keys: KeySet): Claims {
  const header = decodeHeader(token);
  const key = keys.find(header.kid);
  if (!key) throw new UnknownKeyError(header.kid);
  return decodeClaims(token, key);
}
```

```bash
curl -sS -H "Authorization: Bearer $TOKEN" https://example.com/whoami
```

```
No language tag on this fence, and it keeps    its    interior    spacing.
```

Indented code follows:

    plain indented block
    second line

## Images and relative paths

![Architecture diagram](./diagram.png)

![*Emphasised* alt text](./flow.png)

## Injection attempts (must render inert)

<script>alert('xss')</script>

<img src=x onerror="alert('xss')">

<div onclick="alert('xss')">Not a real element.</div>

[Click me](javascript:alert('xss'))

## Unicode

Emoji, including a ZWJ sequence: 👨‍👩‍👧 and a simple one 🚀.

CJK: 認証サービスはすべてのトークンを検証します。 家族 の 記録。

Combining marks: café (composed) and café (decomposed) must compare equal after NFC.

RTL: مرحبا بالعالم — followed by more Latin text.

Mixed: The ключ field maps to `key`.

## Horizontal rule

---

Content after the rule, so an unterminated-front-matter bug is visible immediately.
