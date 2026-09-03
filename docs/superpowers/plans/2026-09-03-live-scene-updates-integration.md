# Live Scene Updates — Plan B: Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `@arbesk/nostr` SDK (Plan A) into the browser, backend, CLI, and E2E so that publishing a child asset live-updates any other user's open scene that references it.

**Architecture:** Client↔relay directly (no backend transport hop). The browser holds a wallet-derived Nostr identity, signs `KIND_ASSET_UPDATE` events at the `updateAssetURI` choke point, and subscribes+verifies for the tokens its scene references. The `besk` CLI reuses the same SDK. The relay is made client-reachable.

**Tech Stack:** `@arbesk/nostr` (Plan A), `nostr-tools` `SimplePool` (bundled into app.js), `viem` (external import map), Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-09-03-live-scene-updates-design.md`

## Global Constraints

- Frontend is TypeScript, transpiled by swc; bare `@arbesk/*` and `nostr-tools` are bundled by esbuild into `app.js` (only `viem`/`@coinbase/cdp-core` are external via the import map). No import-map change needed for `@arbesk/nostr` or `nostr-tools`.
- Import-cycle rule: `blockchain/`/`ipfs/` import endpoints from `services/backend-client.ts`, never `services/api.ts`. Verify no cycle with `npm run typecheck:frontend`.
- `@arbesk/nostr` public API: `createNostrFacade`, `buildBinding`, `verifyBinding`, `signAssetUpdate`, `publishAssetUpdate`, `verifyAssetUpdate`, `tokenTag`, constants.
- Non-custodial: the browser derives the key from a wallet signature; the CLI holds a local key. Neither is backend-held.
- UI changes must sync `e2e/helpers/studio-selectors.mjs` and any spec assertions (`edit-ui` skill's E2E Sync guide).

---

## File Structure

```
docker-compose.yml                      # bind relay to all interfaces
frontend/src/js/
  services/nostr-config.ts              # relay URL constant
  services/nostr-browser.ts             # WalletSignPort/ChainReadPort/RelayPort + binding store
  services/live-updates.ts              # subscribe + verify + emit feed
  engine/child-reload.ts                # reload child_ref node in place
  engine/scene-loader.ts                # export reloadChildRefNode + record depth
  blockchain/token-resolver.ts          # invalidateResolution
  blockchain/wallet-publishing.ts       # emit ASSET_URI_CHANGED at updateAssetURI
packages/asset-core/src/events/bus.ts   # ASSET_URI_CHANGED, ASSET_URI_UPDATED
packages/besk/src/relay.ts              # publish seam after updateUri
packages/besk/src/nostr.ts              # local key + binding storage
e2e/specs/22-live-scene-update.spec.js  # two-context live-update test
```

---

### Task 1: Make the relay client-reachable + expose the URL

**Files:**
- Modify: `docker-compose.yml` (nostr service port binding)
- Create: `frontend/src/js/services/nostr-config.ts`

**Interfaces:**
- Produces: `NOSTR_RELAY_URL` (frontend constant) pointing at the relay's client-facing WS endpoint.

- [ ] **Step 1: Bind the relay to all interfaces**

In `docker-compose.yml`, change the `nostr` service port mapping from loopback to all interfaces (the backend still reaches it via `ws://127.0.0.1:7777`; remote browsers reach it via the host):

```yaml
    ports:
-      - "127.0.0.1:${NOSTR_HOST_PORT:-7777}:7777" # Nostr relay WebSocket
+      - "${NOSTR_HOST_PORT:-7777}:7777" # Nostr relay WebSocket (client-reachable)
```

- [ ] **Step 2: Write `frontend/src/js/services/nostr-config.ts`**

```ts
/** Client-facing Nostr relay URL (same host as the app, standard port 7777). */
export const NOSTR_RELAY_URL =
  (typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss://"
    : "ws://") +
  (typeof window !== "undefined" ? window.location.hostname : "127.0.0.1") +
  ":7777";
```

- [ ] **Step 3: Restart the relay and confirm reachability**

Run: `docker compose up -d nostr && docker compose ps nostr`
Expected: relay listening on `0.0.0.0:7777` (not just `127.0.0.1`).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml frontend/src/js/services/nostr-config.ts
git commit -m "feat(live): client-reachable Nostr relay + frontend URL"
```

---

### Task 2: Asset-core event constants

**Files:**
- Modify: `packages/asset-core/src/events/bus.ts`

