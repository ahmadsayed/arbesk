# Version Clock Gizmo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the headerbar version scrubber with two clock-hand gizmos — a fixed bottom-right scene clock and a selection-following model clock — per `docs/superpowers/specs/2026-07-07-version-clock-gizmo-design.md`.

**Architecture:** A headless `version-history-store.js` (logic extracted from `ui/asset-history.js`) feeds two thin DOM/SVG views built on one reusable `version-clock.js` face component. The model clock is positioned per frame by projecting the selected node's bounding-box top to screen space, initialized from `scene-graph.js` like the existing gizmos.

**Tech Stack:** Vanilla ES modules (`.js` + `checkJs` TypeScript), SVG via `createElementNS`, SCSS tokens, mitt event bus, Jest (`jest.unstable_mockModule` + dynamic import), Playwright E2E.

## Global Constraints

- Source files stay `.js`; new code must pass `npm run typecheck` and `npm run typecheck:frontend` (pre-commit runs both).
- No SRI hashes on CDN scripts in Pug templates.
- Client-side first: no new backend routes in this feature.
- SCSS uses existing tokens (`--surface-overlay`, `--size-*`, accent/success vars); respect `prefers-reduced-motion`.
- Frontend rebuild after Pug/SCSS changes: `npm run build:frontend`.
- Jest is ESM: run single suites with `npm test -- test/frontend/<file>.test.js`.
- E2E needs the local stack (`./scripts/start-dev.sh`); a stale backend on :9090 fails all specs at generate — restart the stack if upload-url 500s appear.
- Every commit message ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Chain walk depth stays at the existing `maxDepth = 50`.

---

### Task 1: Per-node snapshots on `walkManifestChain` entries

**Files:**
- Modify: `frontend/src/js/engine/time-travel.js:123-162` (the `walkManifestChain` function)
- Test: `test/frontend/time-travel-chain.test.js` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: each chain entry gains `nodes: Record<string, string>` — `node_id` → JSON snapshot string of `{ sourceCid, postProcessor, transform }`. Task 2's `versionsForNode()` compares these strings. (The spec names `sourceCid` + `postProcessor`; `transform` is included because transform edits are also first-class versions.)

- [ ] **Step 1: Write the failing test**

```js
// test/frontend/time-travel-chain.test.js
/**
 * @jest-environment jsdom
 */
import { jest, expect, test, describe, beforeAll } from "@jest/globals";

// time-travel.js statically imports scene-graph (engine-heavy) and remote-ipfs;
// mock both before the dynamic import.
jest.unstable_mockModule(
  "../../frontend/src/js/engine/scene-graph.js",
  () => ({ getNodeMeshes: () => [] })
);

const getFromRemoteIPFS = jest.fn();
jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS,
}));

let walkManifestChain;
beforeAll(async () => {
  ({ walkManifestChain } = await import(
    "../../frontend/src/js/engine/time-travel.js"
  ));
});

const NODE_A = {
  node_id: "node-a",
  source: { cid: "src-a" },
  post_processor: { color: "#ff0000" },
};
const NODE_A_V1 = {
  node_id: "node-a",
  source: { cid: "src-a" },
  post_processor: null,
};
const NODE_B = { node_id: "node-b", source: { cid: "src-b" } };

const MANIFESTS = {
  "cid-v2": {
    version: 2,
    name: "Test",
    timestamp: "2026-07-07T00:00:00Z",
    prev_asset_manifest_cid: "cid-v1",
    scene: { nodes: [NODE_A, NODE_B] },
  },
  "cid-v1": {
    version: 1,
    name: "Test",
    timestamp: "2026-07-06T00:00:00Z",
    prev_asset_manifest_cid: null,
    scene: { nodes: [NODE_A_V1] },
  },
};

describe("walkManifestChain per-node snapshots", () => {
  test("each entry carries a nodes map keyed by node_id", async () => {
    getFromRemoteIPFS.mockImplementation(async (cid) => MANIFESTS[cid]);
    const chain = await walkManifestChain("cid-v2");

    expect(chain).toHaveLength(2);
    // Chronological order: v1 first.
    expect(chain[0].version).toBe(1);
    expect(Object.keys(chain[0].nodes)).toEqual(["node-a"]);
    expect(Object.keys(chain[1].nodes).sort()).toEqual(["node-a", "node-b"]);

    // Snapshots are strings and change when post_processor changes.
    expect(typeof chain[0].nodes["node-a"]).toBe("string");
    expect(chain[0].nodes["node-a"]).not.toBe(chain[1].nodes["node-a"]);
  });

  test("nodes without node_id are skipped", async () => {
    getFromRemoteIPFS.mockImplementation(async () => ({
      version: 1,
      scene: { nodes: [{ source: { cid: "anon" } }] },
    }));
    const chain = await walkManifestChain("cid-anon-only");
    expect(chain[0].nodes).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/time-travel-chain.test.js`
Expected: FAIL — `chain[0].nodes` is `undefined`.

- [ ] **Step 3: Add the snapshot map in `walkManifestChain`**

In `frontend/src/js/engine/time-travel.js`, inside the `while` loop, after `const firstNode = nodes[0] || {};` and before `chain.unshift({`:

```js
      // Per-node snapshot for node-level change detection (model clock).
      // A snapshot string changes whenever the node's source, parametric
      // edits, or staged transform change between versions.
      const nodeSnapshots = {};
      for (const n of nodes) {
        if (!n.node_id) continue;
        nodeSnapshots[n.node_id] = JSON.stringify({
          sourceCid: n.source?.cid || null,
          postProcessor: n.post_processor || null,
          transform: n.transform_matrix || null,
        });
      }
```

And add to the `chain.unshift({...})` object literal:

```js
        nodes: nodeSnapshots,
```

Update the function's JSDoc `@returns` to include `nodes: Record<string, string>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/frontend/time-travel-chain.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full unit suite to catch regressions**

Run: `npm test`
Expected: PASS (pre-existing suites unaffected; `test/api.test.js` failures are expected without the dev stack and are not regressions).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/engine/time-travel.js test/frontend/time-travel-chain.test.js
git commit -m "feat(time-travel): per-node snapshot map on manifest chain entries

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Headless version-history store

**Files:**
- Create: `frontend/src/js/state/version-history-store.js`
- Test: `test/frontend/version-history-store.test.js` (create)

**Interfaces:**
- Consumes: `walkManifestChain` entries with `nodes` map (Task 1); bus events; `assetState`.
- Produces (used by Tasks 4–6):
  - `getState(): { entries, activeCid, publishedCid, isLoading }`
  - `subscribe(fn): () => void` — `fn(state)` on every change
  - `activeIndex(): number`
  - `loadVersion(cid: string): Promise<void>`
  - `versionsForNode(nodeId: string): entry[]`
  - `_deps` — injectable dependency object (tests override)

**Design note:** All heavy dependencies (scene-graph → BABYLON, wallet, time-travel) are dynamically imported inside `_deps` defaults so unit tests never load the engine. The `isHistoryNavigation` guard semantics are copied from `asset-history.js` verbatim (flag true until `loadAssetManifest` resolves; no timeouts). `asset-history.js` is NOT touched in this task — it is deleted in Task 6.

- [ ] **Step 1: Write the failing test**

