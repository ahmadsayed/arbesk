// @test-env dom
/**
 * Asset chrome: the single renderer for header title/meta and button
 * visibility. State-driven — no event-ordering assumptions.
 */

import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
let assetStore, _resetAssets, walletState, libraryState, emit, EVENTS;
let renameAsset, resetForNewAsset, closeAsset;
let state;

// Controlled stand-in for the version-history store: tests set entries/active
// directly and poke subscribers to trigger a re-render.
const versionStore = {
  entries: [],
  active: -1,
  subs: new Set(),
};

function title() {
  return document.getElementById("assetStatusName").textContent;
}
function meta() {
  return document.getElementById("assetStatusMeta").textContent;
}
function hidden(id) {
  return document.getElementById(id).hidden;
}

beforeAll(async () => {
  await mock.module(
    "../../frontend/src/js/engine/cleanup.js",
    () => ({
      getPendingChildRefs: () => [],
      getPendingSourceOverrides: () => new Map(),
    })
  );
  await mock.module(
    "@arbesk/asset-core/domain/version-history-store.js",
    () => ({
      getState: () => ({
        entries: versionStore.entries,
        activeCid: null,
        publishedCid: null,
        isLoading: false,
      }),
      activeIndex: () => versionStore.active,
      subscribe: (fn) => {
        versionStore.subs.add(fn);
        return () => versionStore.subs.delete(fn);
      },
    })
  );
  document.body.innerHTML = `
    <span id="assetStatusName">No asset open</span>
    <span id="assetStatusMeta">Create or open an asset</span>
    <button id="newMenuBtn"></button>
    <button id="saveAssetBtn" hidden></button>
    <button id="saveAssetBtnText"></button>
    <button id="publishAssetBtn" hidden></button>
    <button id="publishAssetBtnText"></button>
    <button id="downloadAssetBtn" hidden></button>
    <section id="assetSection" hidden></section>`;
  ({ assetStore, _resetForTesting: _resetAssets } = await import(
    "@arbesk/asset-core/domain/asset-store.js"
  ));
  ({ walletState } = await import(
    "../../frontend/src/js/state/wallet-state.js"
  ));
  ({ libraryState } = await import(
    "../../frontend/src/js/state/library-state.js"
  ));
  ({ emit, EVENTS } = await import("@arbesk/asset-core/events/bus.js"));
  ({ renameAsset, resetForNewAsset, closeAsset } = await import(
    "@arbesk/asset-core/domain/asset.js"
  ));
  await import("../../frontend/src/js/ui/asset-chrome.js");
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
});

beforeEach(() => {
  _resetAssets();
  walletState.set({ walletAddress: null });
  libraryState.set({ subjectAddress: null, subjectChainId: null });
  versionStore.entries = [];
  versionStore.active = -1;
  state.pendingTransformEdits = new Map();
  emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
});

function notifyVersionSubs() {
  versionStore.subs.forEach((fn) => fn({}));
}

test("initial state: No asset open, all buttons hidden", () => {
  expect(title()).toBe("No asset open");
  expect(meta()).toBe("Create or open an asset");
  expect(hidden("saveAssetBtn")).toBe(true);
  expect(hidden("publishAssetBtn")).toBe(true);
  expect(hidden("downloadAssetBtn")).toBe(true);
});

test("named draft without wallet: name shown, buttons still hidden", () => {
  resetForNewAsset();
  renameAsset("My Test Asset");
  expect(title()).toBe("My Test Asset");
  expect(meta()).toBe("Draft");
  expect(hidden("saveAssetBtn")).toBe(true);
});

test("loaded asset with wallet: buttons appear", () => {
  walletState.set({ walletAddress: "0xabc" });
  emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
  assetStore.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  expect(title()).toBe("Chair");
  expect(meta()).toBe("Draft");
  expect(hidden("saveAssetBtn")).toBe(false);
  expect(hidden("publishAssetBtn")).toBe(false);
  expect(hidden("downloadAssetBtn")).toBe(false);
});

test("tokenized asset shows Published", () => {
  assetStore.set({
    activeAssetManifestCid: "bafyX",
    activeAssetName: "Chair",
    activeAssetTokenId: "7",
  });
  expect(meta()).toBe("Published");
});

