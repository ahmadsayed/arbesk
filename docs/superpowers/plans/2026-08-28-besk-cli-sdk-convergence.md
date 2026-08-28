# besk CLI ↔ Studio/SDK Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the drift between the besk CLI and the Studio by moving shared collection-write logic into `@arbesk/asset-core`, collapsing the third copy of the named-collection token-ID derivation, and routing CLI IPFS writes through the backend upload-credential endpoint so testnet (Pinata) works.

**Architecture:** Three pure helpers move into `@arbesk/asset-core` (`buildCollectionManifest`, `applyCollectionMutation`, `resolveCompositeSourceCid`) and both consumers (Studio services, besk commands) call them. besk injects a viem-backed `HashPort` into `createArbeskCore` and uses the canonical `deriveNamedCollectionId` instead of its own copy. besk's `IpfsWritePort` mints an upload credential from `POST /api/v1/ipfs/upload-url` (session-gated) and uploads via asset-core's existing `uploadToIPFSWithCredential`, which already supports both `kubo-api` (local dev) and `presigned-put` (Pinata testnet) strategies.

**Tech Stack:** TypeScript (Node type-stripping, erasable syntax only), viem, Jest (ESM via `NODE_OPTIONS=--experimental-vm-modules`), Express backend.

**Spec:** the review conversation of 2026-08-28 (findings: frozen collection version chain from CLI writes, storage-shape sniffing heuristic living in the CLI, third token-ID derivation copy untested, CLI writes hard-coded to local Kubo). No separate spec doc — this plan is self-contained.

## Global Constraints

- Erasable TypeScript only in `packages/*` and `src/` (no enums/namespaces/parameter properties); type-only imports MUST use `import type`; relative imports inside a package carry explicit `.ts` extensions.
- `packages/*` boundary: no imports from `frontend/`, `src/api/`, `constants/`; no browser globals. New external capability → a port in `types.ts`, never an import. eslint enforces this.
- SDK consumption is by bare specifier with `.js`-suffixed subpaths, e.g. `@arbesk/asset-core/utils/collections.js`.
- Tests run with: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest <file>` (plain `npx jest` fails on ESM).
- The Studio refactor (Task 2) must be behavior-identical: `applyCollectionMutation` replicates exactly `version + 1` and `prev_asset_manifest_cid = currentCid` from `frontend/src/js/services/asset-delete.ts:187-189`.
- Commit style: conventional commits, lowercase scope, e.g. `refactor(asset-core): ...`.
- Do NOT deduplicate the Merkle primitives between `@arbesk/wallet` and `@arbesk/asset-core` — that duplication is intentional and pinned by `test/merkle-parity.test.js`.

---

### Task 1: asset-core collection-write helpers

**Files:**
- Modify: `packages/asset-core/src/utils/collections.ts` (append two functions)
- Modify: `packages/asset-core/src/catalog/index.ts` (append one function)
- Test: `test/asset-core-collection-write.test.js` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (later tasks rely on these exact signatures):
  - `buildCollectionManifest(name: string): Record<string, any>` — from `@arbesk/asset-core/utils/collections.js`
  - `applyCollectionMutation(collection: Record<string, any>, currentCid: string, mutate: (draft: Record<string, any>) => void): Record<string, any>` — same module
  - `resolveCompositeSourceCid(manifest: Record<string, any>): string | null` — from `@arbesk/asset-core/catalog/index.js` (also re-export from `@arbesk/asset-core/catalog.js` if that barrel exists — check; otherwise the deep path is fine)

- [ ] **Step 1: Write the failing test**

Create `test/asset-core-collection-write.test.js`:

```js
/**
 * Collection-write helpers: the single canonical implementation of the
 * collection-manifest literal, the version-chain mutation (version bump +
 * prev link), and the composite-source sniff used by Studio and the besk CLI.
 */
import {
  buildCollectionManifest,
  applyCollectionMutation,
} from "@arbesk/asset-core/utils/collections.js";
import { resolveCompositeSourceCid } from "@arbesk/asset-core/catalog/index.js";