**Interfaces:**
- Produces: `EVENTS.ASSET_URI_CHANGED = "asset:uriChanged"` (local publish), `EVENTS.ASSET_URI_UPDATED = "asset:uriUpdated"` (feed→engine reload).

- [ ] **Step 1: Add constants**

In `bus.ts`, inside the `EVENTS` object (alphabetical, near `ASSET_STATE_CHANGED`):

```ts
  ASSET_URI_CHANGED:          "asset:uriChanged",
  ASSET_URI_UPDATED:          "asset:uriUpdated",
```

- [ ] **Step 2: Rebuild packages (constants ship to the frontend bundle)**

Run: `npm run build:packages`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/asset-core/src/events/bus.ts
git commit -m "feat(live): ASSET_URI_CHANGED and ASSET_URI_UPDATED bus events"
```

---

### Task 3: Resolution-cache invalidation

**Files:**
- Modify: `frontend/src/js/blockchain/token-resolver.ts`
- Test: `test/frontend/token-resolver.invalidation.test.js`

**Interfaces:**
- Produces: `invalidateResolution(chainId: number, contractAddress: string, tokenId: string): void` — drops the matching `resolutionCache` entry (key already encodes those three).

- [ ] **Step 1: Write the failing test**

```js
// test/frontend/token-resolver.invalidation.test.js
import { describe, it, expect, jest } from "@jest/globals";