```js
// test/frontend/version-history-store.test.js
/**
 * @jest-environment jsdom
 */
import { jest, expect, test, describe, beforeEach, beforeAll } from "@jest/globals";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import {
  assetState,
  _resetForTesting,
} from "../../frontend/src/js/state/asset-state.js";

let store;
beforeAll(async () => {
  store = await import(
    "../../frontend/src/js/state/version-history-store.js"
  );
});

const ENTRIES = [
  { cid: "cid-v1", version: 1, name: "T", nodeCount: 1, timestamp: null,
    nodes: { "node-a": "snap-a1" } },
  { cid: "cid-v2", version: 2, name: "T", nodeCount: 2, timestamp: null,
    nodes: { "node-a": "snap-a1", "node-b": "snap-b1" } },
  { cid: "cid-v3", version: 3, name: "T", nodeCount: 2, timestamp: null,
    nodes: { "node-a": "snap-a2", "node-b": "snap-b1" } },
];

function stubDeps(overrides = {}) {
  store._deps.walkChain = jest.fn(async () => ENTRIES);
  store._deps.fetchPublishedCid = jest.fn(async () => "cid-v2");
  store._deps.clearScene = jest.fn(async () => {});
  store._deps.loadAssetManifest = jest.fn(async () => {});
  Object.assign(store._deps, overrides);
}

// Let the store's async _refresh settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("version-history-store", () => {
  beforeEach(async () => {
    _resetForTesting();
    stubDeps();
    global.alert = jest.fn();
    emit(EVENTS.SCENE_EMPTY); // reset store state between tests
    await flush();
  });

  test("SCENE_READY populates entries and notifies subscribers", async () => {
    const seen = [];
    const unsub = store.subscribe((s) => seen.push(s));

    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    const s = store.getState();
    expect(s.entries).toHaveLength(3);
    expect(s.activeCid).toBe("cid-v3");
    expect(s.publishedCid).toBe("cid-v2");
    expect(store.activeIndex()).toBe(2);
    expect(seen.length).toBeGreaterThan(0);
    unsub();
  });

  test("SCENE_EMPTY clears everything", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    emit(EVENTS.SCENE_EMPTY);
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().activeCid).toBe(null);
  });

  test("loadVersion clears scene, preserves latest CID, loads target", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    await store.loadVersion("cid-v1");

    expect(store._deps.clearScene).toHaveBeenCalled();
    expect(store._deps.loadAssetManifest).toHaveBeenCalledWith("cid-v1");
    // Chain root (latest) survives the clearScene reset.
    expect(assetState.get().latestAssetManifestCid).toBe("cid-v3");
    expect(store.getState().activeCid).toBe("cid-v1");
    expect(store.getState().isLoading).toBe(false);
  });

  test("loadVersion failure alerts and reverts activeCid", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    store._deps.loadAssetManifest = jest.fn(async () => {
      throw new Error("ipfs down");
    });
    await store.loadVersion("cid-v1");

    expect(global.alert).toHaveBeenCalled();
    expect(store.getState().activeCid).toBe("cid-v3");
    expect(store.getState().isLoading).toBe(false);
  });

  test("versionsForNode: first appearance + changes only", async () => {
    assetState.set({ activeAssetManifestCid: "cid-v3" });
    emit(EVENTS.SCENE_READY, { manifestCid: "cid-v3" });
    await flush();

    // node-a: appears v1, unchanged v2, changed v3 → [v1, v3]
    expect(store.versionsForNode("node-a").map((e) => e.version)).toEqual([1, 3]);
    // node-b: appears v2, unchanged v3 → [v2]
    expect(store.versionsForNode("node-b").map((e) => e.version)).toEqual([2]);
    // unknown node → []
    expect(store.versionsForNode("nope")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/version-history-store.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```js
// frontend/src/js/state/version-history-store.js
// @ts-nocheck
/**
 * Version History Store (headless)
 *
 * Owns the asset's manifest-chain state: entries (oldest→newest), the active
 * and published CIDs, loading state, and the isHistoryNavigation guard.
 * Logic extracted from the retired ui/asset-history.js; the scene clock and
 * model clock views subscribe here and render it as clock dials.
 *
 * Heavy dependencies (engine, wallet) are dynamically imported via `_deps`
 * at call time so unit tests can stub them without loading BABYLON.
 */

import { on, EVENTS } from "../events/bus.js";
import { assetState } from "./asset-state.js";

export const _deps = {
  walkChain: async (cid) => {
    const { walkManifestChain } = await import("../engine/time-travel.js");
    return walkManifestChain(cid);
  },
  clearScene: async () => {
    const { clearScene } = await import("../engine/scene-graph.js");
    clearScene();
  },
  loadAssetManifest: async (cid) => {
    const { loadAssetManifest } = await import("../engine/scene-graph.js");
    return loadAssetManifest(cid);
  },
  fetchPublishedCid: async (tokenId) => {
    const { contract } = await import("../blockchain/wallet.js");
    if (!contract) return null;
    const cid = await contract.methods.tokenURI(tokenId).call();
    return cid || null;
  },
};

// ─── State ───
let entries = []; // oldest → newest, from walkManifestChain (incl. nodes map)
let chainRootCid = null; // CID used to fetch the chain (latest known)
let activeCid = null; // currently loaded manifest CID
let publishedCid = null; // CID currently anchored on-chain
let isLoading = false;
let isHistoryNavigation = false;

const _subscribers = new Set();

function _notify() {
  const snapshot = getState();
  for (const fn of _subscribers) fn(snapshot);
}

// ─── Public API ───

export function getState() {
  return { entries, activeCid, publishedCid, isLoading };
}

export function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

export function activeIndex() {
  const i = entries.findIndex((e) => e.cid === activeCid);
  return i === -1 ? entries.length - 1 : i;
}

/**
 * Versions relevant to one node: where it first appears, and every version
 * whose snapshot differs from the previous version's. Versions where the
 * node is absent are never included.
 */
export function versionsForNode(nodeId) {
  const out = [];
  let prev; // undefined = node absent in previous version
  for (const entry of entries) {
    const snap = entry.nodes ? entry.nodes[nodeId] : undefined;
    if (snap !== undefined && snap !== prev) out.push(entry);
    prev = snap;
  }
  return out;
}

export async function loadVersion(cid) {
  if (isLoading || cid === activeCid) return;
  const prevCid = activeCid;
  isLoading = true;
  isHistoryNavigation = true;
  activeCid = cid;
  _notify();

  try {
    // clearScene() resets latestAssetManifestCid, but the chain root (latest
    // version) must survive while the user is scrubbing history.
    const preservedLatest =
      chainRootCid || assetState.get().latestAssetManifestCid;
    await _deps.clearScene();
    if (preservedLatest) {
      assetState.set({ latestAssetManifestCid: preservedLatest });
    }
    await _deps.loadAssetManifest(cid);
    activeCid = cid;
  } catch (err) {
    console.error("Failed to load history version:", err);
    alert("Failed to load version: " + err.message);
    activeCid = prevCid; // snap the hand back
  } finally {
    isLoading = false;
    // Stays true until loadAssetManifest() resolved and scene:ready listeners
    // ran — a fixed timeout was too short for slow IPFS loads.
    isHistoryNavigation = false;
    _notify();
  }
}

// ─── Refresh ───

async function _refresh() {
  const manifestCid = assetState.get().activeAssetManifestCid;
  if (!manifestCid) {
    entries = [];
    chainRootCid = null;
    activeCid = null;
    publishedCid = null;
    _notify();
    return;
  }

  // On history navigation, keep the chain root — just track the active CID.
  if (isHistoryNavigation) {
    activeCid = manifestCid;
    _notify();
    return;
  }

  chainRootCid = manifestCid;
  activeCid = manifestCid;

  const tokenId = assetState.get().activeAssetTokenId;
  const [chain, pubCid] = await Promise.all([
    _deps.walkChain(chainRootCid).catch((err) => {
      console.error("History chain fetch failed:", err);
      return [];
    }),
    tokenId
      ? _deps.fetchPublishedCid(tokenId).catch(() => null)
      : Promise.resolve(null),
  ]);

  entries = chain;
  publishedCid = pubCid;
  _notify();
}

