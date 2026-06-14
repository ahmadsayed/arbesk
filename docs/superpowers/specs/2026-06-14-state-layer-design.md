# State Layer Design — Replace `window.*` Globals

**Date:** 2026-06-14  
**Issue:** #16  
**Status:** Approved

---

## Problem

Frontend application state lives in ~12 mutable `window.*` globals with no single source of truth. Any module can read or write them directly, making state changes untraceable, notifications ad-hoc, and isolated testing impractical.

**Globals being replaced:**

| Global | Domain |
|---|---|
| `window.activeAssetManifestCid` | Asset |
| `window.activeAssetTokenId` | Asset |
| `window.activeAssetName` | Asset |
| `window.latestAssetManifestCid` | Asset |
| `window._currentManifest` | Asset |
| `window.walletAddress` | Wallet |
| `window.chainId` | Wallet |
| `window.walletChainId` | Wallet |
| `window.contract` | Wallet |
| `window.contractAddress` / `window._contractAddress` | Wallet |
| `window.selectedNodeId` | UI |
| `window._nestingDepth` | UI |

---

## Decisions

- **Approach:** Option A — plain-JS store modules, no new dependencies.
- **Notifications:** piggyback on the existing `events/registry.js` event bus (`emit` / `on`).
- **Migration:** clean cut — all read and write sites migrated in one pass, no compatibility shims.
- **UI isolation:** `selectedNodeId` and `nestingDepth` go into a separate `ui-state.js` so the UI layer has no import-level coupling to asset/wallet stores.

---

## Architecture

### New modules

```
frontend/src/js/state/
  asset-state.js    — asset fields
  wallet-state.js   — wallet fields
  ui-state.js       — UI navigation fields
```

### Store shape (identical pattern for all three)

```js
const _state = { /* domain fields, all null/0 by default */ };

export const xState = {
  get()           // returns shallow copy of _state
  set(partial)    // Object.assign + emit EVENTS.X_STATE_CHANGED
  reset()         // restore all fields to defaults + emit
};
```

### New event constants (added to `events/registry.js`)

```js
ASSET_STATE_CHANGED:  "asset:stateChanged",
WALLET_STATE_CHANGED: "wallet:stateChanged",
UI_STATE_CHANGED:     "ui:stateChanged",
```

### Field mapping

**`asset-state.js`**
```
activeAssetManifestCid  — was window.activeAssetManifestCid
activeAssetTokenId      — was window.activeAssetTokenId
activeAssetName         — was window.activeAssetName
latestAssetManifestCid  — was window.latestAssetManifestCid
currentManifest         — was window._currentManifest (underscore dropped)
```

**`wallet-state.js`**
```
walletAddress    — was window.walletAddress
chainId          — was window.chainId / window.walletChainId (consolidated)
contract         — was window.contract
contractAddress  — was window.contractAddress / window._contractAddress (consolidated)
```

**`ui-state.js`**
```
selectedNodeId  — was window.selectedNodeId
nestingDepth    — was window._nestingDepth (underscore dropped)
```

---

## Migration Steps

1. **Create** `frontend/src/js/state/asset-state.js`, `wallet-state.js`, `ui-state.js`.
2. **Add** `ASSET_STATE_CHANGED`, `WALLET_STATE_CHANGED`, `UI_STATE_CHANGED` to `events/registry.js`.
3. **Replace writes** — every `window.X = value` becomes `xState.set({ X: value })`.
4. **Replace reads** — every `window.X` becomes `xState.get().X`.
5. **Replace resets** — null-setting blocks in `cleanup.js` become `assetState.reset()` / `uiState.reset()`.
6. **Consolidate aliases** — `walletChainId` and `_contractAddress` usages unified under `chainId` and `contractAddress` in `walletState`.
7. **Remove `window.*` function exports** — `window.connectWallet`, `window.disconnectWallet`, `window.NETWORK_CONFIGS`, `window.getNetworkConfig`, `window.getContractAddress` removed; consumers import directly.
8. **Manual verification** — open asset, publish, burn, nest/ascend, wallet connect/disconnect.

---

## Acceptance Criteria

- [ ] `frontend/src/js/state/` exists with three store modules.
- [ ] `ASSET_STATE_CHANGED`, `WALLET_STATE_CHANGED`, `UI_STATE_CHANGED` added to event registry.
- [ ] Zero `window.*` app-state globals remaining (browser APIs and CDN globals untouched).
- [ ] `walletChainId` and `_contractAddress` aliases eliminated.
- [ ] Open / publish / burn / nest flows verified manually with no behavior change.

---

## Out of Scope

- Replacing `engine/state.js` (Babylon.js scene objects — separate concern, already clean).
- Typed event payloads for the new state-change events (can be added incrementally).
- Automated E2E tests (no E2E framework currently in the project).
