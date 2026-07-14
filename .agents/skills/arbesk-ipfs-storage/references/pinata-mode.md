# Pinata Mode — Arbesk IPFS & Storage

Everything above this file assumes the default `IPFS_BACKEND=kubo` dev stack. This
file covers `IPFS_BACKEND=pinata` (the testnet/production adapter): credential
minting, the signed-URL single-use constraint, the batch-mint fix, and how to
verify Pinata behavior empirically instead of trusting docs (their docs don't
say whether signed URLs are reusable — you have to test it).

## 1. Architecture

`src/api/storage/pinata-adapter.js` wraps the Pinata v3 SDK (`PinataSDK`).
Selected in `src/api/storage/index.js` when `IPFS_BACKEND=pinata`, reading
`PINATA_JWT`, `PINATA_GATEWAY`, `PINATA_UPLOAD_TTL` from `.env`.

- **Backend writes** (`add`, `addDirectory`): use the master JWT directly, server-side only.
- **Browser writes**: the browser never sees the JWT. The backend mints a
  short-lived Pinata *signed upload URL* via `POST /api/v1/ipfs/upload-url`
  (single) or `POST /api/v1/ipfs/upload-urls` (batch, see §3), and the browser
  POSTs the file directly to that URL.
- **Reads**: `cat`/`catBytes` use `pinata.gateways.public.get(cid)` — the
  *authenticated* gateway, not a public gateway fetch. Content not pinned to
  this Pinata account 404s with "The owner of this gateway does not have this
  content pinned to their Pinata account" even if the CID is valid elsewhere
  (e.g. content from a Kubo-backed dev run, or from before a Pinata plan
  upgrade). That 404 is not a bug — it means the CID was never actually
  uploaded to this Pinata account.

## 2. Signed URLs Are Strictly Single-Use (Verified, Not Documented)

**Empirically confirmed against the live Pinata account (2026-07-14):** one
signed URL from `pinata.upload.public.createSignedURL()` /
`POST uploads.pinata.cloud/v3/files/sign` accepts exactly **one** upload.
Every subsequent upload against the same URL — sequential or concurrent —
returns:

```json
{"error":{"code":409,"message":"duplicate file id"}}
```

The mechanism: Pinata pre-creates a file record when it signs the URL, so the
URL is bound to that one file slot. The `/v3/files/sign` request body has no
`max_uses`/reuse parameter — only `expires`, `date`, `filename`/`name`,
`group_id`, `keyvalues`, `max_file_size`, `allow_mime_types`. Pinata's own
docs never state this explicitly either way; don't trust a "presigned URLs
are per-file" comment in old code as authoritative — verify against the live
API if it matters (see §6 for the throwaway-script pattern).

**Consequence:** `mintUploadCredential()` returns `reusable: false` for
Pinata (`reusable: true` for Kubo, which has no such limit). Any code path
that uploads N files must mint N signed URLs — one credential can never be
reused across files.

## 3. Batch-Mint Pattern (the fix for N-file slowness)

Before this pattern existed, every component file (glTF buffer, texture,
composite JSON) minted its own credential one at a time —
`frontend/src/js/ipfs/write-to-ipfs.js`'s `credential || await getUploadCredential()`
fallback — turning a 10-file asset publish into 10 serialized
backend-round-trip + Pinata-sign-call pairs. Steady-state a single mint is
~0.4–0.6s warm (~1–2s cold-TLS first call of a session); it multiplies badly.
A ~9–10s single-mint delay observed in the wild was the Pinata SDK's internal
3-retry backoff (~1+2+4s) on a transient failure, not steady-state cost.

The fix: mint the whole batch of signed URLs in **one** backend round trip,
parallelized server-side, then hand one URL to each file.