// ─── Bus subscriptions (mirrors the retired asset-history.js) ───

on(EVENTS.SCENE_READY, (e) => {
  const manifestCid = e?.manifestCid || assetState.get().activeAssetManifestCid;
  if (!manifestCid) return;

  if (isHistoryNavigation) {
    activeCid = manifestCid;
    _notify();
    return;
  }

  chainRootCid = manifestCid;
  activeCid = manifestCid;
  assetState.set({ latestAssetManifestCid: manifestCid });
  _refresh();
});

on(EVENTS.WALLET_CONNECTED, () => {
  if (assetState.get().activeAssetManifestCid && !isHistoryNavigation) {
    _refresh();
  }
});

on(EVENTS.ASSET_PUBLISHED, () => {
  // Re-check published CID after mint/update.
  setTimeout(_refresh, 500);
});

on(EVENTS.ASSET_DRAFT_SAVED, () => {
  _refresh();
});

on(EVENTS.SCENE_EMPTY, () => {
  entries = [];
  chainRootCid = null;
  activeCid = null;
  publishedCid = null;
  _notify();
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/frontend/version-history-store.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:frontend`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/js/state/version-history-store.js test/frontend/version-history-store.test.js
git commit -m "feat(history): headless version-history store with per-node filtering

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Reusable clock-face component

**Files:**
- Create: `frontend/src/js/ui/version-clock.js`
- Test: `test/frontend/version-clock.test.js` (create)

**Interfaces:**
- Consumes: nothing from other tasks (pure DOM/SVG; no engine, no store).
- Produces (used by Tasks 5 & 6):

```js
createVersionClock({ onCommit }) → {
  el,                       // <div class="version-clock" role="slider" tabindex="0">
  update({ entries, activeIndex, publishedIndex, loading }),
  destroy(),
}
// onCommit(index) fires on: pointer release after drag, wheel debounce (~400 ms),
// every keyboard step (Arrow/Home/End). Live preview (badge/hand/detail) is
// internal — no onScrub callback needed by consumers.
```

**Geometry contract:** N entries divide 360° evenly; index N−1 (newest) at 12 o'clock; clockwise into the past. `angleForIndex(i, n) = -90 + ((n - 1 - i) * 360) / n` degrees. Tick thinning: `k = n > 24 ? Math.ceil(n / 24) : 1`; every k-th tick from newest is full-size, others are dots.

- [ ] **Step 1: Write the failing test**

```js
// test/frontend/version-clock.test.js
/**
 * @jest-environment jsdom
 */
import {
  jest,
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  createVersionClock,
  _angleForIndex,
} from "../../frontend/src/js/ui/version-clock.js";

const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c2", version: 2, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c3", version: 3, name: "T", nodeCount: 2, timestamp: null },
];

