# Event Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all raw `CustomEvent` string literals with a typed central registry (`EVENTS` constants + `emit`/`on` helpers), resolve 7 orphan events, and add unit tests for the registry module.

**Architecture:** A new `frontend/src/js/events/registry.js` module exports 25 named constants, thin `emit`/`on` wrappers over `document.dispatchEvent`/`addEventListener`, and a dev-mode orphan warning. All 32 dispatch sites and 46 listener sites across 18 files are migrated mechanically. Five orphan events get new listeners wired to existing handlers; one gets a stub; two are documented as future-only.

**Tech Stack:** Vanilla JS (ES modules), Jest 29, jest-environment-jsdom

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Create** | `frontend/src/js/events/registry.js` | Event constants, emit/on helpers, dev warning |
| **Create** | `test/events/registry.test.js` | Unit tests for registry (jsdom env) |
| **Modify** | `frontend/src/js/engine/cleanup.js` | 1 dispatch |
| **Modify** | `frontend/src/js/engine/theme.js` | 1 dispatch |
| **Modify** | `frontend/src/js/engine/scene-graph.js` | 7 dispatches + 2 listeners |
| **Modify** | `frontend/src/js/engine/parametric-preview.js` | 1 dispatch + 5 listeners (+ 1 new orphan listener) |
| **Modify** | `frontend/src/js/blockchain/wallet.js` | 10 dispatches |
| **Modify** | `frontend/src/js/engine/studio-init.js` | 4 listeners |
| **Modify** | `frontend/src/js/services/api.js` | 1 listener |
| **Modify** | `frontend/src/js/ui/outliner.js` | 4 dispatches + 3 listeners + 2 new orphan listeners |
| **Modify** | `frontend/src/js/ui/nesting.js` | 2 dispatches + 2 listeners |
| **Modify** | `frontend/src/js/ui/collaborators.js` | 1 dispatch + 4 listeners |
| **Modify** | `frontend/src/js/ui/asset-save.js` | 2 dispatches + 4 listeners |
| **Modify** | `frontend/src/js/ui/asset-drop-zone.js` | 2 dispatches + 1 listener |
| **Modify** | `frontend/src/js/ui/asset-library.js` | 1 dispatch + 6 listeners + 1 new orphan listener |
| **Modify** | `frontend/src/js/ui/asset-history.js` | 4 listeners |
| **Modify** | `frontend/src/js/ui/create-panel.js` | 4 listeners |
| **Modify** | `frontend/src/js/ui/ledger-panel.js` | 3 listeners + 1 new orphan listener |
| **Modify** | `frontend/src/js/ui/asset-editors.js` | 1 listener |

---

## Task 1: Install test dependency + write failing tests

**Files:**
- Install: `jest-environment-jsdom`
- Create: `test/events/registry.test.js`

- [ ] **Step 1: Install jest-environment-jsdom**

```bash
npm install --save-dev jest-environment-jsdom
```

Expected: package-lock.json updates, `node_modules/jest-environment-jsdom` appears.

- [ ] **Step 2: Write the failing test file**

Create `test/events/registry.test.js`:

```js
/**
 * @jest-environment jsdom
 */

import { jest } from "@jest/globals";
import {
  EVENTS,
  emit,
  on,
  _resetListenerCounts,
} from "../../frontend/src/js/events/registry.js";

beforeEach(() => {
  _resetListenerCounts();
});

// ─── EVENTS constants ────────────────────────────────────────────────────────

describe("EVENTS constants", () => {
  test("all values are non-empty strings", () => {
    for (const value of Object.values(EVENTS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test("all 25 values are unique", () => {
    const values = Object.values(EVENTS);
    expect(new Set(values).size).toBe(25);
    expect(values).toHaveLength(25);
  });

  test("spot-check: EVENTS.SCENE_READY === 'scene:ready'", () => {
    expect(EVENTS.SCENE_READY).toBe("scene:ready");
  });

  test("spot-check: EVENTS.ASSET_BURNED === 'asset:burned'", () => {
    expect(EVENTS.ASSET_BURNED).toBe("asset:burned");
  });

  test("spot-check: EVENTS.WALLET_GENERATION_PAID === 'wallet:generationPaid'", () => {
    expect(EVENTS.WALLET_GENERATION_PAID).toBe("wallet:generationPaid");
  });
});

// ─── emit + on ───────────────────────────────────────────────────────────────

describe("emit + on", () => {
  test("handler registered with on() receives event dispatched by emit()", () => {
    const handler = jest.fn();
    on(EVENTS.SCENE_READY, handler);
    emit(EVENTS.SCENE_READY, { manifest: { name: "test" }, manifestCid: "Qm123" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      manifest: { name: "test" },
      manifestCid: "Qm123",
    });
    document.removeEventListener(EVENTS.SCENE_READY, handler);
  });

  test("emit() with no detail argument produces event with null detail", () => {
    const handler = jest.fn();
    on(EVENTS.NODE_DESELECTED, handler);
    emit(EVENTS.NODE_DESELECTED);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toBeNull();
    document.removeEventListener(EVENTS.NODE_DESELECTED, handler);
  });

  test("multiple on() handlers for the same event all fire", () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    on(EVENTS.WALLET_CONNECTED, h1);
    on(EVENTS.WALLET_CONNECTED, h2);
    emit(EVENTS.WALLET_CONNECTED, { walletAddress: "0xABC" });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    document.removeEventListener(EVENTS.WALLET_CONNECTED, h1);
    document.removeEventListener(EVENTS.WALLET_CONNECTED, h2);
  });

  test("handler for event A does not fire when event B is emitted", () => {
    const handler = jest.fn();
    on(EVENTS.ASSET_BURNED, handler);
    emit(EVENTS.ASSET_PUBLISHED, { manifestCid: "Qm456", tokenId: "1" });
    expect(handler).not.toHaveBeenCalled();
    document.removeEventListener(EVENTS.ASSET_BURNED, handler);
  });
});

// ─── dev-mode orphan warning ─────────────────────────────────────────────────

describe("dev-mode orphan warning", () => {
  // jsdom sets location.hostname = "localhost" so _isDev is true in tests.

  test("warns when emitting an event with no registered listeners", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    emit(EVENTS.ASSET_CLEARED); // no on() registered for this event
    expect(warnSpy).toHaveBeenCalledWith(
      '[EVENTS] "asset:cleared" dispatched with no registered listeners'
    );
    warnSpy.mockRestore();
  });

  test("does not warn when at least one listener is registered", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    on(EVENTS.ASSET_CLEARED, () => {});
    emit(EVENTS.ASSET_CLEARED);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("registering listener for event A does not suppress warning for event B", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    on(EVENTS.SCENE_READY, () => {});
    emit(EVENTS.SCENE_EMPTY); // different event, no listener
    expect(warnSpy).toHaveBeenCalledWith(
      '[EVENTS] "scene:empty" dispatched with no registered listeners'
    );
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 3: Run test to confirm it fails with "module not found"**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/events/registry.test.js --runInBand
```

Expected: `Cannot find module '../../frontend/src/js/events/registry.js'`

---

## Task 2: Create registry.js (make tests pass)

**Files:**
- Create: `frontend/src/js/events/registry.js`

- [ ] **Step 1: Create the events directory and registry module**

Create `frontend/src/js/events/registry.js`:

```js
/**
 * Arbesk Studio Event Registry
 *
 * Single source of truth for all CustomEvent names. Import EVENTS constants
 * instead of raw strings, and use emit()/on() instead of raw dispatchEvent/addEventListener.
 */

// ─── Event Name Constants ─────────────────────────────────────────────────────

export const EVENTS = {
  ASSET_ADD_LINKED_REQUESTED: "asset:addLinkedRequested",
  ASSET_BURNED:               "asset:burned",
  ASSET_CLEARED:              "asset:cleared",
  ASSET_DRAFT_SAVED:          "asset:draftSaved",
  ASSET_LINKED_DROPPED:       "asset:linkedDropped",
  ASSET_OPEN_BY_TOKEN_ID:     "asset:openByTokenId",
  ASSET_PUBLISHED:            "asset:published",
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
  USER_AUTHENTICATED:         "user:authenticated",
  USER_AUTH_REQUIRED:         "user:auth-required",
  WALLET_CONNECTED:           "wallet:connected",
  WALLET_DISCONNECTED:        "wallet:disconnected",
  WALLET_GENERATION_PAID:     "wallet:generationPaid",
};

// ─── Payload Typedefs ─────────────────────────────────────────────────────────

/**
 * @typedef {{ manifest: object, manifestCid: string }} SceneReadyDetail
 * @typedef {{ nodeId: string, mesh: object }} NodeSelectedDetail
 * @typedef {{ nodeId: string, meshName: string }} SubmeshSelectedDetail
 * @typedef {{ theme: string }} ThemeChangedDetail
 * @typedef {{ walletAddress: string, chainId: number }} WalletConnectedDetail
 * @typedef {{ tokenId: string, txHash: string }} AssetBurnedDetail
 * @typedef {{ cid: string }} AssetDraftSavedDetail
 * @typedef {{ manifestCid: string, tokenId: string }} AssetPublishedDetail
 * @typedef {{ childRef: object, nodeId: string }} NestingDiveRequestedDetail
 * @typedef {{ depth: number, name: string }} NestingDidDiveDetail
 * @typedef {{ depth: number, name: string }} NestingDidAscendDetail
 * @typedef {{ nodeId: string }} OutlinerNodeSelectedDetail
 * @typedef {{ nodeId: string }} OutlinerRemoveRequestedDetail
 * @typedef {{ nodeId: string, childRef: object, tokenId: string, contractAddress: string, chainId: number }} AssetLinkedDroppedDetail
 * @typedef {{ tokenId: string }} AssetOpenByTokenIdDetail
 * @typedef {{ txHash: string, nodeId: string, prompt: string }} WalletGenerationPaidDetail
 * @typedef {{ nodeId: string, tokenId: string }} SceneTokenChildAddedDetail
 * @typedef {{ nodeId: string, url: string }} AssetAddLinkedRequestedDetail
 */

// ─── Listener Count Tracking (dev-mode orphan detection) ─────────────────────

/** @type {Map<string, number>} */
const _listenerCounts = new Map();

const _isDev =
  typeof location !== "undefined" && location.hostname === "localhost";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Dispatch a named CustomEvent on document.
 * In dev mode, warns to the console if no listeners are registered.
 *
 * @param {string} name - Use an EVENTS.* constant
 * @param {*} [detail]  - Optional payload
 */
export function emit(name, detail) {
  if (_isDev && !_listenerCounts.get(name)) {
    console.warn(`[EVENTS] "${name}" dispatched with no registered listeners`);
  }
  document.dispatchEvent(
    detail !== undefined
      ? new CustomEvent(name, { detail })
      : new CustomEvent(name)
  );
}

/**
 * Register a CustomEvent listener on document.
 *
 * @param {string}        name    - Use an EVENTS.* constant
 * @param {EventListener} handler
 */
export function on(name, handler) {
  _listenerCounts.set(name, (_listenerCounts.get(name) || 0) + 1);
  document.addEventListener(name, handler);
}

/**
 * Reset listener counts. Only call this in tests.
 * @internal
 */
export function _resetListenerCounts() {
  _listenerCounts.clear();
}
```

- [ ] **Step 2: Run tests**

```bash
NODE_OPTIONS=--experimental-vm-modules NODE_NO_WARNINGS=1 npx jest test/events/registry.test.js --runInBand
```