describe("buildCollectionManifest", () => {
  test("produces the exact v1 collection literal", () => {
    const m = buildCollectionManifest("Studio Room");
    expect(m).toEqual({
      type: "collection",
      name: "Studio Room",
      asset_id: expect.stringMatching(/^collection_\d+$/),
      version: 1,
      timestamp: expect.any(Number),
      assets: {},
      prev_asset_manifest_cid: null,
    });
  });
});

describe("applyCollectionMutation", () => {
  const base = {
    type: "collection",
    name: "c",
    asset_id: "collection_1",
    version: 3,
    timestamp: 1,
    assets: { a: "cidA" },
    prev_asset_manifest_cid: "cidPrev",
  };

  test("bumps version, links prev cid, applies the mutation, does not mutate the input", () => {
    const next = applyCollectionMutation(base, "bafyCurrent", (draft) => {
      draft.assets.b = "cidB";
    });
    expect(next.version).toBe(4);
    expect(next.prev_asset_manifest_cid).toBe("bafyCurrent");
    expect(next.assets).toEqual({ a: "cidA", b: "cidB" });
    // input untouched
    expect(base.version).toBe(3);
    expect(base.assets).toEqual({ a: "cidA" });
  });

  test("treats a missing version as 0", () => {
    const noVersion = { type: "collection", assets: {} };
    const next = applyCollectionMutation(noVersion, "bafyC", () => {});
    expect(next.version).toBe(1);
  });
});

