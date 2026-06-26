---
name: arbesk-ipfs-storage
description: IPFS storage expertise for the Arbesk project. Covers the private Kubo Docker node, pin/unpin semantics, add/pin/rm API flows, manifest chain storage model, garbage collection, browser-side writes, read cache, and the unpin-on-burn lifecycle. Use whenever IPFS is involved — "content not found after add", "IPFS is down", "CID won't resolve", "pinning fails", "CORS error from IPFS", "storage full", "run garbage collection", "unpin after burn", "Docker IPFS config", or any IPFS read/write/pin/unpin operation across backend or frontend. If any IPFS-related error appears in logs, invoke this skill.
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
10. **Test IPFS changes with backend running** — `./scripts/start-dev.sh` (or `npm start` + `docker-compose up -d ipfs`).

## File Map

| File | Role | Details |
|------|------|---------|
| `src/api/routes/ipfs.js` | Backend routes: `POST /ipfs/upload-url`, `POST /ipfs/unpin` (both session-gated) | [→ Deep Dive](./references/deep-dive.md) |
| `src/api/ipfs-utils.js` | `catManifest()` — IPFS read with timeout | [→ Deep Dive](./references/deep-dive.md) |
| `src/api/assets/generate-node.js` | Generation pipeline: add asset, build manifest, pin | [→ Deep Dive](./references/deep-dive.md) |
| `frontend/src/js/ipfs/write-to-ipfs.js` | Browser-side IPFS writer | [→ Deep Dive](./references/deep-dive.md) |
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