Expected: all 14 tests pass, 0 failures.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/js/events/registry.js test/events/registry.test.js package.json package-lock.json
git commit -m "feat(events): add typed event registry with emit/on helpers and dev-mode orphan warning"
```

---

## Task 3: Migrate engine/ files

**Files:**
- Modify: `frontend/src/js/engine/cleanup.js`
- Modify: `frontend/src/js/engine/theme.js`
- Modify: `frontend/src/js/engine/scene-graph.js`
- Modify: `frontend/src/js/engine/parametric-preview.js`

The migration pattern is the same in every file:

**Import line to add** (relative path from any file under `frontend/src/js/*/`):
```js
import { emit, on, EVENTS } from "../events/registry.js";
```
(Only import what the file needs: dispatch-only files need just `emit, EVENTS`; listen-only need `on, EVENTS`; both need all three.)

**Dispatch replacement pattern:**
```js
// Before:
document.dispatchEvent(new CustomEvent("scene:cleared"));
document.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme } }));

// After:
emit(EVENTS.SCENE_CLEARED);
emit(EVENTS.THEME_CHANGED, { theme });
```

**Listen replacement pattern:**
```js
// Before:
document.addEventListener("scene:ready", onSceneReady);

// After:
on(EVENTS.SCENE_READY, onSceneReady);
```

- [ ] **Step 1: Migrate `engine/cleanup.js`**

Add import after the existing `import { state }` line:
```js
import { emit, EVENTS } from "../events/registry.js";
```

Replace line 127:
```js
// Before:
document.dispatchEvent(new CustomEvent("scene:cleared"));
// After:
emit(EVENTS.SCENE_CLEARED);
```

- [ ] **Step 2: Migrate `engine/theme.js`**

Add import at the top of the import block:
```js
import { emit, EVENTS } from "../events/registry.js";
```

Replace the `dispatchEvent` call (line ~88):
```js
// Before:
document.dispatchEvent(new CustomEvent("theme:changed", { detail: { theme } }));
// After:
emit(EVENTS.THEME_CHANGED, { theme });
```

- [ ] **Step 3: Migrate `engine/scene-graph.js` — dispatches**

Add import to the import block:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace all 7 dispatch sites:
```js
// line ~367
// Before: document.dispatchEvent(new CustomEvent("node:selected", { detail: { nodeId, mesh } }))
emit(EVENTS.NODE_SELECTED, { nodeId, mesh });

// line ~391
// Before: document.dispatchEvent(new CustomEvent("submesh:selected", { detail: { nodeId, meshName } }))
emit(EVENTS.SUBMESH_SELECTED, { nodeId, meshName });

// line ~432
// Before: document.dispatchEvent(new CustomEvent("node:deselected"));
emit(EVENTS.NODE_DESELECTED);

// line ~895
// Before: document.dispatchEvent(new CustomEvent("scene:ready", { detail: { manifest, manifestCid } }))
emit(EVENTS.SCENE_READY, { manifest, manifestCid });

// line ~1000
// Before: document.dispatchEvent(new CustomEvent("scene:tokenChildAdded", { detail: { ... } }))
emit(EVENTS.SCENE_TOKEN_CHILD_ADDED, { nodeId, tokenId }); // preserve actual detail shape

// line ~1223
// Before: document.dispatchEvent(new CustomEvent("asset:openByTokenId", { detail: { tokenId } }))
emit(EVENTS.ASSET_OPEN_BY_TOKEN_ID, { tokenId });

// line ~1269
// Before: document.dispatchEvent(new CustomEvent("scene:empty"));
emit(EVENTS.SCENE_EMPTY);
```

Replace the 2 listen sites in `scene-graph.js`:
```js
// line ~245 (inside initEngine or equivalent)
// Before: document.addEventListener("theme:changed", () => { ... })
on(EVENTS.THEME_CHANGED, () => { /* existing handler body */ });