describe("version-clock face", () => {
  let clock, commits;

  beforeEach(() => {
    commits = [];
    clock = createVersionClock({ onCommit: (i) => commits.push(i) });
    document.body.appendChild(clock.el);
    clock.update({
      entries: ENTRIES,
      activeIndex: 2,
      publishedIndex: 1,
      loading: false,
    });
  });

  afterEach(() => clock.destroy());

  test("geometry: newest at 12 o'clock, clockwise into the past", () => {
    expect(_angleForIndex(2, 3)).toBe(-90); // newest
    expect(_angleForIndex(1, 3)).toBe(30); // one step clockwise
    expect(_angleForIndex(0, 3)).toBe(150);
  });

  test("renders one tick per entry and slider ARIA", () => {
    expect(clock.el.querySelectorAll(".vc-tick")).toHaveLength(3);
    expect(clock.el.getAttribute("role")).toBe("slider");
    expect(clock.el.getAttribute("aria-valuemin")).toBe("0");
    expect(clock.el.getAttribute("aria-valuemax")).toBe("2");
    expect(clock.el.getAttribute("aria-valuenow")).toBe("2");
    expect(clock.el.getAttribute("aria-valuetext")).toBe("Version 3");
  });

  test("badge and published/loading classes", () => {
    expect(clock.el.querySelector(".vc-badge").textContent).toBe("v3");
    expect(clock.el.classList.contains("published")).toBe(false);

    clock.update({
      entries: ENTRIES,
      activeIndex: 1,
      publishedIndex: 1,
      loading: true,
    });
    expect(clock.el.classList.contains("published")).toBe(true);
    expect(clock.el.classList.contains("loading")).toBe(true);
    expect(clock.el.querySelector(".vc-badge").textContent).toBe("v2");
  });

  test("keyboard: arrows step and commit, Home/End jump", () => {
    // The face never moves activeIndex itself — the store reloads and calls
    // update(). Simulate that here after each commit.
    const setActive = (i) =>
      clock.update({
        entries: ENTRIES,
        activeIndex: i,
        publishedIndex: 1,
        loading: false,
      });
    const key = (k) =>
      clock.el.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, bubbles: true })
      );

    key("ArrowLeft"); // older: 2 → 1
    expect(commits).toEqual([1]);
    setActive(1);
    key("Home"); // oldest
    expect(commits).toEqual([1, 0]);
    setActive(0);
    key("ArrowLeft"); // already oldest → clamped, no commit
    expect(commits).toEqual([1, 0]);
    key("End"); // newest
    expect(commits).toEqual([1, 0, 2]);
  });

  test("single-entry chain renders and cannot step", () => {
    clock.update({
      entries: [ENTRIES[0]],
      activeIndex: 0,
      publishedIndex: -1,
      loading: false,
    });
    expect(clock.el.querySelectorAll(".vc-tick")).toHaveLength(1);
    clock.el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })
    );
    expect(commits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/version-clock.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```js
// frontend/src/js/ui/version-clock.js
// @ts-nocheck
/**
 * Version Clock face — reusable SVG dial for scrubbing the manifest chain.
 *
 * Pure view: no engine or store imports. One tick per version around the
 * dial, newest at 12 o'clock running clockwise into the past, a draggable
 * hand, a green ring on the published tick, version badge + detail in the
 * center. Emits onCommit(index) when the user lands on a version (pointer
 * release, wheel debounce, or keyboard step).
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const TICK_OUTER = 44; // viewBox units; viewBox is 0 0 100 100, center (50,50)
const TICK_INNER = 37;
const DOT_R = 1.6; // thinned tick dot radius
const WHEEL_COMMIT_MS = 400;
const THIN_ABOVE = 24; // start thinning ticks past this many versions

/** Angle in degrees for entry index i of n. Exported for tests. */
export function _angleForIndex(i, n) {
  return -90 + ((n - 1 - i) * 360) / n;
}

function polar(angleDeg, radius) {
  const rad = (angleDeg * Math.PI) / 180;
  return [50 + radius * Math.cos(rad), 50 + radius * Math.sin(rad)];
}

function entryDetail(entry) {
  if (!entry) return "";
  const nodes = `${entry.nodeCount} node${entry.nodeCount !== 1 ? "s" : ""}`;
  const when = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : "";
  return [entry.name || "Untitled", `v${entry.version}`, nodes, when]
    .filter(Boolean)
    .join(" · ");
}

export function createVersionClock({ onCommit }) {
  let view = { entries: [], activeIndex: -1, publishedIndex: -1, loading: false };
  let previewIndex = null; // non-null while dragging / wheel-stepping
  let wheelTimer = null;
  let dragging = false;

  const el = document.createElement("div");
  el.className = "version-clock";
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", "Asset version");
  el.setAttribute("aria-valuemin", "0");
  el.tabIndex = 0;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");

  const face = document.createElementNS(SVG_NS, "circle");
  face.setAttribute("class", "vc-face");
  face.setAttribute("cx", "50");
  face.setAttribute("cy", "50");
  face.setAttribute("r", "48");

  const ticks = document.createElementNS(SVG_NS, "g");
  ticks.setAttribute("class", "vc-ticks");

  const publishedRing = document.createElementNS(SVG_NS, "circle");
  publishedRing.setAttribute("class", "vc-published-ring");
  publishedRing.setAttribute("r", "4.5");
  publishedRing.setAttribute("display", "none");

  // Hand drawn pointing up (12 o'clock = -90°); rotated via transform.
  const hand = document.createElementNS(SVG_NS, "line");
  hand.setAttribute("class", "vc-hand");
  hand.setAttribute("x1", "50");
  hand.setAttribute("y1", "50");
  hand.setAttribute("x2", "50");
  hand.setAttribute("y2", String(50 - TICK_INNER + 4));

  const pivot = document.createElementNS(SVG_NS, "circle");
  pivot.setAttribute("class", "vc-pivot");
  pivot.setAttribute("cx", "50");
  pivot.setAttribute("cy", "50");
  pivot.setAttribute("r", "2.5");

  const badge = document.createElementNS(SVG_NS, "text");
  badge.setAttribute("class", "vc-badge");
  badge.setAttribute("x", "50");
  badge.setAttribute("y", "68");
  badge.setAttribute("text-anchor", "middle");

  svg.append(face, ticks, publishedRing, hand, pivot, badge);

  const detail = document.createElement("div");
  detail.className = "vc-detail";

  el.append(svg, detail);

  // ─── Rendering ───

  function shownIndex() {
    return previewIndex !== null ? previewIndex : view.activeIndex;
  }

  function renderTicks() {
    ticks.textContent = "";
    const n = view.entries.length;
    const k = n > THIN_ABOVE ? Math.ceil(n / THIN_ABOVE) : 1;
    for (let i = 0; i < n; i++) {
      const angle = _angleForIndex(i, n);
      const major =
        (n - 1 - i) % k === 0 || i === view.activeIndex || i === view.publishedIndex;
      if (major) {
        const [x1, y1] = polar(angle, TICK_OUTER);
        const [x2, y2] = polar(angle, TICK_INNER);
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("class", "vc-tick");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        ticks.appendChild(line);
      } else {
        const [cx, cy] = polar(angle, (TICK_OUTER + TICK_INNER) / 2);
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("class", "vc-tick vc-tick-minor");
        dot.setAttribute("cx", String(cx));
        dot.setAttribute("cy", String(cy));
        dot.setAttribute("r", String(DOT_R));
        ticks.appendChild(dot);
      }
    }
  }

  function renderIndicators() {
    const n = view.entries.length;
    const idx = shownIndex();
    const entry = view.entries[idx];

    if (n > 0 && idx >= 0) {
      const angle = _angleForIndex(idx, n);
      hand.setAttribute("transform", `rotate(${angle + 90} 50 50)`);
    }
    badge.textContent = entry ? `v${entry.version}` : "";
    detail.textContent = entryDetail(entry);

    if (view.publishedIndex >= 0 && n > 0) {
      const [cx, cy] = polar(
        _angleForIndex(view.publishedIndex, n),
        (TICK_OUTER + TICK_INNER) / 2
      );
      publishedRing.setAttribute("cx", String(cx));
      publishedRing.setAttribute("cy", String(cy));
      publishedRing.removeAttribute("display");
    } else {
      publishedRing.setAttribute("display", "none");
    }

    el.classList.toggle("loading", view.loading);
    el.classList.toggle(
      "published",
      view.publishedIndex >= 0 && view.activeIndex === view.publishedIndex
    );

    el.setAttribute("aria-valuemax", String(Math.max(0, n - 1)));
    el.setAttribute("aria-valuenow", String(Math.max(0, idx)));
    el.setAttribute("aria-valuetext", entry ? `Version ${entry.version}` : "");
  }

  function update(next) {
    view = next;
    if (!dragging) previewIndex = null;
    renderTicks();
    renderIndicators();
  }

  // ─── Interaction ───

  function clamp(i) {
    return Math.max(0, Math.min(view.entries.length - 1, i));
  }

  function indexForPointer(e) {
    const n = view.entries.length;
    if (n === 0) return -1;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // 0° = 3 o'clock
    const steps =
      Math.round(((((deg + 90) % 360) + 360) % 360) / (360 / n)) % n;
    return n - 1 - steps;
  }

  function commit(index) {
    if (index < 0 || index >= view.entries.length) return;
    if (index === view.activeIndex) {
      previewIndex = null;
      renderIndicators();
      return;
    }
    onCommit(index);
  }

  function onPointerDown(e) {
    if (view.entries.length < 2) return;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    previewIndex = clamp(indexForPointer(e));
    renderIndicators();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const idx = clamp(indexForPointer(e));
    if (idx !== previewIndex) {
      previewIndex = idx;
      renderIndicators();
    }
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const idx = previewIndex;
    previewIndex = null;
    if (idx !== null) commit(idx);
  }

  function onWheel(e) {
    if (view.entries.length < 2) return;
    e.preventDefault();
    const base = shownIndex();
    previewIndex = clamp(base + (e.deltaY > 0 ? -1 : 1)); // wheel down = older
    renderIndicators();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const idx = previewIndex;
      previewIndex = null;
      if (idx !== null) commit(idx);
    }, WHEEL_COMMIT_MS);
  }

  function onKeyDown(e) {
    const n = view.entries.length;
    if (n < 2) return;
    let idx = null;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown":
        idx = clamp(view.activeIndex - 1); // older
        break;
      case "ArrowRight":
      case "ArrowUp":
        idx = clamp(view.activeIndex + 1); // newer
        break;
      case "Home":
        idx = 0; // oldest
        break;
      case "End":
        idx = n - 1; // newest
        break;
      default:
        return;
    }
    e.preventDefault();
    if (idx !== view.activeIndex) commit(idx);
  }

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("keydown", onKeyDown);

  function destroy() {
    clearTimeout(wheelTimer);
    el.remove();
  }

  update(view);
  return { el, update, destroy };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/frontend/version-clock.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck:frontend` — expected clean, then:

```bash
git add frontend/src/js/ui/version-clock.js test/frontend/version-clock.test.js
git commit -m "feat(ui): reusable version-clock SVG dial component

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Version-clock SCSS

**Files:**
- Create: `frontend/src/scss/components/_version-clock.scss`
- Modify: `frontend/src/scss/styles.scss` (add `@use 'components/version-clock';` after the `@use 'components/history';` line — history is removed in Task 6)

**Interfaces:**
- Consumes: class names from Task 3 (`.version-clock`, `.vc-*`, `.loading`, `.published`) and Tasks 5/7 roots (`.scene-clock`, `.model-clock`, `.expanded`).
- Produces: visual styling only; no JS contract.

- [ ] **Step 1: Write the stylesheet**

```scss
// frontend/src/scss/components/_version-clock.scss
// ═══════════════════════════════════════════════════════════════════
// Version Clock — circular scrubber for the asset's manifest chain.
//
// Two hosts share one face component (.version-clock):
//   .scene-clock — fixed bottom-right of #viewport, collapsed watch face
//                  that expands on hover/focus.
//   .model-clock — floats above the selected node's bounding box,
//                  repositioned per frame by model-clock.js.
// ═══════════════════════════════════════════════════════════════════

.version-clock {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  cursor: pointer;
  outline-offset: 2px;
  touch-action: none; // pointer-drag scrubbing owns the gesture

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .vc-face {
    fill: var(--surface-overlay);
    stroke: var(--border-color);
    stroke-width: 1;
  }

  .vc-tick {
    stroke: var(--text-secondary);
    stroke-width: 2;
  }
  .vc-tick-minor {
    fill: var(--text-secondary);
    stroke: none;
    opacity: 0.55;
  }

  .vc-hand {
    stroke: var(--accent-color);
    stroke-width: 3;
    stroke-linecap: round;
  }
  .vc-pivot {
    fill: var(--accent-color);
  }

  .vc-published-ring {
    fill: none;
    stroke: var(--success-color, #2ec27e);
    stroke-width: 1.5;
  }

  .vc-badge {
    fill: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }

  .vc-detail {
    position: absolute;
    top: calc(100% + var(--size-1));
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--surface-overlay);
    border: 1px solid var(--border-color);
    border-radius: var(--size-1);
    padding: 2px var(--size-2);
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
  }

  &.published .vc-badge {
    fill: var(--success-color, #2ec27e);
  }

  &.loading .vc-hand {
    animation: vc-pulse 900ms ease-in-out infinite;
  }
}

// ─── Scene clock host: collapsed watch face, bottom-right ───

.scene-clock {
  position: absolute;
  bottom: var(--size-3);
  right: var(--size-3);
  width: 32px;
  height: 32px;
  z-index: 20;
  transition: width 160ms ease, height 160ms ease;

  // Collapsed: hide detail text, badge, ticks — hand + face only.
  .vc-badge,
  .vc-detail,
  .vc-ticks,
  .vc-published-ring {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  &.expanded {
    width: 96px;
    height: 96px;

    .vc-badge,
    .vc-ticks,
    .vc-published-ring {
      opacity: 1;
    }
    .version-clock:hover .vc-detail,
    .version-clock:focus .vc-detail {
      opacity: 1;
    }
  }
}

// ─── Model clock host: positioned per frame above the selected node ───

.model-clock {
  position: absolute;
  left: 0;
  top: 0;
  width: 28px;
  height: 28px;
  z-index: 20;
  transition: width 160ms ease, height 160ms ease;

  .vc-badge,
  .vc-detail,
  .vc-ticks,
  .vc-published-ring {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  &.expanded {
    width: 88px;
    height: 88px;

    .vc-badge,
    .vc-ticks,
    .vc-published-ring {
      opacity: 1;
    }
    .version-clock:hover .vc-detail,
    .version-clock:focus .vc-detail {
      opacity: 1;
    }
  }
}

@keyframes vc-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .scene-clock,
  .model-clock,
  .version-clock .vc-detail {
    transition: none;
  }
  .version-clock.loading .vc-hand {
    animation: none;
    opacity: 0.6;
  }
}
```

Note for the implementer: before using `--accent-color`, `--success-color`, `--text-primary`, `--text-secondary`, `--border-color`, `--font-mono`, check `frontend/src/scss/base/` for the actual token names in this codebase and substitute the real ones (e.g. the tokens used by `_viewport.scss` and `_history.scss`). Keep the declared fallbacks only where a token genuinely doesn't exist.

- [ ] **Step 2: Register the partial**

In `frontend/src/scss/styles.scss`, after line 24 (`@use 'components/history';`), add:

```scss
@use 'components/version-clock';
```

- [ ] **Step 3: Build to verify Sass compiles**

Run: `npm run build:frontend`
Expected: build succeeds, no Sass errors (undefined token names would surface here as unknown-variable output, since CSS custom props pass through silently — visually verify tokens exist per the note above).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/scss/components/_version-clock.scss frontend/src/scss/styles.scss
git commit -m "feat(scss): version-clock dial styling (scene + model hosts)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Scene clock view

**Files:**
- Create: `frontend/src/js/ui/scene-clock.js`
- Test: `test/frontend/scene-clock.test.js` (create)

**Interfaces:**
- Consumes: store API (Task 2), `createVersionClock` (Task 3).
- Produces: `#sceneClock` root element in `#viewport` (`.scene-clock`, `.expanded` class contract with Task 4 SCSS; E2E selector in Task 8). Self-initializes on import (same pattern as the retired `asset-history.js`); exports `initSceneClock` for tests.

- [ ] **Step 1: Write the failing test**

```js
// test/frontend/scene-clock.test.js
/**
 * @jest-environment jsdom
 */
import { jest, expect, test, describe, beforeEach, beforeAll } from "@jest/globals";

// Mock the store: capture the subscriber, drive renders manually.
let subscriber = null;
const storeMock = {
  getState: jest.fn(() => ({
    entries: [],
    activeCid: null,
    publishedCid: null,
    isLoading: false,
  })),
  subscribe: jest.fn((fn) => {
    subscriber = fn;
    return () => {};
  }),
  activeIndex: jest.fn(() => -1),
  loadVersion: jest.fn(async () => {}),
  versionsForNode: jest.fn(() => []),
  _deps: {},
};
jest.unstable_mockModule(
  "../../frontend/src/js/state/version-history-store.js",
  () => storeMock
);

let initSceneClock;
beforeAll(async () => {
  ({ initSceneClock } = await import(
    "../../frontend/src/js/ui/scene-clock.js"
  ));
});

const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c2", version: 2, name: "T", nodeCount: 1, timestamp: null },
];

function setStoreState(state) {
  storeMock.getState.mockReturnValue(state);
  storeMock.activeIndex.mockReturnValue(
    state.entries.findIndex((e) => e.cid === state.activeCid)
  );
  if (subscriber) subscriber(state);
}

describe("scene-clock", () => {
  let viewport;

  beforeEach(() => {
    document.getElementById("sceneClock")?.remove();
    document.getElementById("viewport")?.remove();
    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);
    storeMock.loadVersion.mockClear();
    initSceneClock();
  });

  test("hidden while the chain is empty, visible once populated", () => {
    const root = document.getElementById("sceneClock");
    expect(root.hidden).toBe(true);

    setStoreState({
      entries: ENTRIES,
      activeCid: "c2",
      publishedCid: null,
      isLoading: false,
    });
    expect(root.hidden).toBe(false);
  });

  test("expands on focusin, collapses on Escape", () => {
    setStoreState({
      entries: ENTRIES,
      activeCid: "c2",
      publishedCid: null,
      isLoading: false,
    });
    const root = document.getElementById("sceneClock");
    const dial = root.querySelector(".version-clock");

    dial.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(root.classList.contains("expanded")).toBe(true);

    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    expect(root.classList.contains("expanded")).toBe(false);
  });

  test("keyboard commit loads the landed version via the store", () => {
    setStoreState({
      entries: ENTRIES,
      activeCid: "c2",
      publishedCid: null,
      isLoading: false,
    });
    const dial = document.querySelector("#sceneClock .version-clock");
    dial.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true })
    );
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/scene-clock.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the view**

```js
// frontend/src/js/ui/scene-clock.js
// @ts-nocheck
/**
 * Scene Clock — fixed version dial, bottom-right of the viewport.
 *
 * Collapsed watch face (hand + version badge) that expands to the full
 * scrubbable dial on hover/focus/click. Scrubs the whole asset's manifest
 * chain via the version-history store. Hidden when no chain is loaded.
 */

import * as store from "../state/version-history-store.js";
import { createVersionClock } from "./version-clock.js";

const ROOT_ID = "sceneClock";

function initSceneClock() {
  const viewport = document.getElementById("viewport");
  if (!viewport || document.getElementById(ROOT_ID)) return;

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "scene-clock";
  root.hidden = true;

  const clock = createVersionClock({
    onCommit(index) {
      const { entries, activeCid } = store.getState();
      const entry = entries[index];
      if (entry && entry.cid !== activeCid) store.loadVersion(entry.cid);
    },
  });
  root.appendChild(clock.el);
  viewport.appendChild(root);

  // Collapsed ↔ expanded
  root.addEventListener("pointerenter", () => root.classList.add("expanded"));
  root.addEventListener("pointerleave", () => {
    if (!root.contains(document.activeElement)) {
      root.classList.remove("expanded");
    }
  });
  root.addEventListener("focusin", () => root.classList.add("expanded"));
  root.addEventListener("focusout", () => root.classList.remove("expanded"));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      root.classList.remove("expanded");
      clock.el.blur();
    }
  });

  function render(s) {
    root.hidden = s.entries.length === 0;
    if (root.hidden) return;
    clock.update({
      entries: s.entries,
      activeIndex: store.activeIndex(),
      publishedIndex: s.entries.findIndex((e) => e.cid === s.publishedCid),
      loading: s.isLoading,
    });
  }

  store.subscribe(render);
  render(store.getState());
}

