# `@arbesk/asset-core` — Asset Engine SDK

Environment-agnostic Arbesk asset engine: manifests, glTF/3MF compose/decompose,
asset domain state, and Merkle editor lists — one TypeScript codebase
(`packages/asset-core/`) consumed by the browser, the Node backend, and tests.
Compiled by `tsc` to `dist/` (ESM + `.d.ts`) with no runtime dependency on
Babylon.js or any 3D engine.

> **Consumer guide:** `docs/ASSET_CORE_SDK.md` — per-environment quickstarts,
> port reference, facade API, worker integration. This file is the **agent /
> contributor** guide: internal structure, the write-discipline rules, and the
> boundary that keeps the package portable.

## Public API (`src/index.ts`)

`createArbeskCore(config) → ArbeskCore` is the one-call composition root; it
installs a **process-wide runtime** (`initRuntime`) and returns the facade:

- `upload(source, opts?)` — GLB bytes or glTF JSON → stored composite (`rootCid`).
- `download(ref, opts?)` / `compose(manifest, opts?)` — composite/manifest → renderable GLB `Blob`.
- `decompose(input, opts?)` — raw artifact → content-addressed composite.
- `getManifest(cid)` / `getVersionHistory(cid, maxDepth?)` / `validateManifest(manifest)`.
- `addEditor` / `removeEditor` / `listEditors` — off-chain Merkle editor list.

Also exported: `compose` / `decompose` / `detectFormat` / `getCodec` /
`listCodecs` (format dispatcher), `initRuntime` / `getRuntime` /
`_resetRuntimeForTesting`, `memoryStorage`, and the port/result types.

**Ports** (`src/types.ts`) are how the package reaches the outside world — it
never imports network/DOM/chain/storage directly: `ipfsRead` + `ipfsWrite`
(required), and optional `credentials`, `chain`, `hash`, `storage`, `executor`,
`kernels`. Reference adapters: `frontend/src/js/ipfs/asset-core-adapter.ts`,
`frontend/src/js/blockchain/asset-core-adapter.ts`,
`frontend/src/js/workers/worker-executor.ts` (browser), and
`src/api/asset-core-adapters.ts` (backend).

## Structure

```
src/
  facade.ts              createArbeskCore composition root
  runtime.ts             process-wide runtime (initRuntime/getRuntime)
  types.ts               port + config types
  index.ts               public exports
  formats/               compose/decompose pipeline (see below)
  manifest/              chain walk (chain.ts), schema (schema.ts), utils
  domain/                shared asset/collection/editor state (single-writer, see below)
  events/bus.ts          singleton mitt bus + EVENTS constants
  state/create-store.ts  generic immutable-ish store helper
  storage/               memory, memory-ipfs, ipfs upload-credential strategies
  executor/inline.ts     inline (same-thread) ExecutorPort op table
  kernels/               default base64/hash/glb kernels (pure TS)
  utils/                 collections, compression, concurrency, cache, encoding, hash, log, uri
  bench/run.ts           pipeline benchmark → test-results/asset-core-bench.json
```

## Domain layer — single-writer discipline

`src/domain/` owns all shared asset/collection state. **Write discipline: asset
identity, name, and manifest-CID fields mutate only via `domain/asset.ts`;
collection fields (`activeCollectionTokenId`, `selectedCollectionId`) only via
`domain/collection.ts`.** Never write these fields from UI/engine/services —
route through the domain commands.

- `asset-store.ts` — the shared store (only `domain/` imports it; everyone else
  reads via getters and subscribes to `EVENTS.ASSET_STATE_CHANGED`, full-state payload).
- `asset.ts` — asset facade: getters (`getActiveAssetManifestCid`,
  `getCurrentManifest`, frozen `getAssetState()` snapshot, …) + commands
  (`adoptOpenedAsset`, `renameAsset`, `saveDraftAsset`, `publishAsset`).
- `collection.ts` — collection state commands, `publishCollection` seam
  (`onAdoptIdentity` callback).
- `editors.ts` — Merkle editor helpers, editor-list cache, proof commands.
- `version-history-store.ts` — headless manifest-chain store feeding the
  scene/model clocks.
- `generation-actions.ts` — pure follow-up-action policy for generation bubbles.

## Formats pipeline

`formats/index.ts` is the single public entry point for compose/decompose: it
resolves the format (explicit hint → `arbesk_format` marker → magic-byte sniff →
fallback `"gltf"`) and dispatches to a `FormatCodec` (`formats/codec.ts`).

- `gltf/` — the primary codec: `composer.ts`/`decomposer.ts` (glTF JSON),
  `glb-codec.ts`/`glb-parser.ts` (binary GLB), `gltf-core.ts` (compose entry),
  `material-editor.ts`/`source-color-editor.ts` (parametric color/scale),
  `merkle-editors.ts`, `dedup.ts`, `bounds.ts`, `cache-aware-fetch.ts`.
- `async-gltf.ts` — dispatches heavy glTF ops through the `ExecutorPort` (Web
  Worker pool in the browser, `executor/inline.ts` on the backend), with
  availability probe + automatic main-thread fallback.
- `3mf/` — OPC ZIP parse/compose + 3MF→glTF render conversion.
- `example/` — dummy reference format; **copy it when adding OBJ/STL/FBX/USDZ**
  (see `format.ts` header).

**glTF buffer URIs** — `ipfs://bafy…` in storage ↔ base64 data URI at render:
only the `gltf/` composer/decomposer performs this transform. Don't bypass it
from callers.

## Events & state

- `events/bus.ts` — singleton `mitt` bus. Import `EVENTS` constants and
  `on`/`off`/`emit` from here instead of `document.dispatchEvent`; handlers
  receive the payload directly (not a `CustomEvent`). `EVENTS` lists the full
  event-name table (`asset:*`, `scene:*`, `node:*`, `collection:*`, `wallet:*`, …).
- `state/create-store.ts` — the store helper `asset-store.ts` builds on.

## Boundary rules (what keeps it portable)

- **No imports** from the frontend/backend trees (`frontend/`, `src/api/`,
  `constants/`) or from browser/backend capability modules
  (`ipfs/*`, `services/`, `blockchain/`, `workers/`, `engine/`, `ui/`) — eslint
  `no-restricted-imports` enforces this.
- **No browser globals** (`window`/`document`/`Web3`/`navigator`/`localStorage`)
  and **no `@babylonjs/*`** — eslint `no-restricted-globals` +
  `no-restricted-imports`. `indexedDB` is allowed only behind the runtime guard
  in `utils/content-cache.ts` (`globalThis` lookup with in-memory fallback).
- **Erasable TypeScript only** (Node type-stripping): no enums/namespaces,
  `import type` for type-only imports, relative imports carry `.ts`.
- **New capability the package needs from the outside?** Add a port to
  `types.ts`, never an import.

## Build, test, benchmark

```bash
npm run build:packages    # tsc → dist/ (ESM + .d.ts)
npm run typecheck         # after build (resolves @arbesk/* via workspace)
npm test                  # jest maps @arbesk/asset-core/*.js → .ts source (no build step)
npm run bench:asset-core  # pipeline benchmark → test-results/asset-core-bench.json
```

Verify with `npm run lint && npm run typecheck && npm run typecheck:frontend &&
npm test`. If a change touches save/publish, manifest schema, or editor flows,
also run E2E (`npm run test:e2e -- --project=chromium`).
