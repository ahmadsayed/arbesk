---
name: arbesk-ipfs-storage
description: Use for any IPFS read/write/pin/unpin issue, backend or frontend — "content not found after add", "CID won't resolve", "pinning fails", CORS errors, garbage collection, unpin-on-burn, Kubo Docker config, or Pinata signed upload URLs (single-use semantics, 403/404/409, "duplicate file id"). If any IPFS error appears in logs, invoke this skill.
---

# Arbesk IPFS & Storage

Two backends behind `src/api/storage/index.ts`: a private Kubo node (local, E2E) and Pinata (testnet, production). The browser uploads asset content itself with a credential minted by `POST /api/v1/ipfs/upload-url(s)` (`src/api/routes/ipfs.ts`); asset bytes do not pass through the backend.

## Rules (both backends)

1. Backend manifest reads go through `catManifest()` (`src/api/ipfs-utils.ts`): timeout plus decoding.
2. Pin failures are non-fatal: log with `[IPFS]` and continue. Kubo's `add` already pins; the browser writer pins again on purpose (`packages/asset-core/src/storage/ipfs/upload-with-credential.ts`).
3. Unpin **before** burning. After the burn `tokenURI` reverts and `/ipfs/unpin` can no longer verify ownership. The call is best-effort and must never block the burn.
4. Never unpin `child_ref` content: it belongs to another token.
5. Deleting an asset from a collection unpins nothing, because forks share its version chain. Only the GC (`src/api/ipfs-gc.ts`) prunes. Reachable = each live token's current collection version, its assets and their full histories. Assets listed only by older collection versions are not followed.
6. No prefetching in the browser cache (`frontend/src/js/ipfs/remote-ipfs.ts`); it is on-demand by design.
7. "not pinned or pinned indirectly" on unpin counts as success.

## Kubo

Private by configuration in `docker/entrypoint.sh`: no DHT, no bootstrap peers, loopback ports, `StorageMax` 100 GB, daemon started with `--enable-gc`. Keep it private.

```bash
docker compose logs -f ipfs
docker compose exec ipfs ipfs cat <CID>     # does the content exist?
docker compose exec ipfs ipfs pin ls        # also: repo stat, repo gc
```

## Pinata (`IPFS_BACKEND=pinata`, `src/api/storage/pinata-adapter.ts`)

Facts below were verified against the live account on 2026-07-14; Pinata's docs do not state them.

- **Reads use the authenticated gateway.** A 404 "owner of this gateway does not have this content pinned" means the CID was never uploaded to this account (for example it came from a Kubo run). It is not a bug.
- **A signed upload URL accepts exactly one upload.** A second one returns 409 "duplicate file id". There is no `max_uses`. N files need N URLs.
- **Mint in one batch**: `POST /api/v1/ipfs/upload-urls {count}` (1–200), wrapped by `getPooledUploadCredential(count)` in asset-core `async-gltf.ts`. Estimate `count` as an upper bound: unused URLs just expire, too few starve the upload midway.
- **A retry must draw a fresh URL.** The failed request may have reached Pinata, so the same URL gives a false 409.
- **A worker gets a copy of the credential pool** (structured clone), so the main thread still holds URLs the worker spent. Any flow that uploads in a worker and then writes from the main thread must call `reserveFollowUpCredential()` before the worker call.
- **Two pools, do not conflate them.** The browser pool exists because URLs are single-use. The backend pool pre-mints URLs to hide signing latency: `PINATA_POOL_SIZE` (20, 0 disables), `PINATA_POOL_EXPIRY_MARGIN` (60 s), `PINATA_UPLOAD_TTL` (300 s). TTL must exceed the margin or every entry is stale at birth; the adapter logs `pool misconfigured`.
- **Keep `MAX_REFILL_ROUNDS`.** A "loop until caught up" refill without a cap spins on microtasks under that misconfiguration and hangs the whole process with no output.
- **Latency**: one mint is 0.4–0.6 s warm, 1–2 s on a cold connection. About 9–10 s is the SDK's own retry backoff (1 + 2 + 4 s) after a transient failure, not a code regression. Grep the backend log for `pinata sign` to see each attempt.
- **When behaviour is unclear, test the real account** with a throwaway script (import the SDK from `node_modules/pinata/dist/index.mjs`). Delete the test files afterwards with `pinata.files.public.delete([...ids])`; the raw bulk DELETE endpoint returned 404.
