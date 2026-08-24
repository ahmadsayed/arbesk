/**
 * Ledger (Activity) panel contract tests.
 *
 * Runs the real ui/ledger-panel.js against the DOM fragment rendered by
 * app.pug (same ids/classes/Alpine directives). engine/time-travel.js,
 * ipfs/remote-ipfs.js and domain/asset.js are mocked — the real modules pull
 * in IPFS/chain machinery.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeEach, afterEach } from "@jest/globals";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const CID_A = "bafyManifestAaa";
const CID_B = "bafyManifestBbb";

// Mirrors the [data-view="ledger"] fragment in frontend/src/pug/app.pug,
// including the Alpine directives owned by ui/ledger-panel.js.
const FRAGMENT = `
  <div id="ledgerBody" class="ledger-panel-body" x-data="ledgerPanel">
    <div class="ledger-panel-controls">
      <select id="ledgerFilter" class="ledger-filter" x-model="filter">
        <option value="">All Operations</option>
        <option value="GENERATION">Generation</option>
        <option value="PARAMETRIC">Parametric</option>
        <option value="SAVE">Save</option>
        <option value="PUBLISH">Publish</option>
        <option value="THUMBNAIL">Thumbnail</option>
        <option value="MINT">Mint</option>
        <option value="TOKEN_URI_UPDATE">URI Update</option>
        <option value="TEAM_EDIT">Team Edit</option>
      </select>
      <button id="ledgerAnchorBtn" class="ledger-anchor-btn" title="Anchor current manifest CID on-chain for immutability proof" @click="anchor()">Anchor Manifest</button>
    </div>
    <div id="ledgerStats" class="ledger-stats" x-text="statsText"></div>
    <ul id="ledgerList" class="ledger-list">
      <template x-for="row in rows" :key="row.id">
        <li class="ledger-entry">
          <span class="ledger-entry-icon" x-text="row.icon"></span>
          <span class="ledger-entry-type" :title="row.opType" x-text="row.label"></span>
          <span class="ledger-entry-cid" :title="row.cid" x-text="row.cidShort"></span>
          <span class="ledger-entry-actor" :title="row.actor" x-text="row.actorShort"></span>
          <span class="ledger-entry-time" x-text="row.timeText"></span>
        </li>
      </template>
      <template x-if="!rows.length">
        <li class="ledger-empty">No operations recorded yet.</li>
      </template>
    </ul>
  </div>`;

/** Flush Alpine's microtask-based reactivity (and pending promises). */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const mockGetActiveAssetManifestCid = jest.fn();
const mockWalkManifestChain = jest.fn();
const mockGetFromRemoteIPFS = jest.fn();

jest.unstable_mockModule("@arbesk/asset-core/domain/asset.js", () => ({
  getActiveAssetManifestCid: mockGetActiveAssetManifestCid,
}));
jest.unstable_mockModule("../../frontend/src/js/engine/time-travel.js", () => ({
  walkManifestChain: mockWalkManifestChain,
}));
jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS: mockGetFromRemoteIPFS,
}));

/**
 * Two-version chain: bafyA (v2, with one chat-provenance prompt) ← bafyB (v1).
 * extractActivities() yields: LOAD (ts 3), AI (ts 2), SAVE (ts 1).
 */
function seedChain() {
  mockGetActiveAssetManifestCid.mockReturnValue(CID_A);
  mockWalkManifestChain.mockResolvedValue([{ cid: CID_A }, { cid: CID_B }]);
  mockGetFromRemoteIPFS.mockImplementation(async (/** @type {string} */ cid) => {
    if (cid === CID_A) {
      return {
        version: 2,
        timestamp: 3000,
        asset_id: "asset-1",
        prev_manifest_cid: CID_B,
        nodes: [{}],
        metadata: {
          chat: [
            { prompt: "make a rock", provider: "mock", task: "text-to-3d", timestamp: 2 },
          ],
        },
      };
    }
    return { version: 1, timestamp: 1000, asset_id: "asset-1", nodes: [] };
  });
}

