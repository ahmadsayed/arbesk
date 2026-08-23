# Asset Core Externalization — Design

Date: 2026-08-23
Status: Approved design (pending implementation plan)

## 1. Goal & Motivation

Externalize Arbesk's client-side manifest handling, glTF compose/decompose
pipeline, domain layer, Merkle editor logic, and IPFS fetch/cache logic into a
single shared module consumable by both the Express backend (Node
type-stripping) and the browser frontend (swc per-file emit).

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
- Boundary enforced by convention + lint/boundary test (§6), not npm
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
  `dedup.ts`, `bounds.ts`
- Manifest schema/chain logic, merged with backend `src/api/manifest-utils.ts`
  (one canonical implementation)
- `gltf/merkle-editors.ts` and `domain/*` (asset-store, asset, collection,
  editors, version-history-store, node, asset-ref)
- Infra they sit on: `events/bus.ts`, `state/create-store.ts` (plain pub/sub,
  no DOM)
- Pure utils: `utils/uri.ts`, `utils/encoding.ts`, `utils/compression.ts`,
  `utils/content-cache.ts` (in-memory parts)
- Orchestration logic of `gltf/async-gltf.ts` (task splitting, progress, error
  propagation, result assembly)

Structural note: `gltf/merkle-editors.ts` already imports `domain/editors.ts`
— the two directories are one module in practice.

### Ports (interface in package, implementation injected by consumer)

- `IpfsReadPort` / `IpfsWritePort` — covers `ipfs/remote-ipfs.ts`,
  `ipfs/write-to-ipfs.ts`, `ipfs/upload-with-credential.ts`. Browser impl:
  today's gateway/session/credential code. Backend impl: kubo/pinata storage
  modules. Largest seam: composer, decomposer, glb-parser, dedup, and the
  material/source-color editors all touch IPFS.
- `HashPort` — replaces `window.Web3.utils.soliditySha3` in
  `domain/editors.ts`; kills a CDN-global dependency.
- `StoragePort` — `localStorage` editor-list cache (backend: in-memory or
  no-op); same shape for the IndexedDB content cache.
- `CredentialPort` — `getUploadCredentials` from `services/api.ts`
  (session-bound, injected).
- `ExecutorPort` — "run this compose/decompose job, possibly off the calling
  thread, with progress callbacks." Browser impl: existing
  `workers/gltf-worker-pool.ts` (stays in frontend, injected). Node impl:
  inline synchronous, or `worker_threads` later. A desktop embedder can
  supply threads/actors — the library never knows.

### Stays out

- `workers/gltf-worker-pool.ts` (Web Workers — browser-only impl of
  `ExecutorPort`)
- `material-editor.ts` / `source-color-editor.ts` move in only after the IPFS
  port exists (thin logic over IPFS reads/writes)
- Everything in `engine/`, `ui/`, `services/`, `blockchain/`, `ipfs/`

### Dependency rule

`asset-core/` imports nothing from `ipfs/`, `services/`, `blockchain/`,
`workers/`, `engine/`, `ui/` — only its own files plus injected ports. No
`window`, `document`, `BABYLON`, `Web3`, `indexedDB`, `localStorage`
references.

## 4. Kernels & Benchmarks

Three primitives behind small interfaces in `asset-core/kernels/`, with
pure-TS defaults:

- `base64` — ArrayBuffer/Uint8Array ↔ base64 (the `ipfs://` ↔ data-URI
  transform). TS default: today's `encoding.ts`; Node default may use
  `Buffer`.
- `hash` — SHA-256/multihash for CID work (`dedup.ts`, cache keys). Default:
  built-in `crypto.subtle` (both runtimes).
- `glb-binary` — GLB container parse/serialize (`glb-parser.ts`). Already
  TypedArray slicing; behind the interface for symmetry.

Everything else (JSON, manifest manipulation, accessor math) stays plain TS.

Selection: consumer calls `initAssetCore({ ports, kernels? })` once; omitted
kernels fall back to defaults. No dynamic imports, no environment sniffing
inside the package.

Benchmark harness at `asset-core/bench/`: Node runner over fixtures from
`mock-gltf-assets/` (smallest to largest GLB + synthetic deeply-nested
manifest chain). Measures compose/decompose time, base64 throughput, hash
throughput, peak memory. Table to stdout + JSON artifact. Wired as
`npm run bench:asset-core`; not in CI initially.

Deliberately **no** WASM scaffold, Rust crate, or wasm-pack toolchain now —
the interface is the entire investment.

## 5. Out-of-the-Box-First Rule

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

## 6. Testing

- Existing Jest suites covering moved files travel with them (mostly
  import-path updates; `moduleNameMapper` already maps `.js`→source).
- **Boundary test**: static check (eslint `no-restricted-imports` or script)
  asserting `asset-core/` never imports from the forbidden dirs and never
  references browser/CDN globals (list in §3).
- **Port contract tests**: one conformance suite per port, run against both
  the browser adapter (jsdom) and the Node adapter.
- Backend suites and E2E stay put; they exercise the package through the real
  app. Save/publish and manifest-schema changes require an E2E run before
  merge (repo §10 rules).

## 7. Migration Order

Each step independently green (lint + typecheck + jest; E2E at the end):

1. **Skeleton + boundary** — `frontend/src/js/asset-core/` with
   `package.json`, `index.ts`, boundary lint rule/test. Nothing moves.
2. **Pure glTF core** — move gltf-core, composer, decomposer, glb-parser,
   dedup, bounds + pure utils. Introduce `IpfsReadPort`/`IpfsWritePort`;
   frontend wires today's IPFS modules as impl; backend re-points imports.
3. **Manifest + validation** — merge `src/api/manifest-utils.ts`, add zod
   manifest schema, backend routes consume from the package. Move
   `material-editor.ts` / `source-color-editor.ts` in at this point (the IPFS
   port they depend on exists since step 2).
4. **Merkle + domain** — move merkle-editors, `domain/*`, events bus, store
   infra; introduce `HashPort` (viem) and `StoragePort`. Single-writer
   discipline and `EVENTS` flow unchanged.
5. **Async logic + kernels + bench** — move async-gltf logic behind
   `ExecutorPort`; carve the three kernels; add benchmark harness.

E2E (`npm run test:e2e -- --project=chromium`) before merging the final step,
covering save/publish, parametric editing/version history, and manifest
schema paths.

## 8. Non-Goals

- No language rewrite, no WASM/Rust/Java scaffold.
- No npm workspace / publishing infrastructure (promotion path deferred).
- No changes to Babylon engine code, UI panels, or contract interaction.
- No behavioral change to manifests, CIDs, or the compose/decompose wire
  format — this is a relocation and boundary-hardening, not a format change.
