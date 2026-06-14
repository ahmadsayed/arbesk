# State Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `window.*` app-state globals with three typed plain-JS store modules backed by the existing event bus.

**Architecture:** Three store modules (`asset-state.js`, `wallet-state.js`, `ui-state.js`) under `frontend/src/js/state/` each expose `get() / set() / reset()`. Every `set()` call emits a typed `EVENTS.*_STATE_CHANGED` CustomEvent on `document` via the existing `emit()` helper. All call sites are migrated in one pass — no `window.*` compatibility shims.

**Tech Stack:** Vanilla ES modules, Jest + jsdom for tests, existing `events/registry.js` for notifications.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/js/state/asset-state.js` | Asset store (manifestCid, tokenId, name, currentManifest) |
| Create | `frontend/src/js/state/wallet-state.js` | Wallet store (address, chainId, contract, contractAddress) |
| Create | `frontend/src/js/state/ui-state.js` | UI store (selectedNodeId, nestingDepth) |
| Create | `test/state/asset-state.test.js` | Store unit tests |
| Create | `test/state/wallet-state.test.js` | Store unit tests |
| Create | `test/state/ui-state.test.js` | Store unit tests |
| Modify | `frontend/src/js/events/registry.js` | Add 3 new event constants, update count |
| Modify | `test/events/registry.test.js` | Update unique-count assertion 25 → 28 |
| Modify | `frontend/src/js/blockchain/wallet.js` | Migrate wallet state writes/reads, remove window exports |
| Modify | `frontend/src/js/blockchain/network-config.js` | Remove window function exports |
| Modify | `frontend/src/js/blockchain/token-resolver.js` | Migrate wallet state reads |
| Modify | `frontend/src/js/services/api.js` | Migrate wallet state reads, remove window exports |
| Modify | `frontend/src/js/engine/scene-graph.js` | Migrate asset + wallet + ui state reads/writes |
| Modify | `frontend/src/js/engine/cleanup.js` | Replace null-clear blocks with reset() calls |
| Modify | `frontend/src/js/engine/studio-init.js` | Migrate wallet state read |
| Modify | `frontend/src/js/ui/asset-save.js` | Migrate asset state reads/writes |
| Modify | `frontend/src/js/ui/nesting.js` | Migrate asset + ui state reads/writes |
| Modify | `frontend/src/js/ui/outliner.js` | Migrate asset + ui state reads/writes |
| Modify | `frontend/src/js/ui/asset-library.js` | Migrate asset + wallet state reads/writes |

---

## Task 1: Create `asset-state.js`

**Files:**
- Create: `frontend/src/js/state/asset-state.js`
- Create: `test/state/asset-state.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/state/asset-state.test.js`:

```js
/**
 * @jest-environment jsdom
 */
import { assetState, _resetForTesting } from "../../frontend/src/js/state/asset-state.js";
import { on, EVENTS } from "../../frontend/src/js/events/registry.js";

beforeEach(() => _resetForTesting());

describe("assetState.get()", () => {
  test("returns null defaults", () => {
    expect(assetState.get()).toEqual({
      activeAssetManifestCid: null,
      activeAssetTokenId: null,
      activeAssetName: null,
      latestAssetManifestCid: null,
      currentManifest: null,
    });
  });

  test("returns a snapshot copy, not the live object", () => {
    const snap1 = assetState.get();
    assetState.set({ activeAssetName: "hello" });
    expect(snap1.activeAssetName).toBeNull();
  });
});

describe("assetState.set()", () => {
  test("merges partial update", () => {
    assetState.set({ activeAssetName: "Cube" });
    expect(assetState.get().activeAssetName).toBe("Cube");
    expect(assetState.get().activeAssetTokenId).toBeNull();
  });

  test("emits ASSET_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      on(EVENTS.ASSET_STATE_CHANGED, ({ detail }) => {
        expect(detail.activeAssetName).toBe("Cube");
        expect(detail.activeAssetTokenId).toBeNull();
        resolve();
      });
      assetState.set({ activeAssetName: "Cube" });
    });
  });
});

