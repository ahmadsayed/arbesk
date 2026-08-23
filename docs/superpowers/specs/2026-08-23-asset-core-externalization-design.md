# Asset Core Externalization — Design

Date: 2026-08-23 (amended same day: SDK facade added as primary API)
Status: Approved design (pending implementation plan)

## 1. Goal & Motivation

Externalize Arbesk's client-side manifest handling, glTF compose/decompose
pipeline, domain layer, Merkle editor logic, and IPFS fetch/cache logic into a
single shared module consumable by both the Express backend (Node
type-stripping) and the browser frontend (swc per-file emit) — **exposed as a
simple SDK facade** (`arbesk.upload(file, opts)`, `arbesk.download(ref)`,
`arbesk.addEditor(asset, identity)`), not as a bag of internal modules.

Driver: **performance headroom at anticipated scale** — not a measured
hotspot. Consequence: no language rewrite (Rust/WASM/Java were evaluated and
rejected); instead the module is TypeScript with swappable performance kernels
behind interfaces, plus a benchmark harness so any future native/WASM swap is
a measured, localized decision.

Rejected alternatives:

- **Rust → WASM now**: workload is JSON/string/buffer-bound, not numeric;
  JS↔WASM boundary costs eat gains; toolchain and debugging complexity; scale
  not yet measured.
- **Java**: no practical browser runtime; would force maintaining two
  implementations (server Java + browser TS) plus an interop round trip that
  likely exceeds the compute saved.

## 2. Package Shape & Consumption (Decision: 1A)

In-tree package at `frontend/src/js/asset-core/`:

- Own `package.json` (`@arbesk/asset-core`), public `index.ts` as the only
  sanctioned import surface, own tests, own benchmark harness.
- Backend imports by relative path (the pattern already used by
  `generate-node.ts` → `gltf-core.ts`), formalized.
- Browser consumption unchanged: sources stay inside the swc root
  (`frontend/src/js`), so `render-ts.js` emits them with the existing
  relative `.ts`→`.js` rewrite. No bundler, no importmap, no build step added.
- Boundary enforced by convention + lint/boundary test (§7), not npm
  mechanics.
- Promotion path to a true npm workspace (`packages/asset-core`, built JS,
  bare-specifier consumption) is documented but deferred until a real
  external consumer exists; the boundary is designed so promotion is
  mechanical (move directory, add exports map).

Constraint honored: imports must resolve identically in three places — Node
type-stripping (backend), swc emit (browser), jest (`moduleNameMapper`).

## 3. Module Map

### Moves in as pure core (verified free of DOM/BABYLON/Web3/CDN deps)

- `gltf/gltf-core.ts`, `composer.ts`, `decomposer.ts`, `glb-parser.ts`,
  `dedup.ts`, `bounds.ts`, `cache-aware-fetch.ts` (fetchers already injected)
- Manifest schema/chain logic, merged with backend `src/api/manifest-utils.ts`
  (one canonical implementation), plus the manifest-chain walk currently in
  `remote-ipfs.ts#getManifestChain` (it is manifest logic; it consumes the
  read port)
- `gltf/merkle-editors.ts` and `domain/*` (asset-store, asset, collection,
  editors, version-history-store, node, asset-ref, generation-actions)
- Infra they sit on: `events/bus.ts` (+ vendored `mitt.mjs`),
  `state/create-store.ts` (plain pub/sub, no DOM)
- Pure utils: `utils/uri.ts`, `utils/encoding.ts`, `utils/hash.ts`,
  `utils/compression.ts`, `utils/concurrency.ts`, `utils/content-cache.ts`
  (in-memory parts; IndexedDB guarded)
- Orchestration logic of `gltf/async-gltf.ts` (op dispatch,
  worker-first/main-thread-fallback, credential pooling/estimation)

Structural note: `gltf/merkle-editors.ts` already imports `domain/editors.ts`
— the two directories are one module in practice.

### Ports (interface in package, implementation injected by consumer)

- `IpfsReadPort` — JSON fetch (auto-gunzip), gunzip-aware byte fetch with
  progress, raw byte fetch. Browser impl: today's `ipfs/remote-ipfs.ts`
  (stays in `frontend/src/js/ipfs/`, wrapped as an adapter). Backend impl:
  kubo/pinata storage modules.
- `IpfsWritePort` — `write` / `writeJSON` with the existing
  `UploadCredential` flow. Browser impl wraps `ipfs/write-to-ipfs.ts`;
  backend impl: kubo add / Pinata. `UploadCredential` and
  `upload-with-credential.ts` move INTO the package (already worker-safe,
  only depends on `utils/concurrency.ts`).
- `CredentialPort` — `getUploadCredentials(count?)` from `services/api.ts`
  (session-bound, injected; backend supplies its own).
