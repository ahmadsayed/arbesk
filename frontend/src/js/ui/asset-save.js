// @ts-nocheck
/**
 * Arbesk Asset Save/Publish Controller.
 * Phase B: Updated for GNOME headerbar - buttons managed individually, no wrapper div.
 *
 * This module is the UI orchestrator. Manifest construction lives in
 * `services/asset-save/manifest-builder.js`; collection and editor publishing
 * live in `services/asset-save/collection-publish.js` and
 * `services/asset-save/editor-publish.js`.
 */

import { getContractAddress } from "../blockchain/network-config.js";
import { showDialog } from "./dialog.js";
import { getPendingChildRefs } from "../engine/scene-graph.js";
import { updateUrlAsset, updateUrlManifest } from "../services/url-utils.js";
import { getAssetName } from "../services/token.js";
import { showToast } from "./toasts.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { deriveDefaultAssetId } from "../utils/collections.js";
import { log, error } from "../utils/log.js";
import { saveAssetDraftCore } from "../services/asset-save/manifest-builder.js";
import { verifyCanEdit } from "../services/asset-save/editor-publish.js";
import { publishCollectionForAsset } from "../services/asset-save/collection-publish.js";
import { announceStatus } from "../services/api.js";

const saveBtn = document.getElementById("saveAssetBtn");
const saveBtnText = document.getElementById("saveAssetBtnText");
const publishBtn = document.getElementById("publishAssetBtn");
const publishBtnText = document.getElementById("publishAssetBtnText");
const assetStatusName = document.getElementById("assetStatusName");
const assetStatusMeta = document.getElementById("assetStatusMeta");

let isSaving = false;
let isPublishing = false;

function requireWallet() {
  if (walletState.get().walletAddress) return true;
  showToast({
    type: "error",
    title: "Not Signed In",
    message: "Please log in or sign up first.",
  });
  return false;
}

function isRateLimitError(err) {
  if (!err || typeof err.message !== "string") return false;
  return (
    err.message.includes("HTTP 429") ||
    err.message.includes("Too Many Requests")
  );
}

function updateAssetStatus(name, meta) {
  if (assetStatusName) assetStatusName.textContent = name;
  if (assetStatusMeta) assetStatusMeta.textContent = meta;
}

function updateButtonState() {
  const hasAsset =
    !!assetState.get().activeAssetManifestCid ||
    !!assetState.get().generatedAsset ||
    getPendingChildRefs().length > 0;
  const hasWallet = !!walletState.get().walletAddress;
  const visible = hasAsset && hasWallet;

  if (saveBtn) saveBtn.hidden = !visible;
  if (publishBtn) publishBtn.hidden = !visible;

  if (saveBtnText) saveBtnText.textContent = "Save";
  if (saveBtn) saveBtn.title = "Save Draft (Ctrl+S)";
  if (publishBtnText) {
    publishBtnText.textContent = "Besk it";
  }
  if (publishBtn) {
    publishBtn.title = "Besk it: publish this asset";
  }
}

async function fetchAssetName(tokenId) {
  return getAssetName(tokenId);
}

const DEFAULT_NAMES = new Set([
  "untitled asset",
  "my asset",
  "no asset open",
  "",
]);

function isDefaultName(name) {
  return DEFAULT_NAMES.has((name || "").toLowerCase().trim());
}

async function resolveAssetName() {
  // Always prefer the user's in-session rename.
  if (assetState.get().activeAssetName) return assetState.get().activeAssetName;

  // If no rename yet, try fetching from the token's stored manifest.
  if (assetState.get().activeAssetTokenId) {
    return (
      (await fetchAssetName(assetState.get().activeAssetTokenId)) || "My Asset"
    );
  }
  return "My Asset";
}

/**
 * Prompt for a name only if it hasn't been explicitly set.
 * Returns the final name or null if cancelled.
 */