// line ~1304 (inside init)
// Before: document.addEventListener("asset:linkedDropped", handleLinkedAssetDropped)
on(EVENTS.ASSET_LINKED_DROPPED, handleLinkedAssetDropped);
```

- [ ] **Step 4: Migrate `engine/parametric-preview.js` — existing dispatch + listeners**

Add import:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace dispatch (line ~309):
```js
// Before: document.dispatchEvent(new CustomEvent("nesting:diveRequested", { detail: { childRef, nodeId } }))
emit(EVENTS.NESTING_DIVE_REQUESTED, { childRef, nodeId: activeNodeId });
```

Replace 5 existing listeners (lines 288–372):
```js
// Before:
document.addEventListener("node:selected", onNodeSelected);
document.addEventListener("outliner:nodeSelected", onNodeSelected);
document.addEventListener("submesh:selected", (e) => { ... });
document.addEventListener("asset:draftSaved", () => { ... });
document.addEventListener("scene:tokenChildAdded", onTokenChildAdded);

// After:
on(EVENTS.NODE_SELECTED, onNodeSelected);
on(EVENTS.OUTLINER_NODE_SELECTED, onNodeSelected);
on(EVENTS.SUBMESH_SELECTED, (e) => { /* existing body */ });
on(EVENTS.ASSET_DRAFT_SAVED, () => { /* existing body */ });
on(EVENTS.SCENE_TOKEN_CHILD_ADDED, onTokenChildAdded);
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/engine/cleanup.js frontend/src/js/engine/theme.js frontend/src/js/engine/scene-graph.js frontend/src/js/engine/parametric-preview.js
git commit -m "refactor(events): migrate engine layer to typed event registry"
```

---

## Task 4: Migrate blockchain/ + services/ files

**Files:**
- Modify: `frontend/src/js/blockchain/wallet.js`
- Modify: `frontend/src/js/engine/studio-init.js`
- Modify: `frontend/src/js/services/api.js`

- [ ] **Step 1: Migrate `blockchain/wallet.js`**

Add import at the top of the import block:
```js
import { emit, EVENTS } from "../events/registry.js";
```

Replace all 10 dispatch sites (use the string in each call to identify the right constant):

| String | Replacement |
|--------|-------------|
| `"wallet:connected"` (×3) | `emit(EVENTS.WALLET_CONNECTED, { walletAddress, chainId })` |
| `"user:authenticated"` | `emit(EVENTS.USER_AUTHENTICATED, { ... })` |
| `"user:auth-required"` | `emit(EVENTS.USER_AUTH_REQUIRED, { ... })` |
| `"wallet:disconnected"` | `emit(EVENTS.WALLET_DISCONNECTED)` |
| `"wallet:generationPaid"` (×2) | `emit(EVENTS.WALLET_GENERATION_PAID, { txHash, nodeId, ... })` |
| `"asset:published"` | `emit(EVENTS.ASSET_PUBLISHED, { manifestCid, tokenId })` |
| `"asset:burned"` | `emit(EVENTS.ASSET_BURNED, { tokenId, txHash })` |

Preserve the exact `detail` object shape at each site — only change the dispatch call.

- [ ] **Step 2: Migrate `engine/studio-init.js`**

Add import:
```js
import { on, EVENTS } from "../events/registry.js";
```

Replace 4 listeners:
```js
// Before:
document.addEventListener("wallet:connected", (e) => { ... });
document.addEventListener("wallet:disconnected", () => { ... });
document.addEventListener("user:authenticated", (e) => { ... });
document.addEventListener("user:auth-required", (e) => { ... });

