---
name: arbesk-ipfs-storage
description: Use for any IPFS read/write/pin/unpin issue, backend or frontend — "content not found after add", "CID won't resolve", "pinning fails", CORS errors, garbage collection, unpin-on-burn, Kubo Docker config, or Pinata signed upload URLs (single-use semantics, 403/404/409, "duplicate file id"). If any IPFS error appears in logs, invoke this skill.
---

# Arbesk IPFS & Storage

## Quick Decision

| Symptom / need | Action |
|----------------|--------|
| Content not found after `ipfs.add()` | Node init / corrupted repo / `StorageMax` — read `references/troubleshooting.md` |
| Frontend writes fail with CORS | Read `references/docker-config.md` |
| `WRONG_CONTRACT` with smart account | Validate events, not `receipt.to` — see `solidity-smart-contracts` skill |
| Manual unpin after burn | `POST /api/v1/ipfs/unpin` — read `references/api-reference.md` |
| Pinata: slow mints, signed-URL reuse, 403/404, "pool misconfigured" | Read `references/pinata-mode.md` (`PINATA_UPLOAD_TTL` must exceed `PINATA_POOL_EXPIRY_MARGIN`) |

## Key Rules

1. Every `ipfs.add()` must be followed by explicit `ipfs.pin.add()` — defense-in-depth.
2. Pin failures non-fatal — try/catch, log, continue.
3. Backend manifest reads via `catManifest()` only (timeout + chunk decoding).
4. Never unpin other tokens' content — `child_ref` CIDs excluded from unpin-on-burn.
5. No prefetching in the frontend cache — on-demand by design.
6. IPFS ports loopback-only (`127.0.0.1`) — node stays private.
7. Log IPFS ops with `[IPFS]` tag.
8. Storage cap 100 GB (`Datastore.StorageMax`).
9. Unpin before `ipfs repo gc`.
10. Test with backend running — `./scripts/start-dev.sh`.
11. Pinata signed URLs strictly single-use (verified 409 "duplicate file id" on reuse, no `max_uses`) — never reuse across files; batch-mint. §2–3.
12. Worker and main thread never share a live credential pool (structured clone) — reserve follow-up credential *before* the worker call (`reserveFollowUpCredential`, `async-gltf.js`). §3.
13. Two pools, don't conflate: backend pre-minted (hides sign latency, §7) vs frontend per-publish (works around single-use, §3).
14. Background "loop until caught up" jobs need a round cap — unbounded microtask loops starve the event loop, hanging the process. §7.

(§ = section of `references/pinata-mode.md`.)

## File Map

| File | Role |
|------|------|
| `src/api/routes/ipfs.ts` | `POST /ipfs/upload-url`, `/upload-urls` (batch), `/unpin` — all session-gated |
| `src/api/ipfs-utils.ts` | `catManifest()` — read with timeout |
| `src/api/assets/generate-node.ts` | Generation: add, build manifest, pin |
| `src/api/storage/pinata-adapter.ts` | Pinata `add`, pooled `mintUploadCredential(s)`, gateway reads, sign diagnostics |
| `src/api/storage/index.ts` | Kubo/Pinata selection; pool env vars |
| `frontend/src/js/ipfs/write-to-ipfs.ts` | Browser-side writer |
| `frontend/src/js/ipfs/upload-with-credential.ts` | Worker-safe upload; pool consumption |
| `packages/asset-core/src/formats/gltf/async-gltf.ts` | Pool sizing/reservation for worker-offloaded decompose |
| `frontend/src/js/ipfs/remote-ipfs.ts` | Browser-side reader + cache |
| `docker/Dockerfile`, `docker/entrypoint.sh`, `docker-compose.yml` | Kubo image, init/isolation config, orchestration |

## Reference Files

- Read `references/deep-dive.md` for architecture, pinning, write/read paths, cache, manifest chain model.
- Read `references/api-reference.md` for `/ipfs/upload-urls` and `/ipfs/unpin` specs.
- Read `references/docker-config.md` for Kubo container, isolation config, volumes.
- Read `references/troubleshooting.md` for manual pin/GC ops and symptom/cause/fix.
- Read `references/pinata-mode.md` for `IPFS_BACKEND=pinata` — single-use URLs, batch-mint, credential pools, diagnostics, latency.
