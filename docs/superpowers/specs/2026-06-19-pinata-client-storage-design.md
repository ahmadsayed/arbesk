# Pinata Client-Side Storage Migration — Design

**Issue:** #27 — Client-side Pinata uploads with short-lived scoped tokens (pre-3D storage migration)
**Date:** 2026-06-19
**Status:** Approved design — ready for implementation plan

---

## 1. Problem

Today the browser POSTs binary data directly to the private Kubo node at
`http://127.0.0.1:5001` (`frontend/src/js/ipfs/write-to-ipfs.js`), and reads
from the loopback gateway `http://127.0.0.1:8080` (`frontend/src/js/ipfs/remote-ipfs.js`).
This only works because the browser and Kubo share one machine. A tester's
browser on a different machine cannot reach the loopback node, so nothing they
store is durable or publicly resolvable.

This work moves **all** IPFS storage onto **Pinata**, with browser uploads
performed client-side via **short-lived presigned upload URLs** minted by the
backend. It is the gating infra dependency for any external pilot, and lands
*before* the real cloud 3D-generation work (the current `501` path in
`src/api/assets/generate-node.js`).

## 2. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Write scope | **All storage via Pinata** — frontend writes, backend `generate-node` writes, unpin-on-burn. Kubo retained **only** for the E2E automated suite. |
| 2 | CID version | **CIDv1 (`baf…`)** — greenfield; backward compatibility with existing `Qm…` CIDs is explicitly **not** a goal. |
| 3 | Local dev / E2E | Local dev **web UI** uses Pinata. The **automated E2E suite** keeps using the local Kubo node. Selected by an `IPFS_BACKEND` env switch. |
| 4 | Client credentials | **Pinata v3 presigned upload URLs** (`pinata.upload.public.createSignedURL`). Free-plan compatible; master JWT never reaches the browser. |
| 5 | Rate limit | **5 uploads / 60s**, keyed on the **SIWE wallet address** (session `userAddress`), not IP. |

## 3. Architecture

### 3.1 Storage backend abstraction

A single backend env, `IPFS_BACKEND` (`pinata` | `kubo`), selects the storage
path server-side:

- **`pinata`** (local dev web UI, testnet, production): backend uses the Pinata
  v3 SDK (`new PinataSDK({ pinataJwt, pinataGateway })`) initialized with the
  master JWT from `.env`. Browser uploads use presigned URLs.
- **`kubo`** (automated E2E suite only): retains today's `ipfs-http-client`
  against the local node. `e2e/` specs and the Docker stack are untouched.

The abstraction is a thin server-side module (e.g. `src/api/storage/index.js`)
exposing `add(payload)`, `mintUploadCredential(session)`, `unpin(cid)`, and
`gatewayBase()`, dispatching on `IPFS_BACKEND`. Existing call sites
(`generate-node.js`, `index.js` thumbnail/manifest add, `/ipfs/unpin`) call
through this module rather than `ipfs.*` directly.

### 3.2 Pinata products — public, not private

Use Pinata v3 **`upload.public`** (public IPFS, DHT-resolvable CIDs) — **not**
`upload.private` (signed-gateway-only). On-chain `tokenURI`s and manifest chains
embed these CIDs and must resolve through a normal IPFS gateway.

### 3.3 CID version

Pinata v3 public uploads return **CIDv1 (`baf…`)** by default (e.g. `bafy…` for dag-pb, `bafkrei…` for raw JSON). No
`cidVersion: 0` override. New assets are CIDv1 end-to-end.

## 4. Backend changes

### 4.1 New route: `POST /api/v1/ipfs/upload-url`
- **Auth:** session-gated (`authenticate`).
- **Rate limit:** 5 / 60s on wallet (see §6).
- **Pinata mode:** returns `{ backend: "pinata", url, gateway }` where `url`
  comes from `createSignedURL({ expires: PINATA_UPLOAD_TTL })`.
- **Kubo mode:** returns `{ backend: "kubo", apiUrl }` so the frontend uses the
  legacy multipart path.
- Master JWT is never included in the response.

### 4.2 `POST /api/v1/ipfs/unpin` (burn lifecycle)
- **Pinata mode:** for each CID gathered from the manifest walk, resolve CID →
  file id via `files.public.list({ cid })`, then `files.public.delete([id])`.
  Treat "not found" as already-unpinned (parity with current "not pinned" branch).
- **Kubo mode:** unchanged (`ipfs.pin.rm`).

### 4.3 Backend-originated writes
- `generate-node.js`: replace `ipfs.add` + `ipfs.pin.add` for the source asset
  and manifest with `storage.add(...)` (Pinata mode → `upload.public.file` with
  master JWT; Kubo mode → current path).
- `index.js`: the thumbnail and manifest `ipfs.add`/`pin.add` (lines ~69, ~116)
  move to `storage.add(...)` the same way.

## 5. Frontend changes

### 5.1 `frontend/src/js/ipfs/write-to-ipfs.js`
- `writeToIPFS` / `writeJSONToIPFS` first call `POST /api/v1/ipfs/upload-url`.
  - `backend === "pinata"`: upload via
    `pinata.upload.public.file(blob).url(signedUrl)` (or equivalent fetch to the
    signed URL), return the CIDv1.
  - `backend === "kubo"`: keep the current multipart `POST /api/v0/add`.
