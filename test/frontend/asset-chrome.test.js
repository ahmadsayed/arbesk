/**
 * @jest-environment jsdom
 *
 * Asset chrome: the single renderer for header title/meta and button
 * visibility. State-driven — no event-ordering assumptions.
 */
import { jest, expect, test, beforeAll, beforeEach } from "@jest/globals";

let assetStore, _resetAssets, walletState, emit, EVENTS;
let renameAsset, resetForNewAsset, closeAsset;

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
  await jest.unstable_mockModule(
    "../../frontend/src/js/engine/cleanup.js",
    () => ({ getPendingChildRefs: () => [] })
  );
  document.body.innerHTML = `
    <span id="assetStatusName">No asset open</span>
    <span id="assetStatusMeta">Create or open an asset</span>
    <button id="saveAssetBtn" hidden></button>
    <button id="saveAssetBtnText"></button>
    <button id="publishAssetBtn" hidden></button>
    <button id="publishAssetBtnText"></button>
    <button id="downloadAssetBtn" hidden></button>`;
  ({ assetStore, _resetForTesting: _resetAssets } = await import(
    "../../frontend/src/js/domain/asset-store.js"
  ));
  ({ walletState } = await import(
    "../../frontend/src/js/state/wallet-state.js"
  ));
  ({ emit, EVENTS } = await import("../../frontend/src/js/events/bus.js"));
  ({ renameAsset, resetForNewAsset, closeAsset } = await import(
    "../../frontend/src/js/domain/asset.js"
  ));
  await import("../../frontend/src/js/ui/asset-chrome.js");
});

beforeEach(() => {
  _resetAssets();
  walletState.set({ walletAddress: null });
  emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
});

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
  expect(meta()).toBe("Draft Scene");
  expect(hidden("saveAssetBtn")).toBe(true);
});

test("loaded asset with wallet: buttons appear", () => {
  walletState.set({ walletAddress: "0xabc" });
  emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
  assetStore.set({ activeAssetManifestCid: "bafyX", activeAssetName: "Chair" });
  expect(title()).toBe("Chair");
  expect(meta()).toBe("Draft Scene");
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
