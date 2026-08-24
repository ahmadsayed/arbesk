# @arbesk/asset-core

**Consumer guide: `docs/ASSET_CORE_SDK.md`** — quickstarts per environment, port reference, facade API, boundary rules.

Environment-agnostic Arbesk asset engine: manifests, glTF compose/decompose,
asset domain state, and Merkle editor helpers. A real npm workspace package
(`packages/asset-core/`) consumed by the browser, the Node backend, and tests —
compiled to `dist/` (ESM + `.d.ts`) with no runtime dependency on Babylon.js
or any 3D engine.

## Usage

```ts
import { createArbeskCore } from "@arbesk/asset-core";

const core = createArbeskCore({
  ipfsRead,   // IpfsReadPort  — getJSON/getBytes/getRawBytes
  ipfsWrite,  // IpfsWritePort — write/writeJSON
  // optional ports:
  credentials, // CredentialPort — mint upload credentials
  chain,       // ChainPort — editor-list URI/version, email resolution
  hash,        // HashPort — soliditySha3/keccak256
  storage,     // StoragePort — key/value persistence
  executor,    // ExecutorPort — worker pool or inline fallback
  kernels,     // Partial<Kernels> — base64/hash/glb overrides
});

await core.upload(file);              // GLB or glTF JSON → stored composite
await core.download(rootCid);         // stored composite → Blob
await core.getVersionHistory(cid);    // prev_manifest_cid chain walk
await core.addEditor({ tokenId }, "0x…");
```

Subpath imports (advanced callers) use `.js`-suffixed specifiers, e.g.
`import { composeGltfJson } from "@arbesk/asset-core/gltf/gltf-core.js"`.

Frontend apps call `initAssetCoreBrowser()` once at boot
(`frontend/src/js/asset-core-init.ts`) instead of constructing a core by hand.

## Build

```bash
npm run build:packages        # tsc → dist/ (ESM + .d.ts)
npm run build:frontend        # vendors dist/ into the browser build
npm run bench:asset-core      # timing table + test-results/asset-core-bench.json
```

## Ports

Environment-specific capabilities are injected, never imported by this package.
Browser adapters live in `frontend/src/js/ipfs/asset-core-adapter.ts`,
`frontend/src/js/blockchain/asset-core-adapter.ts`, and
`frontend/src/js/workers/worker-executor.ts`; backend adapters live in
`src/api/asset-core-adapters.ts`.

## Boundary rule

The package must not import from the frontend/backend trees (`frontend/`,
`src/api/`), must not touch browser globals (`window`, `document`,
`localStorage`, `navigator`), and must not depend on Babylon.js — the eslint
boundary block (`eslint.config.js`) enforces all three.