initSceneClock();

export { initSceneClock };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/frontend/scene-clock.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck:frontend` — expected clean, then:

```bash
git add frontend/src/js/ui/scene-clock.js test/frontend/scene-clock.test.js
git commit -m "feat(ui): scene clock — collapsed version dial in the viewport

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Replace the headerbar scrubber

**Files:**
- Modify: `frontend/src/pug/app.pug` (remove `#assetHistory` block at lines 53–59; swap the `asset-history.js` script tag at line 436)
- Delete: `frontend/src/js/ui/asset-history.js`
- Delete: `frontend/src/scss/components/_history.scss`
- Modify: `frontend/src/scss/styles.scss` (remove `@use 'components/history';`)
- Modify: `test/frontend/wallet-exports.test.js:126` (rename the consumer-contract test label)

**Interfaces:**
- Consumes: `scene-clock.js` (Task 5) — it must be in the page before the scrubber is removed, which this task's script-tag swap does atomically.
- Produces: `app.html` with no `#assetHistory` / `#historySlider` / `#historyVersionBadge`; `#sceneClock` is the only version control. E2E (Task 8) depends on this.

- [ ] **Step 1: Remove the scrubber markup from `app.pug`**

Delete this block (currently lines 53–59):

```pug
        #assetHistory.history(hidden)
          span.history-label Version
          .history-slider-wrap
            input#historySlider.history-slider(type="range" min="0" max="0" step="1" value="0" aria-label="Asset version" aria-describedby="historyDetailPopover" title="Scrub asset versions")
            #historyDetailPopover.history-detail(hidden)
          span#historyVersionBadge.version-badge v1
```