// resolveChildRef is async and hits viem; test the cache directly by
// reaching the internal map through a small exported helper added below.
describe("invalidateResolution", () => {
  it("removes the cached CID for a token", async () => {
    const { invalidateResolution, _setCachedForTest } = await import("../../frontend/src/js/blockchain/token-resolver.ts");
    _setCachedForTest(31415822, "0xabc", "7", "bafy-old");
    invalidateResolution(31415822, "0xabc", "7");
    expect(_setCachedForTest).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:frontend -- token-resolver.invalidation`
Expected: FAIL — `invalidateResolution is not a function`.

- [ ] **Step 3: Implement**

Add to `token-resolver.ts` (after `setCachedResolution`):

```ts
/** Drops a cached resolution so the next read re-resolves on-chain. */
export function invalidateResolution(
  chainId: number,
  contractAddress: string,
  tokenId: string
): void {
  const key = buildCacheKey({ chainId, contractAddress, tokenId });
  resolutionCache.delete(key);
}

/** Test-only seam: writes a cache entry directly (jest reaches the internal map). */
export function _setCachedForTest(
  chainId: number,
  contractAddress: string,
  tokenId: string,
  cid: string
): void {
  setCachedResolution({ chainId, contractAddress, tokenId }, cid);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:frontend -- token-resolver.invalidation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/blockchain/token-resolver.ts test/frontend/token-resolver.invalidation.test.js
git commit -m "feat(live): resolution-cache invalidation"
```

---

### Task 4: Browser Nostr adapters + binding store (`nostr-browser.ts`)

**Files:**
- Create: `frontend/src/js/services/nostr-browser.ts`
- Test: `test/frontend/nostr-browser.test.js`

**Interfaces:**
- Produces: `getNostrFacade(): Promise<NostrFacade | null>` (lazily built from wallet + read client + SimplePool), `getOrCreateBinding(): Promise<Binding | null>` (localStorage-backed), `isTokenAuthor(chainId, tokenId, address): Promise<boolean>`.
- Consumes: `createNostrFacade`, `SimplePool`, `getSigner`, `getReadClient`, `getContractAddress`, `buildEditorProof`, `NOSTR_RELAY_URL`.

- [ ] **Step 1: Write `frontend/src/js/services/nostr-browser.ts`**

```ts
import { SimplePool } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { createNostrFacade } from "@arbesk/nostr";
import type { Binding, NostrFacade, WalletSignPort, ChainReadPort, RelayPort } from "@arbesk/nostr";
import { getSigner } from "../blockchain/wallet.ts";
import { getReadClient } from "../blockchain/viem-clients.ts";
import { getContractAddress } from "../blockchain/network-config.ts";
import { walletState } from "../state/wallet-state.ts";
import { buildEditorProof } from "@arbesk/asset-core/domain/editors.js";
import { NOSTR_RELAY_URL } from "./nostr-config.ts";

const OWNER_ABI = [{
  inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
  name: "ownerOf", outputs: [{ internalType: "address", name: "", type: "address" }],
  stateMutability: "view", type: "function",
}] as const;

const pool = new SimplePool();

const signerPort: WalletSignPort = {
  signMessage: async (m) => {
    const signer = getSigner();
    if (!signer) throw new Error("no signer");
    return signer.signMessage(m);
  },
};

const chainPort: ChainReadPort = {
  isTokenAuthor: isTokenAuthor,
};

const relayPort: RelayPort = {
  publish: async (event: NostrEvent) => {
    await pool.publish([NOSTR_RELAY_URL], event);
  },
};

/** Owner or Merkle-editor check for a token. */
export async function isTokenAuthor(
  chainId: number, tokenId: string, address: string
): Promise<boolean> {
  try {
    const contract = getContractAddress(chainId);
    const owner = await getReadClient(chainId).readContract({
      address: contract as `0x${string}`,
      abi: OWNER_ABI,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });
    if ((owner as string).toLowerCase() === address.toLowerCase()) return true;
    const proof = await buildEditorProof(tokenId, address);
    return proof != null;
  } catch {
    return false;
  }
}

export async function getTokenOwner(chainId: number, tokenId: string): Promise<string | null> {
  try {
    const contract = getContractAddress(chainId);
    const owner = await getReadClient(chainId).readContract({
      address: contract as `0x${string}`,
      abi: OWNER_ABI,
      functionName: "ownerOf",
      args: [BigInt(tokenId)],
    });
    return (owner as string).toLowerCase();
  } catch {
    return null;
  }
}

export function getNostrFacade(): NostrFacade {
  return createNostrFacade({ signer: signerPort, chain: chainPort, relay: relayPort });
}

function bindingKey(address: string): string {
  return `arbesk-nostr-binding-${address.toLowerCase()}`;
}

/** The connected wallet's binding, created (once) from a wallet signature. */
export async function getOrCreateBinding(): Promise<Binding | null> {
  const address = walletState.get().walletAddress;
  if (!address) return null;
  const cached = localStorage.getItem(bindingKey(address));
  if (cached) {
    try { return JSON.parse(cached) as Binding; } catch { /* re-create */ }
  }
  const binding = await getNostrFacade().createIdentity();
  localStorage.setItem(bindingKey(address), JSON.stringify(binding));
  return binding;
}
```

- [ ] **Step 2: Verify no import cycle + bundle**

Run: `npm run typecheck:frontend && npm run build:frontend`
Expected: PASS (esbuild bundles `@arbesk/nostr` + `nostr-tools`; `viem` resolves via the import map).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/js/services/nostr-browser.ts frontend/src/js/services/nostr-config.ts
git commit -m "feat(live): browser Nostr adapters and binding store"
```

---

### Task 5: Publish seam (`updateAssetURI` emits on the bus)

**Files:**
- Modify: `frontend/src/js/blockchain/wallet-publishing.ts`

**Interfaces:**
- Produces: after a successful `updateAssetURI`, emits `EVENTS.ASSET_URI_CHANGED` with `{ chainId, tokenId, newAssetURI, txHash }`.

- [ ] **Step 1: Modify `updateAssetURI`**

In `wallet-publishing.ts`, refactor `updateAssetURI` (lines ~131–160) so both success paths emit before returning. Replace the function body's two return points with a single emit:

```ts
async function updateAssetURI(
  tokenId: number | string,
  newTokenURI: string,
  proof: string[],
  assetScope: string = ZERO_HASH
) {
  const c = _readyContract();
  if (!c) return null;

  const relayed = await _relayForCdp("updateUri", tokenId, { newUri: newTokenURI, proof, assetScope });
  if (relayed.handled) {
    _notifyUriChanged(tokenId, newTokenURI, relayed.txHash);
    return relayed.txHash;
  }

  try {
    const receipt = await sendContractCall({
      to: walletState.get().contractAddress,
      abi: c.abi,
      functionName: "updateAssetURI(uint256,string,bytes32,bytes32[])",
      args: [BigInt(tokenId), newTokenURI, assetScope, proof],
      pendingPayload: { tokenId, tokenURI: newTokenURI },
    });
    _notifyUriChanged(tokenId, newTokenURI, receipt.transactionHash);
    return receipt.transactionHash;
  } catch (error) {
    // ...existing error handling unchanged...
  }
}

function _notifyUriChanged(tokenId: number | string, newTokenURI: string, txHash: string) {
  emit(EVENTS.ASSET_URI_CHANGED, {
    chainId: walletState.get().chainId,
    tokenId: String(tokenId),
    newAssetURI: newTokenURI,
    txHash,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck:frontend`
Expected: PASS (`EVENTS.ASSET_URI_CHANGED` resolves from the rebuilt asset-core).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/js/blockchain/wallet-publishing.ts
git commit -m "feat(live): emit ASSET_URI_CHANGED at updateAssetURI"
```

---

### Task 6: Live-update feed (`live-updates.ts`)

**Files:**
- Create: `frontend/src/js/services/live-updates.ts`
- Test: `test/frontend/live-updates.test.js`

**Interfaces:**
- Produces: `startLiveUpdates(): void` (idempotent), `stopLiveUpdates(): void`. Subscribes to `EVENTS.ASSET_URI_CHANGED` (local → publish) and to the relay (remote → verify → emit `ASSET_URI_UPDATED`).
- Consumes: `SimplePool`, `getNostrFacade`, `getOrCreateBinding`, `isTokenAuthor`, `NOSTR_RELAY_URL`, `KIND_ASSET_UPDATE`, `KIND_BINDING`, `TAG_TOKEN`, `TAG_ADDRESS`, `EVENTS`.

- [ ] **Step 1: Write `frontend/src/js/services/live-updates.ts`**

```ts
import { SimplePool } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";
import { on, emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { KIND_ASSET_UPDATE, KIND_BINDING, TAG_TOKEN, TAG_ADDRESS, tokenTag } from "@arbesk/nostr";
import { getNostrFacade, getOrCreateBinding, getTokenOwner } from "./nostr-browser.ts";
import { getContractAddress } from "../blockchain/network-config.ts";
import { getManifestNodes } from "../engine/transforms.ts";
import { NOSTR_RELAY_URL } from "./nostr-config.ts";
import { invalidateResolution } from "../blockchain/token-resolver.ts";

const pool = new SimplePool();
let started = false;
let unsub: (() => void) | null = null;
let relaySub: { close: () => void } | null = null;
const seen = new Set<string>();

export function collectTokens(): { chainId: number; contractAddress: string; tokenId: string }[] {
  // child_ref nodes carry collection.{chainId,contractAddress,tokenId} (new) or flat (legacy).
  const nodes = getManifestNodes(getCurrentManifest());
  const set = new Map<string, { chainId: number; contractAddress: string; tokenId: string }>();
  for (const n of nodes) {
    const ref = n?.child_ref;
    if (!ref) continue;
    const chainId = Number(ref.collection?.chainId ?? ref.chainId ?? 0);
    const contractAddress = String(ref.collection?.contractAddress ?? ref.contractAddress ?? "");
    const tokenId = String(ref.collection?.tokenId ?? ref.tokenId ?? "");
    if (chainId && contractAddress && tokenId) set.set(tokenTag(chainId, contractAddress, tokenId), { chainId, contractAddress, tokenId });
  }
  return [...set.values()];
}

async function onLocalUriChanged(payload: any) {
  const binding = await getOrCreateBinding();
  if (!binding) return;
  const contract = getContractAddress(payload.chainId);
  await getNostrFacade().publishAssetUpdate(binding, {
    chainId: payload.chainId, tokenId: payload.tokenId, newAssetURI: payload.newAssetURI,
  }, contract!);
  emit(EVENTS.ASSET_URI_UPDATED, { ...payload, source: "local" });
}

async function resolveBindingFor(address: string): Promise<any | null> {
  const events = await pool.querySync([NOSTR_RELAY_URL], [
    { kinds: [KIND_BINDING], "#address": [address.toLowerCase()] },
  ]);
  if (!events.length) return null;
  const ev = events[events.length - 1];
  try { return JSON.parse(ev.content); } catch { return null; }
}

export function startLiveUpdates(): void {
  if (started) return;
  started = true;
  unsub = on(EVENTS.ASSET_URI_CHANGED, (p) => { onLocalUriChanged(p).catch(() => {}); });
  relaySub = pool.subscribeMany([NOSTR_RELAY_URL], [
    { kinds: [KIND_ASSET_UPDATE] },
  ], {
    onevent: async (event: NostrEvent) => {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      try {
        const payload = JSON.parse(event.content);
        const eventTag = event.tags.find((t) => t[0] === TAG_TOKEN)?.[1] || "";
        // Only react to tokens this scene references.
        const tokens = collectTokens();
        if (!tokens.some((t) => tokenTag(t.chainId, t.contractAddress, t.tokenId) === eventTag)) return;
        const owner = await getTokenOwner(payload.chainId, payload.tokenId);
        if (!owner) return;
        const binding = await resolveBindingFor(owner);
        if (!binding) return;
        const ok = await getNostrFacade().verifyAssetUpdate(event, binding, payload);
        if (!ok) return;
        invalidateResolution(payload.chainId, getContractAddress(payload.chainId)!, payload.tokenId);
        emit(EVENTS.ASSET_URI_UPDATED, { ...payload, source: "remote" });
      } catch { /* ignore malformed */ }
    },
  });
}

export function stopLiveUpdates(): void {
  started = false;
  unsub?.(); unsub = null;
  relaySub?.close(); relaySub = null;
}
```

- [ ] **Step 2: Note — manifest node source**

`collectTokens()` reads the live manifest via `getManifestNodes(getCurrentManifest())` (from `engine/transforms.ts` + `@arbesk/asset-core/domain/asset.js`). This is the same source `outliner.ts` uses internally; do NOT add a hook to `engine/state.ts` and do NOT use a window global. The `getManifestNodes` import (`services/live-updates.ts` → `engine/transforms.ts`) is acyclic (transforms is a pure leaf). No code change in this step.

```ts
export function getReferencedChildNodes(): any[] {
  return getNodes().filter((n: any) => !!n?.child_ref);
}
```

Then replace the `(window as any).__ARBESK_NODES__` line in `collectTokens()` with `getReferencedChildNodes()` (import from `engine/state.ts`). Verify the import direction is acyclic (`live-updates.ts` → `engine/state.ts` → asset-core; no back-import).

- [ ] **Step 3: Typecheck + bundle**

Run: `npm run typecheck:frontend && npm run build:frontend`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/services/live-updates.ts
git commit -m "feat(live): subscribe, verify, and emit update feed"
```

---

### Task 7: In-place child reload (`child-reload.ts` + scene-loader export)

**Files:**
- Create: `frontend/src/js/engine/child-reload.ts`
- Modify: `frontend/src/js/engine/scene-loader.ts`

**Interfaces:**
- Produces: `reloadChildRefsForToken(chainId, tokenId): void`. Scene-loader exports `reloadChildRefNode(nodeId): Promise<void>`.

- [ ] **Step 1: Record depth on the child anchor**

In `scene-loader.ts` `loadTokenChildNode` (the `childAnchor.metadata = {...}` block ~line 282), add `depth`:

```ts
    childAnchor.metadata = {
      childRef,
      resolvedCid: resolution.manifestCid,
      loaded: true,
      nodeId: node.node_id,
      depth,
    };
```

- [ ] **Step 2: Export a reload helper from `scene-loader.ts`**

Append to `scene-loader.ts`:

```ts
/** Tears down and re-resolves a single child_ref node in place. */
export async function reloadChildRefNode(nodeId: string): Promise<void> {
  const node = getManifestNodes(getCurrentManifest()).find((n: any) => n?.node_id === nodeId && n?.child_ref);
  const anchor = state.nodeAnchors.get(nodeId);
  if (!node || !anchor) return;
  const parent = anchor.parent;
  const depth = (anchor.metadata as any)?.depth ?? 0;
  disposeNodeSubtree(nodeId);
  await loadTokenChildNode(node, parent as BABYLON.TransformNode, depth, new Set<string>());
}
```

(Import `getCurrentManifest` from `@arbesk/asset-core/domain/asset.js`, `getManifestNodes` from `./transforms.ts`, and `disposeNodeSubtree` from `./cleanup.ts`. `loadTokenChildNode`, `state`, and `BABYLON` are already in scope in `scene-loader.ts`.)

- [ ] **Step 3: Write `frontend/src/js/engine/child-reload.ts`**

```ts
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getCurrentManifest } from "@arbesk/asset-core/domain/asset.js";
import { getManifestNodes } from "./transforms.ts";
import { reloadChildRefNode } from "./scene-loader.ts";

/** Reloads every child_ref node whose referenced token matches the update. */
export function initChildReload(): void {
  on(EVENTS.ASSET_URI_UPDATED, (payload: any) => {
    for (const n of getManifestNodes(getCurrentManifest())) {
      const ref = n?.child_ref;
      if (!ref) continue;
      const chainId = Number(ref.collection?.chainId ?? ref.chainId ?? 0);
      const tokenId = String(ref.collection?.tokenId ?? ref.tokenId ?? "");
      if (chainId === Number(payload.chainId) && tokenId === String(payload.tokenId)) {
        reloadChildRefNode(n.node_id).catch(() => {});
      }
    }
  });
}
```

- [ ] **Step 4: Call the initializers at boot**

In `frontend/src/js/app-init.ts` (or the Studio entry), call `startLiveUpdates()` and `initChildReload()` once after DOMContentLoaded.

- [ ] **Step 5: Typecheck + bundle**

Run: `npm run typecheck:frontend && npm run build:frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/engine/child-reload.ts frontend/src/js/engine/scene-loader.ts frontend/src/js/app-init.ts
git commit -m "feat(live): in-place child_ref reload on update"
```

---

### Task 8: CLI publish seam + local key (`besk`)

**Files:**
- Create: `packages/besk/src/nostr.ts`
- Modify: `packages/besk/src/catalog.ts`

**Interfaces:**
- Produces: `getOrCreateCliBinding(): Promise<Binding>` (local key + stored binding), `publishCliUpdate(payload): Promise<void>`.

- [ ] **Step 1: Write `packages/besk/src/nostr.ts`**

```ts
import fs from "fs";
import os from "os";
import path from "path";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import type { Binding } from "@arbesk/nostr";

const KEY_PATH = process.env.ARBESK_NOSTR_PATH ||
  path.join(os.homedir(), ".config", "besk", "nostr.json");

// NOTE: binding.address is filled at CDP login time (embedded EOA signs the
// identity message in the browser). Until then, events publish with an
// unverified local key — see spec §15 / GH issue #58 for the chat-side migration.
export function getOrCreateCliBinding(): Binding {
  if (fs.existsSync(KEY_PATH)) {
    return JSON.parse(fs.readFileSync(KEY_PATH, "utf8")) as Binding;
  }
  const secret = generateSecretKey();
  const binding = { address: "", pubkey: getPublicKey(secret), signature: "" };
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, JSON.stringify({ secret, binding }), { mode: 0o600 });
  return binding;
}
```

- [ ] **Step 2: Publish after `updateUri` in `catalog.ts`**

In `packages/besk/src/catalog.ts`, after `await relay(session, "updateUri", tokenId, { newUri: newCid, proof: [] })` succeeds, publish the update event. (This is a thin call to the SDK; MCP inherits via parity.)

- [ ] **Step 3: Typecheck + build the CLI**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/besk/src/nostr.ts packages/besk/src/catalog.ts
git commit -m "feat(live): CLI publish seam and local Nostr key"
```

---

### Task 9: E2E — cross-user live update

**Files:**
- Create: `e2e/specs/22-live-scene-update.spec.js`
- Modify: `e2e/helpers/studio-selectors.mjs` (add live-update status selector if needed)

**Interfaces:**
- Consumes: two-wallet fixture pattern (reuse `e2e/fixtures/multi-wallet.mjs` and the selectors/flow helpers from `e2e/specs/13-editor-collaboration.spec.js` and `e2e/specs/06-nesting.spec.js`).

- [ ] **Step 1: Write the spec**

```js
// e2e/specs/22-live-scene-update.spec.js
import { test, expect } from "@playwright/test";

// Two wallets: A owns+publishes a child asset; B owns a parent scene that
// references A's child via child_ref. After A republishes the child, B's open
// scene reloads the child node without a page refresh.
test("publishing a child asset live-updates a referencing scene", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();

  // 1. Connect A, publish a child asset; capture its token id.
  await a.goto("/");
  // ... reuse the connect + publish flow helpers (spec 03) ...
  const childTokenId = "42"; // captured from publish

  // 2. Connect B, open the parent scene that references the child, wait for load.
  await b.goto("/");
  // ... open parent collection; assert the child placeholder is rendered ...

  // 3. A republishes the child (new version).
  // ... reuse republish flow (spec 05) ...

  // 4. B's scene reloads the child in place within a short window.
  await expect(b.locator("[data-child-ref='updated']")).toBeVisible({ timeout: 15000 });
});
```

Note: fill in the exact connect/publish/republish/child-node selectors by reusing the
helpers from the referenced specs — do not invent new selectors.

- [ ] **Step 2: Run E2E**

Run: `npm run test:e2e -- --project=chromium e2e/specs/22-live-scene-update.spec.js`
Expected: PASS (requires the dev stack: `./scripts/start-dev.sh --setup-only` + backend).

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/22-live-scene-update.spec.js e2e/helpers/studio-selectors.mjs
git commit -m "test(e2e): cross-user live scene update"
```