// After:
on(EVENTS.WALLET_CONNECTED, (e) => { /* existing body */ });
on(EVENTS.WALLET_DISCONNECTED, () => { /* existing body */ });
on(EVENTS.USER_AUTHENTICATED, (e) => { /* existing body */ });
on(EVENTS.USER_AUTH_REQUIRED, (e) => { /* existing body */ });
```

- [ ] **Step 3: Migrate `services/api.js`**

Add import:
```js
import { on, EVENTS } from "../events/registry.js";
```

Replace 1 listener (line ~107):
```js
// Before: document.addEventListener("wallet:disconnected", () => { ... })
on(EVENTS.WALLET_DISCONNECTED, () => { /* existing body */ });
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/js/blockchain/wallet.js frontend/src/js/engine/studio-init.js frontend/src/js/services/api.js
git commit -m "refactor(events): migrate blockchain/services layer to typed event registry"
```

---

## Task 5: Migrate ui/ files

**Files:** `outliner.js`, `nesting.js`, `collaborators.js`, `asset-save.js`, `asset-drop-zone.js`, `asset-library.js`, `asset-history.js`, `create-panel.js`, `ledger-panel.js`, `asset-editors.js`

All use the same pattern: add `import { emit, on, EVENTS } from "../events/registry.js";` and replace string literals.

- [ ] **Step 1: Migrate `ui/outliner.js`**

Add import after existing imports:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace 4 dispatches:
```js
// line ~213
emit(EVENTS.OUTLINER_NODE_SELECTED, { nodeId });

// line ~232
emit(EVENTS.NESTING_DIVE_REQUESTED, { childRef, nodeId });

// line ~246
emit(EVENTS.OUTLINER_REMOVE_REQUESTED, { nodeId: selectedNodeId });