- [ ] **Step 2: Swap the script tag**

Replace:

```pug
    script(type="module", src="/js/ui/asset-history.js")
```

with:

```pug
    script(type="module", src="/js/ui/scene-clock.js")
```

(The store and face component enter the bundle through scene-clock's imports; no extra tags.)

- [ ] **Step 3: Delete the retired files and SCSS import**

```bash
git rm frontend/src/js/ui/asset-history.js frontend/src/scss/components/_history.scss
```

In `frontend/src/scss/styles.scss`, delete the line:

```scss
@use 'components/history';
```

- [ ] **Step 4: Update the wallet-exports consumer label**

In `test/frontend/wallet-exports.test.js` line 126, the test documents which module consumes `contract` from wallet.js. Rename:

```js
    test("version-history-store.js: contract", () => {
      expect(exported).toContain("contract");
    });
```

- [ ] **Step 5: Rebuild and run the frontend suite**

Run: `npm run build:frontend && npm test -- test/frontend/`
Expected: build OK; all suites pass. If any other test greps for `assetHistory`/`historySlider` (search first: `grep -rn "assetHistory\|historySlider" test/`), update it to `#sceneClock` equivalents in this step.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/pug/app.pug frontend/src/scss/styles.scss test/frontend/wallet-exports.test.js
git commit -m "feat!: replace headerbar version scrubber with scene clock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Model clock (selection-following)

**Files:**
- Create: `frontend/src/js/ui/model-clock.js`
- Modify: `frontend/src/js/engine/state.js` (add `isGizmoDragging` flag)
- Modify: `frontend/src/js/ui/transform-gizmo.js:208-216` (`ensureDragEndSubscription` sets the flag)
- Modify: `frontend/src/js/engine/scene-graph.js` (~line 322, after the transform-gizmo dynamic import: add the model-clock dynamic import)
- Test: `test/frontend/model-clock.test.js` (create)

**Interfaces:**
- Consumes: store `versionsForNode`/`getState`/`subscribe`/`loadVersion` (Task 2); `createVersionClock` (Task 3); `state.nodeMeshes`, `state.highlightedNodeId`, `state.isGizmoDragging` from `engine/state.js`; bus `NODE_SELECTED`/`NODE_DESELECTED`/`SCENE_EMPTY`.
- Produces: `#modelClock` root in `#viewport`; `initModelClock(scene, camera)` export called by `scene-graph.js`. Reads meshes from `state.nodeMeshes` directly (NOT via `scene-graph.js` imports) to avoid a circular import with its dynamic-import parent.

- [ ] **Step 1: Write the failing test**

```js
// test/frontend/model-clock.test.js
/**
 * @jest-environment jsdom
 */
import {
  jest,
  expect,
  test,
  describe,
  beforeEach,
  afterEach,
  beforeAll,
} from "@jest/globals";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import { state } from "../../frontend/src/js/engine/state.js";

let subscriber = null;
const ENTRIES = [
  { cid: "c1", version: 1, name: "T", nodeCount: 1, timestamp: null },
  { cid: "c3", version: 3, name: "T", nodeCount: 1, timestamp: null },
];
const storeMock = {
  getState: jest.fn(() => ({
    entries: ENTRIES,
    activeCid: "c3",
    publishedCid: null,
    isLoading: false,
  })),
  subscribe: jest.fn((fn) => {
    subscriber = fn;
    return () => {};
  }),
  activeIndex: jest.fn(() => 1),
  loadVersion: jest.fn(async () => {}),
  versionsForNode: jest.fn(() => ENTRIES),
  _deps: {},
};
jest.unstable_mockModule(
  "../../frontend/src/js/state/version-history-store.js",
  () => storeMock
);

let initModelClock;
beforeAll(async () => {
  ({ initModelClock } = await import(
    "../../frontend/src/js/ui/model-clock.js"
  ));
});

describe("model-clock", () => {
  let viewport, scene, repositionFns;

  beforeEach(() => {
    document.getElementById("modelClock")?.remove();
    document.getElementById("viewport")?.remove();
    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);

    repositionFns = [];
    scene = {
      onBeforeRenderObservable: { add: (fn) => repositionFns.push(fn) },
      getTransformMatrix: () => ({}),
      getEngine: () => ({
        getRenderWidth: () => 800,
        getRenderHeight: () => 600,
        getRenderingCanvas: () => ({ clientWidth: 800, clientHeight: 600 }),
      }),
    };
    state.highlightedNodeId = null;
    state.isGizmoDragging = false;
    state.nodeMeshes = new Map();
    storeMock.versionsForNode.mockReturnValue(ENTRIES);
    storeMock.loadVersion.mockClear();

    global.BABYLON = {
      Vector3: class V3 {
        constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
        static Minimize(a, b) {
          return new V3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
        }
        static Maximize(a, b) {
          return new V3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
        }
        static Project() { return { x: 400, y: 200, z: 0.5 }; }
        clone() { return new V3(this.x, this.y, this.z); }
      },
      Matrix: { Identity: () => ({}) },
    };

    initModelClock(scene, { viewport: { toGlobal: () => ({}) } });
  });

  afterEach(() => {
    delete global.BABYLON;
  });

  test("hidden until a node with history is selected", () => {
    const root = document.getElementById("modelClock");
    expect(root.hidden).toBe(true);

    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    expect(root.hidden).toBe(false);
    expect(storeMock.versionsForNode).toHaveBeenCalledWith("node-a");

    emit(EVENTS.NODE_DESELECTED);
    expect(root.hidden).toBe(true);
  });

  test("filtered dial: aria-valuemax reflects the node's versions", () => {
    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const dial = document.querySelector("#modelClock .version-clock");
    expect(dial.getAttribute("aria-valuemax")).toBe("1"); // 2 entries
  });

  test("commit loads the underlying chain version", () => {
    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const dial = document.querySelector("#modelClock .version-clock");
    dial.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true })
    );
    expect(storeMock.loadVersion).toHaveBeenCalledWith("c1");
  });

  test("reposition hides during gizmo drag and when meshes are gone", () => {
    state.highlightedNodeId = "node-a";
    emit(EVENTS.NODE_SELECTED, { nodeId: "node-a" });
    const root = document.getElementById("modelClock");
    const reposition = repositionFns[0];

    // No meshes → invisible.
    reposition();
    expect(root.style.visibility).toBe("hidden");

    // Meshes present → positioned via projection.
    state.nodeMeshes.set("node-a", [
      {
        isDisposed: () => false,
        getBoundingInfo: () => ({
          boundingBox: {
            minimumWorld: new global.BABYLON.Vector3(-1, 0, -1),
            maximumWorld: new global.BABYLON.Vector3(1, 2, 1),
          },
        }),
      },
    ]);
    reposition();
    expect(root.style.visibility).toBe("");
    expect(root.style.transform).toContain("400px");

    // Mid-drag → invisible.
    state.isGizmoDragging = true;
    reposition();
    expect(root.style.visibility).toBe("hidden");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/frontend/model-clock.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the drag flag to engine state**

In `frontend/src/js/engine/state.js`, after `transformMode: null,` add:

```js
  /** @type {boolean} True while a transform-gizmo drag is in progress (model clock hides). */
  isGizmoDragging: false,
```

In `frontend/src/js/ui/transform-gizmo.js`, replace `ensureDragEndSubscription` (lines 210–216) with:

```js
function ensureDragEndSubscription(gizmo) {
  if (!gizmo || _subscribedGizmos.has(gizmo)) return;
  let subscribed = false;
  if (gizmo.onDragStartObservable) {
    gizmo.onDragStartObservable.add(() => {
      state.isGizmoDragging = true;
    });
    subscribed = true;
  }
  if (gizmo.onDragEndObservable) {
    gizmo.onDragEndObservable.add(() => {
      state.isGizmoDragging = false;
      captureSelectedTransform();
    });
    subscribed = true;
  }
  if (subscribed) _subscribedGizmos.add(gizmo);
}
```

Note: `test/frontend/transform-gizmo.test.js` mocks gizmos with only `onDragEndObservable` — the `onDragStartObservable` guard keeps it passing unchanged.

- [ ] **Step 4: Write the view**

```js
// frontend/src/js/ui/model-clock.js
// @ts-nocheck
/**
 * Model Clock — version dial floating above the selected node.
 *
 * A filtered lens over the same manifest chain as the scene clock: it shows
 * only the versions where the selected node changed (store.versionsForNode).
 * Committing a version reloads the whole scene at that version.
 *
 * Positioned each frame by projecting the top-center of the node's bounding
 * box to screen space (constant screen size). Initialized from scene-graph.js
 * after the engine is ready — meshes are read from engine/state.js directly
 * to avoid a circular import with scene-graph.
 */

import * as store from "../state/version-history-store.js";
import { createVersionClock } from "./version-clock.js";
import { on, EVENTS } from "../events/bus.js";
import { state } from "../engine/state.js";

const ROOT_ID = "modelClock";
const ABOVE_OFFSET_PX = 12; // gap between bounding-box top and the dial

function initModelClock(scene, camera) {
  const viewport = document.getElementById("viewport");
  if (!viewport || document.getElementById(ROOT_ID)) return;

  let selectedNodeId = null;

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "model-clock";
  root.hidden = true;

  const clock = createVersionClock({
    onCommit(index) {
      const filtered = store.versionsForNode(selectedNodeId);
      const entry = filtered[index];
      if (entry && entry.cid !== store.getState().activeCid) {
        store.loadVersion(entry.cid);
      }
    },
  });
  root.appendChild(clock.el);
  viewport.appendChild(root);

  // Collapsed ↔ expanded (same pattern as the scene clock).
  root.addEventListener("pointerenter", () => root.classList.add("expanded"));
  root.addEventListener("pointerleave", () => {
    if (!root.contains(document.activeElement)) {
      root.classList.remove("expanded");
    }
  });
  root.addEventListener("focusin", () => root.classList.add("expanded"));
  root.addEventListener("focusout", () => root.classList.remove("expanded"));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      root.classList.remove("expanded");
      clock.el.blur();
    }
  });

  function render() {
    const filtered = selectedNodeId
      ? store.versionsForNode(selectedNodeId)
      : [];
    root.hidden = filtered.length === 0;
    if (root.hidden) {
      root.classList.remove("expanded");
      return;
    }
    const s = store.getState();
    const activeIdx = filtered.findIndex((e) => e.cid === s.activeCid);
    clock.update({
      entries: filtered,
      // Scene may sit on a version between two node-changes; snap the hand to
      // the newest filtered entry at or before it.
      activeIndex: activeIdx !== -1 ? activeIdx : filtered.length - 1,
      publishedIndex: filtered.findIndex((e) => e.cid === s.publishedCid),
      loading: s.isLoading,
    });
  }

  on(EVENTS.NODE_SELECTED, (e) => {
    selectedNodeId = e?.nodeId || state.highlightedNodeId;
    render();
  });
  on(EVENTS.NODE_DESELECTED, () => {
    selectedNodeId = null;
    render();
  });
  on(EVENTS.SCENE_EMPTY, () => {
    selectedNodeId = null;
    render();
  });
  store.subscribe(render);

  // ─── Per-frame positioning ───

  function reposition() {
    if (root.hidden) return;
    if (state.isGizmoDragging) {
      root.style.visibility = "hidden";
      return;
    }

    const meshes = state.nodeMeshes.get(selectedNodeId);
    if (!meshes || meshes.length === 0) {
      root.style.visibility = "hidden";
      return;
    }

    let min = null;
    let max = null;
    for (const mesh of meshes) {
      if (!mesh || mesh.isDisposed()) continue;
      const bb = mesh.getBoundingInfo().boundingBox;
      min = min
        ? BABYLON.Vector3.Minimize(min, bb.minimumWorld)
        : bb.minimumWorld.clone();
      max = max
        ? BABYLON.Vector3.Maximize(max, bb.maximumWorld)
        : bb.maximumWorld.clone();
    }
    if (!min) {
      root.style.visibility = "hidden";
      return;
    }

    const top = new BABYLON.Vector3(
      (min.x + max.x) / 2,
      max.y,
      (min.z + max.z) / 2
    );
    const engine = scene.getEngine();
    const projected = BABYLON.Vector3.Project(
      top,
      BABYLON.Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(
        engine.getRenderWidth(),
        engine.getRenderHeight()
      )
    );

    // Behind the camera or outside the depth range → hide.
    if (projected.z < 0 || projected.z > 1) {
      root.style.visibility = "hidden";
      return;
    }

    // Projection is in render-buffer pixels; convert to CSS pixels.
    const canvas = engine.getRenderingCanvas();
    const sx = canvas.clientWidth / engine.getRenderWidth();
    const sy = canvas.clientHeight / engine.getRenderHeight();
    root.style.visibility = "";
    root.style.transform =
      `translate(${projected.x * sx}px, ` +
      `${projected.y * sy - ABOVE_OFFSET_PX}px) translate(-50%, -100%)`;
  }

  scene.onBeforeRenderObservable.add(reposition);
}