- Token handling: fetch one presigned URL per upload burst; refresh on `401` or
  expiry. (Each presigned URL is single-target; mint per file or per small burst
  as the SDK allows.)

### 5.2 `frontend/src/js/ipfs/remote-ipfs.js`
- Gateway base URL becomes runtime-config-driven: the Pinata dedicated gateway
  for dev/prod, `http://127.0.0.1:8080/ipfs/` for E2E. Source the value from the
  `/upload-url` response `gateway` (cached) or a small config endpoint.
- Keep `cache: "no-store"` semantics (re-enabling the browser read cache is out
  of scope).

### 5.3 CID normalization
- Verify `frontend/src/js/blockchain/uri-utils.js` (`normalizeTokenURI`) and
  `token-resolver.js` accept CIDv1 (`baf…`). The existing `[A-Za-z0-9]{46,}` regex
  matches CIDv1 by length; add a regression test for a CIDv1 round-trip through
  `normalizeTokenURI`.

## 6. Rate limiting

`src/api/rate-limiter.js` currently keys on `res.locals.userAddress` only when
`req.body.txHash` is present, else `req.ip`. Generalize: **prefer
`res.locals.userAddress` whenever a session set it** (authenticate runs first),
falling back to `req.ip`. The `/upload-url` route uses
`rateLimit({ max: 5, windowMs: 60_000 })`. This change is backward-compatible
with the generation route (still wallet-keyed there).

## 7. Config

Document in `docs/CURRENT_STATUS.md §6.5`. All secrets gitignored.

| Var | Scope | Meaning |
|-----|-------|---------|
| `IPFS_BACKEND` | backend | `pinata` (default for dev/prod) or `kubo` (E2E) |
| `PINATA_JWT` | backend secret | Master JWT for the v3 SDK; server-only |
| `PINATA_GATEWAY` | backend | Dedicated gateway host (e.g. `xxxx.mypinata.cloud`) |
| `PINATA_UPLOAD_TTL` | backend | Presigned URL lifetime in seconds |

The existing `.env.pinata` (untracked) supplies the JWT/keys; values fold into
`.env` (or are loaded from `.env.pinata`) — never committed.

## 8. Testing

### 8.1 Unit — rate limit without uploading
In `test/api.test.js`, mock `createSignedURL` so `/api/v1/ipfs/upload-url` only
*mints* a URL (no network, no file sent). With a valid session:
- Call 6× within the 60s window → assert the 6th returns `429 RATE_LIMITED`
  with a `Retry-After` header.
- Call without a session → assert `401`.
Rate limiting is verified purely at the token-minting layer; no real upload occurs.

### 8.2 Unit — route branching & unpin
- `/upload-url` returns the `pinata` vs `kubo` response shape per `IPFS_BACKEND`.
- Pinata unpin path (`files.public.list({cid})` → `files.public.delete([id])`)
  with the Pinata SDK mocked.

### 8.3 E2E — default suite stays on Kubo
Specs `01`–`06` run with `IPFS_BACKEND=kubo`, unchanged. No selector/manifest
rewrites expected.

### 8.4 E2E — new Pinata spec (`e2e/specs/07-pinata-storage.spec.js`)
Runs with `IPFS_BACKEND=pinata` against **real Pinata**. The only spec that
touches the network/third party.
- Generate/save an asset; assert a `baf…` **CIDv1** is returned.
- Fetch the CID back through the Pinata dedicated gateway and validate the
  manifest.
- Assert the network log carries only a **signed URL**, never the master JWT.
- Isolation: own Playwright project or `@pinata` grep tag so the default run
  never depends on the network or consumes quota.
- Requires `PINATA_JWT` / `PINATA_GATEWAY` in the E2E env; **skips with a clear
  message** if absent.

### 8.5 Manual acceptance (issue criteria)
- A browser on a *different machine* than the backend stores an asset/manifest
  and resolves it back via the Pinata gateway.
- Network inspector shows only short-lived signed URLs reaching the browser.
- Burn → unpin removes pins from Pinata.

## 9. Affected files

- `src/api/storage/index.js` (new — backend abstraction)
- `src/api/index.js` (`/ipfs/upload-url` new route, `/ipfs/unpin` Pinata path, thumbnail/manifest add)
- `src/api/assets/generate-node.js` (source asset + manifest add via storage module)
- `src/api/rate-limiter.js` (prefer session wallet key)
- `frontend/src/js/ipfs/write-to-ipfs.js` (write path)
- `frontend/src/js/ipfs/remote-ipfs.js` (read gateway)
- `frontend/src/js/blockchain/uri-utils.js`, `token-resolver.js` (CIDv1 verify + test)
- `test/api.test.js` (rate-limit + branching + unpin tests)
- `e2e/specs/07-pinata-storage.spec.js` (new), `e2e/playwright.config.js` (project/tag)
- `docs/CURRENT_STATUS.md §6.5` (config docs)
- `package.json` (Pinata v3 SDK dependency)

## 10. Out of scope
- Real cloud 3D generation (the `501` adapter path — separate later issue).
- Re-enabling the disabled browser read cache (`IPFS_CACHE_ENABLED`).
- Migrating existing `Qm…` CIDs already on-chain (greenfield break accepted).
