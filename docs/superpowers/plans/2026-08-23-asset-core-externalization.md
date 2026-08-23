# Asset-Core Externalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Externalize Arbesk's manifest + glTF compose/decompose + domain + Merkle editor logic into `frontend/src/js/asset-core/` — an in-tree, environment-agnostic package with a simple SDK facade (`arbesk.upload(file)`, `arbesk.download(ref)`, `arbesk.addEditor(asset, identity)`) consumed by both the Node backend and the browser frontend.

**Architecture:** In-tree TypeScript package (no build step, no npm workspace). Environment-specific capabilities (IPFS, chain, credentials, storage, execution, hashing) are injected as ports via a single `createArbeskCore(config)` entry point; implementations stay with the consumer (browser adapters wrap existing `ipfs/`/`blockchain/`/`workers/` modules; backend adapters wrap kubo/pinata). Three performance kernels (base64, hash, glb-binary) sit behind interfaces with TS defaults so a future WASM swap is localized and benchmark-driven.

**Tech Stack:** TypeScript (Node type-stripping backend, swc per-file emit frontend, @swc/jest tests), zod (manifest schema), viem (keccak/soliditySha3), fflate (gzip), @gltf-transform/core (GLB utilities), @openzeppelin/merkle-tree, vendored mitt (event bus).

**Spec:** `docs/superpowers/specs/2026-08-23-asset-core-externalization-design.md` — read it first; this plan argues from it.

## Global Constraints

- Backend `src/` runs via Node type-stripping: **erasable syntax only** (no enums/namespaces/parameter properties); type-only imports MUST use `import type`; relative imports carry explicit `.ts` extensions.
- Frontend import specifiers always match the on-disk file (`.ts` for TS modules); `frontend/scripts/render-ts.js` rewrites relative `.ts` → `.js` for the browser, jest maps `.js` → source via `moduleNameMapper`. Never use bare specifiers for in-repo modules.
- `asset-core/` must never import from `../ipfs/`, `../services/`, `../blockchain/`, `../workers/`, `../engine/`, `../ui/`, and never reference `window`, `document`, `BABYLON`, `Web3`, `navigator`, `localStorage`, or unguarded `indexedDB`. Enforced by the eslint block from Task 1.
- **No behavioral change** to manifests, CIDs, or the compose/decompose wire format. Moves are `git mv` + import rewiring only; logic edits happen only where a port replaces a direct call.
- Out-of-the-box first (AGENTS.md §5): reuse viem/fflate/zod/@gltf-transform/@openzeppelin/merkle-tree; hand-roll nothing that a current dependency provides.
- CDN globals (`BABYLON`, `Web3`, `IpfsHttpClient`) are never imported; this plan removes one such usage (`window.Web3` in `domain/editors.ts`).
- Verification rhythm per task: `npm run lint` + `npm run typecheck` + `npm run typecheck:frontend` + targeted jest, then full `npm test` before each commit that crosses module boundaries.
- Commits: conventional messages (`refactor:`, `feat:`, `test:`), one per task.

---

### Task 1: Package skeleton, runtime module, boundary lint

**Files:**
- Create: `frontend/src/js/asset-core/package.json`
- Create: `frontend/src/js/asset-core/types.ts`
- Create: `frontend/src/js/asset-core/runtime.ts`
- Create: `frontend/src/js/asset-core/index.ts`
- Create: `frontend/src/js/asset-core/storage/memory.ts`
- Modify: `eslint.config.js` (append a block after the `arbesk/typescript` block)
- Test: `test/frontend/asset-core-runtime.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `ArbeskCoreConfig`, `ArbeskRuntime`, `IpfsReadPort`, `IpfsWritePort`, `WriteJsonOptions`, `CredentialPort`, `ChainPort`, `HashPort`, `StoragePort`, `ExecutorPort`, `ExecutorOp`, `Kernels` (types); `initRuntime(config)`, `getRuntime()`, `_resetRuntimeForTesting()`; `memoryStorage()`. Every later task relies on these exact names.

- [x] **Step 1: Write the failing runtime test**

`test/frontend/asset-core-runtime.test.js`:

```js
import {
  initRuntime,
  getRuntime,
  _resetRuntimeForTesting,
} from "../../frontend/src/js/asset-core/runtime.ts";
import { memoryStorage } from "../../frontend/src/js/asset-core/storage/memory.ts";

const fakeRead = { getJSON: async () => ({}), getBytes: async () => new ArrayBuffer(0), getRawBytes: async () => new ArrayBuffer(0) };
const fakeWrite = { write: async () => "bafyfake", writeJSON: async () => "bafyfake" };

afterEach(() => _resetRuntimeForTesting());

test("getRuntime throws before init", () => {
  expect(() => getRuntime()).toThrow(/not initialized/);
});

test("initRuntime applies defaults for optional ports", () => {
  const rt = initRuntime({ ipfsRead: fakeRead, ipfsWrite: fakeWrite });
  expect(rt.ipfsRead).toBe(fakeRead);
  expect(rt.executor).toBeDefined();
  expect(rt.kernels.base64).toBeDefined();
  expect(rt.storage.getItem("x")).toBeNull();
});