async function ensureExplicitName() {
  const currentName = assetState.get().activeAssetName || "";
  if (!isDefaultName(currentName)) {
    return currentName; // already explicitly named - skip dialog
  }
  const input = await showDialog(
    "Name Your Asset",
    "Give your asset a descriptive name before publishing.",
    ""
  );
  if (input === null) {
    return null;
  }
  const name = input.trim();
  if (name) {
    assetState.set({ activeAssetName: name });
    if (assetStatusName) assetStatusName.textContent = name;
    return name;
  }
  return "Untitled Asset";
}

async function onSaveAssetDraft() {
  if (isSaving) return;
  if (!requireWallet()) return;

  isSaving = true;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.title = "Saving…";
  }
  if (saveBtnText) saveBtnText.textContent = "Saving…";
  announceStatus("Saving draft…");

  try {
    const assetName = await resolveAssetName();
    const result = await saveAssetDraftCore(assetName);

    if (!result.ok) {
      if (result.reason === "empty") {
        announceStatus("No asset data to save.");
        showToast({
          type: "warning",
          title: "Nothing to Save",
          message: "Generate an asset or add linked worlds first.",
        });
      } else if (result.reason === "no-changes") {
        showToast({
          type: "info",
          title: "No Changes",
          message: "Nothing new to save.",
        });
      }
      return;
    }

    const { cid } = result;

    // Only rewrite the URL for non-tokenized drafts. For tokenized assets,
    // the ?asset=<tokenId> URL already anchors to the blockchain; avoid
    // stashing a draft manifest in query params.
    if (!assetState.get().activeAssetTokenId) {
      updateUrlManifest(cid);
    }

    emit(EVENTS.ASSET_DRAFT_SAVED, { cid });
    updateAssetStatus(
      assetName,
      assetState.get().activeAssetTokenId ? "Published" : "Draft Scene"
    );
    announceStatus("Draft saved.");
  } catch (err) {
    error("Save asset draft failed:", err);
    const rateLimited = isRateLimitError(err);
    announceStatus(
      rateLimited
        ? "Upload rate limit hit. Save aborted."
        : "Save failed: " + err.message
    );
    showToast({
      type: "error",
      title: rateLimited ? "Upload Rate Limited" : "Save Failed",
      message: rateLimited
        ? "Too many upload requests. Please wait a moment and try again."
        : err.message,
      actions: [{ label: "Retry", onClick: onSaveAssetDraft }],
    });
  } finally {
    isSaving = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.title = "Save Draft (Ctrl+S)";
    }
    updateButtonState();
  }
}

