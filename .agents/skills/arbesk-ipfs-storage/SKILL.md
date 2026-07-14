---
name: arbesk-ipfs-storage
description: IPFS storage expertise for the Arbesk project. Covers the private Kubo Docker node, pin/unpin semantics, add/pin/rm API flows, manifest chain storage model, garbage collection, browser-side writes, read cache, the unpin-on-burn lifecycle, and Pinata cloud mode (signed/presigned upload URLs, createSignedURL, mintUploadCredential, batch-minting credentials, single-use URL semantics). Use whenever IPFS is involved — "content not found after add", "IPFS is down", "CID won't resolve", "pinning fails", "CORS error from IPFS", "storage full", "run garbage collection", "unpin after burn", "Docker IPFS config", "upload-url is slow", "can I reuse a signed URL", "Pinata 403/404", "duplicate file id", or any IPFS read/write/pin/unpin operation across backend or frontend. If any IPFS-related error appears in logs, invoke this skill.
---

# Arbesk IPFS & Storage

Use this skill when working with any IPFS-related code in the Arbesk project — reads, writes, pinning, unpinning, garbage collection, Docker configuration, or storage lifecycle questions.

## Quick Decision

| Question | Action |
|----------|--------|
| Content not found after `ipfs.add()`? | Check if node initialized, repo corrupted, or `StorageMax` too low. See [→ Troubleshooting](./references/troubleshooting.md) |
| Frontend IPFS writes fail with CORS? | CORS headers set in entrypoint. See [→ Docker Config](./references/docker-config.md) |
| `WRONG_CONTRACT` with smart account? | Validate events, not `receipt.to`. See `solidity-smart-contracts` skill |
| Need to manually unpin after burn? | `POST /api/v1/ipfs/unpin` with manifest CID. See [→ API Reference](./references/api-reference.md) |
| Pinata upload-url is slow, or want to reuse a signed URL for multiple files? | Signed URLs are single-use (verified, 409 on reuse) — batch-mint N credentials in one call instead. Request-path latency is also hidden by a pre-minted pool (`PINATA_POOL_SIZE`). See [→ Pinata Mode](./references/pinata-mode.md) |
| `PINATA_POOL_SIZE` set but mints still slow, or a "pool misconfigured" warning in logs? | `PINATA_UPLOAD_TTL` must exceed `PINATA_POOL_EXPIRY_MARGIN` or every pooled entry is stale on arrival. See [→ Pinata Mode §7](./references/pinata-mode.md) |
| `IPFS_BACKEND=pinata` 403/404 on read, or Pinata-specific question? | See [→ Pinata Mode](./references/pinata-mode.md) |

## Key Rules

1. **Every `ipfs.add()` must be followed by explicit `ipfs.pin.add()`** — defense-in-depth.
2. **Pin calls are wrapped in try/catch** — a pin failure is non-fatal; log and continue.
3. **Use `catManifest()` for all backend manifest reads** — consistent timeout + chunk decoding.
4. **Never unpin content belonging to other tokens** — `child_ref` CIDs are excluded from unpin-on-burn.
5. **Do NOT add prefetching to the frontend cache** — on-demand by design.
6. **Do NOT expose IPFS ports beyond `127.0.0.1`** — node must remain private.
7. **Log IPFS operations with `[IPFS]` tag** — per project logging conventions.
8. **Storage cap is 100 GB** — adjust `Datastore.StorageMax` if needed.
9. **Unpin before running GC** — never run `ipfs repo gc` without unpinning first.
10. **Test IPFS changes with backend running** — `./scripts/start-dev.sh` (or `npm start` + `docker compose up -d ipfs`).
11. **Pinata signed URLs are single-use** — verified empirically (409 "duplicate file id" on reuse), no `max_uses` param exists. Never design a flow that reuses one signed URL for multiple files; batch-mint instead. See [→ Pinata Mode](./references/pinata-mode.md).
12. **A worker call and a main-thread call never share a live credential pool** — `postMessage`/structured clone gives the worker its own copy; pops in one don't affect the other. Reserve any post-worker main-thread upload's credential *before* the worker call (see `reserveFollowUpCredential` in `async-gltf.js`).
13. **Two distinct pools exist — don't conflate them.** The backend pre-minted pool (`pinata-adapter.js`, §7 of Pinata Mode) hides Pinata's `/files/sign` latency from the request path; the frontend per-publish credential pool (`async-gltf.js`, §3) hides Pinata's single-use constraint across a multi-file upload. Both are internal — routes/callers never see either.
14. **Any background "loop until caught up" job needs a round cap** — an unbounded retry/refill loop can spin forever on pure microtask work if its target condition can never actually be satisfied (e.g. entries expiring as fast as they're minted), which starves Node's event loop and hangs the whole process, not just one call. Caught exactly this way in the pool's refill logic — see [→ Pinata Mode §7](./references/pinata-mode.md).

## File Map

| File | Role | Details |
|------|------|---------|
| `src/api/routes/ipfs.js` | Backend routes: `POST /ipfs/upload-url`, `POST /ipfs/upload-urls` (batch), `POST /ipfs/unpin` (all session-gated) | [→ Deep Dive](./references/deep-dive.md) |
| `src/api/ipfs-utils.js` | `catManifest()` — IPFS read with timeout | [→ Deep Dive](./references/deep-dive.md) |
| `src/api/assets/generate-node.js` | Generation pipeline: add asset, build manifest, pin | [→ Deep Dive](./references/deep-dive.md) |
| `src/api/storage/pinata-adapter.js` | Pinata adapter: `add`, `mintUploadCredential(s)` backed by a pre-minted pool, authenticated gateway reads, per-attempt `/files/sign` diagnostic logging | [→ Pinata Mode](./references/pinata-mode.md) |
| `src/api/storage/index.js` | Selects Kubo/Pinata adapter; sources `PINATA_POOL_SIZE`/`PINATA_POOL_EXPIRY_MARGIN` from env | [→ Pinata Mode](./references/pinata-mode.md) |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side IPFS writer | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ipfs/upload-with-credential.js` | Worker-safe upload primitives; pooled-credential consumption for Pinata | [→ Pinata Mode](./references/pinata-mode.md) |
| `frontend/src/js/gltf/async-gltf.js` | Credential pool sizing/reservation for worker-offloaded glTF/GLB decompose | [→ Pinata Mode](./references/pinata-mode.md) |
| `frontend/src/js/ipfs/remote-ipfs.js` | Browser-side IPFS reader with cache | [→ Deep Dive](./references/deep-dive.md) |
| `docker/Dockerfile` | Kubo IPFS container image | [→ Docker Config](./references/docker-config.md) |
| `docker/entrypoint.sh` | IPFS node init and isolation config | [→ Docker Config](./references/docker-config.md) |
| `docker-compose.yml` | Orchestration: IPFS + Hardhat | [→ Docker Config](./references/docker-config.md) |

## Deep Reference

| Topic | File |
|-------|------|
| Architecture, Pinning, Write/Read Paths, Cache, Chain Model | [→ Deep Dive](./references/deep-dive.md) |
| Unpin Endpoint Spec | [→ API Reference](./references/api-reference.md) |
| Docker Config, Isolation, Volumes | [→ Docker Config](./references/docker-config.md) |
| Manual Operations, Symptom/Cause/Fix | [→ Troubleshooting](./references/troubleshooting.md) |
| Pinata Mode: Signed-URL Single-Use, Batch-Mint, Frontend Credential Pooling, Backend Pre-Minted Pool, Diagnostic Logging, Latency Baseline | [→ Pinata Mode](./references/pinata-mode.md) |
