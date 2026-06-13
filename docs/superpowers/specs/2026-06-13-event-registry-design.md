# Event Registry Design

**Issue**: #17 — Formalize the CustomEvent bus with a typed registry  
**Date**: 2026-06-13  
**Status**: Approved

---

## Problem

Inter-module communication uses string-keyed `CustomEvent`s dispatched on `document` with no central registry. 25 distinct event names exist as free-form strings across 33 dispatch sites and ~25 listener sites. 7 events are dispatched with zero listeners ("orphans"), which is the same failure mode as the recently-fixed burn-gallery bug (`asset:burned` dispatched into the void).

---

## Architecture

### New file: `frontend/src/js/events/registry.js`

Single module that owns the event contract. Three exports:

**1. Event name constants**
```js
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
```

**2. Payload typedefs (JSDoc)**  
One `@typedef` per event documenting the `detail` shape. No runtime cost.

**3. `emit` / `on` helpers**
```js
export function emit(name, detail) { ... }
export function on(name, handler) { ... }
```
Thin wrappers over `document.dispatchEvent(new CustomEvent(...))` and `document.addEventListener`. In development (`location.hostname === "localhost"`), `emit` logs a console warning if the event has zero registered listeners at dispatch time (catches orphans early).

### Dev-mode orphan detection

A `Map<eventName, count>` tracks listener registrations. `on()` increments the count. `emit()` checks the count and warns if zero. This is build-free and has no prod overhead.

---

## Migration

All call sites are updated mechanically:

- `document.dispatchEvent(new CustomEvent("foo:bar", { detail }))` → `emit(EVENTS.FOO_BAR, detail)`
- `document.addEventListener("foo:bar", handler)` → `on(EVENTS.FOO_BAR, handler)`

Each file adds `import { emit, on, EVENTS } from "../events/registry.js"` (path adjusted per file location). No behavior changes during migration.

**Files touched** (dispatch + listen sites):

| File | Dispatches | Listens |
|------|-----------|---------|
| `engine/cleanup.js` | scene:cleared | — |
| `engine/scene-graph.js` | node:selected, submesh:selected, node:deselected, scene:ready, scene:tokenChildAdded, scene:empty, asset:openByTokenId | — |
| `engine/parametric-preview.js` | nesting:diveRequested | node:selected, outliner:nodeSelected, submesh:selected |
| `engine/theme.js` | theme:changed | — |
| `ui/outliner.js` | outliner:nodeSelected, nesting:diveRequested, outliner:removeRequested, asset:linkedDropped | scene:ready, scene:empty, asset:draftSaved |
| `ui/nesting.js` | nesting:didDive, nesting:didAscend | scene:empty |
| `ui/asset-drop-zone.js` | asset:linkedDropped | — |
| `ui/asset-library.js` | asset:addLinkedRequested | asset:burned, asset:openByTokenId, wallet:connected, asset:published, asset:draftSaved |
| `ui/collaborators.js` | asset:cleared | wallet:connected, asset:draftSaved, scene:ready |
| `ui/asset-save.js` | asset:draftSaved, asset:published | scene:ready, scene:empty, wallet:connected |
| `ui/create-panel.js` | — | scene:ready, scene:empty, wallet:connected |
| `ui/asset-history.js` | — | scene:ready, scene:empty |
| `ui/ledger-panel.js` | — | scene:ready, asset:draftSaved, asset:published |
| `ui/asset-editors.js` | — | theme:changed |
| `blockchain/wallet.js` | wallet:connected, wallet:disconnected, wallet:generationPaid, user:authenticated, user:auth-required, asset:published, asset:burned | — |
| `engine/studio-init.js` | — | wallet:connected, wallet:disconnected, user:authenticated, user:auth-required |
| `engine/scene-graph.js` (theme) | — | theme:changed |
| `ui/asset-history.js` (wallet) | — | wallet:connected |
| `services/api.js` | — | wallet:disconnected |

---

## Orphan Resolutions