- **Backend**: `StorageAdapter.mintUploadCredentials(count)` —
  `pinata-adapter.js` runs `Promise.all` of N `createSignedURL()` calls;
  `kubo-adapter.js` returns N copies of the same reusable credential (no-op,
  Kubo doesn't need pooling). Route: `POST /api/v1/ipfs/upload-urls`
  `{ count }` (1–200, `uploadUrlsSchema` in `src/api/schemas.js`) →
  `{ credentials: [...] }`. Session-gated, rate-limited like `/upload-url`.
- **Frontend**: `getUploadCredentials(count)` in `services/api.js` hits the
  batch route. `frontend/src/js/gltf/async-gltf.js` wraps it in
  `getPooledUploadCredential(count)`, which for Pinata reshapes the array
  into a single pool-credential object: `{ backend: 'pinata', urls: [...],
  gateway, reusable: true }` (kubo passes through unchanged — already
  reusable). `count` is estimated as an **upper bound**
  (`buffers.length + images.length + 1`, clamped to 200) via
  `estimateUploadCount`/`estimateGlbUploadCount` — over-minting is harmless
  (unused signed URLs just expire), under-minting would starve mid-upload.
- **Consumption**: `frontend/src/js/ipfs/upload-with-credential.js`'s
  `uploadToPinata()` calls `nextPinataUrl(credential)`, which does
  `credential.urls.shift()` for a pool credential (or returns the plain
  `credential.url` for a legacy single-shot credential). Safe without a lock
  because JS is single-threaded and the shift happens synchronously before
  the upload's first `await` — concurrent uploads via
  `uploadBatchToIPFSWithCredential`/the concurrency limiter in
  `upload-with-credential.js` can't interleave mid-shift.
- **Retry fix (bundled with the pool)**: the old retry-once-on-network-error
  logic in `uploadToPinata` retried against the *same* URL. If that URL had
  actually reached Pinata before the client saw a network error, retrying
  guaranteed a false 409. With a pool, retry now draws a *fresh* URL via the
  same `nextPinataUrl` call — the bug only remains for legacy single-shot
  credentials, which have no replacement URL to draw from.

### The clone-boundary gotcha

`decomposeAndStoreAsync` in `async-gltf.js` runs buffer/image uploads inside
a Web Worker (`decomposeAndUploadGltf`), then writes the composite JSON back
on the **main thread** afterward. The credential object crosses the worker
boundary via `postMessage`/structured clone — the worker mutates its own
*copy* of `credential.urls`, so the main thread's copy is untouched and
still has every URL, including the ones the worker already spent. Without
guarding this, the main-thread composite write would pop `urls[0]` — a URL
the worker's clone already used — and hit the same 409.

Fix: `reserveFollowUpCredential(credential)` carves one URL off the pool
*before* the worker call (non-mutating `.slice()`, so a worker-failure
fallback to the main-thread decompose path still sees the full original
pool) and hands the worker a pool one shorter. `decomposeGLBAsync` doesn't
need this — its worker task (`decomposeAndUploadGlb`) uploads buffers,
images, *and* the composite JSON all inside the same worker call, so there's
no cross-boundary desync to guard against.

**If you add a new async-gltf.js flow that (a) uses a pooled Pinata
credential in a worker call, and (b) does a follow-up IPFS write on the main
thread after that worker call returns — you need the same
`reserveFollowUpCredential` treatment, or the follow-up write will 409.**

## 4. Latency Baseline (2026-07-14, from this environment)

- `POST /v3/files/sign` raw: 0.56–1.9s (first call of a connection slowest — cold TLS)
- SDK `createSignedURL`, 5 sequential: 1821, 646, 445, 517, 345ms
- Batch mint via `mintUploadCredentials(5)` (parallel `Promise.all`): ~1.5s total for 5 — not 5×
- Individual Pinata upload POSTs: ~2.1–2.7s typical, one outlier at 8.5s (network variance, not a code issue)

If minting looks like ~9–10s again, suspect a transient failure retried by
the SDK's internal backoff, or Pinata-side/network slowness that day — not a
regression in this code. Check the Pinata status page and re-run the
throwaway script in §5 before assuming a code bug.

### Confirmed mechanism (not speculation)

The retry/backoff claim above is verified against the actual installed SDK,
not inferred from behavior: `node_modules/pinata/dist/index.mjs` (search
`Source: "sdk/createSignURL"`) retries `POST .../v3/files/sign` up to 3 times
on retryable failures (network errors, 5xx, 429 — 4xx auth errors throw
immediately, no retry) with `delay = Math.min(1000 * 2**attempt, 4000)`ms —
i.e. 1s, 2s, 4s between attempts. `pinata-adapter.js`'s
`installSignedUrlDiagnostics()` (see §5) caught a live instance of exactly
this on the first real run after being added: attempt #1 failed with a raw
`fetch failed` (no HTTP status — a network-level failure, e.g. DNS/TCP/TLS,
not a Pinata-side 5xx) after 890ms, attempt #2 succeeded after 1139ms. So at
least some of these slow mints are genuine transient network failures
between this environment and `uploads.pinata.cloud`, not Pinata service
errors — but don't assume that's the only cause without checking the logs
each time (see §5).

## 5. Signed-URL Diagnostic Logging

`pinata-adapter.js` installs a scoped `fetch` wrapper (`installSignedUrlDiagnostics`,
called once from `createPinataAdapter`, idempotent, lazy - never installed in
Kubo-only deployments) that intercepts only URLs containing `/files/sign` and
logs each individual attempt the SDK's internal retry loop makes - the ones
that never otherwise reach application code, since the SDK swallows each
attempt's error and only throws if all 4 attempts (1 + 3 retries) exhaust:

```
[IPFS] pinata sign #1 → dispatched
[IPFS] pinata sign #1 → ERROR (890ms): fetch failed
[IPFS] pinata sign #2 → dispatched
[IPFS] pinata sign #2 → OK (1139ms)
```

- `ERROR (Nms): <message>` — the `fetch()` call itself threw (network-level: DNS, TCP, TLS, timeout).
- `HTTP <status> (Nms)` — Pinata responded but not 2xx (5xx or 429 trigger a retry; other 4xx would already have thrown inside the SDK before reaching a log line here, since those aren't retried).
- `OK (Nms)` — this attempt succeeded.

The sequence number (`#N`) is a process-global counter, not per-mint - the
SDK gives no correlation id across its own retries. Adjacent numbers usually
belong to the same logical mint (the SDK's retry loop is serial), but under
heavy concurrency (e.g. `mintUploadCredentials()`'s `Promise.all` batch, or
multiple simultaneous requests) numbers from different logical mints can
interleave. Still useful for diagnosis - just don't over-read exact grouping
under load. Every other fetch call in the process (RPC, other Pinata
endpoints like `files.public.list/delete`) passes through this wrapper
completely untouched.

When the next slow mint is reported, grep the backend log for `pinata sign`
around the same timestamp/request to see exactly which attempt(s) failed and
why, instead of re-deriving the mechanism from scratch.

## 6. How to Verify Pinata Behavior Empirically

Don't trust old comments or docs gaps about Pinata semantics — the SDK and
API evolve, and some behavior (like §2) is simply undocumented. Write a
throwaway Node script against the real account instead of guessing:

```js
// Load PINATA_JWT/PINATA_GATEWAY from .env, then either:
//   - use the SDK: import from node_modules/pinata/dist/index.mjs
//     (package.json only exposes ESM via `import`, not a bare specifier
//     resolvable without package "exports" - import the dist path directly)
//   - or raw fetch: POST https://uploads.pinata.cloud/v3/files/sign
//     with Authorization: Bearer $PINATA_JWT
```

**Always clean up test files afterward** — `pinata.files.public.list().name(prefix)`
to find them, `pinata.files.public.delete([...ids])` to remove them. The
bulk `DELETE https://api.pinata.cloud/v3/files/public` raw endpoint is
flaky for this (returned 404 in testing); the SDK's `files.public.delete()`
is the reliable path, and even it occasionally needs one retry per id
("fetch failed" on a single id, succeeds on retry).

## 7. Pre-Minted Credential Pool (hides mint latency from the request path)

Even with the batch-mint fix (§3), every mint - single or batch - still pays
Pinata's `/files/sign` latency (§4: 0.4-6s+, occasionally ~9-10s with SDK
retries) *on the request path*, because it mints on demand. `pinata-adapter.js`
closes that gap: a small pool of already-signed URLs, kept warm in the
background, so `mintUploadCredential(s)` usually just pops from an array -
sub-millisecond, verified live (0-5ms per pop against the real account).

- **Config**: `PINATA_POOL_SIZE` (default 20, 0 disables pooling entirely -
  falls back to minting on demand, byte-for-byte the pre-pool behavior) and
  `PINATA_POOL_EXPIRY_MARGIN` (default 60s) via `storage/index.js`. A pooled
  entry is discarded once `Date.now() - mintedAt > uploadTtl - margin` -
  don't hand the browser a URL that might expire mid-upload.
  **`PINATA_UPLOAD_TTL` must comfortably exceed the margin** or pooling does
  nothing (every entry is stale the instant it's minted) - `pinata-adapter.js`
  logs a `pool misconfigured` warning at construction if so.
- **Serving**: `mintUploadCredential()`/`mintUploadCredentials(count)` prune
  expired entries, pop what's available, mint only the shortfall inline (same
  fallback path as before pooling existed), then trigger a background
  top-up (`scheduleRefill()`) before returning. Callers see the exact same
  credential shape either way - pooling is invisible to routes/frontend.
- **Warm-up**: `createPinataAdapter()` fires one background refill at
  construction so the pool starts filling immediately, without blocking
  server startup or the first request (which falls back to inline mint if
  it arrives before warm-up finishes - no worse than before pooling).
- **Refill collapsing, and the burst bug it caused**: concurrent refill
  triggers (a pop plus the construction warm-up, or several pops in a
  burst) share one in-flight promise rather than stacking redundant Pinata
  calls. The first version computed the shortfall *once* per trigger and
  didn't recheck - verified live against the real account: draining a
  pool of 5 with 5 rapid pops only refilled it back to 1/5 (the shortfall
  at the *first* pop), because the other 4 pops piggybacked on that
  refill's promise instead of contributing their own shortfall. Fixed with
  `refillLoop()`, which rechecks the shortfall after every round and keeps
  minting until caught up (or gives up after `MAX_REFILL_ROUNDS = 5`).
  Re-verified live after the fix: same 5-pop burst now correctly reaches
  5/5 over two rounds (+1, then +4).
- **The infinite-loop trap in that same fix**: rechecking shortfall in a
  loop is only safe because `mintFreshEntries` genuinely awaits a Promise
  each round. If `uploadTtl <= poolExpiryMarginSeconds` (the misconfiguration
  warned about above), every freshly-minted entry's `mintedAt` is already
  past the prune cutoff by the time the *next* round's `pruneExpired()`
  runs, so the shortfall never reaches 0 - an unbounded loop spins forever
  on pure microtask work, which starves Node's event loop entirely (no
  macrotask yield ever happens) and hangs the process with zero output, not
  just that one request. Caught by actually running the test for that exact
  misconfigured case (a 60s-timeout `timeout` wrapper around the Jest run
  showed zero output rather than a normal pass/fail), not by inspection -
  a reminder that any "loop until caught up" background job needs a round
  cap regardless of how "obviously" the condition should converge.
- **Trade-off**: a popped-but-never-uploaded-to credential wastes a
  pre-created Pinata file slot until it expires - same as the batch
  endpoint's over-minting (§3), bounded by keeping `PINATA_POOL_SIZE` modest.
