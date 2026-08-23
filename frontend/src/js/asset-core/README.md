# @arbesk/asset-core

Environment-agnostic Arbesk asset pipeline: manifests, glTF compose/decompose,
asset domain state, and Merkle editor helpers. Consumed as TypeScript source by
both the Node backend and the browser frontend — there is no build step and no
npm workspace.

## Usage

```ts
import { createArbeskCore } from "./asset-core/facade.ts";

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

Frontend apps call `initAssetCoreBrowser()` once at boot
(`frontend/src/js/asset-core-init.ts`) instead of constructing a core by hand.

## Ports

Environment-specific capabilities are injected, never imported by this package.
Browser adapters live in `ipfs/asset-core-adapter.ts`,
`blockchain/asset-core-adapter.ts`, and `workers/worker-executor.ts`; backend
adapters live in `src/api/asset-core-adapters.ts`.

## Boundary rule

`asset-core/` must not import from `ipfs/`, `services/`, `blockchain/`,
`workers/`, `engine/`, or `ui/`, and must not touch browser globals. The
eslint boundary block enforces this.

## Benchmark

```bash
npm run bench:asset-core
```

Prints a timing table and writes `test-results/asset-core-bench.json`.