// line ~279
emit(EVENTS.ASSET_LINKED_DROPPED, { nodeId, childRef, tokenId, contractAddress, chainId }); // preserve actual detail
```

Replace 3 existing listeners:
```js
on(EVENTS.SCENE_READY, onSceneReady);
on(EVENTS.SCENE_EMPTY, onSceneEmpty);
on(EVENTS.ASSET_DRAFT_SAVED, () => refreshOutliner());
```

- [ ] **Step 2: Migrate `ui/nesting.js`**

Add import:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace 2 dispatches:
```js
emit(EVENTS.NESTING_DID_DIVE, { depth: currentDepth, name: manifest.name });
emit(EVENTS.NESTING_DID_ASCEND, { depth: currentDepth, name: prev.name });
```

Replace 2 listeners:
```js
on(EVENTS.NESTING_DIVE_REQUESTED, onDiveRequested);
on(EVENTS.SCENE_EMPTY, resetNesting);
```

- [ ] **Step 3: Migrate `ui/collaborators.js`**

Add import:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace 1 dispatch:
```js
emit(EVENTS.ASSET_CLEARED);
```

Replace 4 listeners:
```js
on(EVENTS.ASSET_PUBLISHED, () => refreshTeamPanel());
on(EVENTS.WALLET_CONNECTED, () => refreshTeamPanel());
on(EVENTS.ASSET_DRAFT_SAVED, () => refreshTeamPanel());
on(EVENTS.SCENE_READY, () => refreshTeamPanel());
```

- [ ] **Step 4: Migrate `ui/asset-save.js`**

Add import:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace 2 dispatches:
```js
emit(EVENTS.ASSET_DRAFT_SAVED, { cid });
emit(EVENTS.ASSET_PUBLISHED, { manifestCid, tokenId }); // preserve actual detail shape
```

Replace 4 listeners:
```js
on(EVENTS.SCENE_READY, (e) => { /* existing body */ });
on(EVENTS.SCENE_EMPTY, () => { /* existing body */ });
on(EVENTS.WALLET_CONNECTED, updateButtonState);
on(EVENTS.WALLET_DISCONNECTED, () => { /* existing body */ });
```

- [ ] **Step 5: Migrate `ui/asset-drop-zone.js`**

Add import:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace 2 dispatches (lines ~61, ~74):
```js
emit(EVENTS.ASSET_LINKED_DROPPED, { nodeId, childRef, tokenId, contractAddress, chainId });
```

Replace 1 listener:
```js
on(EVENTS.ASSET_ADD_LINKED_REQUESTED, (event) => { /* existing body */ });
```

- [ ] **Step 6: Migrate `ui/asset-library.js`**

Add import:
```js
import { emit, on, EVENTS } from "../events/registry.js";
```

Replace 1 dispatch:
```js
emit(EVENTS.ASSET_ADD_LINKED_REQUESTED, { nodeId, url }); // preserve actual detail shape
```

Replace 6 listeners:
```js
on(EVENTS.SCENE_READY, highlightActiveAsset);
on(EVENTS.ASSET_PUBLISHED, async () => { /* existing body */ });
on(EVENTS.ASSET_BURNED, async () => { /* existing body */ });
on(EVENTS.ASSET_OPEN_BY_TOKEN_ID, (e) => { /* existing body */ });
on(EVENTS.WALLET_CONNECTED, async () => { /* existing body */ });
on(EVENTS.WALLET_DISCONNECTED, () => { /* existing body */ });
```

- [ ] **Step 7: Migrate `ui/asset-history.js`**

Add import:
```js
import { on, EVENTS } from "../events/registry.js";
```

Replace 5 listeners:
```js
on(EVENTS.SCENE_READY, (e) => { /* existing body */ });
on(EVENTS.WALLET_CONNECTED, () => { /* existing body */ });
on(EVENTS.ASSET_PUBLISHED, () => { /* existing body */ });
on(EVENTS.ASSET_DRAFT_SAVED, () => { /* existing body */ });
on(EVENTS.SCENE_EMPTY, () => { /* existing body */ });
```

- [ ] **Step 8: Migrate `ui/create-panel.js`**

Add import:
```js
import { on, EVENTS } from "../events/registry.js";
```

Replace 4 listeners:
```js
on(EVENTS.SCENE_READY, (event) => { /* existing body */ });
on(EVENTS.SCENE_EMPTY, () => { /* existing body */ });
on(EVENTS.WALLET_CONNECTED, () => { /* existing body */ });
on(EVENTS.WALLET_DISCONNECTED, () => { /* existing body */ });
```

- [ ] **Step 9: Migrate `ui/ledger-panel.js`**

Add import:
```js
import { on, EVENTS } from "../events/registry.js";
```

Replace 3 existing listeners (inside the `initLedgerPanel` function):
```js
on(EVENTS.SCENE_READY, () => loadActivities());
on(EVENTS.ASSET_DRAFT_SAVED, () => loadActivities());
on(EVENTS.ASSET_PUBLISHED, () => loadActivities());
```

- [ ] **Step 10: Migrate `ui/asset-editors.js`**

Add import:
```js
import { on, EVENTS } from "../events/registry.js";
```

Replace 1 listener:
```js
on(EVENTS.ASSET_PUBLISHED, (e) => { /* existing body */ });
```

- [ ] **Step 11: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/js/ui/
git commit -m "refactor(events): migrate ui layer to typed event registry"
```

---

## Task 6: Wire orphan listeners

**Files:**
- Modify: `frontend/src/js/ui/outliner.js` — 2 new listeners
- Modify: `frontend/src/js/engine/parametric-preview.js` — 1 new listener
- Modify: `frontend/src/js/ui/asset-library.js` — 1 new listener
- Modify: `frontend/src/js/ui/ledger-panel.js` — 1 new listener
- Modify: `frontend/src/js/engine/scene-graph.js` — 1 new stub listener

> All `import` lines for these files were already added in Tasks 3–5. Just add the new `on()` calls.

- [ ] **Step 1: `outliner.js` — wire `scene:cleared` and `node:deselected`**

In `outliner.js`, find the block where `initOutliner()` registers its listeners (the three `on()` calls added in Task 5). Add two more calls immediately after:

