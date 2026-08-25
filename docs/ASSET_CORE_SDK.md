# Arbesk Asset Core — SDK Consumer Guide

`@arbesk/asset-core` (`packages/asset-core/`) is Arbesk's
environment-agnostic asset engine: manifest handling, glTF compose/decompose,
asset domain state, and Merkle editor lists — one TypeScript codebase that
runs unchanged in the browser, in the Node backend, and in tests.

Use it when you need to **store, retrieve, inspect, or manage Arbesk assets
programmatically** — a backend route, a CLI/script, a batch job, a test, or a
new host environment (desktop shell, another web app) — without talking to the
Express API or reimplementing the manifest/glTF formats.

If you only need to call Arbesk over HTTP, you want `docs/API_SPEC.md`
instead. This guide is for embedding the engine itself.

## 1. How consumption works (npm workspace package)

`@arbesk/asset-core` lives at `packages/asset-core/` as an npm **workspace**
package (root `"workspaces": ["packages/*"]`) and is compiled by `tsc` to
`dist/` (ESM + `.d.ts`). Consumers import it by bare specifier, with
`.js`-suffixed subpaths for advanced callers:

```ts
import { createArbeskCore } from "@arbesk/asset-core";
import { composeGltfJson } from "@arbesk/asset-core/formats/gltf/gltf-core.js";
```

- **Build** — `npm run build:packages` (also wired as `prestart`/`pretypecheck`/
  `prebuild:frontend`, so it runs automatically where needed).
- **Node (backend, scripts)** — resolves `@arbesk/asset-core` through the
  workspace symlink to `dist/`.