test("closeAsset returns chrome to the empty state", () => {
  assetStore.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  closeAsset();
  expect(title()).toBe("No asset open");
  expect(meta()).toBe("Create or open an asset");
  expect(hidden("downloadAssetBtn")).toBe(true);
});

test("wallet disconnect hides save/publish but keeps download", () => {
  walletState.set({ walletAddress: "0xabc" });
  assetStore.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  walletState.set({ walletAddress: null });
  emit(EVENTS.WALLET_DISCONNECTED, {});
  expect(hidden("saveAssetBtn")).toBe(true);
  expect(hidden("publishAssetBtn")).toBe(true);
  expect(hidden("downloadAssetBtn")).toBe(false);
});

test("New is hidden without a wallet, shown for a connected owner", () => {
  expect(hidden("newMenuBtn")).toBe(true);
  walletState.set({ walletAddress: "0xabc" });
  emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
  expect(hidden("newMenuBtn")).toBe(false);
});

test("New is hidden in visitor mode even with a wallet connected", () => {
  walletState.set({ walletAddress: "0xabc" });
  libraryState.set({ subjectAddress: "0xdef" });
  emit(EVENTS.LIBRARY_STATE_CHANGED, libraryState.get());
  expect(hidden("newMenuBtn")).toBe(true);
  // Subject == wallet is owner mode: New comes back.
  libraryState.set({ subjectAddress: "0xABC" });
  emit(EVENTS.LIBRARY_STATE_CHANGED, libraryState.get());
  expect(hidden("newMenuBtn")).toBe(false);
});

test("Properties → Asset section is hidden with no asset and shown once a draft exists", () => {
  const section = () => document.getElementById("assetSection");
  expect(section().hidden).toBe(true);
  assetStore.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  expect(section().hidden).toBe(false);
  closeAsset();
  expect(section().hidden).toBe(true);
});

test("meta shows the 1-based active version and status", () => {
  assetStore.set({ activeAssetManifestCid: "bafyC", activeAssetName: "Chair" });
  versionStore.entries = [{ cid: "a" }, { cid: "b" }, { cid: "c" }];
  versionStore.active = 1;
  notifyVersionSubs();
  expect(meta()).toBe("v2 · Draft");
});

test("meta omits the version when there is no history yet", () => {
  assetStore.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  versionStore.entries = [];
  notifyVersionSubs();
  expect(meta()).toBe("Draft");
});

test("meta gains 'Unsaved changes' and Save gets the dot while edits are pending", () => {
  walletState.set({ walletAddress: "0x00000000000000000000000000000000000000a1" });
  assetStore.set({ activeAssetManifestCid: "bafyA", activeAssetName: "Stand" });
  versionStore.entries = [{ cid: "bafyA" }];
  versionStore.active = 0;
  notifyVersionSubs();
  expect(meta()).toBe("v1 · Draft");

  state.pendingTransformEdits.set("n1", [1]);
  emit(EVENTS.PENDING_EDITS_CHANGED);
  expect(meta()).toBe("v1 · Draft · Unsaved changes");
  const save = document.getElementById("saveAssetBtn");
  expect(save.classList.contains("has-unsaved")).toBe(true);
  expect(save.getAttribute("aria-label")).toBe("Save Draft (unsaved changes)");

  state.pendingTransformEdits.clear();
  emit(EVENTS.PENDING_EDITS_CHANGED);
  expect(meta()).toBe("v1 · Draft");
  expect(save.classList.contains("has-unsaved")).toBe(false);
  expect(save.getAttribute("aria-label")).toBe("Save Draft");
});

test("with no versions yet the marker reads 'Draft · Unsaved changes'", () => {
  assetStore.set({ activeAssetManifestCid: "bafyA", activeAssetName: "Stand" });
  state.pendingTransformEdits.set("n1", [1]);
  emit(EVENTS.PENDING_EDITS_CHANGED);
  expect(meta()).toBe("Draft · Unsaved changes");
});

test("beforeunload is prevented only while dirty", () => {
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);

  state.pendingTransformEdits.set("n1", [1]);
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
});