- `ChainPort` — on-chain editor-list version lookup currently done via
  `getActiveContract` in `domain/editors.ts`, plus optional email→address
  resolution (backend `/users/resolve-email`); browser impl wraps
  `blockchain/wallet.ts` + `services/api.ts`, backend impl uses its Web3
  instance.
- `HashPort` — replaces `window.Web3.utils.soliditySha3` in
  `domain/editors.ts`; kills a CDN-global dependency.
- `StoragePort` — `localStorage` editor-list cache (backend: in-memory or
  no-op); same shape for the IndexedDB content cache.
- `ExecutorPort` — named-op execution: `available()` + `exec(op, args)` where
  op ∈ {`compose`, `decomposeGltf`, `decomposeGlb`, `bakeSourceColors`} (the
  op set the worker already exposes). Browser impl: existing
  `workers/gltf-worker-pool.ts` (stays in frontend, injected). Package
  default: inline executor dispatching to the same functions on the calling
  thread. A desktop embedder can supply threads/actors.

### Stays out

- `workers/gltf-worker-pool.ts` (Web Workers — browser impl of
  `ExecutorPort`); its worker entry's relative imports are updated to the new
  paths and its cache-busting `?v=` bumped
- `frontend/src/js/ipfs/remote-ipfs.ts`, `write-to-ipfs.ts` — stay as the
  browser adapters behind the IPFS ports (29 existing consumers across
  blockchain/, engine/, services/, ui/, 3mf/, formats/ are untouched)
- Everything in `engine/`, `ui/`, `services/`, `blockchain/`

### Dependency rule

`asset-core/` imports nothing from `ipfs/`, `services/`, `blockchain/`,
`workers/`, `engine/`, `ui/` — only its own files plus injected ports. No
`window`, `document`, `BABYLON`, `Web3`, `navigator`, `indexedDB` (guarded
fallback allowed), `localStorage` references.

### External dependencies

`@gltf-transform/core` (used by `glb-parser.ts`, currently frontend-only) is
added to the root `package.json` so the backend can import the moved module.
Browser keeps resolving it via the existing Pug import map to the vendored
file. `fflate` moves from root devDependency to dependency.

## 4. SDK Facade — the Public API

The package's primary surface is a small facade created once per environment.
Design goal: the obvious three-line usage works — the internal modules remain
exported for advanced callers, but new code should need only the facade.

```ts
import { createArbeskCore } from "./asset-core/index.ts";

const arbesk = createArbeskCore({
  ipfsRead, ipfsWrite,          // required
  credentials,                  // required for upload/editor ops
  chain,                        // optional — editor ops needing chain/email
  storage,                      // optional — defaults to in-memory
  executor,                     // optional — defaults to inline
  kernels,                      // optional — defaults to TS implementations
});

// Whole-model round trip (the headline API):
const { rootCid, compositeCid } = await arbesk.upload(file, { onProgress });
const blob = await arbesk.download(cidOrManifest, { onProgress });

// Editors (identity = 0x address or email; email resolves via ChainPort):
await arbesk.addEditor(assetRef, "friend@example.com");
await arbesk.removeEditor(assetRef, "0xabc…");
const editors = await arbesk.listEditors(assetRef);

// Manifests & history:
const manifest = await arbesk.getManifest(cid);
const history = await arbesk.getVersionHistory(cid);
arbesk.validateManifest(manifest); // zod-backed

// Pipeline primitives (same engine, explicit control):
await arbesk.compose(manifest);            // → Blob
await arbesk.decompose(gltfJson, opts);    // → { rootCid, … }
await arbesk.decomposeGLB(bytes, opts);
```

- `upload` = format sniff (GLB vs glTF JSON) → decompose → composite manifest
  write; returns the CIDs. `download` = manifest resolve → compose → Blob.
- Facade methods are thin compositions over the internal modules + injected
  ports — no duplicated logic.
- `createArbeskCore` also performs `initAssetCore(config)` (the module-level
  runtime the ported internals read their ports from), so there is exactly
  one configuration entry point.
- Email identity is only resolvable when `chain` provides `resolveEmail`;
  otherwise a clear error tells the caller to pass a 0x address.

## 5. Kernels & Benchmarks

Three primitives behind small interfaces in `asset-core/kernels/`, with
pure-TS defaults:

- `base64` — ArrayBuffer/Uint8Array ↔ base64 (the `ipfs://` ↔ data-URI
  transform). TS default: today's `encoding.ts`; Node default may use
  `Buffer`.
- `hash` — content hashing for `dedup.ts`/cache keys. Default: existing
  `utils/hash.ts` (murmur3, pure) plus built-in `crypto.subtle` for SHA-256.
