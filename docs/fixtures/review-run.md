# Rate limiting

A short, deliberately imperfect document for the Phase 4 acceptance run. Unlike
`kitchen-sink.md` — which unit tests and `dev/harness/fixture.js` both assert against, and which
must therefore never change — this file exists to be rewritten by an agent. Reset it with
`git checkout docs/fixtures/review-run.md` when the run is done.

## How it works

Requests are counted per API key. When a key goes over its allowance the service returns an error
and the caller is expected to back off. The window is fairly short, so a client that misbehaves
recovers quickly, and we have found this works well in practice for most consumers.

Counters live in memory. This is fine for now.

## Configuration

The limit is set with the `RATE_LIMIT` environment variable. There is also a burst allowance which
is calculated from it automatically.

```ts
export function allow(key: string, now: number): boolean {
  const bucket = buckets.get(key) ?? refill(key, now);
  return bucket.tokens >= 1;
}
```

## Failure modes

If the counter store is unavailable the service currently fails open, which means every request is
allowed through. Nobody has decided whether that is the right default.

Clients receive a `429` with no indication of when to retry.

## Rollout

We will turn it on for internal traffic first, then everyone else. The exact ordering has not been
written down anywhere, which has caused confusion before.