/** @type {typeof import("../../frontend/src/js/ui/ledger-panel.js")} */
let ledgerMod;
/** @type {typeof import("../../frontend/src/js/state/wallet-state.js")} */
let walletStateMod;
/** @type {typeof import("@arbesk/asset-core/events/bus.js")} */
let busMod;

async function setup() {
  jest.resetModules();
  document.body.innerHTML = FRAGMENT;
  walletStateMod = await import("../../frontend/src/js/state/wallet-state.js");
  walletStateMod.walletState.set({ walletAddress: ADDRESS });
  busMod = await import("@arbesk/asset-core/events/bus.js");
  ledgerMod = await import("../../frontend/src/js/ui/ledger-panel.js");
  ledgerMod.initLedgerPanel();
  await flush();
  await flush();
}

const listEl = () => /** @type {HTMLElement} */ (document.getElementById("ledgerList"));
const statsEl = () => /** @type {HTMLElement} */ (document.getElementById("ledgerStats"));
const filterEl = () => /** @type {HTMLSelectElement} */ (document.getElementById("ledgerFilter"));
const entries = () => [...listEl().querySelectorAll("li.ledger-entry")];
const entryType = (/** @type {Element} */ li) => li.querySelector(".ledger-entry-type");

/** @param {string} value */
function selectFilter(value) {
  filterEl().value = value;
  filterEl().dispatchEvent(new Event("change"));
}

beforeEach(() => {
  mockGetActiveAssetManifestCid.mockReset();
  mockWalkManifestChain.mockReset();
  mockGetFromRemoteIPFS.mockReset();
});

afterEach(async () => {
  // Each setup() gets a fresh Alpine instance via jest.resetModules(); tear
  // down the one that just ran so its MutationObserver can't initialize the
  // next test's DOM before its own instance starts.
  const { Alpine } = await import("../../frontend/src/js/ui/alpine.js");
  Alpine.destroyTree(document.body);
  Alpine.stopObservingMutations();
  document.body.innerHTML = "";
});

// ─── Characterization (must hold on the old imperative module too) ───

test("shows the empty state and blank stats when no asset is active", async () => {
  mockGetActiveAssetManifestCid.mockReturnValue(null);
  await setup();
  expect(listEl().querySelector("li.ledger-empty")?.textContent).toBe(
    "No operations recorded yet."
  );
  expect(entries()).toHaveLength(0);
  expect(statsEl().textContent).toBe("");
  expect(mockWalkManifestChain).not.toHaveBeenCalled();
});

test("renders manifest-chain entries most-recent first with icons and truncation", async () => {
  seedChain();
  await setup();

  const lis = entries();
  expect(lis).toHaveLength(3);

  // LOAD (v2 manifest) — newest
  expect(entryType(lis[0])?.textContent?.trim()).toBe("Load");
  expect(entryType(lis[0])?.getAttribute("title")).toBe("LOAD");
  expect(lis[0].querySelector(".ledger-entry-icon")?.textContent).toBe("→");
  const cid0 = lis[0].querySelector(".ledger-entry-cid");
  expect(cid0?.getAttribute("title")).toBe(CID_A);
  expect(cid0?.textContent).toBe("bafyMani…estAaa");

  // AI (chat provenance) — falls back to opType label and "·" icon
  expect(entryType(lis[1])?.textContent?.trim()).toBe("AI");
  expect(lis[1].querySelector(".ledger-entry-icon")?.textContent).toBe("·");

  // SAVE (v1 manifest) — oldest
  expect(entryType(lis[2])?.textContent?.trim()).toBe("Save");
  expect(lis[2].querySelector(".ledger-entry-icon")?.textContent).toBe("⬇");

  // Actor truncated with the full address in the title; time rendered.
  const actor = lis[0].querySelector(".ledger-entry-actor");
  expect(actor?.textContent).toBe("0x1111…1111");
  expect(actor?.getAttribute("title")).toBe(ADDRESS);
  expect(lis[0].querySelector(".ledger-entry-time")?.textContent?.trim()).toMatch(/\d/);
});