async function onPublishAsset() {
  if (isPublishing) return;
  if (!requireWallet()) return;

  isPublishing = true;
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.title = "Besking…";
  }
  if (publishBtnText) publishBtnText.textContent = "Besking…";
  announceStatus(
    assetState.get().activeAssetTokenId
      ? "Republishing asset…"
      : "Publishing asset…"
  );

  try {
    const assetName = await ensureExplicitName();
    if (!assetName) {
      isPublishing = false;
      if (publishBtn) publishBtn.disabled = false;
      updateButtonState();
      return;
    }

    // Republishes (existing tokenId) snapshot the live comment thread into the
    // manifest via publishContext. First-time publishes have no prior comments.
    const existingTokenId = assetState.get().activeAssetTokenId;
    const walletAddr = walletState.get().walletAddress;

    // Fail fast on unauthorized republish attempts so the user gets immediate
    // feedback instead of paying for gas on a transaction that will revert.
    if (existingTokenId) {
      await verifyCanEdit(existingTokenId, walletAddr);
    }

    const publishContext = existingTokenId
      ? {
          tokenId: existingTokenId,
          chainId: walletState.get().chainId,
          contractAddress: getContractAddress(walletState.get().chainId),
        }
      : null;

    // Save first: every Besk creates a new draft version, then publishes it.
    const result = await saveAssetDraftCore(assetName, {
      captureThumbnail: true,
      publishContext,
    });

    if (!result.ok) {
      if (result.reason === "empty") {
        announceStatus("No asset data to publish.");
        showToast({
          type: "warning",
          title: "Nothing to Publish",
          message: "Generate an asset or add linked worlds first.",
        });
        return;
      }
      // A publish request should always anchor the current asset to the
      // collection, even when the asset manifest itself has not changed
      // semantically (e.g. the user already saved the color edit as a draft).
      // The collection manifest still gets a version bump + new prev link.
      if (result.reason !== "no-changes") return;
    }

    const { cid: assetCid, manifest: publishedManifest } = result;

    // Use the manifest's own asset_id as the collection key for new assets;
    // it is generated from Date.now() at creation time and is unique per draft.
    // For updates to an existing asset, activeAssetId is already set and reused.
    const assetID = deriveDefaultAssetId(
      assetState.get().activeAssetId,
      publishedManifest?.asset_id || `asset_${Date.now()}`
    );
    log(
      `[PUBLISH] assetID derived | activeAssetId=${
        assetState.get().activeAssetId
      } manifestAssetId=${publishedManifest?.asset_id} chosen=${assetID}`
    );
    assetState.set({ activeAssetId: assetID });

    announceStatus("Confirm transaction in MetaMask…");

    const { tokenId, isNew } = await publishCollectionForAsset(
      assetCid,
      assetID,
      walletAddr
    );

    assetState.set({
      activeCollectionTokenId: String(tokenId),
      activeAssetTokenId: String(tokenId),
    });
    updateUrlAsset(tokenId);
    announceStatus(
      isNew
        ? "Default collection published and minted."
        : "Collection republished successfully."
    );

    if (isNew) {
      const { refreshTeamPanel } = await import("./collaborators.js");
      refreshTeamPanel();
    }

    emit(EVENTS.ASSET_PUBLISHED, {
      tokenId: assetState.get().activeAssetTokenId,
      cid: assetCid,
    });
    updateAssetStatus(assetName, "Published");
  } catch (err) {
    error("Publish asset failed:", err);
    const rateLimited = isRateLimitError(err);
    announceStatus(
      rateLimited
        ? "Upload rate limit hit. Publish aborted."
        : "Publish failed: " + err.message
    );
    showToast({
      type: "error",
      title: rateLimited ? "Upload Rate Limited" : "Publish Failed",
      message: rateLimited
        ? "Too many upload requests. The asset was not anchored on-chain. Please wait a moment and try again."
        : err.message,
      actions: [{ label: "Retry", onClick: onPublishAsset }],
    });
  } finally {
    isPublishing = false;
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.title = "Besk it: publish this asset";
    }
    updateButtonState();
  }
}

export { onSaveAssetDraft, onPublishAsset };

saveBtn?.addEventListener("click", onSaveAssetDraft);
publishBtn?.addEventListener("click", onPublishAsset);

document.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key === "s")) return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (
    document.activeElement?.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  )
    return;
  if (saveBtn && !saveBtn.hidden) {
    e.preventDefault();
    onSaveAssetDraft();
  }
});

// Asset name is set at creation time and displayed read-only in the header.

on(EVENTS.SCENE_READY, (e) => {
  const manifest = e?.manifest;
  // Preserve an existing rename - don't overwrite with fallback defaults.
  const name =
    manifest?.name || assetState.get().activeAssetName || "Untitled Asset";
  if (manifest?.name || !assetState.get().activeAssetName) {
    assetState.set({ activeAssetName: name });
  }
  updateAssetStatus(
    name,
    assetState.get().activeAssetTokenId ? "Published" : "Draft Scene"
  );
  updateButtonState();
});

on(EVENTS.SCENE_EMPTY, () => {
  if (saveBtn) saveBtn.hidden = true;
  if (publishBtn) publishBtn.hidden = true;
  updateAssetStatus("No asset open", "Create or open an asset");
});
on(EVENTS.WALLET_CONNECTED, updateButtonState);
on(EVENTS.WALLET_DISCONNECTED, () => {
  if (saveBtn) saveBtn.hidden = true;
  if (publishBtn) publishBtn.hidden = true;
});
on(EVENTS.ASSET_STATE_CHANGED, updateButtonState);
