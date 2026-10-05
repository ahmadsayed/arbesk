/**
 * Puts the edit-mode store into Edit for gizmo unit tests by making the
 * real can-edit rule true (wallet + open asset).
 */
import { setActiveManifestCid } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../../../frontend/src/js/state/wallet-state.js";
import { setEditing } from "../../../frontend/src/js/state/edit-mode.js";

export function enterEditForTest() {
  walletState.set({ walletAddress: "0x00000000000000000000000000000000000000a1" });
  setActiveManifestCid("bafyTestAsset");
  if (!setEditing(true)) throw new Error("enterEditForTest: canEdit() is false");
}