```js
on(EVENTS.SCENE_CLEARED, onSceneEmpty);   // clear tree when engine wipes the scene
on(EVENTS.NODE_DESELECTED, clearSelection); // deselect row when viewport deselects
```

`onSceneEmpty` and `clearSelection` are already defined in this file — no new functions needed.

- [ ] **Step 2: `parametric-preview.js` — wire `scene:cleared`**

At the bottom of `parametric-preview.js`, after the existing `on()` calls, add:

```js
on(EVENTS.SCENE_CLEARED, closeInspector); // close inspector when engine clears scene
```

`closeInspector` is already defined in this file. It safely handles a cleared scene because it guards on `activeNodeId` and `getNodeMeshes` returns `[]` when meshes are gone.

- [ ] **Step 3: `asset-library.js` — wire `asset:cleared`**

In `asset-library.js`, after the existing `on(EVENTS.ASSET_BURNED, ...)` call, add:

```js
on(EVENTS.ASSET_CLEARED, async () => {
  const url = new URL(window.location);
  url.searchParams.delete("asset");
  url.searchParams.delete("manifest");
  window.history.replaceState({}, "", url);
  await refreshAssetLibrary();
});
```

This is the same body as the `ASSET_BURNED` handler. `refreshAssetLibrary` is already defined and used in this file.

- [ ] **Step 4: `ledger-panel.js` — wire `wallet:generationPaid`**

In `ledger-panel.js`, inside the `initLedgerPanel` function, after the existing three `on()` calls, add:

```js
on(EVENTS.WALLET_GENERATION_PAID, () => loadActivities());
```

`loadActivities` is already defined in this file.

- [ ] **Step 5: `scene-graph.js` — wire `outliner:removeRequested` stub**

At the bottom of `scene-graph.js` (before the export block), add:

```js
on(EVENTS.OUTLINER_REMOVE_REQUESTED, ({ detail }) => {
  // TODO(#18): implement node removal from manifest
  console.warn("[SCENE] outliner:removeRequested not yet implemented for nodeId:", detail?.nodeId);
});
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/js/ui/outliner.js frontend/src/js/engine/parametric-preview.js frontend/src/js/ui/asset-library.js frontend/src/js/ui/ledger-panel.js frontend/src/js/engine/scene-graph.js
git commit -m "feat(events): wire listeners for 5 orphan events, stub outliner:removeRequested"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite one last time**

```bash
npm test
```

Expected: all tests pass. The registry test suite (14 tests) is included.

- [ ] **Step 2: Verify dev-mode warning is silenced for all events**

Start the dev server (`npm start` or `npm run nodemon`) and open the app in a browser at `http://localhost:9090`. Open the browser console. The `[EVENTS]` orphan warning should no longer fire for any event during normal use. If a warning appears, that event still has no listener — investigate before closing the issue.

- [ ] **Step 3: Manual smoke test**

| Flow | What to verify |
|------|---------------|
| Open the app, connect wallet | No `[EVENTS]` warnings in console |
| Select a node in the viewport | Inspector opens; outliner row highlights |
| Click canvas to deselect | Inspector closes; outliner row clears |
| Create a new asset (mock mode) | Ledger panel shows new entry without manual refresh |
| Burn an asset | Gallery refreshes; URL params cleared |
| Dive into a child world | Inspector closes cleanly |
| Navigate back | Inspector closes cleanly |
| Click Remove button in outliner | `console.warn("[SCENE] outliner:removeRequested not yet implemented...")` — no crash |

- [ ] **Step 4: Confirm no raw string CustomEvent calls remain**

```bash
grep -rn 'new CustomEvent("' frontend/src/js --include="*.js"
```

Expected: no output.

```bash
grep -rn 'addEventListener("[a-z]' frontend/src/js --include="*.js" | grep -v "eip6963"
```

Expected: no output.