test("memoryStorage round-trips and removes", () => {
  const s = memoryStorage();
  s.setItem("k", "v");
  expect(s.getItem("k")).toBe("v");
  s.removeItem("k");
  expect(s.getItem("k")).toBeNull();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/asset-core-runtime.test.js`
Expected: FAIL — module not found.

- [x] **Step 3: Create skeleton files**

`frontend/src/js/asset-core/package.json`:

```json
{
  "name": "@arbesk/asset-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Environment-agnostic Arbesk asset pipeline: manifests, glTF compose/decompose, domain state, Merkle editors. Consumed as TS source by both the Node backend and the browser frontend."
}
```

`frontend/src/js/asset-core/types.ts`:

```ts
/** Port + config types for asset-core. No runtime code here. */
import type { UploadCredential } from "./ipfs/upload-credential.ts";

export interface IpfsReadPort {
  /** JSON fetch with auto-gunzip. */
  getJSON(cid: string): Promise<any>;
  /** Byte fetch with auto-gunzip and optional progress (0..1). */
  getBytes(cid: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer>;
  /** Byte fetch with NO gunzip. */
  getRawBytes(cid: string): Promise<ArrayBuffer>;
}

export interface WriteJsonOptions {
  compress?: boolean;
  type?: string;
  assetId?: string;
  filename?: string;
}

export interface IpfsWritePort {
  write(
    data: Uint8Array | ArrayBuffer | Blob | string,
    filename?: string,
    credential?: UploadCredential | null,
    options?: { compress?: boolean }
  ): Promise<string>;
  writeJSON(
    json: Record<string, any>,
    credential?: UploadCredential | null,
    options?: WriteJsonOptions
  ): Promise<string>;
}

export interface CredentialPort {
  getUploadCredentials(count?: number): Promise<UploadCredential>;
}

export interface ChainPort {
  /** On-chain editor-list version for an asset tag (merkle-editors flow). */
  getEditorListVersion?(assetTag: string): Promise<number>;
  /** Resolve an email login to a wallet address (backend /users/resolve-email). */
  resolveEmail?(email: string): Promise<string>;
}

export interface HashPort {
  /** drop-in for Web3.utils.soliditySha3 — implement with viem encodePacked+keccak256. */
  soliditySha3(...args: any[]): string;
  keccak256(data: Uint8Array | `0x${string}`): string;
}

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ExecutorOp = "compose" | "decomposeGltf" | "decomposeGlb" | "bakeSourceColors";

export interface ExecutorPort {
  available(): Promise<boolean>;
  exec<T = any>(op: ExecutorOp, args: unknown[]): Promise<T>;
}

export interface Kernels {
  base64: {
    encode(bytes: Uint8Array | ArrayBuffer): string;
    decode(b64: string): Uint8Array;
  };
  hash: {
    sha256(bytes: Uint8Array): Promise<Uint8Array>;
    murmur3_128(bytes: Uint8Array, seed?: number): string;
  };
  glb: {
    isGLB(bytes: Uint8Array | ArrayBuffer): boolean;
  };
}

export interface ArbeskCoreConfig {
  ipfsRead: IpfsReadPort;
  ipfsWrite: IpfsWritePort;
  credentials?: CredentialPort;
  chain?: ChainPort;
  hash?: HashPort;
  storage?: StoragePort;
  executor?: ExecutorPort;
  kernels?: Partial<Kernels>;
}

export interface ArbeskRuntime {
  ipfsRead: IpfsReadPort;
  ipfsWrite: IpfsWritePort;
  credentials: CredentialPort | null;
  chain: ChainPort | null;
  hash: HashPort | null;
  storage: StoragePort;
  executor: ExecutorPort;
  kernels: Kernels;
}
```

Note: `types.ts` imports `UploadCredential` from `./ipfs/upload-credential.ts` — created empty for now as `frontend/src/js/asset-core/ipfs/upload-credential.ts` containing only `export interface UploadCredential { backend: string; url?: string; urls?: string[]; apiUrl?: string; gateway?: string; reusable?: boolean }` (Task 3 replaces it with the real moved module; keeping the type definition stable from day one avoids a later rewrite of `types.ts`).

`frontend/src/js/asset-core/storage/memory.ts`:

```ts
import type { StoragePort } from "../types.ts";

/** In-memory StoragePort — backend default and test double. */
export function memoryStorage(): StoragePort {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}
```

`frontend/src/js/asset-core/runtime.ts` (references `defaultKernels`/`inlineExecutor` — create minimal stubs now, real defaults land in Tasks 10/6 respectively; stubs MUST already satisfy the `Kernels`/`ExecutorPort` types):

`frontend/src/js/asset-core/executor/inline.ts`:

```ts
import type { ExecutorPort } from "../types.ts";

/**
 * Placeholder inline executor — Task 6 wires it to the real op table.
 * available() reports false so async-gltf falls back to its main-thread
 * path until then.
 */
export const inlineExecutor: ExecutorPort = {
  available: async () => false,
  exec: async () => {
    throw new Error("asset-core: inline executor not wired yet (Task 6)");
  },
};
```

`frontend/src/js/asset-core/kernels/index.ts`:

```ts
import type { Kernels } from "../types.ts";

/**
 * Placeholder default kernels — Task 10 replaces bodies with the real
 * implementations delegating to utils/encoding, utils/hash, gltf-core.
 */
export const defaultKernels: Kernels = {
  base64: {
    encode: () => { throw new Error("asset-core: base64 kernel not wired yet (Task 10)"); },
    decode: () => { throw new Error("asset-core: base64 kernel not wired yet (Task 10)"); },
  },
  hash: {
    sha256: async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
    murmur3_128: () => { throw new Error("asset-core: hash kernel not wired yet (Task 10)"); },
  },
  glb: {
    isGLB: () => { throw new Error("asset-core: glb kernel not wired yet (Task 10)"); },
  },
};
```

`frontend/src/js/asset-core/runtime.ts`:

```ts
import type { ArbeskCoreConfig, ArbeskRuntime } from "./types.ts";
import { defaultKernels } from "./kernels/index.ts";
import { inlineExecutor } from "./executor/inline.ts";
import { memoryStorage } from "./storage/memory.ts";

let runtime: ArbeskRuntime | null = null;

/** Set the process-wide runtime. Called once per environment by createArbeskCore(). */
export function initRuntime(config: ArbeskCoreConfig): ArbeskRuntime {
  runtime = {
    ipfsRead: config.ipfsRead,
    ipfsWrite: config.ipfsWrite,
    credentials: config.credentials ?? null,
    chain: config.chain ?? null,
    hash: config.hash ?? null,
    storage: config.storage ?? memoryStorage(),
    executor: config.executor ?? inlineExecutor,
    kernels: { ...defaultKernels, ...(config.kernels ?? {}) },
  };
  return runtime;
}

export function getRuntime(): ArbeskRuntime {
  if (!runtime) {
    throw new Error("asset-core: not initialized — call createArbeskCore() (or initRuntime()) first");
  }
  return runtime;
}

export function _resetRuntimeForTesting(): void {
  runtime = null;
}
```

`frontend/src/js/asset-core/index.ts` (for now):

```ts
export type * from "./types.ts";
export { initRuntime, getRuntime, _resetRuntimeForTesting } from "./runtime.ts";
export { memoryStorage } from "./storage/memory.ts";
```

- [x] **Step 4: Add the boundary eslint block**

Append to the exported array in `eslint.config.js`, after the `arbesk/typescript` block:

```js
  {
    name: "arbesk/asset-core",
    files: ["frontend/src/js/asset-core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["../ipfs/*", "../services/*", "../blockchain/*", "../workers/*", "../engine/*", "../ui/*", "**/ipfs/remote-ipfs*", "**/services/api*", "**/blockchain/*", "**/workers/*"],
          message: "asset-core must stay environment-agnostic — consume these via injected ports (see docs/superpowers/specs/2026-08-23-asset-core-externalization-design.md §3).",
        }],
      }],
      "no-restricted-globals": ["error",
        { name: "window", message: "asset-core is environment-agnostic; inject via ports." },
        { name: "document", message: "asset-core is environment-agnostic; inject via ports." },
        { name: "BABYLON", message: "asset-core must not touch the 3D engine." },
        { name: "Web3", message: "use the HashPort/ChainPort instead of the Web3 CDN global." },
        { name: "navigator", message: "asset-core is environment-agnostic; inject via ports." },
        { name: "localStorage", message: "use the StoragePort instead." },
      ],
    },
  },
```

- [x] **Step 5: Run test + lint to verify they pass**

Run: `npm test -- test/frontend/asset-core-runtime.test.js && npx eslint frontend/src/js/asset-core && npm run typecheck:frontend`
Expected: test PASS (3 tests), eslint clean, typecheck clean.

- [x] **Step 6: Commit**

```bash
git add frontend/src/js/asset-core eslint.config.js test/frontend/asset-core-runtime.test.js
git commit -m "feat(asset-core): package skeleton with runtime, ports, boundary lint"
```

---

### Task 2: Move pure utils into asset-core

**Files:**
- Move (git mv): `frontend/src/js/utils/uri.ts`, `encoding.ts`, `hash.ts`, `compression.ts`, `concurrency.ts`, `content-cache.ts` → `frontend/src/js/utils/` → `frontend/src/js/asset-core/utils/`
- Modify: every importer of those six modules (find with grep; known: `gltf/*`, `ipfs/remote-ipfs.ts`, `ipfs/write-to-ipfs.ts`, `domain/*`, `services/*`, `ui/*`, `workers/*`, plus tests)
- Test: existing suites (`npm test`) must stay green — no new tests.

**Interfaces:**
- Consumes: Task 1 skeleton (none of these modules use the runtime).
- Produces: same exported symbols as before (`sanitizeFileName`, `extractDataURI`, `arrayBufferToBase64`, `base64ToBytes`, `hashBytes`, `DEFAULT_HASH_ALGORITHM`, `SUPPORTED_HASH_ALGORITHMS`, `murmur3_32`, `murmur3_128`, `isGzipped`, `compress`, `decompress`, `createConcurrencyLimiter`, `ContentCache`, `getPayload`, `putPayload`, `clearCache`, `BIG_CONTENT_THRESHOLD_BYTES`, …) now under `asset-core/utils/`.

- [x] **Step 1: List all importers (ground truth for the rewire)**

Run:
```bash
grep -rl -E "utils/(uri|encoding|hash|compression|concurrency|content-cache)\.ts" frontend/src src test --include='*.ts' --include='*.js' | sort
```
Save the list; every file on it gets its specifier rewritten in Step 3.

- [x] **Step 2: Move the files**

```bash
mkdir -p frontend/src/js/asset-core/utils
for f in uri encoding hash compression concurrency content-cache; do
  git mv "frontend/src/js/utils/$f.ts" "frontend/src/js/asset-core/utils/$f.ts"
done
```

- [x] **Step 3: Rewrite import specifiers**

For each importer from Step 1, replace the `utils/…` path segment with the correct relative path to `asset-core/utils/…`, preserving the importer's depth. Work file by file with the editor; for each, the change is purely the path segment, e.g. in `frontend/src/js/gltf/composer.ts`:

```diff
-import { decompress } from "../utils/compression.ts";
+import { decompress } from "../asset-core/utils/compression.ts";
```

Also fix imports *inside* the moved files themselves (e.g. `content-cache.ts` importing `./hash.ts` stays `./hash.ts` — same dir — but any moved file importing a non-moved sibling must be adjusted; `compression.ts`, `hash.ts`, `encoding.ts`, `uri.ts`, `concurrency.ts` have zero or intra-dir imports, `content-cache.ts` imports only guarded globals + hash — verify with `grep -n "^import" frontend/src/js/asset-core/utils/*.ts`).

- [x] **Step 4: Run verification**

Run: `npm run typecheck:frontend && npm run typecheck && npm test`
Expected: all green. TS "cannot find module" errors enumerate any missed importer — fix and re-run.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(asset-core): move pure utils into the package"
```

---

### Task 3: Move upload-with-credential, gltf-core, bounds, cache-aware-fetch

**Files:**
- Move: `frontend/src/js/ipfs/upload-with-credential.ts` → `frontend/src/js/asset-core/ipfs/upload-with-credential.ts`
- Move: `frontend/src/js/gltf/gltf-core.ts`, `bounds.ts`, `cache-aware-fetch.ts` → `frontend/src/js/asset-core/gltf/`
- Modify: `frontend/src/js/asset-core/ipfs/upload-credential.ts` (delete — the real module supersedes the Task-1 stub; update `types.ts` import to `./upload-with-credential.ts`)
- Modify: importers — `gltf/dedup.ts`, `gltf/decomposer.ts`, `gltf/glb-parser.ts`, `gltf/async-gltf.ts` (type imports of UploadCredential), `frontend/src/js/workers/gltf-worker.ts` (imports `gltf/cache-aware-fetch`, `gltf/gltf-core`), plus tests `test/frontend/gltf-core.test.js`, `gltf-bounds.test.js`
- Test: existing suites stay green.

**Interfaces:**
- Consumes: Task 2 utils (moved files import `../utils/*` → now `../utils/*` inside asset-core — i.e. `asset-core/gltf/gltf-core.ts` imports `../utils/uri.ts`, resolving inside the package).
- Produces: `UploadCredential`, `uploadToIPFSWithCredential`, `uploadBatchToIPFSWithCredential` from `asset-core/ipfs/upload-with-credential.ts`; everything `gltf-core.ts` exports (`composeGltfJson`, `decomposeGltfJson`, `IPFS_URI_PREFIX`, `isComposite`, `ipfsUriFromCid`, `cidFromIpfsUri`, `attachDedupMeta`, `stripDedupMeta`, `serializeGLB`, …); `computeGltfBounds`; `fetchCIDAsBase64` from their new paths.

- [x] **Step 1: Move the files**

```bash
mkdir -p frontend/src/js/asset-core/ipfs frontend/src/js/asset-core/gltf
git mv frontend/src/js/ipfs/upload-with-credential.ts frontend/src/js/asset-core/ipfs/upload-with-credential.ts
git mv frontend/src/js/gltf/gltf-core.ts frontend/src/js/asset-core/gltf/gltf-core.ts
git mv frontend/src/js/gltf/bounds.ts frontend/src/js/asset-core/gltf/bounds.ts
git mv frontend/src/js/gltf/cache-aware-fetch.ts frontend/src/js/asset-core/gltf/cache-aware-fetch.ts
```

- [x] **Step 2: Fix imports inside moved files**

`asset-core/gltf/gltf-core.ts`: `../utils/uri.ts` already correct (now resolves to `asset-core/utils/uri.ts`).
`asset-core/gltf/cache-aware-fetch.ts`: `../utils/encoding.ts`, `../utils/hash.ts`, `../utils/content-cache.ts` already correct by the same mechanism.
`asset-core/ipfs/upload-with-credential.ts`: `../utils/concurrency.ts` already correct.
Verify: `grep -n "^import" frontend/src/js/asset-core/{gltf,ipfs}/*.ts` — every specifier must resolve inside `asset-core/`.

- [x] **Step 3: Replace the stub credential module and update types.ts**

```bash
git rm frontend/src/js/asset-core/ipfs/upload-credential.ts
```
In `frontend/src/js/asset-core/types.ts`:
```diff
-import type { UploadCredential } from "./ipfs/upload-credential.ts";
+import type { UploadCredential } from "./ipfs/upload-with-credential.ts";
```

- [x] **Step 4: Rewire external importers**

Known edits:
- `frontend/src/js/workers/gltf-worker.ts`: `../gltf/cache-aware-fetch.ts` → `../asset-core/gltf/cache-aware-fetch.ts`; `../gltf/gltf-core.ts` → `../asset-core/gltf/gltf-core.ts`.
- `gltf/dedup.ts`, `decomposer.ts`, `glb-parser.ts`, `async-gltf.ts`: `../ipfs/upload-with-credential.ts` → `../asset-core/ipfs/upload-with-credential.ts` (type-only imports).
- `test/frontend/gltf-core.test.js` → `../../frontend/src/js/asset-core/gltf/gltf-core.ts`; `gltf-bounds.test.js` likewise.
- Any other hits from: `grep -rl -E "(gltf/(gltf-core|bounds|cache-aware-fetch)|ipfs/upload-with-credential)\.ts" frontend/src src test --include='*.ts' --include='*.js'`

Note `dedup.ts` re-exports gltf-core symbols "for legacy import sites" — leave those re-exports in place; they keep working after the path fix.

- [x] **Step 5: Run verification**

Run: `npm run typecheck:frontend && npm run typecheck && npm test && npx eslint frontend/src/js/asset-core`
Expected: green. (`src/api/assets/generate-node.ts` still imports the OLD `frontend/src/js/gltf/gltf-core.ts` path — it must be updated in Step 4's sweep; the root typecheck catches it if missed.)

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(asset-core): move gltf-core, bounds, cache-aware-fetch, upload-with-credential"
```

---

### Task 4: IPFS port adapters (browser + in-memory Node) with contract tests

**Files:**
- Create: `frontend/src/js/asset-core/testing/memory-ipfs.ts`
- Create: `frontend/src/js/ipfs/asset-core-adapter.ts` (browser adapter — lives OUTSIDE asset-core by design)
- Test: `test/frontend/asset-core-ipfs-ports.test.js`

**Interfaces:**
- Consumes: `IpfsReadPort`/`IpfsWritePort` from Task 1; existing `ipfs/remote-ipfs.ts` + `ipfs/write-to-ipfs.ts` (unchanged).
- Produces: `createMemoryIpfs()` (test/backend-double: returns `{ read: IpfsReadPort, write: IpfsWritePort, dump: () => Map<string,Uint8Array> }`); `createBrowserIpfsPorts()` (returns `{ read, write }` wrapping today's modules). Task 5's moved pipeline modules call `getRuntime().ipfsRead/.ipfsWrite`; Task 11's facade config consumes both factories.

- [x] **Step 1: Write the failing contract test**

`test/frontend/asset-core-ipfs-ports.test.js`:

```js
import { createMemoryIpfs } from "../../frontend/src/js/asset-core/testing/memory-ipfs.ts";

/** Contract shared by every IpfsReadPort/IpfsWritePort pair. */
function ipfsContract(name, makePorts) {
  describe(name, () => {
    test("write → getRawBytes round-trips bytes", async () => {
      const { read, write } = makePorts();
      const cid = await write.write(new Uint8Array([1, 2, 3]), "x.bin", null, { compress: false });
      expect(typeof cid).toBe("string");
      const bytes = await read.getRawBytes(cid);
      expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3]);
    });

    test("writeJSON → getJSON round-trips an object", async () => {
      const { read, write } = makePorts();
      const cid = await write.writeJSON({ hello: "world" }, null, { compress: false });
      expect(await read.getJSON(cid)).toEqual({ hello: "world" });
    });

    test("reads unknown CID reject", async () => {
      const { read } = makePorts();
      await expect(read.getJSON("bafyunknown")).rejects.toThrow();
    });
  });
}

ipfsContract("memory adapter", () => createMemoryIpfs());
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/asset-core-ipfs-ports.test.js`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the memory adapter**

`frontend/src/js/asset-core/testing/memory-ipfs.ts`:

```ts
import type { IpfsReadPort, IpfsWritePort, WriteJsonOptions } from "../types.ts";
import type { UploadCredential } from "../ipfs/upload-with-credential.ts";
import { compress, decompress, isGzipped } from "../utils/compression.ts";

let counter = 0;

/**
 * In-memory IPFS double. Deterministic fake CIDs; honors the compress
 * option so getJSON/getBytes exercise the same gunzip paths as production.
 * Also serves as the backend-side adapter for benchmarks and tests.
 */
export function createMemoryIpfs(): {
  read: IpfsReadPort;
  write: IpfsWritePort;
  dump: () => Map<string, Uint8Array>;
} {
  const store = new Map<string, Uint8Array>();

  const put = (bytes: Uint8Array): string => {
    const cid = `bafymem${(counter++).toString().padStart(8, "0")}`;
    store.set(cid, bytes);
    return cid;
  };
  const get = (cid: string): Uint8Array => {
    const bytes = store.get(cid);
    if (!bytes) throw new Error(`memory-ipfs: unknown CID ${cid}`);
    return bytes;
  };

  const read: IpfsReadPort = {
    async getJSON(cid) {
      const raw = get(cid);
      const plain = isGzipped(raw) ? decompress(raw) : raw;
      return JSON.parse(new TextDecoder().decode(plain));
    },
    async getBytes(cid) {
      const raw = get(cid);
      const plain = isGzipped(raw) ? decompress(raw) : raw;
      return plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer;
    },
    async getRawBytes(cid) {
      const raw = get(cid);
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    },
  };

  const write: IpfsWritePort = {
    async write(data, _filename = "asset.bin", _credential: UploadCredential | null = null, options = {}) {
      let bytes =
        data instanceof Uint8Array ? data :
        data instanceof ArrayBuffer ? new Uint8Array(data) :
        typeof data === "string" ? new TextEncoder().encode(data) :
        new Uint8Array(await (data as Blob).arrayBuffer());
      if (options.compress !== false) bytes = compress(bytes);
      return put(bytes);
    },
    async writeJSON(json, credential = null, options: WriteJsonOptions = {}) {
      return this.write(JSON.stringify(json), options.filename ?? "manifest.json", credential, options);
    },
  };

  return { read, write, dump: () => new Map(store) };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- test/frontend/asset-core-ipfs-ports.test.js`
Expected: PASS (3 tests).

- [x] **Step 5: Implement the browser adapter**

`frontend/src/js/ipfs/asset-core-adapter.ts`:

```ts
/**
 * Browser IpfsReadPort/IpfsWritePort — thin wrappers over the existing
 * gateway/session modules. Lives outside asset-core by design: this file
 * IS the environment-specific implementation.
 */
import type { IpfsReadPort, IpfsWritePort } from "../asset-core/types.ts";
import {
  getFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
  getRawArrayBufferFromRemoteIPFS,
} from "./remote-ipfs.ts";
import { writeToIPFS, writeJSONToIPFS } from "./write-to-ipfs.ts";

export function createBrowserIpfsPorts(): { read: IpfsReadPort; write: IpfsWritePort } {
  const read: IpfsReadPort = {
    getJSON: (cid) => getFromRemoteIPFS(cid),
    getBytes: (cid, onProgress) => getArrayBufferFromRemoteIPFS(cid, onProgress),
    getRawBytes: (cid) => getRawArrayBufferFromRemoteIPFS(cid) as Promise<ArrayBuffer>,
  };
  const write: IpfsWritePort = {
    write: (data, filename, credential, options) => writeToIPFS(data, filename, credential, options),
    writeJSON: (json, credential, options) => writeJSONToIPFS(json, credential, options),
  };
  return { read, write };
}
```

Add a smoke test appended to `asset-core-ipfs-ports.test.js` asserting `createBrowserIpfsPorts()` returns objects with the three read methods and two write methods (jsdom environment; no network calls).

- [x] **Step 6: Run verification + commit**

Run: `npm test -- test/frontend/asset-core-ipfs-ports.test.js && npm run lint && npm run typecheck:frontend`
Expected: green.

```bash
git add -A
git commit -m "feat(asset-core): IPFS port adapters (browser + in-memory) with contract tests"
```

---

### Task 5: Move composer, decomposer, glb-parser, dedup, color editors behind ports; manifest chain walk in

**Files:**
- Move: `frontend/src/js/gltf/{composer,decomposer,glb-parser,dedup,material-editor,source-color-editor}.ts` → `frontend/src/js/asset-core/gltf/`
- Create: `frontend/src/js/asset-core/manifest/chain.ts` (manifest-chain walk, moved from `remote-ipfs.ts#getManifestChain`)
- Modify: `frontend/src/js/ipfs/remote-ipfs.ts` (drop `getManifestChain`; re-export from asset-core for its current consumers)
- Modify: root `package.json` (add `@gltf-transform/core` dep; move `fflate` devDep → dep)
- Modify: `src/api/assets/generate-node.ts` (import from new gltf-core path)
- Modify: importers of the moved modules (grep-driven; known: `formats/handlers/*`, `3mf/decomposer.ts`, `services/asset-save/manifest-builder.ts`, `services/asset-download.ts` (async-gltf — Task 6), workers, tests `glb-parser.test.js`, `glb-parser.bench.mjs`)
- Test: existing suites stay green; new port-rewire covered by existing composer/decomposer/glb-parser tests.

**Interfaces:**
- Consumes: `getRuntime().ipfsRead/.ipfsWrite` (Task 1 + Task 4 adapters).
- Produces: from `asset-core/gltf/`: `composeGltfJson` pipeline entry `composeGLTF`/`composeGltf` (existing composer exports, names unchanged), `decomposeAndStore` + `isComposite` re-export (decomposer), `isGLB`, `decomposeGLB`, `serializeGLB` (glb-parser), `uploadWithDedup`, `buildDedupMap`, `DedupMeta` (dedup), `editCompositeColors` (material-editor), source-color editor entries. From `asset-core/manifest/chain.ts`: `getManifestChain(cid: string, maxDepth?: number): Promise<ManifestChainEntry[]>` and `export interface ManifestChainEntry { cid: string; version: any; name: string | null; nodeCount: number }` (now exported — it wasn't before).

- [x] **Step 1: Add dependencies**

```bash
npm install @gltf-transform/core@^4.1.2
npm install fflate && npm uninstall --save-dev fflate   # moves it to dependencies
```
Verify `frontend/package.json` still pins its own copies (browser import map is untouched).

- [x] **Step 2: Move the six gltf modules**

```bash
for f in composer decomposer glb-parser dedup material-editor source-color-editor; do
  git mv "frontend/src/js/gltf/$f.ts" "frontend/src/js/asset-core/gltf/$f.ts"
done
```

- [x] **Step 3: Rewire moved files to ports**

Inside each moved file, replace direct IPFS imports with runtime port calls. Exact substitutions:

- `asset-core/gltf/composer.ts`:
```diff
-import { getArrayBufferFromRemoteIPFS, getRawArrayBufferFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
+import { getRuntime } from "../runtime.ts";
```
and at call sites: `getArrayBufferFromRemoteIPFS(cid)` → `getRuntime().ipfsRead.getBytes(cid)`; `getRawArrayBufferFromRemoteIPFS(cid)` → `getRuntime().ipfsRead.getRawBytes(cid)`. `../utils/compression.ts` import already resolves (same package now). `./cache-aware-fetch.ts`, `./gltf-core.ts` unchanged (moved together).

- `asset-core/gltf/dedup.ts`: `../utils/hash.ts`, `../utils/compression.ts` resolve in-package; replace `import { writeToIPFS } from "../ipfs/write-to-ipfs.ts"` with `getRuntime().ipfsWrite.write(...)` at call sites; `../ipfs/upload-with-credential.ts` → `../ipfs/upload-with-credential.ts` (in-package now — adjust to `../ipfs/upload-with-credential.ts`, i.e. verify relative depth is correct as `../ipfs/` from `gltf/`).

- `asset-core/gltf/decomposer.ts`, `glb-parser.ts`: same pattern — `writeJSONToIPFS(...)` → `getRuntime().ipfsWrite.writeJSON(...)`; `../utils/uri.ts` resolves in-package.

- `asset-core/gltf/material-editor.ts`, `source-color-editor.ts`: `getFromRemoteIPFS(cid)` → `getRuntime().ipfsRead.getJSON(cid)`; `getArrayBufferFromRemoteIPFS(cid)` → `getRuntime().ipfsRead.getBytes(cid)`; `writeJSONToIPFS(...)` → port.

- [x] **Step 4: Move the manifest-chain walk into the package**

Create `frontend/src/js/asset-core/manifest/chain.ts` by moving the body of `getManifestChain` (and the `ManifestChainEntry` shape, now exported) out of `frontend/src/js/ipfs/remote-ipfs.ts`, replacing its internal fetch helper with `getRuntime().ipfsRead.getJSON(cid)`. In `remote-ipfs.ts`, keep a re-export so its current consumers are untouched:

```ts
export { getManifestChain } from "../asset-core/manifest/chain.ts";
export type { ManifestChainEntry } from "../asset-core/manifest/chain.ts";
```

- [x] **Step 5: Rewire external importers**

```bash
grep -rl -E "gltf/(composer|decomposer|glb-parser|dedup|material-editor|source-color-editor)\.ts" frontend/src src test --include='*.ts' --include='*.js'
```
Update each to the `asset-core/gltf/` path (e.g. `formats/handlers/glb-handler.ts`: `../../gltf/async-gltf.ts` stays for now — Task 6 — but `../gltf/decomposer.ts` → `../asset-core/gltf/decomposer.ts`). Update `src/api/assets/generate-node.ts:7` to `frontend/src/js/asset-core/gltf/gltf-core.ts`. Update `test/frontend/glb-parser.test.js`, `glb-parser.bench.mjs`.

- [x] **Step 6: Run verification**

Run: `npm run lint && npm run typecheck && npm run typecheck:frontend && npm test`
Expected: green. The eslint boundary block must pass on the moved files — if it flags a missed `services/` or `ipfs/` import, that import was overlooked in Step 3; fix via the port, never by exempting the rule.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(asset-core): move compose/decompose pipeline behind IPFS ports"
```

---

### Task 6: ExecutorPort + async-gltf orchestration move; inline executor wired

**Files:**
- Move: `frontend/src/js/gltf/async-gltf.ts` → `frontend/src/js/asset-core/gltf/async-gltf.ts`
- Modify: `frontend/src/js/asset-core/executor/inline.ts` (replace stub with real op table)
- Create: `frontend/src/js/workers/worker-executor.ts` (browser ExecutorPort impl wrapping `gltf-worker-pool.ts`)
- Modify: `frontend/src/js/workers/gltf-worker-pool.ts` (bump worker URL `?v=5` → `?v=6`)
- Modify: importers of async-gltf (`services/asset-download.ts`, `formats/handlers/glb-handler.ts`, `gltf-handler.ts`, `test/frontend/async-gltf-credential-pool.test.js`)
- Test: `test/frontend/asset-core-executor.test.js` (new) + existing async-gltf tests.

**Interfaces:**
- Consumes: Task 5 pipeline modules; `CredentialPort` (Task 1) for credential pooling — `async-gltf.ts`'s `getUploadCredentials(n)` call becomes `getRuntime().credentials!.getUploadCredentials(n)` with a guard error if the port is absent.
- Produces: `composeGlTFAsync`, `composeGlTFToBlobAsync`, `decomposeGlTFAsync`, `decomposeAndStoreAsync`, `decomposeGLBAsync`, `editSourceColorsAsync` (unchanged names/signatures, new path); real `inlineExecutor` (op table dispatching to main-thread implementations); `createWorkerExecutor()` in frontend workers/.

- [x] **Step 1: Write the failing inline-executor test**

`test/frontend/asset-core-executor.test.js`:

```js
import { initRuntime, _resetRuntimeForTesting } from "../../frontend/src/js/asset-core/runtime.ts";
import { inlineExecutor } from "../../frontend/src/js/asset-core/executor/inline.ts";
import { createMemoryIpfs } from "../../frontend/src/js/asset-core/testing/memory-ipfs.ts";
import { readFileSync } from "node:fs";

afterEach(() => _resetRuntimeForTesting());

test("inline executor decomposeGlb + compose round-trips triangle.glb", async () => {
  const { read, write } = createMemoryIpfs();
  initRuntime({ ipfsRead: read, ipfsWrite: write, executor: inlineExecutor });
  const bytes = readFileSync("mock-gltf-assets/triangle.glb");
  const result = await inlineExecutor.exec("decomposeGlb", [new Uint8Array(bytes), "triangle.glb", null, {}]);
  expect(result.rootCid ?? result.compositeCid).toMatch(/^bafymem/);
  const composed = await inlineExecutor.exec("compose", [result.compositeCid ?? result.rootCid]);
  expect(composed).toBeDefined();
});

test("inline executor reports available", async () => {
  expect(await inlineExecutor.available()).toBe(true);
});
```

(Adjust the asserted result field names to the real return shape of the moved `decomposeGLB` once wired in Step 3 — the round-trip assertion is the contract.)

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/asset-core-executor.test.js`
Expected: FAIL — "inline executor not wired yet".

- [x] **Step 3: Move async-gltf and wire the inline executor**

```bash
git mv frontend/src/js/gltf/async-gltf.ts frontend/src/js/asset-core/gltf/async-gltf.ts
```

In the moved file:
- Remove `import { getGlTFWorkerPool, isWorkerPoolAvailable } from "../workers/gltf-worker-pool.ts"` → use `getRuntime().executor`.
- Replace `import { getUploadCredentials } from "../services/api.ts"` with a module helper:

```ts
function credentialPort() {
  const c = getRuntime().credentials;
  if (!c) throw new Error("asset-core: upload requires a CredentialPort (createArbeskCore({ credentials }))");
  return c;
}
```

- The worker-first/main-thread-fallback structure is preserved verbatim, except "worker" now means `getRuntime().executor.exec(op, args)` and "is pool available" means `getRuntime().executor.available()`. Credential pooling logic (`estimateUploadCount`, `estimateGlbUploadCount`, `reserveFollowUpCredential`, `MAX_POOLED_CREDENTIALS`) moves unchanged.

Replace `executor/inline.ts` stub with the real op table:

```ts
import type { ExecutorPort, ExecutorOp } from "../types.ts";
import { composeGLTF /* existing composer entry */ } from "../gltf/composer.ts";
import { decomposeAndStore } from "../gltf/decomposer.ts";
import { decomposeGLB } from "../gltf/glb-parser.ts";
import { bakeSourceColors /* existing source-color-editor entry */ } from "../gltf/source-color-editor.ts";

const OPS: Record<ExecutorOp, (...args: any[]) => Promise<any>> = {
  compose: composeGLTF,
  decomposeGltf: decomposeAndStore,
  decomposeGlb: decomposeGLB,
  bakeSourceColors,
};

/** Runs pipeline ops on the calling thread — backend default and browser fallback. */
export const inlineExecutor: ExecutorPort = {
  available: async () => true,
  exec: (op, args) => OPS[op](...args),
};
```

(Use the actual exported names from the moved modules; if the composer/decomposer entries differ, map them in `OPS` — the op-name contract `"compose" | "decomposeGltf" | "decomposeGlb" | "bakeSourceColors"` is fixed because the worker already exposes exactly these.)

- [x] **Step 4: Create the browser worker executor**

`frontend/src/js/workers/worker-executor.ts`:

```ts
import type { ExecutorPort, ExecutorOp } from "../asset-core/types.ts";
import { getGlTFWorkerPool, isWorkerPoolAvailable } from "./gltf-worker-pool.ts";

/** Browser ExecutorPort backed by the Web Worker pool. */
export function createWorkerExecutor(): ExecutorPort {
  return {
    available: () => isWorkerPoolAvailable(),
    exec: <T>(op: ExecutorOp, args: unknown[]) => getGlTFWorkerPool().exec(op, args) as Promise<T>,
  };
}
```

Bump the cache-buster in `gltf-worker-pool.ts`: `new URL("./gltf-worker.js?v=5", import.meta.url)` → `?v=6` (worker entry imports changed paths in Task 3).

- [x] **Step 5: Rewire importers + run verification**

Update `services/asset-download.ts`, `formats/handlers/glb-handler.ts`, `gltf-handler.ts`, `test/frontend/async-gltf-credential-pool.test.js` to the new `asset-core/gltf/async-gltf.ts` path. The credential-pool test previously stubbed `services/api#getUploadCredentials` — re-stub via `initRuntime({ credentials: fakePort })` instead (test edit allowed: same behavior, new seam).

Run: `npm run lint && npm run typecheck && npm run typecheck:frontend && npm test`
Expected: green, including the new executor test.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(asset-core): move async pipeline orchestration behind ExecutorPort"
```

---

### Task 7: Manifest module — merge backend manifest-utils, add zod schema

**Files:**
- Create: `frontend/src/js/asset-core/manifest/schema.ts` (zod manifest schema)
- Create: `frontend/src/js/asset-core/manifest/utils.ts` (`getSceneNodes`, `bumpManifestVersion`)
- Modify: `src/api/manifest-utils.ts` → thin re-export of the asset-core module (keeps backend import sites stable)
- Modify: `src/api/schemas.ts` — `validateManifest` delegates to the asset-core zod schema
- Test: `test/frontend/asset-core-manifest.test.js` (new); existing backend tests must stay green.

**Interfaces:**
- Consumes: zod (root dep), nothing from moved pipeline.
- Produces: `ManifestSchema` (zod), `validateManifest(manifest): { valid: boolean; issues?: any[] }` (match the current `src/api/schemas.ts` return contract — backend routes depend on it), `getSceneNodes(manifest)`, `bumpManifestVersion(manifest, prevCid?)`.

- [x] **Step 1: Write the failing schema test**

`test/frontend/asset-core-manifest.test.js`:

```js
import { validateManifest, getSceneNodes, bumpManifestVersion } from "../../frontend/src/js/asset-core/manifest/utils.ts";

test("validateManifest accepts a minimal valid manifest", () => {
  const m = { version: 1, scene: { nodes: [] }, timestamp: new Date().toISOString() };
  expect(validateManifest(m).valid).toBe(true);
});

test("validateManifest rejects a non-object with issues", () => {
  const r = validateManifest(42);
  expect(r.valid).toBe(false);
  expect(r.issues?.length).toBeGreaterThan(0);
});

test("getSceneNodes creates scene.nodes when missing", () => {
  const m = {};
  expect(Array.isArray(getSceneNodes(m))).toBe(true);
  expect(m.scene.nodes).toEqual([]);
});

test("bumpManifestVersion increments and chains prev cid", () => {
  const m = { version: 3 };
  bumpManifestVersion(m, "bafyprev");
  expect(m.version).toBe(4);
  expect(m.prev_asset_manifest_cid).toBe("bafyprev");
  expect(typeof m.timestamp).toBe("string");
});
```

IMPORTANT: before finalizing Step 1, read the CURRENT `src/api/schemas.ts#validateManifest` and the manifests in `test/` fixtures; the new zod schema must accept exactly what the current validator accepts (same required fields, same tolerance for extra fields). If the current validator is stricter/looser than the sketch above, the test follows the CURRENT behavior — the wire format does not change.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/asset-core-manifest.test.js`
Expected: FAIL — module not found.

- [x] **Step 3: Implement schema + utils**

`manifest/schema.ts`: zod object mirroring the current validator's rules (`.passthrough()` if the current validator tolerates unknown keys). `manifest/utils.ts`: move `getSceneNodes`/`bumpManifestVersion` verbatim from `src/api/manifest-utils.ts`; implement `validateManifest` as `ManifestSchema.safeParse` mapped to the existing `{ valid, issues }` contract.

- [x] **Step 4: Rewire backend**

`src/api/manifest-utils.ts` becomes:

```ts
export { getSceneNodes, bumpManifestVersion } from "../../frontend/src/js/asset-core/manifest/utils.ts";
export { validateManifest } from "../../frontend/src/js/asset-core/manifest/utils.ts";
```

`src/api/schemas.ts`: remove its local manifest validator; `export { validateManifest } from ...asset-core...` (or delegate), keeping every other schema untouched.

- [x] **Step 5: Run verification + commit**

Run: `npm test -- test/frontend/asset-core-manifest.test.js && npm run test:api && npm run lint && npm run typecheck`
Expected: green (backend suite proves the re-export contract).

```bash
git add -A
git commit -m "refactor(asset-core): canonical manifest schema + utils in the package"
```

---

### Task 8: Events bus + store infra + domain layer + merkle-editors move; Hash/Storage/Chain ports

**Files:**
- Move: `frontend/src/js/events/bus.ts`, `frontend/src/js/events/mitt.mjs` → `frontend/src/js/asset-core/events/`
- Move: `frontend/src/js/state/create-store.ts` → `frontend/src/js/asset-core/state/`
- Move: `frontend/src/js/domain/*` (all 9 files) → `frontend/src/js/asset-core/domain/`
- Move: `frontend/src/js/gltf/merkle-editors.ts` → `frontend/src/js/asset-core/gltf/merkle-editors.ts`
- Create: `frontend/src/js/blockchain/asset-core-adapter.ts` (browser HashPort via viem + ChainPort via wallet.ts; StoragePort over localStorage)
- Modify: all importers of `events/bus`, `state/create-store`, `domain/*`, `gltf/merkle-editors` (grep-driven; known large set across engine/, services/, ui/, workers/, test/)
- Test: existing suites (`domain-asset-*.test.js`, `version-history-store.test.js`, `generation-actions.test.js`, `domain-structs.test.js`, `outliner.test.js`, `asset-library.test.js`, `nesting.test.js`, …) stay green; new port-wiring in `domain/editors.ts` covered by existing editor tests.

**Interfaces:**
- Consumes: `HashPort`, `StoragePort`, `ChainPort` from runtime (Task 1); viem.
- Produces: `EVENTS`, `on`, `off`, `emit` from `asset-core/events/bus.ts`; `createStore` from `asset-core/state/create-store.ts`; all domain exports (`adoptOpenedAsset`, `renameAsset`, `saveDraftAsset`, `publishAsset`, `getAssetState`, `getActiveAssetManifestCid`, `getCurrentManifest`, `publishCollection`, editor helpers, `version-history-store` API, `generation-actions` policy) at their new paths; merkle-editors API (`MAX_CHILD_ASSET_DEPTH`-adjacent editor helpers, proof commands) at new path. `createBrowserPlatformPorts()` returning `{ hash, storage, chain }`.

- [x] **Step 1: Move bus + store + domain + merkle-editors**

```bash
mkdir -p frontend/src/js/asset-core/events frontend/src/js/asset-core/state frontend/src/js/asset-core/domain
git mv frontend/src/js/events/bus.ts frontend/src/js/events/mitt.mjs frontend/src/js/asset-core/events/
git mv frontend/src/js/state/create-store.ts frontend/src/js/asset-core/state/
git mv frontend/src/js/domain/*.ts frontend/src/js/asset-core/domain/
git mv frontend/src/js/gltf/merkle-editors.ts frontend/src/js/asset-core/gltf/merkle-editors.ts
```

Leave `frontend/src/js/events/` and `state/` dirs behind only if other unmoved files remain (check first; if empty, `git rm` the dirs).

- [x] **Step 2: Rewire domain/editors.ts to ports**

In `asset-core/domain/editors.ts`:
- Replace `const W3 = window.Web3; … W3.utils.soliditySha3(...)` with `getRuntime().hash` — guard: `const h = getRuntime().hash; if (!h) throw new Error("asset-core: editor ops require a HashPort")`. Call sites: `h.soliditySha3(...)`.
- Replace `localStorage.getItem/setItem/removeItem` with `getRuntime().storage.*`.
- Replace `getActiveContract(...)`-based on-chain version lookup with `getRuntime().chain` — `const c = getRuntime().chain; if (!c?.getEditorListVersion) throw …`; move the exact contract call into the browser adapter (Step 3).
- Replace `getFromRemoteIPFS` with `getRuntime().ipfsRead.getJSON`.
- Update `../gltf/merkle-editors.ts` ↔ `../domain/editors.ts` cross-imports to their in-package relative paths.

- [x] **Step 3: Browser platform adapter**

`frontend/src/js/blockchain/asset-core-adapter.ts`:

```ts
import type { ChainPort, HashPort, StoragePort } from "../asset-core/types.ts";
import { keccak256, encodePacked, toBytes } from "viem";
import { getActiveContract } from "./wallet.ts";

export function createBrowserHashPort(): HashPort {
  return {
    // Mirror Web3.utils.soliditySha3 semantics: abi-packed keccak256.
    soliditySha3: (...args) => keccak256(encodePacked(args.map(inferType), args)),
    keccak256: (data) => keccak256(data),
  };
}

export function createBrowserStoragePort(): StoragePort {
  return {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
  };
}

export function createBrowserChainPort(): ChainPort {
  return {
    // Move the exact editor-list-version contract call from domain/editors.ts here.
    getEditorListVersion: async (assetTag) => { /* existing call via getActiveContract */ },
    resolveEmail: async (email) => { /* existing /users/resolve-email call via services/api */ },
  };
}
```

`inferType` maps JS values to abi types the way `soliditySha3` infers them (`address` for 0x-strings of 40 hex chars, `uint256` for numbers, `string` otherwise) — implement by mirroring the ONE usage pattern in the old `editors.ts` (if it only ever hashes addresses, the mapper is one line; do not build a general ABI encoder — YAGNI).

- [x] **Step 4: Rewire all importers**

```bash
grep -rl -E "(events/bus|state/create-store|domain/(asset|asset-store|collection|editors|node|asset-ref|generation-actions|version-history-store)|gltf/merkle-editors)\.ts" frontend/src src test --include='*.ts' --include='*.js'
```
Rewrite each to the `asset-core/…` path. Known hot spots from exploration: `engine/{cleanup,scene-loader,camera-persistence,scene-graph}.ts`, `services/{asset-save/*,team,asset-delete,asset-file-drop,comment-thread,library-ops}.ts`, `ui/*` (12 files), `workers/gltf-worker.ts`, tests listed above. The single-writer discipline (only `domain/asset.ts` mutates identity fields) is unchanged — moves only.

- [x] **Step 5: Run verification**

Run: `npm run lint && npm run typecheck && npm run typecheck:frontend && npm test`
Expected: green. The boundary block now guards the domain files — any flagged import means a missed port rewire in Step 2.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(asset-core): move domain layer, events bus, merkle editors behind ports"
```

---

### Task 9: SDK facade — createArbeskCore

**Files:**
- Create: `frontend/src/js/asset-core/facade.ts`
- Modify: `frontend/src/js/asset-core/index.ts` (export facade)
- Modify: `src/api/assets/generate-node.ts` (switch to facade as backend proof site)
- Modify: one frontend proof site — `frontend/src/js/services/asset-download.ts` download path via `arbesk.download`
- Test: `test/frontend/asset-core-facade.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–8 (`composeGlTFToBlobAsync`, `decomposeAndStoreAsync`, `decomposeGLBAsync`, `getManifestChain`, `validateManifest`, domain editor commands, `isGLB`).
- Produces:

```ts
export interface UploadOptions { onProgress?: (fraction: number) => void; credential?: UploadCredential | null; compress?: boolean }
export interface UploadResult { rootCid: string; compositeCid?: string }
export interface DownloadOptions { onProgress?: (fraction: number) => void }
export interface AssetRefLike { tag?: string; chainId?: number; contractAddress?: string; tokenId?: string; assetId?: string }

export interface ArbeskCore {
  upload(source: Blob | ArrayBuffer | Uint8Array | string, opts?: UploadOptions): Promise<UploadResult>;
  download(ref: string | Record<string, any>, opts?: DownloadOptions): Promise<Blob>;
  compose(manifest: Record<string, any>, opts?: DownloadOptions): Promise<Blob>;
  decompose(gltfJson: Record<string, any>, opts?: UploadOptions): Promise<UploadResult>;
  decomposeGLB(bytes: Uint8Array | ArrayBuffer, opts?: UploadOptions): Promise<UploadResult>;
  getManifest(cid: string): Promise<Record<string, any>>;
  getVersionHistory(cid: string, maxDepth?: number): Promise<ManifestChainEntry[]>;
  validateManifest(manifest: unknown): { valid: boolean; issues?: any[] };
  addEditor(asset: AssetRefLike, identity: string): Promise<void>;
  removeEditor(asset: AssetRefLike, identity: string): Promise<void>;
  listEditors(asset: AssetRefLike): Promise<any[]>;
}
export function createArbeskCore(config: ArbeskCoreConfig): ArbeskCore;
```

- [x] **Step 1: Write the failing facade test**

`test/frontend/asset-core-facade.test.js`:

```js
import { createArbeskCore } from "../../frontend/src/js/asset-core/facade.ts";
import { createMemoryIpfs } from "../../frontend/src/js/asset-core/testing/memory-ipfs.ts";
import { _resetRuntimeForTesting } from "../../frontend/src/js/asset-core/runtime.ts";
import { readFileSync } from "node:fs";

const makeCore = () => {
  const { read, write } = createMemoryIpfs();
  return createArbeskCore({ ipfsRead: read, ipfsWrite: write });
};

afterEach(() => _resetRuntimeForTesting());

test("upload(GLB) → download round-trips through memory IPFS", async () => {
  const core = makeCore();
  const bytes = readFileSync("mock-gltf-assets/triangle.glb");
  const { rootCid } = await core.upload(new Uint8Array(bytes));
  expect(rootCid).toMatch(/^bafymem/);
  const blob = await core.download(rootCid);
  expect(blob.size).toBeGreaterThan(0);
});

test("validateManifest is exposed on the facade", async () => {
  const core = makeCore();
  expect(core.validateManifest(42).valid).toBe(false);
});

test("addEditor with email but no chain port rejects with guidance", async () => {
  const core = makeCore();
  await expect(core.addEditor({ tag: "31337:0x0:1:asset" }, "friend@example.com"))
    .rejects.toThrow(/resolveEmail|0x/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/asset-core-facade.test.js`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the facade**

`frontend/src/js/asset-core/facade.ts` — `createArbeskCore` calls `initRuntime(config)` then returns thin compositions:

```ts
import type { ArbeskCoreConfig } from "./types.ts";
import { initRuntime, getRuntime } from "./runtime.ts";
import { isGLB, decomposeGLB } from "./gltf/glb-parser.ts";
import { decomposeAndStore } from "./gltf/decomposer.ts";
import { composeGlTFToBlobAsync } from "./gltf/async-gltf.ts";
import { getManifestChain } from "./manifest/chain.ts";
import { validateManifest } from "./manifest/utils.ts";
// domain editor commands moved in Task 8:
import * as editors from "./domain/editors.ts";

export function createArbeskCore(config: ArbeskCoreConfig) {
  initRuntime(config);

  async function upload(source, opts = {}) {
    const bytes = await toBytes(source);
    if (isGLB(bytes)) return decomposeGLB(bytes, opts);       // returns { rootCid, compositeCid? }
    const json = typeof source === "string" ? JSON.parse(source) : JSON.parse(new TextDecoder().decode(bytes));
    return decomposeAndStore(json, opts);
  }

  async function download(ref, opts = {}) {
    const manifest = typeof ref === "string" ? await getRuntime().ipfsRead.getJSON(ref) : ref;
    return composeGlTFToBlobAsync(manifest, opts);
  }

  async function resolveIdentity(identity) {
    if (/^0x[0-9a-fA-F]{40}$/.test(identity)) return identity;
    const chain = getRuntime().chain;
    if (!chain?.resolveEmail) {
      throw new Error("asset-core: email identity requires a ChainPort with resolveEmail — or pass a 0x address");
    }
    return chain.resolveEmail(identity);
  }

  return {
    upload,
    download,
    compose: (manifest, opts) => composeGlTFToBlobAsync(manifest, opts),
    decompose: (json, opts) => decomposeAndStore(json, opts),
    decomposeGLB: (bytes, opts) => decomposeGLB(bytes, opts),
    getManifest: (cid) => getRuntime().ipfsRead.getJSON(cid),
    getVersionHistory: (cid, maxDepth) => getManifestChain(cid, maxDepth),
    validateManifest,
    addEditor: async (asset, identity) => editors.addEditorCommand(asset, await resolveIdentity(identity)),
    removeEditor: async (asset, identity) => editors.removeEditorCommand(asset, await resolveIdentity(identity)),
    listEditors: (asset) => editors.listEditorsCommand(asset),
  };
}
```

(`toBytes` handles Blob/ArrayBuffer/Uint8Array/string. The `editors.*Command` names are placeholders ONLY in the sense that they must be the real exported command names from the Task-8-moved `domain/editors.ts` — use those verbatim; if `domain/editors.ts` exposes lower-level helpers, compose them here: load list (StoragePort/chain version) → add/remove address → rebuild Merkle root (merkle-editors) → persist. The facade contains no logic of its own beyond identity resolution and format sniffing.)

- [x] **Step 4: Switch the two proof sites**

- `src/api/assets/generate-node.ts`: construct a backend core at module init — `createArbeskCore({ ipfsRead: kuboAdapter, ipfsWrite: kuboAdapter })` where the kubo adapter maps `getJSON/getBytes/getRawBytes/write/writeJSON` onto the existing `src/api/storage/` kubo functions (create `src/api/asset-core-adapters.ts`); replace the direct `gltf-core` usage with the facade/core call equivalent.
- `frontend/src/js/services/asset-download.ts`: route its download through a frontend core built once in an init module (see Task 10 wiring) — for this task, construct with `createBrowserIpfsPorts()` + `createWorkerExecutor()`.

- [x] **Step 5: Run verification + commit**

Run: `npm test -- test/frontend/asset-core-facade.test.js && npm run test:api && npm run lint && npm run typecheck && npm run typecheck:frontend && npm test`
Expected: green.

```bash
git add -A
git commit -m "feat(asset-core): SDK facade (upload/download/editors/manifests) + backend & frontend proof sites"
```

---

### Task 10: Frontend app init wiring + kernels carved

**Files:**
- Create: `frontend/src/js/asset-core-init.ts` (one-call frontend bootstrap)
- Modify: the frontend entry that runs on Studio boot (verify: `frontend/src/js/index.ts` or app bootstrap) to call it
- Modify: `frontend/src/js/asset-core/kernels/index.ts` (real defaults)
- Modify: `asset-core/utils/encoding.ts`, `asset-core/gltf/gltf-core.ts` call sites to route through `getRuntime().kernels` where on the hot path (base64 in cache-aware-fetch/composer; glb magic check in glb-parser via kernel `isGLB`)
- Test: `test/frontend/asset-core-runtime.test.js` extended — default kernels actually encode/decode now.

**Interfaces:**
- Consumes: all adapters from Tasks 4/6/8.
- Produces: `initAssetCoreBrowser(): ArbeskCore` (frontend one-liner); real `defaultKernels` (base64 ↔ `utils/encoding.ts`, murmur3 ↔ `utils/hash.ts`, sha256 ↔ `crypto.subtle`, `isGLB` ↔ `gltf-core`/glb-parser magic check).

- [x] **Step 1: Extend the runtime test (failing)**

Append to `test/frontend/asset-core-runtime.test.js`:

```js
test("default kernels: base64 round-trips", () => {
  const rt = initRuntime({ ipfsRead: fakeRead, ipfsWrite: fakeWrite });
  const bytes = new Uint8Array([104, 101, 108, 108, 111]);
  expect(Array.from(rt.kernels.base64.decode(rt.kernels.base64.encode(bytes)))).toEqual(Array.from(bytes));
});

test("default kernels: murmur3 matches utils/hash", async () => {
  const { murmur3_128 } = await import("../../frontend/src/js/asset-core/utils/hash.ts");
  const rt = initRuntime({ ipfsRead: fakeRead, ipfsWrite: fakeWrite });
  const bytes = new Uint8Array([1, 2, 3]);
  expect(rt.kernels.hash.murmur3_128(bytes)).toBe(murmur3_128(bytes));
});
```

- [x] **Step 2: Run to verify it fails** — `npm test -- test/frontend/asset-core-runtime.test.js` → FAIL ("not wired yet").

- [x] **Step 3: Implement real kernels + browser init**

`kernels/index.ts` delegates to the moved utils; `asset-core-init.ts`:

```ts
import { createArbeskCore, type ArbeskCore } from "./asset-core/facade.ts";
import { createBrowserIpfsPorts } from "./ipfs/asset-core-adapter.ts";
import { createBrowserHashPort, createBrowserStoragePort, createBrowserChainPort } from "./blockchain/asset-core-adapter.ts";
import { createWorkerExecutor } from "./workers/worker-executor.ts";
import { getUploadCredentials } from "./services/api.ts";

let core: ArbeskCore | null = null;

/** Single frontend entry point — call once at Studio boot. */
export function initAssetCoreBrowser(): ArbeskCore {
  if (core) return core;
  const { read, write } = createBrowserIpfsPorts();
  core = createArbeskCore({
    ipfsRead: read,
    ipfsWrite: write,
    credentials: { getUploadCredentials },
    hash: createBrowserHashPort(),
    storage: createBrowserStoragePort(),
    chain: createBrowserChainPort(),
    executor: createWorkerExecutor(),
  });
  return core;
}
```

Call `initAssetCoreBrowser()` from the Studio bootstrap before any domain/gltf module use (find the exact boot file: `grep -rn "DOMContentLoaded\|Alpine.start" frontend/src/js/index.ts frontend/src/js/ui/alpine.ts`).

- [x] **Step 4: Run verification + commit**

Run: `npm test && npm run lint && npm run typecheck && npm run typecheck:frontend && npm run build:frontend`
Expected: green; build emits `dist/js/asset-core/**` (spot-check `ls frontend/dist/js/asset-core`).

```bash
git add -A
git commit -m "feat(asset-core): browser bootstrap wiring + real kernel defaults"
```

---

### Task 11: Benchmark harness + docs + full gate

**Files:**
- Create: `frontend/src/js/asset-core/bench/run.ts`
- Modify: root `package.json` (`bench:asset-core` script)
- Modify: `AGENTS.md` §3 layout (asset-core entry) + `frontend/src/js/asset-core/README.md` (short usage doc — create)
- Test: `test/frontend/asset-core-bench-smoke.test.js` (bench runs against one tiny fixture and returns numbers — keeps the harness from rotting).

**Interfaces:**
- Consumes: facade + memory adapters.
- Produces: `npm run bench:asset-core` → stdout table + `test-results/asset-core-bench.json`.

- [x] **Step 1: Write the failing bench smoke test**

```js
import { runBench } from "../../frontend/src/js/asset-core/bench/run.ts";

test("bench returns timing rows for the smallest fixture", async () => {
  const rows = await runBench({ fixtures: ["mock-gltf-assets/triangle.glb"], iterations: 1 });
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.op).toMatch(/compose|decompose|base64|hash/);
    expect(r.ms).toBeGreaterThanOrEqual(0);
  }
});
```

- [x] **Step 2: Run to verify it fails** — `npm test -- test/frontend/asset-core-bench-smoke.test.js` → module not found.

- [x] **Step 3: Implement the bench runner**

`bench/run.ts`: builds a core over `createMemoryIpfs()`; for each fixture GLB (default: all of `mock-gltf-assets/*.glb` sorted by size) times `decomposeGLB`, `compose`, a 1 MiB base64 encode/decode loop, and a murmur3 loop; `{ fixture, op, ms, bytes }` rows; CLI entry (`import.meta.url` main check) prints a table and writes the JSON artifact. Export `runBench({ fixtures, iterations })` for the smoke test.

Add to root `package.json` scripts: `"bench:asset-core": "node frontend/src/js/asset-core/bench/run.ts"`.

- [x] **Step 4: Docs**

`asset-core/README.md`: 30-line usage doc — createArbeskCore config, facade verbs, port list, boundary rule, bench command. `AGENTS.md` §3: add the `asset-core/` bullet (single-writer discipline unchanged; note the boundary lint rule and that `index.ts`/facade is the only sanctioned import surface).

- [x] **Step 5: Full gate**

Run: `npm run test:all && npm run bench:asset-core && npm run test:e2e -- --project=chromium`
Expected: `test:all` green; bench prints a table; E2E passes (save/publish, version history, manifest paths — repo §10 requirement for manifest-schema + save/publish changes). Dev stack must be running for E2E: `./scripts/start-dev.sh --setup-only`.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(asset-core): benchmark harness, README, AGENTS.md layout update"
```

---

## Self-Review Notes (completed)

- Spec coverage: §2 skeleton→T1; §3 module map→T2/T3/T5/T6/T8, ports→T1/T4/T6/T8; §4 facade→T9; §5 kernels/bench→T10/T11; §6 out-of-box→T5 deps, T8 viem, T7 zod; §7 testing→T1 boundary, T4 contracts, T11 gate; §8 migration order→T1–T11 (spec steps 2–3 split into T2/T3 + T5 for reviewable diffs; spec step 6 split into T6 + T10).
- Known follow-ups deliberately out of scope (spec §9): migrating the 29 direct `ipfs/` consumers to the facade; promoting to an npm workspace.
- Riskiest tasks: T5 (widest import surface) and T8 (domain single-writer discipline + editor port rewire) — both are pure relocations verified by the existing ~110-suite jest run plus typecheck; no logic changes except the documented port substitutions.