- `glb-binary` — GLB container parse/serialize (`gltf-core.ts`). Already
  TypedArray slicing; behind the interface for symmetry.

Everything else (JSON, manifest manipulation, accessor math) stays plain TS.

Selection: passed to `createArbeskCore({ kernels })`; omitted kernels fall
back to defaults. No dynamic imports, no environment sniffing inside the
package.

Benchmark harness at `asset-core/bench/`: Node runner over fixtures from
`mock-gltf-assets/` (smallest to largest GLB + synthetic deeply-nested
manifest chain), using in-memory IPFS test adapters (doubles as proof the
package runs server-side with no browser). Measures compose/decompose time,
base64 throughput, hash throughput, peak memory. Table to stdout + JSON
artifact. Wired as `npm run bench:asset-core`; not in CI initially.

Deliberately **no** WASM scaffold, Rust crate, or wasm-pack toolchain now —
the interface is the entire investment.

## 6. Out-of-the-Box-First Rule

Before writing any utility inside the package, check the existing dependency
tree (house policy, AGENTS.md §5):

- Hashing: `viem` (already a dep, wraps `@noble/hashes`, isomorphic) for
  keccak256/soliditySha3 replacement; built-in `crypto.subtle` for SHA-256.
- Merkle trees: `@openzeppelin/merkle-tree` (already in use).
- Compression: `fflate` (already in use via `utils/compression.ts`).
- Manifest schema validation: `zod` (house standard) — one schema definition
  inside the package, used by backend routes and frontend alike.
- Base64: Node `Buffer`; browser keeps `encoding.ts` unless benchmarks object.
- Event bus/store: `events/bus.ts` + `state/create-store.ts` move in
  unchanged; no event library.

Kernel interfaces sit in front of these libraries so a future WASM swap
doesn't change call sites.

## 7. Testing

- Existing Jest suites covering moved files travel with them (mostly
  import-path updates; `moduleNameMapper` already maps `.js`→source).
- **Boundary test**: eslint `no-restricted-imports` +
  `no-restricted-globals` block scoped to `frontend/src/js/asset-core/**`
  asserting the §3 dependency rule.
- **Port contract tests**: one conformance suite per port, run against both
  the browser adapter (jsdom) and an in-memory Node adapter.
- Backend suites and E2E stay put; they exercise the package through the real
  app. Save/publish and manifest-schema changes require an E2E run before
  merge (repo §10 rules).

## 8. Migration Order

Each step independently green (lint + typecheck + jest; E2E at the end):

1. **Skeleton + boundary** — `frontend/src/js/asset-core/` with
   `package.json`, `index.ts`, runtime/init module, port type definitions,
   boundary eslint block. Nothing moves.
2. **Pure utils + glTF core** — move utils (uri, encoding, hash, compression,
   concurrency, content-cache), `upload-with-credential.ts`, gltf-core,
   bounds, cache-aware-fetch. Rewire importers.
3. **Pipeline behind ports** — define `IpfsReadPort`/`IpfsWritePort`; move
   composer, decomposer, glb-parser, dedup; frontend wires today's
   `remote-ipfs`/`write-to-ipfs` as adapters; move the manifest-chain walk in;
   move `material-editor.ts` / `source-color-editor.ts`; backend
   (`generate-node.ts`) re-points its import. Add `@gltf-transform/core` to
   root deps, promote `fflate` to a root dependency.
4. **Manifest + validation** — merge `src/api/manifest-utils.ts`, add zod
   manifest schema, backend routes consume from the package.
5. **Merkle + domain** — move merkle-editors, `domain/*`, events bus, store
   infra; introduce `HashPort` (viem), `StoragePort`, `ChainPort`;
   single-writer discipline and `EVENTS` flow unchanged.
6. **Async logic + executor** — move async-gltf orchestration behind
   `ExecutorPort` (inline default; worker pool injected by frontend); update
   worker entry imports + bump `?v=`; carve the three kernels.
7. **Facade + bench + docs** — implement `createArbeskCore` facade (§4);
   switch `generate-node.ts` and one frontend call site to it as proof; add
   benchmark harness; update AGENTS.md §3 layout.

E2E (`npm run test:e2e -- --project=chromium`) before merging the final step,
covering save/publish, parametric editing/version history, and manifest
schema paths.

## 9. Non-Goals

- No language rewrite, no WASM/Rust/Java scaffold.
- No npm workspace / publishing infrastructure (promotion path deferred).
- No changes to Babylon engine code, UI panels, or contract interaction.
- No behavioral change to manifests, CIDs, or the compose/decompose wire
  format — this is a relocation, boundary-hardening, and facade addition,
  not a format change.
- The 29 existing direct consumers of `ipfs/` modules are NOT migrated to the
  facade in this pass (only `generate-node.ts` + one frontend proof site).