describe("resolveCompositeSourceCid", () => {
  test("returns the root node source cid for a wrapping asset manifest", () => {
    const m = { type: "asset", scene: { nodes: [{ source: { cid: "bafyComposite" } }] } };
    expect(resolveCompositeSourceCid(m)).toBe("bafyComposite");
  });

  test("returns null when the manifest IS the composite (has glTF markers)", () => {
    expect(resolveCompositeSourceCid({ nodes: [], meshes: [] })).toBeNull();
    expect(resolveCompositeSourceCid({ arbesk_format: "3mf" })).toBeNull();
    expect(resolveCompositeSourceCid({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/asset-core-collection-write.test.js`
Expected: FAIL — module exports do not exist.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/asset-core/src/utils/collections.ts`:

```ts
/**
 * Build the canonical v1 collection manifest literal. The ONE place this
 * shape is constructed — Studio (library-ops) and the besk CLI both call it.
 */
export function buildCollectionManifest(name: string): Record<string, any> {
  return {
    type: "collection",
    name,
    asset_id: `collection_${Date.now()}`,
    version: 1,
    timestamp: Date.now(),
    assets: {},
    prev_asset_manifest_cid: null,
  };
}

/**
 * Apply a mutation to a collection manifest following the immutable-chain
 * convention: the mutation runs on a shallow copy, `version` is bumped, and
 * `prev_asset_manifest_cid` links back to the manifest this one replaces.
 *
 * Mirrors the Studio's updateCollectionManifest (asset-delete.ts) exactly —
 * every collection write (Studio or CLI) MUST go through this so the chain
 * stays walkable.
 *
 * @returns the new manifest (input is not mutated)
 */
export function applyCollectionMutation(
  collection: Record<string, any>,
  currentCid: string,
  mutate: (draft: Record<string, any>) => void
): Record<string, any> {
  const next = { ...collection, assets: { ...(collection.assets ?? {}) } };
  mutate(next);
  next.version = (next.version || 0) + 1;
  next.prev_asset_manifest_cid = currentCid;
  return next;
}
```

Append to `packages/asset-core/src/catalog/index.ts`:

```ts
/**
 * A collection asset may be stored either as a full asset manifest
 * (type:"asset" with scene.nodes[0].source.cid → the composite) or, for CLI
 * uploads, as the composite glTF/3MF JSON directly. Return the composite
 * source CID when the manifest wraps one, else null (the manifest IS the
 * composite).
 */
export function resolveCompositeSourceCid(manifest: Record<string, any>): string | null {
  const src = manifest?.scene?.nodes?.[0]?.source?.cid;
  if (src && !manifest.buffers && !manifest.meshes && !manifest.arbesk_format) return src;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/asset-core-collection-write.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/asset-core/src/utils/collections.ts packages/asset-core/src/catalog/index.ts test/asset-core-collection-write.test.js
git commit -m "feat(asset-core): canonical collection-write helpers (build/mutate/source-cid)"
```

---

### Task 2: Studio adopts the shared helpers (behavior-identical refactor)

**Files:**
- Modify: `frontend/src/js/services/asset-delete.ts:177-194` (the `updateCollectionManifest` body)
- Modify: `frontend/src/js/services/library-ops.ts:83-91` (the collection-manifest literal in `createNamedCollection`)

**Interfaces:**
- Consumes: `buildCollectionManifest`, `applyCollectionMutation` from Task 1, imported as `import { buildCollectionManifest, applyCollectionMutation } from "@arbesk/asset-core/utils/collections.js";` (library-ops already imports from that subpath; asset-delete does not yet).
- Produces: unchanged public behavior — `updateCollectionManifest(tokenId, mutate, options)` and `createNamedCollection(name, { onPending })` signatures stay identical.

- [ ] **Step 1: Run the guard tests BEFORE the change (baseline)**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/ --silent 2>&1 | tail -5`
Expected: all PASS. Record the count.

- [ ] **Step 2: Refactor asset-delete.ts**

In `frontend/src/js/services/asset-delete.ts`, add the import (top of file, grouped with the other `@arbesk/asset-core` imports — check the existing import block and merge):

```ts
import { applyCollectionMutation } from "@arbesk/asset-core/utils/collections.js";
```

Replace lines 187-189:

```ts
  const newCollection = mutate({ ...collection });
  newCollection.version = (newCollection.version || 0) + 1;
  newCollection.prev_asset_manifest_cid = currentCid;
```

with:

```ts
  const newCollection = applyCollectionMutation(collection, currentCid, mutate);
```

Note: `applyCollectionMutation` already shallow-copies `assets`, so a `mutate` that reassigns `col.assets = { ...col.assets }` still works unchanged.

- [ ] **Step 3: Refactor library-ops.ts**

In `frontend/src/js/services/library-ops.ts`, extend the existing import from `@arbesk/asset-core/utils/collections.js` (line 23-26) to include `buildCollectionManifest`, then replace the literal (lines 83-91):

```ts
  const collectionManifest = {
    type: "collection",
    name: trimmed,
    asset_id: `collection_${Date.now()}`,
    version: 1,
    timestamp: Date.now(),
    assets: {},
    prev_asset_manifest_cid: null,
  };
```

with:

```ts
  const collectionManifest = buildCollectionManifest(trimmed);
```

The next statement reads `collectionManifest.asset_id` — unchanged, the helper sets it.

- [ ] **Step 4: Re-run the guard tests + typecheck**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/frontend/ --silent 2>&1 | tail -5`
Expected: same pass count as baseline.
Run: `npm run typecheck:frontend 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/services/asset-delete.ts frontend/src/js/services/library-ops.ts
git commit -m "refactor(frontend): route collection writes through asset-core shared helpers"
```

---

### Task 3: besk uses the canonical token-ID derivation

**Files:**
- Modify: `packages/besk/src/adapters.ts` (add `createHashPort`)
- Modify: `packages/besk/src/catalog.ts` (`getCore` config gains `hash`)
- Modify: `packages/besk/src/collections.ts` (delete `deriveNamedCollectionTokenId`, use the asset-core helper)
- Test: `test/besk-collections.test.js` (rewrite)

**Interfaces:**
- Consumes: `deriveNamedCollectionId` from `@arbesk/asset-core/utils/collections.js` (existing, returns hex string | null via the runtime HashPort).
- Produces: `createHashPort(): HashPort` in `packages/besk/src/adapters.ts`; `createCollection(session, name)` in besk keeps its signature.

- [ ] **Step 1: Rewrite the failing test**

Replace the whole of `test/besk-collections.test.js`:

```js
/**
 * Named-collection token-ID parity: the CLI derives IDs through the canonical
 * asset-core helper (HashPort-backed). This pins that derivation against raw
 * viem (the contract's expectation) so the two can never drift apart.
 */
import { jest } from "@jest/globals";
import { encodePacked, keccak256 } from "viem/utils";
import { createHashPort } from "../packages/besk/src/adapters.ts";

const { initRuntime, _resetRuntimeForTesting } = await import(
  "@arbesk/asset-core/runtime.js"
);
const { deriveNamedCollectionId } = await import(
  "@arbesk/asset-core/utils/collections.js"
);

const ipfsStubs = () => ({
  ipfsRead: { getJSON: jest.fn(), getBytes: jest.fn(), getRawBytes: jest.fn() },
  ipfsWrite: { write: jest.fn(), writeJSON: jest.fn() },
});

beforeEach(() => {
  initRuntime({ ...ipfsStubs(), hash: createHashPort() });
});

afterEach(() => _resetRuntimeForTesting());

describe("named-collection token IDs (canonical path)", () => {
  const address = "0x407EDfCFd16a5623012BbB778BD47A2bf861ed40";

  test("matches the contract's keccak256(abi.encodePacked(address, string))", () => {
    const expectedHex = keccak256(
      encodePacked(["address", "string"], [address.toLowerCase(), "test"])
    );
    const hex = deriveNamedCollectionId(address, "test");
    expect(hex).toBe(expectedHex);
    // token IDs are handled as uint256 decimal strings, not hex.
    expect(BigInt(hex).toString()).toMatch(/^\d+$/);
  });

  test("is case-insensitive on the address (checksum-exempt, like Web3.soliditySha3)", () => {
    const lower = deriveNamedCollectionId(address.toLowerCase(), "Studio Room");
    const mixed = deriveNamedCollectionId(address, "Studio Room");
    expect(lower).toBe(mixed);
  });

  test("differs across names (no collision for distinct names)", () => {
    const a = deriveNamedCollectionId(address, "living room");
    const b = deriveNamedCollectionId(address, "bedroom");
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/besk-collections.test.js`
Expected: FAIL — `createHashPort` is not exported from adapters.

- [ ] **Step 3: Implement**

In `packages/besk/src/adapters.ts`, add (the `viem/utils` import line already exists for `createPublicClient`… check: adapters.ts imports `createPublicClient, http` from `"viem"` — add `import { encodePacked, keccak256 } from "viem/utils";`):

```ts
/**
 * viem-backed HashPort. Address values are lowercased before packing so the
 * output is byte-identical to Web3.utils.soliditySha3 (checksum-exempt) and to
 * packages/wallet/src/merkle.ts — the contract's expectation.
 */
export function createHashPort() {
  return {
    soliditySha3: (...args: any[]) =>
      keccak256(
        encodePacked(
          args.map((a: any) => a.type) as any,
          args.map((a: any) =>
            a.type === "address" ? String(a.value).toLowerCase() : a.value
          ) as any,
        ),
      ),
    keccak256: (data: any) => keccak256(data),
  };
}
```

In `packages/besk/src/catalog.ts` `getCore()`, add `hash: createHashPort()` to the `createArbeskCore({ ... })` config and import it from `./adapters.ts`.

In `packages/besk/src/collections.ts`:
- Delete `deriveNamedCollectionTokenId` and the now-unused `encodePacked`/`keccak256` import.
- Add `import { deriveNamedCollectionId } from "@arbesk/asset-core/utils/collections.js";` and `import { getCore } from "./catalog.ts";` (check for an import cycle: catalog.ts does not import collections.ts — safe).
- In `createCollection`, replace:

```ts
  const tokenId = deriveNamedCollectionTokenId(session.address, trimmed);
```

with:

```ts
  await getCore(); // installs the runtime (HashPort) the derivation reads
  const hex = deriveNamedCollectionId(session.address, trimmed);
  if (!hex) throw new Error("Cannot derive collection token id (no hash port)");
  const tokenId = BigInt(hex).toString();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/besk-collections.test.js test/merkle-parity.test.js`
Expected: PASS. (merkle-parity is the canary that the runtime juggling didn't break other suites.)

- [ ] **Step 5: Commit**

```bash
git add packages/besk/src/adapters.ts packages/besk/src/catalog.ts packages/besk/src/collections.ts test/besk-collections.test.js
git commit -m "refactor(besk): derive named-collection ids via the canonical asset-core helper"
```

---

### Task 4: besk IPFS writes go through the backend upload credential

**Files:**
- Modify: `packages/besk/src/adapters.ts` (replace `createIpfsWritePort`, add `mintUploadCredential`)
- Modify: `packages/besk/src/config.ts` (remove `IPFS_API`)
- Test: `test/besk-ipfs-write.test.js` (create)

**Interfaces:**
- Consumes: `uploadToIPFSWithCredential` from `@arbesk/asset-core/storage/ipfs/upload-with-credential.js` (existing; wildcard export `"./*"` confirmed in `packages/asset-core/package.json`); `loadSession` from `./session.ts`.
- Produces: unchanged `createIpfsWritePort()` shape (`write`, `writeJSON`); `mintUploadCredential(): Promise<UploadCredential>` exported for tests.

- [ ] **Step 1: Write the failing test**

Create `test/besk-ipfs-write.test.js`:

```js
/**
 * besk IPFS write port: uploads go through a backend-minted upload credential
 * (POST /api/v1/ipfs/upload-url, session-gated) instead of a hard-coded local
 * Kubo — this is what makes the CLI work on testnet (Pinata presigned-put).
 */
import { jest } from "@jest/globals";

const SESSION = {
  token: "tok123",
  expiresAt: Date.now() + 3600_000,
  address: "0xabc",
  email: "a@b.c",
  authMethod: "siwe",
};

jest.unstable_mockModule("../packages/besk/src/session.ts", () => ({
  loadSession: jest.fn(() => SESSION),
}));

const { createIpfsWritePort } = await import("../packages/besk/src/adapters.ts");

describe("besk ipfs write port (credential-based)", () => {
  afterEach(() => jest.restoreAllMocks());

  test("mints a credential with the session token, then uploads via the kubo-api strategy", async () => {
    const calls = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      calls.push({ url: String(url), method: opts?.method, headers: opts?.headers });
      if (String(url).includes("/api/v1/ipfs/upload-url")) {
        return new Response(JSON.stringify({
          strategy: "kubo-api",
          apiUrl: "http://127.0.0.1:5001",
          reusable: true,
        }));
      }
      if (String(url).includes("/api/v0/add")) {
        return new Response(JSON.stringify({ Hash: "bafyX", Size: 10 }));
      }
      return new Response("{}", { status: 200 }); // pin/add
    });

    const port = createIpfsWritePort();
    const cid = await port.writeJSON({ type: "collection", assets: {} });

    expect(cid).toBe("bafyX");
    const mint = calls.find((c) => c.url.includes("/upload-url"));
    expect(mint.headers.Authorization).toBe("Session tok123");
  });

  test("reuses a reusable kubo credential (one mint for two writes)", async () => {
    const calls = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).includes("/upload-url")) {
        return new Response(JSON.stringify({ strategy: "kubo-api", apiUrl: "http://127.0.0.1:5001", reusable: true }));
      }
      if (String(url).includes("/api/v0/add")) return new Response(JSON.stringify({ Hash: "bafyY" }));
      return new Response("{}");
    });

    const port = createIpfsWritePort();
    await port.writeJSON({ a: 1 });
    await port.writeJSON({ a: 2 });

    expect(calls.filter((u) => u.includes("/upload-url"))).toHaveLength(1);
  });

  test("uploads each write against a fresh presigned-put credential (single-use)", async () => {
    const calls = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).includes("/upload-url")) {
        return new Response(JSON.stringify({ strategy: "presigned-put", url: "https://pinata.example/signed/" + calls.length }));
      }
      return new Response(JSON.stringify({ data: { cid: "bafyZ" } }));
    });

    const port = createIpfsWritePort();
    await port.writeJSON({ a: 1 });
    await port.writeJSON({ a: 2 });

    expect(calls.filter((u) => u.includes("/upload-url"))).toHaveLength(2);
    expect(calls.filter((u) => u.includes("pinata.example"))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/besk-ipfs-write.test.js`
Expected: FAIL — the current port never calls `/upload-url` (it POSTs straight to Kubo), so the first assertion on `Authorization` fails.

- [ ] **Step 3: Implement**

In `packages/besk/src/adapters.ts`:
- Add imports: `import { uploadToIPFSWithCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";` and `import type { UploadCredential } from "@arbesk/asset-core/storage/ipfs/upload-with-credential.js";` and `import { loadSession } from "./session.ts";`.
- Delete `kuboAdd` and the `IPFS_API` import.
- Replace `createIpfsWritePort` with:

```ts
/** Mint one upload credential from the backend with the CLI session token. */
export async function mintUploadCredential(): Promise<UploadCredential> {
  const s = loadSession();
  if (!s) throw new Error("Not logged in. Run `besk login <email>`.");
  const res = await fetch(BACKEND_URL + "/api/v1/ipfs/upload-url", {
    method: "POST",
    headers: { Authorization: "Session " + s.token },
  });
  if (!res.ok) throw new Error("upload credential mint failed: " + res.status);
  return (await res.json()) as UploadCredential;
}

/**
 * Write port: every upload goes through a backend-minted credential, so the
 * same code path serves local dev (kubo-api strategy) and testnet (Pinata
 * presigned-put). Presigned URLs are single-use — only a credential that
 * declares itself reusable (kubo) is cached.
 */
export function createIpfsWritePort() {
  let reusable: UploadCredential | null = null;
  const credentialFor = async (): Promise<UploadCredential> => {
    if (reusable) return reusable;
    const c = await mintUploadCredential();
    if (c.strategy === "kubo-api" && c.reusable !== false) reusable = c;
    return c;
  };
  return {
    write: async (data: unknown, filename?: string, _credential?: unknown, options?: { compress?: boolean }) => {
      let bytes = await toBytes(data);
      if (options?.compress !== false) bytes = new Uint8Array(gzipSync(bytes));
      return uploadToIPFSWithCredential(bytes, (filename ?? "blob") + ".gz", await credentialFor());
    },
    writeJSON: async (json: Record<string, unknown>) => {
      const bytes = new Uint8Array(gzipSync(Buffer.from(JSON.stringify(json))));
      return uploadToIPFSWithCredential(bytes, "manifest.json.gz", await credentialFor());
    },
  };
}
```

In `packages/besk/src/config.ts`, remove the `IPFS_API` line. Grep for other `IPFS_API` users first (`Grep "IPFS_API" packages/besk`) — adapters.ts was the only consumer at plan time.

- [ ] **Step 4: Run test to verify it passes**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/besk-ipfs-write.test.js test/besk-collections.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/besk/src/adapters.ts packages/besk/src/config.ts test/besk-ipfs-write.test.js
git commit -m "feat(besk): upload through backend-minted credentials (testnet-capable writes)"
```

---

### Task 5: besk commands adopt the shared mutation + source resolver

**Files:**
- Modify: `packages/besk/src/catalog.ts` (add `updateCollection`)
- Modify: `packages/besk/src/cli.ts` (cmdUpload/cmdDelete/cmdRename/cmdInfo/cmdDownload)
- Test: `test/besk-catalog-write.test.js` (create)

**Interfaces:**
- Consumes: `applyCollectionMutation` (Task 1), `resolveCompositeSourceCid` (Task 1), `relay` from `./relay.ts` (existing).
- Produces: `updateCollection(session: Session, tokenId: string, mutate: (draft: Record<string, any>) => void): Promise<string>` in `packages/besk/src/catalog.ts` — the one write path for collection mutations from the CLI; returns the new collection CID.

- [ ] **Step 1: Write the failing test**

Create `test/besk-catalog-write.test.js`:

```js
/**
 * besk updateCollection: every CLI collection write (upload/delete/rename)
 * goes through applyCollectionMutation — version bumps and prev links, or the
 * on-chain collection history chain silently breaks.
 */
import { jest } from "@jest/globals";

const relayMock = jest.fn(async () => ({}));
jest.unstable_mockModule("../packages/besk/src/relay.ts", () => ({ relay: relayMock }));

const written = [];
jest.unstable_mockModule("../packages/besk/src/adapters.ts", () => ({
  getBackendConfig: jest.fn(async () => ({ contractAddress: "0x0", ipfsGatewayUrl: "http://gw", networkConfigs: {} })),
  createCollectionReadPort: jest.fn(() => ({
    tokenURI: jest.fn(async () => "bafyCurrentCollection"),
    listTokens: jest.fn(async () => []),
  })),
  createIpfsReadPort: jest.fn(() => ({
    getJSON: jest.fn(async () => ({
      type: "collection", name: "c", asset_id: "collection_1",
      version: 2, timestamp: 1, assets: { a: "cidA", b: "cidB" },
      prev_asset_manifest_cid: "bafyOlder",
    })),
    getBytes: jest.fn(), getRawBytes: jest.fn(),
  })),
  createIpfsWritePort: jest.fn(() => ({
    write: jest.fn(),
    writeJSON: jest.fn(async (json) => { written.push(json); return "bafyNewCollection"; }),
  })),
  createHashPort: jest.fn(() => ({ soliditySha3: jest.fn(), keccak256: jest.fn() })),
}));

const { updateCollection } = await import("../packages/besk/src/catalog.ts");

const SESSION = { token: "t", expiresAt: Date.now() + 3600_000, address: "0xabc", email: "a@b.c", authMethod: "siwe" };

describe("besk updateCollection", () => {
  test("bumps version, links prev cid, relays updateUri, returns the new cid", async () => {
    const newCid = await updateCollection(SESSION, "42", (draft) => {
      delete draft.assets.b;
    });

    expect(newCid).toBe("bafyNewCollection");
    expect(written).toHaveLength(1);
    expect(written[0].version).toBe(3);
    expect(written[0].prev_asset_manifest_cid).toBe("bafyCurrentCollection");
    expect(written[0].assets).toEqual({ a: "cidA" });
    expect(relayMock).toHaveBeenCalledWith(SESSION, "updateUri", "42", { newUri: "bafyNewCollection", proof: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/besk-catalog-write.test.js`
Expected: FAIL — `updateCollection` is not exported.

- [ ] **Step 3: Implement**

In `packages/besk/src/catalog.ts`, add imports `applyCollectionMutation` from `@arbesk/asset-core/utils/collections.js`, `relay` from `./relay.ts`, `import type { Session } from "./session.ts";`, then append:

```ts
/**
 * The one CLI collection-write path: read → mutate (with version bump + prev
 * link, via the canonical asset-core helper) → write → relay updateUri →
 * invalidate the catalog cache. Returns the new collection CID.
 */
export async function updateCollection(
  session: Session,
  tokenId: string,
  mutate: (draft: Record<string, any>) => void,
): Promise<string> {
  const { cid, manifest } = await getCollectionManifest(tokenId);
  const next = applyCollectionMutation(manifest, cid, mutate);
  const newCid = await writeManifest(next);
  await relay(session, "updateUri", tokenId, { newUri: newCid, proof: [] });
  clearCatalogCache();
  return newCid;
}
```

In `packages/besk/src/cli.ts`:
- Delete the local `composeSourceCid` function; import `resolveCompositeSourceCid` from `@arbesk/asset-core/catalog/index.js` and rename the three call sites (`cmdInfo`, `cmdDownload`).
- Add `updateCollection` to the `./catalog.ts` import list.
- `cmdDelete`: replace the block from `const { manifest } = await getCollectionManifest(tokenId);` through `clearCatalogCache();` with:

```ts
  await updateCollection(s, tokenId, (draft) => {
    delete draft.assets[hit.assetID];
  });
```

- `cmdRename`: replace from `const { manifest } = await getCollectionManifest(tokenId);` through `clearCatalogCache();` with:

```ts
  await updateCollection(s, tokenId, (draft) => {
    draft.assets[hit.assetID] = newAssetCid;
  });
```

(The preceding lines that rewrite the asset manifest with the new name stay as-is.)
- `cmdUpload`: replace from `const { manifest } = await getCollectionManifest(tokenId);` through `clearCatalogCache();` with:

```ts
  await updateCollection(s, tokenId, (draft) => {
    draft.assets[assetId] = compositeCid;
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/besk-catalog-write.test.js test/besk-collections.test.js test/asset-core-collection-write.test.js test/besk-ipfs-write.test.js test/api/wallet-relay.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/besk/src/catalog.ts packages/besk/src/cli.ts test/besk-catalog-write.test.js
git commit -m "refactor(besk): route collection writes through the canonical mutation helper"
```

---

### Task 6: Docs + full verification

**Files:**
- Modify: `packages/AGENTS.md` (one line: besk is the CLI consumer, not an SDK)
- Modify: `packages/asset-core/AGENTS.md` (catalog module now has the write helpers + `resolveCompositeSourceCid`)
- Modify: `docs/ASSET_CORE_SDK.md` (if it documents the catalog API — check § facade API; add the three helpers)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: accurate docs.

- [ ] **Step 1: Update packages/AGENTS.md**

Below the package table, add:

```markdown
`@arbesk/besk` (`packages/besk/`) is the CLI **consumer** of these SDKs (not an
SDK itself): it composes `createArbeskCore` with its own Node adapters and
routes all on-chain writes through the backend wallet relay.
```

- [ ] **Step 2: Update packages/asset-core/AGENTS.md**

In the Structure section's `catalog/` mention (or the Public API section), note that catalog now also carries the collection-write helpers (`buildCollectionManifest`/`applyCollectionMutation` in `utils/collections.ts`, `resolveCompositeSourceCid` in `catalog/index.ts`) and that **every collection-manifest write — Studio or CLI — must go through `applyCollectionMutation`** so the version chain stays walkable.

- [ ] **Step 3: Update docs/ASSET_CORE_SDK.md**

Only if it documents the catalog/facade API surface (grep for `listCollections`); add the three helpers in the same style. Skip if the doc doesn't cover catalog.

- [ ] **Step 4: Full verification**

Run, in order:

```bash
npm run lint
npm run typecheck
npm run typecheck:frontend
IPFS_BACKEND=kubo NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --silent 2>&1 | tail -6
```

Expected: lint clean, no type errors, full jest suite green (~110 suites — compare against the pre-change baseline; the only intentional test changes are the rewritten `test/besk-collections.test.js` and the three new suites).

This plan touches the Studio save/publish helpers (`asset-delete.ts`, `library-ops.ts`), so per AGENTS.md §10 also run E2E before merging (requires the dev stack: `./scripts/start-dev.sh --setup-only` first):

```bash
npm run test:e2e -- --project=chromium
```

- [ ] **Step 5: Commit**

```bash
git add packages/AGENTS.md packages/asset-core/AGENTS.md docs/ASSET_CORE_SDK.md
git commit -m "docs: besk as SDK consumer; canonical collection-write helpers"
```

---

## Self-Review Notes

- **Spec coverage:** all four findings from the review are covered — frozen version chain (Tasks 1+5), sniffing heuristic in the CLI (Tasks 1+5), third token-ID derivation copy (Task 3), Kubo-only writes (Task 4). Out of scope (documented MVP limitations, not bugs): no `updateEditors`/`burn` CLI commands, no unpin-on-delete, `proof: []` (owner-only writes).
- **Type consistency:** `applyCollectionMutation(collection, currentCid, mutate)` and `resolveCompositeSourceCid(manifest)` use the same names in Tasks 1, 2, and 5; `updateCollection(session, tokenId, mutate)` matches between its Step-1 test and Step-3 implementation in Task 5; `mintUploadCredential`/`createHashPort` names match between tests and implementations.
- **Known risk:** Task 4 Step 3 assumes the backend returns `strategy: "kubo-api"` with `reusable` in local-dev mode — the executor should read `src/api/storage/` `mintUploadCredential()` to confirm the exact credential shape before finalizing, and adjust the cache condition to match reality.
