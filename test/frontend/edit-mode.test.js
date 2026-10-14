// @test-env dom
import { beforeEach, describe, expect, jest, test } from "bun:test";
import { emit, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { closeAsset, renameAsset, setActiveManifestCid } from "@arbesk/asset-core/domain/asset.js";
import { _resetForTesting as resetAssets } from "@arbesk/asset-core/domain/asset-store.js";
import { walletState } from "../../frontend/src/js/state/wallet-state.js";
import { libraryState } from "../../frontend/src/js/state/library-state.js";
import {
  canEdit,
  hasOpenAsset,
  isAssetOpen,
  isEditing,
  setEditing,
  toggleEditing,
  subscribeEditMode,
  _resetEditModeForTesting,
} from "../../frontend/src/js/state/edit-mode.js";

const WALLET = "0x00000000000000000000000000000000000000a1";

function editable() {
  walletState.set({ walletAddress: WALLET });
  setActiveManifestCid("bafyAsset");
}

beforeEach(() => {
  resetAssets();
  walletState.set({ walletAddress: null });
  libraryState.set({ subjectAddress: null, subjectChainId: null });
  _resetEditModeForTesting();
});

describe("edit-mode store", () => {
  test("starts in View mode", () => {
    expect(isEditing()).toBe(false);
  });

  test("canEdit needs an open asset, a wallet, and owner (not visitor) view", () => {
    expect(canEdit()).toBe(false);
    setActiveManifestCid("bafyAsset");
    expect(hasOpenAsset()).toBe(true);
    expect(canEdit()).toBe(false); // no wallet
    walletState.set({ walletAddress: WALLET });
    expect(canEdit()).toBe(true);
    libraryState.set({ subjectAddress: "0x00000000000000000000000000000000000000b2" });
    expect(canEdit()).toBe(false); // visiting someone else's profile
  });

  test("setEditing(true) is refused when the user cannot save", () => {
    expect(setEditing(true)).toBe(false);
    expect(isEditing()).toBe(false);
    editable();
    expect(setEditing(true)).toBe(true);
    expect(toggleEditing()).toBe(false);
  });

  test("subscribers hear mode changes", () => {
    editable();
    const fn = jest.fn();
    const off = subscribeEditMode(fn);
    setEditing(true);
    expect(fn).toHaveBeenCalled();
    off();
  });

  test("losing the wallet exits Edit", () => {
    editable();
    setEditing(true);
    walletState.set({ walletAddress: null });
    emit(EVENTS.WALLET_STATE_CHANGED, walletState.get());
    expect(isEditing()).toBe(false);
  });

  test("a scene reload (asset or version change) resets to View", () => {
    editable();
    setEditing(true);
    emit(EVENTS.SCENE_CLEARED);
    expect(isEditing()).toBe(false);
  });
});

describe("isAssetOpen (an asset is open, including a named empty draft)", () => {
  test("false with nothing open", () => {
    expect(isAssetOpen()).toBe(false);
  });

  test("a named empty draft (New ▾ → Empty asset) counts as open", () => {
    walletState.set({ walletAddress: WALLET });
    renameAsset("Chair");
    expect(isAssetOpen()).toBe(true);
    // Save/edit semantics keep the content-based meaning.
    expect(hasOpenAsset()).toBe(false);
    expect(canEdit()).toBe(false);
    closeAsset();
    expect(isAssetOpen()).toBe(false);
  });

  test("a loaded manifest counts as open", () => {
    setActiveManifestCid("bafyAsset");
    expect(isAssetOpen()).toBe(true);
  });
});