### `scene:cleared` (dispatched from `cleanup.js:clearScene()`)
**Problem**: when the engine clears the 3D scene (before loading a new asset), neither the outliner nor the inspector react.  
**Fix**: 
- `outliner.js`: add `on(EVENTS.SCENE_CLEARED, onSceneEmpty)` — reuses existing handler (clears tree + selection)
- `parametric-preview.js`: add `on(EVENTS.SCENE_CLEARED, closeInspector)` — clears inspector panel and pending color edits; safe because `closeInspector` guards nulls when meshes are gone

### `asset:cleared` (dispatched from `collaborators.js` when user loses access)
**Problem**: gallery doesn't refresh when the active asset is cleared (same failure class as the burn bug).  
**Fix**: `asset-library.js`: add handler identical to `asset:burned` handler (clear URL params + `refreshAssetLibrary()`)

### `node:deselected` (dispatched from `scene-graph.js:deselectAll()`)
**Problem**: outliner row stays highlighted after node is deselected in the viewport.  
**Fix**: `outliner.js`: add `on(EVENTS.NODE_DESELECTED, clearSelection)` — `clearSelection()` is idempotent; no loop because the event fires from `deselectAll()` which `closeInspector()` also calls, but `clearSelection()` is safe to call multiple times.

### `wallet:generationPaid` (dispatched from `blockchain/wallet.js`)
**Problem**: ledger panel doesn't show new generation activity after payment confirmation.  
**Fix**: `ledger-panel.js`: add `on(EVENTS.WALLET_GENERATION_PAID, () => loadActivities())` — reuses existing function.

### `nesting:didDive` / `nesting:didAscend`
**Analysis**: dispatched after `loadAssetManifest()` completes (scene is already re-loaded). The `scene:cleared` + `scene:ready` cycle already resets and re-populates all UI panels. These events carry `{ depth, name }` for future consumers (animations, logging, breadcrumb effects). No missing behavior identified.  
**Fix**: register as documented constants in registry; no new listeners needed.

### `outliner:removeRequested` (dispatched from `outliner.js` Remove button)
**Analysis**: button exists, event dispatches, but no scene-graph function implements node removal. Implementing full manifest-aware node removal is outside the scope of this refactoring.  
**Fix**: register in registry + add a listener stub in `scene-graph.js` that logs `console.warn("[SCENE] outliner:removeRequested not yet implemented")`. Tracks the intent without silently dropping the event.

---

## Data Flow

```
User action
    │
    ▼
emit(EVENTS.X, detail)          ← replaces: new CustomEvent("x", {detail})
    │  dev-mode: warn if 0 listeners
    ▼
document CustomEvent "x"
    │
    ├──► on(EVENTS.X, handlerA)  ← replaces: addEventListener("x", ...)
    └──► on(EVENTS.X, handlerB)
```

No new indirection at runtime. The registry is just constants + two one-liner functions.

---

## Testing

No automated E2E currently. Manual verification after implementation:

- [ ] Open asset → `scene:ready` fires, outliner + history + ledger populate
- [ ] Burn asset → gallery refreshes (existing `asset:burned` path)
- [ ] Use Remove button in outliner → console.warn appears, no crash
- [ ] Select node in viewport → inspector opens; click elsewhere to deselect → outliner row clears
- [ ] Generate new asset (paid) → ledger shows new entry without manual refresh
- [ ] Lose collaborator access → gallery refreshes (`asset:cleared`)
- [ ] Dive into child world → inspector closes cleanly
- [ ] Navigate back → inspector closes cleanly

---

## Acceptance Criteria (from issue #17)

- [x] All event names defined as constants in one registry module
- [x] `emit()` / `on()` helpers used at all dispatch/listen sites
- [x] Each event has a documented payload shape (JSDoc typedef)
- [x] Dev-mode warning flags dispatched-but-unlistened events
- [x] All 7 orphans resolved (5 get listeners, 2 documented as future-only, 1 gets stub)
- [x] No behavior change to existing flows