export { initModelClock };
```

- [ ] **Step 5: Initialize from scene-graph**

In `frontend/src/js/engine/scene-graph.js`, directly after the transform-gizmo dynamic-import block (ends ~line 324), add:

```js
  // Model clock (version dial above the selected node).
  import("../ui/model-clock.js")
    .then(({ initModelClock }) => {
      initModelClock(state.scene, camera);
      console.log("[SCENE] model clock initialized");
    })
    .catch((e) => {
      console.warn("[SCENE] model clock init failed:", e.message);
    });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- test/frontend/model-clock.test.js test/frontend/transform-gizmo.test.js`
Expected: PASS (model-clock 4 tests; transform-gizmo unchanged).

- [ ] **Step 7: Typecheck, full unit suite, commit**

Run: `npm run typecheck:frontend && npm test`
Expected: clean / PASS. Then:

```bash
git add frontend/src/js/ui/model-clock.js frontend/src/js/engine/state.js \
        frontend/src/js/ui/transform-gizmo.js frontend/src/js/engine/scene-graph.js \
        test/frontend/model-clock.test.js
git commit -m "feat(ui): model clock — per-node version dial above the selection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E migration

**Files:**
- Modify: `e2e/helpers/studio-selectors.mjs:41-43` (replace scrubber selectors)
- Modify: `e2e/helpers/flows.mjs:282-298` (replace `scrubHistorySlider`)
- Modify: `e2e/specs/04-parametric-version.spec.js` (drive the scene clock; add a model-clock case)