describe("assetState.reset()", () => {
  test("restores all fields to null", () => {
    assetState.set({ activeAssetName: "Cube", activeAssetTokenId: "42" });
    assetState.reset();
    expect(assetState.get()).toEqual({
      activeAssetManifestCid: null,
      activeAssetTokenId: null,
      activeAssetName: null,
      latestAssetManifestCid: null,
      currentManifest: null,
    });
  });

  test("emits ASSET_STATE_CHANGED after reset", () => {
    return new Promise((resolve) => {
      assetState.set({ activeAssetName: "Cube" });
      on(EVENTS.ASSET_STATE_CHANGED, ({ detail }) => {
        expect(detail.activeAssetName).toBeNull();
        resolve();
      });
      assetState.reset();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/asset-state.test.js --runInBand
```

Expected: FAIL — `Cannot find module '../../frontend/src/js/state/asset-state.js'`

- [ ] **Step 3: Create `frontend/src/js/state/asset-state.js`**

```js
import { emit, EVENTS } from "../events/registry.js";

const _defaults = {
  activeAssetManifestCid: null,
  activeAssetTokenId: null,
  activeAssetName: null,
  latestAssetManifestCid: null,
  currentManifest: null,
};

const _state = { ..._defaults };

export const assetState = {
  get: () => ({ ..._state }),
  set(partial) {
    Object.assign(_state, partial);
    emit(EVENTS.ASSET_STATE_CHANGED, { ..._state });
  },
  reset() {
    Object.assign(_state, _defaults);
    emit(EVENTS.ASSET_STATE_CHANGED, { ..._state });
  },
};

export function _resetForTesting() {
  Object.assign(_state, _defaults);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/asset-state.test.js --runInBand
```

Expected: FAIL — `EVENTS.ASSET_STATE_CHANGED` is undefined (event constant doesn't exist yet — this is expected; fix in Task 4)

> **Note:** The test will pass fully after Task 4 adds the event constants. For now, confirm the module loads without import errors. If the error is only the missing event constant, proceed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/state/asset-state.js test/state/asset-state.test.js
git commit -m "feat(state): add asset-state store module"
```

---

## Task 2: Create `wallet-state.js`

**Files:**
- Create: `frontend/src/js/state/wallet-state.js`
- Create: `test/state/wallet-state.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/state/wallet-state.test.js`:

```js
/**
 * @jest-environment jsdom
 */
import { walletState, _resetForTesting } from "../../frontend/src/js/state/wallet-state.js";
import { on, EVENTS } from "../../frontend/src/js/events/registry.js";

beforeEach(() => _resetForTesting());

describe("walletState.get()", () => {
  test("returns null defaults", () => {
    expect(walletState.get()).toEqual({
      walletAddress: null,
      chainId: null,
      contract: null,
      contractAddress: null,
    });
  });

  test("returns a snapshot copy, not the live object", () => {
    const snap = walletState.get();
    walletState.set({ walletAddress: "0xabc" });
    expect(snap.walletAddress).toBeNull();
  });
});

describe("walletState.set()", () => {
  test("merges partial update", () => {
    walletState.set({ walletAddress: "0xabc" });
    expect(walletState.get().walletAddress).toBe("0xabc");
    expect(walletState.get().chainId).toBeNull();
  });

  test("emits WALLET_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      on(EVENTS.WALLET_STATE_CHANGED, ({ detail }) => {
        expect(detail.walletAddress).toBe("0xabc");
        resolve();
      });
      walletState.set({ walletAddress: "0xabc" });
    });
  });
});

describe("walletState.reset()", () => {
  test("restores all fields to null", () => {
    walletState.set({ walletAddress: "0xabc", chainId: 10 });
    walletState.reset();
    expect(walletState.get()).toEqual({
      walletAddress: null,
      chainId: null,
      contract: null,
      contractAddress: null,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/wallet-state.test.js --runInBand
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/js/state/wallet-state.js`**

```js
import { emit, EVENTS } from "../events/registry.js";

const _defaults = {
  walletAddress: null,
  chainId: null,
  contract: null,
  contractAddress: null,
};

const _state = { ..._defaults };

export const walletState = {
  get: () => ({ ..._state }),
  set(partial) {
    Object.assign(_state, partial);
    emit(EVENTS.WALLET_STATE_CHANGED, { ..._state });
  },
  reset() {
    Object.assign(_state, _defaults);
    emit(EVENTS.WALLET_STATE_CHANGED, { ..._state });
  },
};

export function _resetForTesting() {
  Object.assign(_state, _defaults);
}
```

- [ ] **Step 4: Run test to verify it passes (pending event constant)**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/wallet-state.test.js --runInBand
```

Expected: FAIL only on missing `EVENTS.WALLET_STATE_CHANGED`. Confirm module loads cleanly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/state/wallet-state.js test/state/wallet-state.test.js
git commit -m "feat(state): add wallet-state store module"
```

---

## Task 3: Create `ui-state.js`

**Files:**
- Create: `frontend/src/js/state/ui-state.js`
- Create: `test/state/ui-state.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/state/ui-state.test.js`:

```js
/**
 * @jest-environment jsdom
 */
import { uiState, _resetForTesting } from "../../frontend/src/js/state/ui-state.js";
import { on, EVENTS } from "../../frontend/src/js/events/registry.js";

beforeEach(() => _resetForTesting());

describe("uiState.get()", () => {
  test("returns defaults: selectedNodeId null, nestingDepth 0", () => {
    expect(uiState.get()).toEqual({
      selectedNodeId: null,
      nestingDepth: 0,
    });
  });
});

describe("uiState.set()", () => {
  test("merges partial update", () => {
    uiState.set({ selectedNodeId: "node-1" });
    expect(uiState.get().selectedNodeId).toBe("node-1");
    expect(uiState.get().nestingDepth).toBe(0);
  });

  test("emits UI_STATE_CHANGED with full state", () => {
    return new Promise((resolve) => {
      on(EVENTS.UI_STATE_CHANGED, ({ detail }) => {
        expect(detail.selectedNodeId).toBe("node-1");
        expect(detail.nestingDepth).toBe(0);
        resolve();
      });
      uiState.set({ selectedNodeId: "node-1" });
    });
  });
});

describe("uiState.reset()", () => {
  test("restores selectedNodeId to null and nestingDepth to 0", () => {
    uiState.set({ selectedNodeId: "node-1", nestingDepth: 3 });
    uiState.reset();
    expect(uiState.get()).toEqual({ selectedNodeId: null, nestingDepth: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/ui-state.test.js --runInBand
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/src/js/state/ui-state.js`**

```js
import { emit, EVENTS } from "../events/registry.js";

const _defaults = {
  selectedNodeId: null,
  nestingDepth: 0,
};

const _state = { ..._defaults };

export const uiState = {
  get: () => ({ ..._state }),
  set(partial) {
    Object.assign(_state, partial);
    emit(EVENTS.UI_STATE_CHANGED, { ..._state });
  },
  reset() {
    Object.assign(_state, _defaults);
    emit(EVENTS.UI_STATE_CHANGED, { ..._state });
  },
};

export function _resetForTesting() {
  Object.assign(_state, _defaults);
}
```

- [ ] **Step 4: Run test (pending event constant)**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/ui-state.test.js --runInBand
```

Expected: FAIL only on missing `EVENTS.UI_STATE_CHANGED`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/state/ui-state.js test/state/ui-state.test.js
git commit -m "feat(state): add ui-state store module"
```

---

## Task 4: Add event constants to `events/registry.js`

**Files:**
- Modify: `frontend/src/js/events/registry.js`
- Modify: `test/events/registry.test.js`

- [ ] **Step 1: Add 3 constants to `EVENTS` in `frontend/src/js/events/registry.js`**

Add the three new constants inside the `EVENTS` object (alphabetical position):

```js
  ASSET_STATE_CHANGED:  "asset:stateChanged",
  // ... existing entries ...
  UI_STATE_CHANGED:     "ui:stateChanged",
  // ... existing entries ...
  WALLET_STATE_CHANGED: "wallet:stateChanged",
```

The full updated `EVENTS` object should include (verify existing entries are untouched):

```js
export const EVENTS = {
  ASSET_ADD_LINKED_REQUESTED: "asset:addLinkedRequested",
  ASSET_BURNED:               "asset:burned",
  ASSET_CLEARED:              "asset:cleared",
  ASSET_DRAFT_SAVED:          "asset:draftSaved",
  ASSET_LINKED_DROPPED:       "asset:linkedDropped",
  ASSET_OPEN_BY_TOKEN_ID:     "asset:openByTokenId",
  ASSET_PUBLISHED:            "asset:published",
  ASSET_STATE_CHANGED:        "asset:stateChanged",
  NESTING_DID_ASCEND:         "nesting:didAscend",
  NESTING_DID_DIVE:           "nesting:didDive",
  NESTING_DIVE_REQUESTED:     "nesting:diveRequested",
  NODE_DESELECTED:            "node:deselected",
  NODE_SELECTED:              "node:selected",
  OUTLINER_NODE_SELECTED:     "outliner:nodeSelected",
  OUTLINER_REMOVE_REQUESTED:  "outliner:removeRequested",
  SCENE_CLEARED:              "scene:cleared",
  SCENE_EMPTY:                "scene:empty",
  SCENE_READY:                "scene:ready",
  SCENE_TOKEN_CHILD_ADDED:    "scene:tokenChildAdded",
  SUBMESH_SELECTED:           "submesh:selected",
  THEME_CHANGED:              "theme:changed",
  UI_STATE_CHANGED:           "ui:stateChanged",
  USER_AUTHENTICATED:         "user:authenticated",
  USER_AUTH_REQUIRED:         "user:auth-required",
  WALLET_CONNECTED:           "wallet:connected",
  WALLET_DISCONNECTED:        "wallet:disconnected",
  WALLET_GENERATION_PAID:     "wallet:generationPaid",
  WALLET_STATE_CHANGED:       "wallet:stateChanged",
};
```

- [ ] **Step 2: Update the count test in `test/events/registry.test.js`**

Find the line:
```js
  test("all 25 values are unique", () => {
    const values = Object.values(EVENTS);
    expect(new Set(values).size).toBe(25);
    expect(values).toHaveLength(25);
  });
```

Change both `25` to `28`:
```js
  test("all 28 values are unique", () => {
    const values = Object.values(EVENTS);
    expect(new Set(values).size).toBe(28);
    expect(values).toHaveLength(28);
  });
```

- [ ] **Step 3: Run all state + registry tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/state/ test/events/ --runInBand
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/events/registry.js test/events/registry.test.js
git commit -m "feat(events): add ASSET_STATE_CHANGED, WALLET_STATE_CHANGED, UI_STATE_CHANGED constants"
```

---

## Task 5: Migrate `blockchain/wallet.js`

**Files:**
- Modify: `frontend/src/js/blockchain/wallet.js`

This file has ~64 `window.*` hits — all wallet state reads/writes plus two window function exports at the bottom.

- [ ] **Step 1: Add import at the top of `wallet.js`**

After the existing imports, add:
```js
import { walletState } from "../state/wallet-state.js";
```

- [ ] **Step 2: Replace the wallet state write block (around line 370)**

Find:
```js
  window.walletAddress = address;
```
```js
  window.chainId = chainId;
```
```js
  window.contractAddress = contractAddress;
```

These three writes are scattered near each other but called at different points. Each becomes a `walletState.set()` call. For writes where multiple fields change together (e.g. address + chainId at connection time), batch them:

```js
// Was: window.walletAddress = address; window.chainId = chainId;
walletState.set({ walletAddress: address, chainId });
```

```js
// Was: window.contractAddress = contractAddress;
walletState.set({ contractAddress });
```

```js
// Was: window.contract = <someContract>;
walletState.set({ contract: <someContract> });
```

- [ ] **Step 3: Replace all `window.walletAddress` reads**

Pattern: `window.walletAddress` → `walletState.get().walletAddress`

For repeated reads in the same function, destructure at the top of that function for readability:
```js
const { walletAddress, contract } = walletState.get();
```

- [ ] **Step 4: Replace `window.chainId` reads**

Pattern: `window.chainId` → `walletState.get().chainId`

- [ ] **Step 5: Replace `window.contract` reads**

Pattern: `window.contract` → `walletState.get().contract`

Example — the existing pattern `contract || window.contract || null` becomes:
```js
contract || walletState.get().contract || null
```

- [ ] **Step 6: Replace `window.contract` write**

Find the line where the ERC-721 contract instance is assigned (search for `new w3.eth.Contract` or `new web3.eth.Contract`):
```js
window.contract = new w3.eth.Contract(abi, address);
// or similar
```

Replace with:
```js
walletState.set({ contract: new w3.eth.Contract(abi, address) });
```

- [ ] **Step 7: Replace `window.walletAddress = null` (disconnect)**

Find (around line 563):
```js
window.walletAddress = null;
```

Replace with:
```js
walletState.reset();
```

- [ ] **Step 8: Remove window function exports at the bottom of the file**

Remove these two lines:
```js
window.connectWallet = connectWallet;
window.disconnectWallet = disconnectWallet;
```

- [ ] **Step 9: Run the full test suite**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand --silent
```

Expected: All PASS (wallet.js has no unit tests; backend tests are unaffected).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/js/blockchain/wallet.js
git commit -m "refactor(wallet): migrate window.* state to walletState store"
```

---

## Task 6: Migrate `blockchain/network-config.js` and `services/api.js` window exports

**Files:**
- Modify: `frontend/src/js/blockchain/network-config.js`
- Modify: `frontend/src/js/services/api.js`

These files only export functions onto `window` — no consumers call them via `window.*` anywhere in the codebase. They're console shortcuts.

- [ ] **Step 1: Remove window exports from `network-config.js`**

Find and remove these three lines at the bottom of the file:
```js
window.NETWORK_CONFIGS = NETWORK_CONFIGS;
window.getNetworkConfig = getNetworkConfig;
window.getContractAddress = getContractAddress;
```

- [ ] **Step 2: Remove window exports from `services/api.js`**

Find and remove these lines at the bottom of the file:
```js
window.createSession = createSession;
window.clearSession = clearSession;
window.getConfig = getConfig;
window.getContractAddress = getContractAddress;
window.getContractArtifact = getContractArtifact;
window.generateAsset = generateAsset;
window.saveManifest = saveManifest;
window.publishManifest = publishManifest;
window.getManifestHistory = getManifestHistory;
window.getTokenManifest = getTokenManifest;
window.unpinAssetCids = unpinAssetCids;
```

- [ ] **Step 3: Also migrate wallet state reads inside `services/api.js`**

Add import at the top:
```js
import { walletState } from "../state/wallet-state.js";
```

Replace `window.walletAddress` (4 occurrences) with `walletState.get().walletAddress`.

Replace `window.chainId` (2 occurrences) with `walletState.get().chainId`.

The specific lines (~119–173, ~265–266):
```js
// Was:
if (!web3 || !window.walletAddress) {
// Becomes:
if (!web3 || !walletState.get().walletAddress) {

// Was:
const chainId = Number(window.chainId || 1);
const message = buildSiweMessage(domain, window.walletAddress, nonce, chainId);
signature = await web3.eth.personal.sign(message, window.walletAddress, "");
// Becomes:
const { walletAddress, chainId: rawChainId } = walletState.get();
const chainId = Number(rawChainId || 1);
const message = buildSiweMessage(domain, walletAddress, nonce, chainId);
signature = await web3.eth.personal.sign(message, walletAddress, "");

// Was:
cacheSession(data.token, data.expiresAt, window.walletAddress);
// Becomes:
cacheSession(data.token, data.expiresAt, walletState.get().walletAddress);

// Was:
if (cached && cached.address === window.walletAddress?.toLowerCase()) {
// Becomes:
if (cached && cached.address === walletState.get().walletAddress?.toLowerCase()) {

// Was (around line 265):
typeof window !== "undefined" && window.chainId
  ? Number(window.chainId)
// Becomes:
walletState.get().chainId
  ? Number(walletState.get().chainId)
```

- [ ] **Step 4: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand --silent
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/blockchain/network-config.js frontend/src/js/services/api.js
git commit -m "refactor(api): migrate wallet state reads, remove console-shortcut window exports"
```

---

## Task 7: Migrate `blockchain/token-resolver.js`

**Files:**
- Modify: `frontend/src/js/blockchain/token-resolver.js`

3 app-state reads: `window.chainId` (×2) and `window.contractAddress`.

- [ ] **Step 1: Add import**

```js
import { walletState } from "../state/wallet-state.js";
```

- [ ] **Step 2: Replace reads**

Line ~109:
```js
// Was:
const connectedChainId = window.chainId;
// Becomes:
const connectedChainId = walletState.get().chainId;
```

Line ~179–181:
```js
// Was:
const chainId = Number(childRef.chainId || window.chainId) || null;
const contractAddress =
  childRef.contractAddress || window.contractAddress || null;
// Becomes:
const { chainId: walletChainId, contractAddress: walletContractAddress } = walletState.get();
const chainId = Number(childRef.chainId || walletChainId) || null;
const contractAddress = childRef.contractAddress || walletContractAddress || null;
```

- [ ] **Step 3: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/token-resolver.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/blockchain/token-resolver.js
git commit -m "refactor(token-resolver): migrate window.chainId/contractAddress to walletState"
```

---

## Task 8: Migrate `engine/scene-graph.js`

**Files:**
- Modify: `frontend/src/js/engine/scene-graph.js`

Touches `window.selectedNodeId` (UI), `window.activeAssetManifestCid / tokenId / name / latestAssetManifestCid` (asset), and `window.chainId / contractAddress / walletAddress / contract` (wallet).

- [ ] **Step 1: Add imports**

```js
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { uiState } from "../state/ui-state.js";
```

- [ ] **Step 2: Replace `window.selectedNodeId` writes (lines ~405, 413, 467)**

```js
// Was:
window.selectedNodeId = nodeId;
// Becomes:
uiState.set({ selectedNodeId: nodeId });

// Was:
window.selectedNodeId = null;
// Becomes:
uiState.set({ selectedNodeId: null });
```

- [ ] **Step 3: Replace asset state writes (lines ~941, 1272–1315)**

```js
// Line ~941 — single CID assignment:
// Was:
window.activeAssetManifestCid = manifestCid;
// Becomes:
assetState.set({ activeAssetManifestCid: manifestCid });

// Lines ~1272–1274 — all three together; batch into one set():
// Was:
window.activeAssetTokenId = String(assetTokenId);
window.activeAssetManifestCid = cid;
window.latestAssetManifestCid = cid;
// Becomes:
assetState.set({
  activeAssetTokenId: String(assetTokenId),
  activeAssetManifestCid: cid,
  latestAssetManifestCid: cid,
});

// Lines ~1280–1281:
// Was:
window.activeAssetManifestCid = manifestCid;
window.latestAssetManifestCid = manifestCid;
// Becomes:
assetState.set({ activeAssetManifestCid: manifestCid, latestAssetManifestCid: manifestCid });

// Lines ~1295–1297 — null-clear block; batch:
// Was:
window.activeAssetManifestCid = null;
window.latestAssetManifestCid = null;
window.activeAssetTokenId = null;
// Becomes:
assetState.set({ activeAssetManifestCid: null, latestAssetManifestCid: null, activeAssetTokenId: null });

// Lines ~1307–1315 — name writes + DOM update:
// Was:
window.activeAssetName = (name && name.trim()) || "Untitled Asset";
// ...
window.activeAssetName = "Untitled Asset";
// ...
if (nameEl) nameEl.textContent = window.activeAssetName;
if (statusEl) statusEl.textContent = window.activeAssetName;
// Becomes:
const activeAssetName = (name && name.trim()) || "Untitled Asset";
assetState.set({ activeAssetName });
// ...
assetState.set({ activeAssetName: "Untitled Asset" });
// ...
if (nameEl) nameEl.textContent = assetState.get().activeAssetName;
if (statusEl) statusEl.textContent = assetState.get().activeAssetName;
```

- [ ] **Step 4: Replace wallet state reads (lines ~965–974, 1266–1267)**

```js
// Lines ~965–967:
// Was:
const resolvedChainId = Number(eventChainId || window.chainId || CHAIN_IDS.HARDHAT_LOCAL);
const resolvedContract = eventContractAddress || window.contractAddress || window._contractAddress;
// Becomes:
const { chainId: walletChainId, contractAddress: walletContractAddress } = walletState.get();
const resolvedChainId = Number(eventChainId || walletChainId || CHAIN_IDS.HARDHAT_LOCAL);
const resolvedContract = eventContractAddress || walletContractAddress;

// Line ~974:
// Was:
if (!window.walletAddress) {
// Becomes:
if (!walletState.get().walletAddress) {

// Lines ~1266–1267:
// Was:
if (assetTokenId && window.contract) {
  window.contract.methods
// Becomes:
const { contract } = walletState.get();
if (assetTokenId && contract) {
  contract.methods
```

- [ ] **Step 5: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/scene-graph.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/engine/scene-graph.js
git commit -m "refactor(scene-graph): migrate window.* to state stores"
```

---

## Task 9: Migrate `engine/cleanup.js`

**Files:**
- Modify: `frontend/src/js/engine/cleanup.js`

5 `window.*` writes — all null-clears. Replace with `reset()` calls.

- [ ] **Step 1: Add imports**

```js
import { assetState } from "../state/asset-state.js";
import { uiState } from "../state/ui-state.js";
```

- [ ] **Step 2: Replace the early-return null-clear block (lines ~76–78)**

```js
// Was:
if (!state.scene) {
  window.activeAssetManifestCid = null;
  window.selectedNodeId = null;
  return;
}
// Becomes:
if (!state.scene) {
  assetState.set({ activeAssetManifestCid: null });
  uiState.set({ selectedNodeId: null });
  return;
}
```

- [ ] **Step 3: Replace the post-clear block (lines ~151–153)**

```js
// Was:
window.activeAssetManifestCid = null;
window.selectedNodeId = null;
window.latestAssetManifestCid = null;
// Becomes:
assetState.set({ activeAssetManifestCid: null, latestAssetManifestCid: null });
uiState.set({ selectedNodeId: null });
```

- [ ] **Step 4: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand --silent
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/engine/cleanup.js
git commit -m "refactor(cleanup): replace window null-clears with state store calls"
```

---

## Task 10: Migrate `ui/asset-save.js`

**Files:**
- Modify: `frontend/src/js/ui/asset-save.js`

~37 `window.*` hits, all asset state (no wallet state writes in this file — it reads `window.contract` but only via the imported `contract()` helper).

- [ ] **Step 1: Add import**

```js
import { assetState } from "../state/asset-state.js";
```

- [ ] **Step 2: Replace all asset state reads**

Pattern replacements throughout the file:

```js
window.activeAssetManifestCid  →  assetState.get().activeAssetManifestCid
window.activeAssetTokenId      →  assetState.get().activeAssetTokenId
window.activeAssetName         →  assetState.get().activeAssetName
window.latestAssetManifestCid  →  assetState.get().latestAssetManifestCid
```

For functions with multiple reads of the same field, destructure at the top:
```js
const { activeAssetManifestCid, activeAssetTokenId, activeAssetName, latestAssetManifestCid } = assetState.get();
```

- [ ] **Step 3: Replace all asset state writes**

```js
// Was:
window.activeAssetName = name;
if (assetStatusName) assetStatusName.textContent = window.activeAssetName;
// Becomes:
assetState.set({ activeAssetName: name });
if (assetStatusName) assetStatusName.textContent = assetState.get().activeAssetName;

// Was:
window.latestAssetManifestCid = cid;
window.activeAssetManifestCid = cid;
// Becomes:
assetState.set({ latestAssetManifestCid: cid, activeAssetManifestCid: cid });

// Was:
window.activeAssetTokenId = tokenId;
// Becomes:
assetState.set({ activeAssetTokenId: tokenId });
```

- [ ] **Step 4: Replace `window.contract` read (line ~92)**

Add wallet import:
```js
import { walletState } from "../state/wallet-state.js";
```

```js
// Was:
const c = contract || window.contract;
// Becomes:
const c = contract || walletState.get().contract;
```

- [ ] **Step 5: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand --silent
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/asset-save.js
git commit -m "refactor(asset-save): migrate window.* to assetState store"
```

---

## Task 11: Migrate `ui/nesting.js`

**Files:**
- Modify: `frontend/src/js/ui/nesting.js`

Writes and reads `window.activeAssetManifestCid`, `window.latestAssetManifestCid`, `window.activeAssetName`, `window.activeAssetTokenId` (all asset state) and `window._nestingDepth` (ui state).

- [ ] **Step 1: Add imports**

```js
import { assetState } from "../state/asset-state.js";
import { uiState } from "../state/ui-state.js";
```

- [ ] **Step 2: Replace the dive-push block (lines ~84–96)**

```js
// Was:
{
  cid: window.activeAssetManifestCid,
  name: window.activeAssetName || "World",
  assetName: window.activeAssetName,
  tokenId: window.activeAssetTokenId,
}
// Becomes:
const { activeAssetManifestCid, activeAssetName, activeAssetTokenId } = assetState.get();
{
  cid: activeAssetManifestCid,
  name: activeAssetName || "World",
  assetName: activeAssetName,
  tokenId: activeAssetTokenId,
}

// Was:
window.activeAssetManifestCid = manifest.cid;
window.latestAssetManifestCid = manifest.cid;
window.activeAssetName = manifest.name || "Child World";
window.activeAssetTokenId = childRef.tokenId;
window._nestingDepth = ++currentDepth;
// Becomes:
assetState.set({
  activeAssetManifestCid: manifest.cid,
  latestAssetManifestCid: manifest.cid,
  activeAssetName: manifest.name || "Child World",
  activeAssetTokenId: childRef.tokenId,
});
uiState.set({ nestingDepth: ++currentDepth });
```

- [ ] **Step 3: Replace the ascend-pop block (lines ~119–126)**

```js
// Was:
window._nestingDepth = currentDepth;
// ...
window.activeAssetManifestCid = prev.cid;
window.latestAssetManifestCid = prev.cid;
window.activeAssetName = prev.assetName;
window.activeAssetTokenId = prev.tokenId;
// Becomes:
uiState.set({ nestingDepth: currentDepth });
// ...
assetState.set({
  activeAssetManifestCid: prev.cid,
  latestAssetManifestCid: prev.cid,
  activeAssetName: prev.assetName,
  activeAssetTokenId: prev.tokenId,
});
```

- [ ] **Step 4: Replace remaining reads**

```js
// Was (line ~202):
const hidePublish = currentDepth > 0 && !window.activeAssetTokenId;
// Becomes:
const hidePublish = currentDepth > 0 && !assetState.get().activeAssetTokenId;

// Was (line ~221):
window._nestingDepth = 0;
// Becomes:
uiState.set({ nestingDepth: 0 });
```

- [ ] **Step 5: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand --silent
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/ui/nesting.js
git commit -m "refactor(nesting): migrate window.* to assetState and uiState stores"
```

---

## Task 12: Migrate `ui/outliner.js`

**Files:**
- Modify: `frontend/src/js/ui/outliner.js`

Reads/writes `window.activeAssetManifestCid`, `window._currentManifest` (asset state) and `window._nestingDepth` (ui state).

- [ ] **Step 1: Add imports**

```js
import { assetState } from "../state/asset-state.js";
import { uiState } from "../state/ui-state.js";
```

- [ ] **Step 2: Replace reads and writes**

```js
// Was (line ~61):
if (window.activeAssetManifestCid) {
// Becomes:
if (assetState.get().activeAssetManifestCid) {

// Was (line ~69):
if (!window.activeAssetManifestCid) return null;
return await getFromRemoteIPFS(window.activeAssetManifestCid);
// Becomes:
const { activeAssetManifestCid } = assetState.get();
if (!activeAssetManifestCid) return null;
return await getFromRemoteIPFS(activeAssetManifestCid);

// Was (line ~78):
const manifest = window._currentManifest;
// Becomes:
const manifest = assetState.get().currentManifest;

// Was (line ~122):
const cid = window.activeAssetManifestCid;
// Becomes:
const cid = assetState.get().activeAssetManifestCid;

// Was (line ~127):
window._currentManifest = manifest;
// Becomes:
assetState.set({ currentManifest: manifest });

// Was (line ~295):
const depth = window._nestingDepth || 0;
// Becomes:
const depth = uiState.get().nestingDepth;
```

- [ ] **Step 3: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/outliner.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/ui/outliner.js
git commit -m "refactor(outliner): migrate window.* to assetState and uiState stores"
```

---

## Task 13: Migrate `ui/asset-library.js` and `engine/studio-init.js`

**Files:**
- Modify: `frontend/src/js/ui/asset-library.js`
- Modify: `frontend/src/js/engine/studio-init.js`

- [ ] **Step 1: Add imports to `asset-library.js`**

```js
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
```

- [ ] **Step 2: Replace reads and writes in `asset-library.js`**

```js
// Was (line ~24):
return walletContract || window.contract || null;
// Becomes:
return walletContract || walletState.get().contract || null;

// Was (lines ~75–77):
window.activeAssetTokenId = String(tokenId);
window.activeAssetManifestCid = cid;
window.latestAssetManifestCid = cid;
// Becomes:
assetState.set({
  activeAssetTokenId: String(tokenId),
  activeAssetManifestCid: cid,
  latestAssetManifestCid: cid,
});

// Was (lines ~166, 221):
const chainId = Number(window.chainId || window.walletChainId || CHAIN_IDS.HARDHAT_LOCAL);
const contractAddress = window.contractAddress || window._contractAddress || null;
// Becomes (both occurrences):
const { chainId: rawChainId, contractAddress: walletContractAddress } = walletState.get();
const chainId = Number(rawChainId || CHAIN_IDS.HARDHAT_LOCAL);
const contractAddress = walletContractAddress || null;

// Was (lines ~317–327):
if (!window.walletAddress || !assetLibraryBody) return;
const { owned, shared } = await fetchAssetLibrary(window.walletAddress);
// ...
el.dataset.tokenId === String(window.activeAssetTokenId)
// Becomes:
const { walletAddress } = walletState.get();
if (!walletAddress || !assetLibraryBody) return;
const { owned, shared } = await fetchAssetLibrary(walletAddress);
// ...
el.dataset.tokenId === String(assetState.get().activeAssetTokenId)
```

- [ ] **Step 3: Migrate `engine/studio-init.js`**

Add import:
```js
import { walletState } from "../state/wallet-state.js";
```

Replace (line ~50):
```js
// Was:
if (window.walletAddress) {
// Becomes:
if (walletState.get().walletAddress) {
```

- [ ] **Step 4: Run full test suite**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand --silent
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/ui/asset-library.js frontend/src/js/engine/studio-init.js
git commit -m "refactor(ui): migrate remaining window.* reads to state stores"
```

---

## Task 14: Verify zero remaining app-state `window.*` globals

- [ ] **Step 1: Audit for remaining app-state globals**

Run this grep — it should return no output:

```bash
grep -rn "window\." frontend/src/js/ --include="*.js" \
  | grep -v \
    "window\.location\|window\.open\|window\.history\|window\.addEventListener\|window\.removeEventListener\|window\.dispatchEvent\|window\.scrollTo\|window\.innerWidth\|window\.innerHeight\|window\.devicePixelRatio\|window\.requestAnimationFrame\|window\.performance\|window\.crypto\|window\.alert\|window\.confirm\|window\.ethereum\|window\.web3\|window\.BABYLON\|window\.Web3\|window\.IpfsHttpClient\|window\.TextDecoder\|window\.TextEncoder\|window\.URL\|window\.Blob\|window\.File\|window\.FileReader\|window\.atob\|window\.btoa\|window\.indexedDB\|window\.fetch\|window\.matchMedia\|window\.__ARBESK_CONFIG__\|new window\."
```

Expected: no output. If any lines appear, fix them before proceeding.

- [ ] **Step 2: Run full test suite**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest --runInBand --silent
```

Expected: All PASS.

- [ ] **Step 3: Build the frontend**

```bash
npm run build:frontend
```

Expected: no errors.

- [ ] **Step 4: Start the dev server and manually verify flows**

```bash
npm start
```

Open `http://localhost:9090` and verify each flow:
- [ ] Connect wallet → wallet address appears in UI
- [ ] Open an existing asset → asset name and token ID appear in status bar
- [ ] Publish / save draft → succeeds, CID updates
- [ ] Dive into a nested world → breadcrumb depth increments, correct asset loads
- [ ] Ascend back to parent → parent asset restores correctly
- [ ] Disconnect wallet → wallet UI resets

- [ ] **Step 5: Commit (if any last-minute fixes were made)**

```bash
git add -p
git commit -m "fix(state): address any remaining window.* refs found in audit"
```

---

## Acceptance Criteria Checklist

- [ ] `frontend/src/js/state/` contains `asset-state.js`, `wallet-state.js`, `ui-state.js`
- [ ] `events/registry.js` contains `ASSET_STATE_CHANGED`, `WALLET_STATE_CHANGED`, `UI_STATE_CHANGED`
- [ ] Zero `window.*` app-state globals remain (audit grep returns no output)
- [ ] `walletChainId` and `_contractAddress` aliases eliminated
- [ ] All unit tests pass
- [ ] Open / publish / burn / nest flows verified manually