- **Browser (this repo's frontend)** — the frontend build vendors `dist/` into
  `dist/js/vendor/asset-core/` and an import map entry (`head.pug`) resolves
  the bare specifier. The glTF Web Worker, which has no import map, imports the
  vendored copy by relative path. Frontend code should not build its own core —
  call the existing composition root:
  ```ts
  import { initAssetCoreBrowser } from "./asset-core-init.ts";
  const core = initAssetCoreBrowser(); // singleton, already wired at boot
  ```
- **Tests** — jest maps `@arbesk/asset-core/*.js` to the package's `.ts` source
  (`jest.config.js` moduleNameMapper), so tests exercise source with no build
  step.

The package's only runtime npm dependencies are `zod`, `fflate`,
`@gltf-transform/core`, and `@openzeppelin/merkle-tree` (no Babylon.js, no DOM,
no chain code).

One runtime rule that matters: `createArbeskCore(config)` installs a
**process-wide runtime** — call it once per environment, keep the returned
object, and pass it around. Calling it again replaces the runtime (tests use
this with `_resetRuntimeForTesting()`).

## 2. Quickstart

### 2.1 Node script / service (minimal — IPFS only)

The smallest useful core needs just the two IPFS ports. This repo ships a
ready-made backend wiring (`src/api/asset-core-adapters.ts#createBackendCore`)
and an in-memory double for tests
(`packages/asset-core/src/storage/memory-ipfs.ts#createMemoryIpfs`).

```ts
import { createArbeskCore } from "@arbesk/asset-core";
import { createBackendCore } from "../src/api/asset-core-adapters.ts"; // in-repo backend
import { createStorageAdapter } from "../src/api/storage/index.ts";

const core = createBackendCore(createStorageAdapter()); // IPFS via kubo/pinata, selected by IPFS_BACKEND

// Store a model (GLB bytes or glTF JSON — format is sniffed automatically):
const { rootCid } = await core.upload(glbBytes, { assetName: "chair" });

// Get it back as a renderable GLB Blob:
const blob = await core.download(rootCid);

// Inspect:
const manifest = await core.getManifest(rootCid);
const history = await core.getVersionHistory(rootCid); // prev_manifest_cid chain
const check = core.validateManifest(manifest);         // { valid, data | errors }
```

### 2.2 Tests (no IPFS, no chain, no browser)

```ts
import { createArbeskCore } from "@arbesk/asset-core";
import { createMemoryIpfs } from "@arbesk/asset-core/storage/memory-ipfs.js";
import { _resetRuntimeForTesting } from "@arbesk/asset-core/runtime.js";

afterEach(() => _resetRuntimeForTesting());

test("round-trip", async () => {
  const { read, write } = createMemoryIpfs();
  const core = createArbeskCore({ ipfsRead: read, ipfsWrite: write });
  const { rootCid } = await core.upload(glbBytes);
  expect((await core.download(rootCid)).size).toBeGreaterThan(0);
});
```

### 2.3 A new environment (the real extension point)

You implement **ports** — plain objects matching the interfaces in
`packages/asset-core/src/types.ts` — and pass them to `createArbeskCore`. Nothing inside
the package touches network, DOM, chain, or storage directly; it only calls
your ports.

```ts
const core = createArbeskCore({
  ipfsRead,              // REQUIRED — IpfsReadPort
  ipfsWrite,             // REQUIRED — IpfsWritePort
  credentials,           // optional — CredentialPort (pooled upload credentials)
  chain,                 // optional — ChainPort (editor chain reads, email→wallet)
  hash,                  // optional — HashPort (soliditySha3/keccak256)
  storage,               // optional — StoragePort (defaults: in-memory)
  executor,              // optional — ExecutorPort (defaults: inline same-thread)
  kernels,               // optional — Partial<Kernels> (defaults: pure TS)
});
```

## 3. Port reference

| Port | Required | Default if omitted | Used by | Without it |
|------|----------|--------------------|---------|------------|
| `ipfsRead` | yes | — | `download`, `compose`, `getManifest`, `getVersionHistory`, editor-list load | those methods throw (not-initialized or fetch errors) |
| `ipfsWrite` | yes | — | `upload`, `decompose*`, editor-list save | uploads fail |
| `credentials` | no | none | pooled upload-credential flow in the async pipeline | only needed by the worker/upload-pooling path; direct facade uploads pass `credential: null` and let your `ipfsWrite` decide |
| `chain` | no | none | `getEditorListURI`, `getEditorListVersion`, `resolveEmail` | editor lists fall back to storage cache; email identities rejected with a clear error |
| `hash` | no | none | Merkle leaf hashing in editor commands | `addEditor`/`removeEditor` throw `editor ops require a HashPort` |
| `storage` | no | in-memory Map | editor-list cache | editor lists simply aren't persisted across runs |
| `executor` | no | inline (same thread) | `download`/`compose` and async decompose ops | fine for scripts/backend; browsers should inject the worker executor to keep the UI responsive |
| `kernels` | no | pure-TS implementations | base64, hashing, GLB sniffing on hot paths | nothing — swap only with benchmark evidence (`npm run bench:asset-core`) |

Interface signatures are the source of truth: `packages/asset-core/src/types.ts`.
Reference implementations to copy from:

- **Browser**: `frontend/src/js/ipfs/asset-core-adapter.ts` (IPFS),
  `frontend/src/js/blockchain/asset-core-adapter.ts` (hash/storage/chain),
  `frontend/src/js/workers/worker-executor.ts` (executor)
- **Backend**: `src/api/asset-core-adapters.ts` (IPFS over kubo/pinata)
- **Test/in-memory**: `packages/asset-core/src/storage/memory-ipfs.ts`

### 3.1 Upload credentials are strategy tokens

When the async pipeline uploads (decompose-and-upload), the `credentials`
port returns `UploadCredential[]`, where each credential is a
**self-describing strategy token** — it tells the writer *how* to upload (a
topology), not *who* the provider is:

```ts
interface UploadCredential {
  strategy: "presigned-put" | "kubo-api"; // extensible: "server-proxy" | "helia"
  url?: string;      // presigned-put: single-use URL
  urls?: string[];   // presigned-put: pooled URLs (one per file)
  key?: string;      // presigned-put: object key = CID for backends that don't echo it (Storj)
  apiUrl?: string;   // kubo-api: Kubo RPC base
  gateway?: string;  // gateway base returned alongside
  reusable?: boolean;// kubo-api: true (one token per batch); presigned-put: false (single-use)
}
```

- The SDK dispatches on `strategy` (topology), **never on a provider name** —
  `upload-with-credential.ts` maps `presigned-put` → a presigned-URL upload and
  `kubo-api` → Kubo's `/api/v0/add`.
- `reusable` drives pooling in `async-gltf.ts`: reusable tokens cover a whole
  batch with one credential; single-use tokens are pooled (one URL per file)
  and reserved before the worker call (§6).
- Backend adapters mint these (`kubo-adapter.ts` → `kubo-api`,
  `pinata-adapter.ts` → `presigned-put`). Adding a topology (a desktop app
  writing to its own local node, or an in-browser Helia node) is a new
  `strategy` value + an `IpfsWritePort` implementation — zero SDK-core changes.

## 4. Facade API

All methods are on the object returned by `createArbeskCore`.

| Method | Signature | Notes |
|--------|-----------|-------|
| `upload` | `(source: Blob \| ArrayBuffer \| Uint8Array \| string, opts?) → Promise<{ rootCid, compositeCid? }>` | GLB bytes or glTF JSON (object string); format sniffed by GLB magic. Decomposes into content-addressed components and stores the composite. |
| `download` | `(ref: string \| manifest, opts?) → Promise<Blob>` | CID or an already-fetched manifest → composed GLB `Blob`. Uses the executor (worker pool in the browser). |
| `compose` | `(manifest, opts?) → Promise<Blob>` | Explicit compose of a manifest you already hold. |
| `decompose` | `(gltfJson, opts?) → Promise<UploadResult>` | Explicit decompose of glTF JSON. |
| `decomposeGLB` | `(bytes, opts?) → Promise<UploadResult>` | Explicit decompose of GLB bytes. |
| `getManifest` | `(cid) → Promise<manifest>` | Auto-gunzip JSON read via `ipfsRead`. |
| `getVersionHistory` | `(cid, maxDepth = 50) → Promise<ManifestChainEntry[]>` | Walks the `prev_manifest_cid` chain: `{ cid, version, name, nodeCount }[]`. |
| `validateManifest` | `(manifest) → { valid: true, data } \| { valid: false, errors }` | zod-backed; the same schema the backend routes enforce. Unknown keys are stripped in `data`. |
| `addEditor` | `(asset: { tokenId } \| { tag }, identity) → Promise<void>` | `identity` = `0x…` address (passthrough) or email (requires `chain.resolveEmail`). |
| `removeEditor` | same | Refuses to remove the last editor. |
| `listEditors` | `(asset) → Promise<EditorEntry[]>` | Reads chain URI via `chain` port, falls back to `storage` cache. |

`UploadOptions`: `{ credential?, compress? = true, assetName?, assetId?, dedupMap?, onProgress? }`
(`onProgress` is accepted for interface stability; the pipeline does not
report progress yet.)

### What editor calls do — and don't do

`addEditor`/`removeEditor` update the **off-chain** Merkle editor list (IPFS
write + storage cache) and enforce the invariants (address normalization,
duplicate guard, last-editor guard, 5000-editor cap). They do **not** submit
the on-chain `updateEditors` transaction — contract writes stay with the
caller (in this repo: `services/team.ts`, which owns wallet UX). If you need
the root/version for a transaction, use the domain commands directly
(`packages/asset-core/src/domain/editors.ts` — `addEditorCommand` returns
`{ cid, root, version }`).

### Error behavior to expect

- Runtime not initialized (no `createArbeskCore` call yet): methods throw
  `asset-core: not initialized — call createArbeskCore()…`.
- Email identity without a chain port:
  `email identity requires a ChainPort with resolveEmail — or pass a 0x address`.
- Editor ops without a hash port: `editor ops require a HashPort`.
- Unknown CID on read: rejects (memory adapter:
  `memory-ipfs: unknown CID <cid>`; real adapters surface the storage error).

## 5. Kernels (performance swap points — measure first)

`kernels` exist so a future native/WASM implementation can replace a hot
primitive without touching call sites. Defaults are pure TS and are what
production runs today. **Do not build a custom kernel on a hunch** — run the
benchmark and swap only what it indicts:

```bash
npm run bench:asset-core   # timing table + test-results/asset-core-bench.json
```

Note: kernels apply to main-thread execution; the Web Worker path does its
own fetching/encoding internally and does not see custom kernels.

## 6. Web Worker integration (browser)

Heavy pipeline ops (compose, decompose) should not run on the UI thread in a
browser. The package's answer is the `ExecutorPort` — the package never
touches `Worker` itself; the host injects the execution backend:

```ts
const core = createArbeskCore({
  ipfsRead, ipfsWrite, /* … */
  executor: createWorkerExecutor(), // browser: Web Worker pool
  // omitting executor → inlineExecutor: same ops, calling thread (fine for Node/scripts)
});
```

How the production browser wiring works (copy this pattern):

1. **The port** (`frontend/src/js/workers/worker-executor.ts`) is a thin
   pass-through to a `workerpool` pool (`workers/gltf-worker-pool.ts`: module
   workers, `maxWorkers = min(4, hardwareConcurrency)`, cache-busted script
   URL — bump the `?v=` whenever the worker's imports change). Its one
   environment job: inject `gatewayBase` into `compose*` payloads, because
   the worker fetches `ipfs://` references over HTTP itself and asset-core
   deliberately does not know what a gateway is.
2. **The worker entry** (`workers/gltf-worker.ts`) imports the *same*
   asset-core pipeline modules (composer, decomposer, glb-parser,
   source-color-editor) and registers them with `workerpool.worker({ … })`.
   The worker has **no runtime and no ports** — the pure pipeline functions
   take fetchers/credentials as arguments, so they are worker-safe by
   construction.
3. **The op set** is fixed by the worker's registered methods:
   `compose`, `composeToBytes`, `decomposeGltf`, `decomposeGlb`,
   `decomposeAndUploadGltf`, `decomposeAndUploadGlb`, `bakeSourceColors`
   (`ExecutorOp` in `types.ts`). `async-gltf.ts` dispatches these op names
   with a single payload object per call — an ExecutorPort is either this
   pass-through or the inline op table (`packages/asset-core/src/executor/inline.ts`)
   mapping the same names to the same functions on the calling thread.
4. **Availability probe + automatic fallback**: `available()` execs the
   built-in `methods` op and checks the required methods registered (this
   detects a worker script that failed to evaluate — a classic
   non-module-worker trap, documented in `gltf-worker-pool.ts`). If the pool
   is unavailable or an exec fails, `async-gltf.ts` logs and re-runs the op
   on the main thread. Callers never handle this.

Rules of the road for worker integration:

- **Payloads must be structured-cloneable** — one plain object per op, no
  functions, no class instances.
- **Single-use upload credentials**: the workerpool structured-clones the
  credential into the worker, so a pooled `presigned-put` URL would be
  double-spent (HTTP 409). The credential-pooling logic in `async-gltf.ts`
  (`estimateUploadCount`, `reserveFollowUpCredential`,
  `MAX_POOLED_CREDENTIALS = 200`) exists for exactly this — if you build your
  own executor, preserve that behavior for upload-bearing ops.
- **Kernels don't cross the boundary** (see §5): a custom kernel only affects
  main-thread/inline execution. If a benchmark ever justifies a WASM kernel,
  the worker entry must load it too.

To integrate in another browser app: serve the transpiled asset-core modules,
create a module-worker entry that registers the pipeline functions, wrap the
pool in an `ExecutorPort`, pass it to `createArbeskCore({ executor })`. A
non-browser host (desktop shell) does the same with threads/actors — the
package cannot tell the difference.

## 7. Rules for contributors (the boundary that keeps this portable)

`packages/asset-core/` must stay environment-agnostic:

- No imports from the frontend/backend trees (`frontend/`, `src/api/`,
  `constants/`) or from the browser/backend capability modules
  (`ipfs/remote-ipfs*`, `ipfs/write-to-ipfs*`, `ipfs/asset-core-adapter*`,
  `services/`, `blockchain/`, `workers/`, `engine/`, `ui/`) — eslint enforces
  this (`no-restricted-imports`, name-anchored patterns).
- No `window`/`document`/`Web3`/`navigator`/`localStorage` references and no
  `@babylonjs/*` imports — eslint `no-restricted-globals` +
  `no-restricted-imports`. `indexedDB` is allowed **only**
  behind the existing runtime guard in `utils/content-cache.ts`
  (`globalThis` lookup with in-memory fallback).
- Erasable TypeScript only (Node type-stripping): no enums/namespaces,
  type-only imports via `import type`, relative imports carry `.ts`.
- New capability the package needs from the outside world? Add a port to
  `types.ts`, never an import.

Verify with: `npm run lint && npm run typecheck && npm run typecheck:frontend && npm test`.
If your change touches save/publish, manifest schema, or editor flows, also
run E2E: `npm run test:e2e -- --project=chromium`.

## 8. FAQ

**Do I need the backend running to use the SDK?**
No. The SDK never calls the Express API directly — only your ports. With the
in-memory adapters it runs with zero infrastructure (that is how the
benchmark and most unit tests work).

**Can I use it without a blockchain?**
Yes. Manifest/upload/download/compose/decompose/validate/history never touch
a chain. Only editor ops need `chain` (reads) and `hash` (Merkle leaves), and
on-chain submission is always the caller's job.

**Where does compression fit?**
Writes gzip by default (`compress: true`); reads auto-detect the gzip magic.
You never handle this yourself.

**What CIDs/formats does it produce?**
Exactly the same manifests, `ipfs://` buffer URIs, and dedup behavior as the
production Studio — the Studio is the primary consumer of this package, not a
separate implementation.

**How do I add a host environment (desktop, another app)?**
Implement the six port interfaces against your host's capabilities (§3),
call `createArbeskCore` once at boot, and you get the full facade. The
executor port is where "run compose/decompose off the UI thread" maps to
whatever your host offers (Web Workers, threads, actors).

## See also

- `packages/asset-core/README.md` — package overview
- `docs/superpowers/specs/2026-08-23-asset-core-externalization-design.md` — design decisions (why TS, why ports, why no WASM yet)
- `docs/ARCHITECTURE.md §4` — manifest/collection data model
- `docs/API_SPEC.md` — the HTTP API, if you don't need to embed the engine