test("stats line counts ops and unique asset CIDs", async () => {
  seedChain();
  await setup();
  expect(statsEl().textContent).toBe("3 ops · 2 assets");
});

test("filter select narrows the list and shows the empty state on no match", async () => {
  seedChain();
  await setup();

  selectFilter("SAVE");
  await flush();
  const lis = entries();
  expect(lis).toHaveLength(1);
  expect(entryType(lis[0])?.textContent?.trim()).toBe("Save");

  selectFilter("GENERATION");
  await flush();
  expect(entries()).toHaveLength(0);
  expect(listEl().querySelector("li.ledger-empty")?.textContent).toBe(
    "No operations recorded yet."
  );

  selectFilter("");
  await flush();
  expect(entries()).toHaveLength(3);
});

test("stats line survives a filter that matches nothing (stale-stats quirk)", async () => {
  seedChain();
  await setup();
  selectFilter("GENERATION");
  await flush();
  expect(statsEl().textContent).toBe("3 ops · 2 assets");
});

test("anchor button reports the stubbed contract support", async () => {
  seedChain();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  await setup();
  /** @type {HTMLElement} */ (document.getElementById("ledgerAnchorBtn")).click();
  await flush();
  expect(warn).toHaveBeenCalledWith(
    "[LEDGER] anchorManifest() not available in current contract"
  );
  warn.mockRestore();
});

test("reloads the manifest chain when ASSET_PUBLISHED fires", async () => {
  seedChain();
  await setup();
  expect(mockWalkManifestChain).toHaveBeenCalledTimes(1);

  busMod.emit(busMod.EVENTS.ASSET_PUBLISHED, {});
  await flush();
  await flush();
  expect(mockWalkManifestChain).toHaveBeenCalledTimes(2);
  expect(mockWalkManifestChain).toHaveBeenLastCalledWith(CID_A);
  expect(entries()).toHaveLength(3);
});

test("clears the list when the chain walk fails", async () => {
  mockGetActiveAssetManifestCid.mockReturnValue(CID_A);
  mockWalkManifestChain.mockRejectedValue(new Error("ipfs down"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  await setup();
  expect(entries()).toHaveLength(0);
  expect(listEl().querySelector("li.ledger-empty")).toBeTruthy();
  warn.mockRestore();
});

// ─── Reactive contract (fails on the old imperative module) ─────────

test("reactive: writing the store re-renders the list without an explicit render call", async () => {
  mockGetActiveAssetManifestCid.mockReturnValue(null);
  await setup();
  expect(entries()).toHaveLength(0);

  const { Alpine } = await import("../../frontend/src/js/ui/alpine.js");
  const store = /** @type {any} */ (Alpine.store("ledgerPanel"));
  expect(store).toBeTruthy();

  store.activities = [
    {
      id: "manifest-bafyX",
      timestamp: 9000,
      opType: "SAVE",
      cid: "bafyX",
      actorAddress: ADDRESS,
    },
  ];
  await flush();

  const lis = entries();
  expect(lis).toHaveLength(1);
  expect(entryType(lis[0])?.textContent?.trim()).toBe("Save");
});

test("reactive: writing the store filter re-filters without touching the select", async () => {
  seedChain();
  await setup();
  expect(entries()).toHaveLength(3);

  const { Alpine } = await import("../../frontend/src/js/ui/alpine.js");
  const store = /** @type {any} */ (Alpine.store("ledgerPanel"));
  expect(store).toBeTruthy();

  store.filter = "SAVE";
  await flush();
  const lis = entries();
  expect(lis).toHaveLength(1);
  expect(entryType(lis[0])?.textContent?.trim()).toBe("Save");
  // x-model two-way binding keeps the select in sync.
  expect(filterEl().value).toBe("SAVE");
});

test("refreshLedger() re-walks the chain on demand", async () => {
  seedChain();
  await setup();
  expect(mockWalkManifestChain).toHaveBeenCalledTimes(1);
  ledgerMod.refreshLedger();
  await flush();
  await flush();
  expect(mockWalkManifestChain).toHaveBeenCalledTimes(2);
});