**Interfaces:**
- Consumes: `#sceneClock` / `#modelClock` DOM (Tasks 5–7); keyboard contract of the face (Home = oldest, End = newest, commits immediately).
- Produces: green E2E on the critical parametric path.

- [ ] **Step 1: Update selectors**

In `e2e/helpers/studio-selectors.mjs`, replace lines 41–43 with:

```js
  sceneClock: "#sceneClock",
  sceneClockDial: "#sceneClock .version-clock",
  sceneClockBadge: "#sceneClock .vc-badge",
  modelClock: "#modelClock",
  modelClockDial: "#modelClock .version-clock",
```

- [ ] **Step 2: Replace the flow helper**

In `e2e/helpers/flows.mjs`, replace `scrubHistorySlider` (and its JSDoc) with:

```js
/**
 * Scrub the scene clock to the oldest or newest version. Focusing the dial
 * expands the collapsed watch face; Home/End commit the version load
 * immediately (keyboard contract of version-clock.js).
 *
 * @param {Page} page
 * @param {"oldest" | "newest"} position
 */
export async function scrubSceneClock(page, position) {
  const dial = page.locator(SELECTORS.sceneClockDial);
  await dial.focus();
  await page.keyboard.press(position === "oldest" ? "Home" : "End");
}
```

- [ ] **Step 3: Rewrite spec 04's scrubber interactions**

In `e2e/specs/04-parametric-version.spec.js`:

Import change: `scrubHistorySlider` → `scrubSceneClock` in the `flows.mjs` import list.

Replace step 5's assertions (lines 46–51):

```js
    // 5. The scene clock now spans two versions and sits on the newest.
    await expect(page.locator(SELECTORS.sceneClock)).toBeVisible();
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v2");
    await expect(page.locator(SELECTORS.sceneClockDial)).toHaveAttribute(
      "aria-valuemax",
      "1",
    );
```

Replace step 6's scrub + assertions:

```js
    // 6. Time-travel back to v1 (oldest): the original GLB source re-renders.
    await scrubSceneClock(page, "oldest");
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v1");
    await expect(page.locator(SELECTORS.sceneClockDial)).not.toHaveClass(
      /loading/,
    );
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(genCid);
```

Replace step 7's scrub:

```js
    await scrubSceneClock(page, "newest");
    await expect(page.locator(SELECTORS.sceneClockBadge)).toHaveText("v2");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(saveCid);
```

- [ ] **Step 4: Add the model-clock case (after step 7, before publish)**

```js
    // 7b. Model clock: selecting the node surfaces its filtered dial —
    // 2 versions (v1 introduction + v2 color edit) → aria-valuemax 1.
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    await expect(page.locator(SELECTORS.modelClock)).toBeVisible();
    await expect(page.locator(SELECTORS.modelClockDial)).toHaveAttribute(
      "aria-valuemax",
      "1",
    );

    // Scrub the model clock to its oldest entry → whole scene reloads v1.
    await page.locator(SELECTORS.modelClockDial).focus();
    await page.keyboard.press("Home");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(genCid);

    // Reloading cleared the selection (model clock hides again); return to
    // the newest version via the scene clock before publishing.
    await expect(page.locator(SELECTORS.modelClock)).toBeHidden();
    await scrubSceneClock(page, "newest");
    await expect
      .poll(() => page.evaluate(() => window.__sceneReadyCids.at(-1)))
      .toBe(saveCid);
```

- [ ] **Step 5: Check for other specs using the old selectors**

Run: `grep -rn "historySlider\|assetHistory\|historyVersionBadge\|scrubHistorySlider" e2e/`
Expected: no hits outside the files updated above. Fix any stragglers the same way.

- [ ] **Step 6: Run the E2E suite**

Start the stack (fresh backend — a stale one 500s at generate):

```bash
./scripts/start-dev.sh
npm run build:frontend
npx playwright test --config=e2e/playwright.config.js --project=chromium e2e/specs/04-parametric-version.spec.js
```

Expected: PASS. Then the full critical path:

```bash
npm run test:e2e -- --project=chromium
```

Expected: PASS (17 specs).

- [ ] **Step 7: Commit**

```bash
git add e2e/helpers/studio-selectors.mjs e2e/helpers/flows.mjs e2e/specs/04-parametric-version.spec.js
git commit -m "test(e2e): drive version time-travel via scene + model clocks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Full gate + docs sync

**Files:**
- Modify: `CLAUDE.md` (the "Current counts" line under Tests)
- Possibly modify: `docs/CURRENT_STATUS.md` (if it describes the headerbar scrubber)

**Interfaces:** none — verification and documentation only.

- [ ] **Step 1: Run the full gate**

```bash
npm run test:all
```

Expected: lint + typecheck + frontend + api + contracts all pass (api tests need the dev stack running; without it those failures are environmental, not regressions).

- [ ] **Step 2: Visual smoke check**

With the dev stack up, open `http://localhost:9090/studio`, generate an asset, save a color edit, and verify: collapsed watch face bottom-right; expands on hover; drag/wheel/keys scrub; selecting the node shows the model clock above it; both light and dark themes render the dial with correct tokens.

- [ ] **Step 3: Update docs**

- `CLAUDE.md`: update the Jest test/suite counts on the "Current counts" line to the new totals reported by `npm test`.
- `grep -n "scrubber\|assetHistory\|history slider" docs/CURRENT_STATUS.md AGENTS.md` — if the headerbar scrubber is described, update those passages to describe the scene/model clocks.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: sync test counts and version-control description for clock gizmos

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
