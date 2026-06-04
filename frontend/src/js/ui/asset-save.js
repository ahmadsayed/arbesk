/**
 * Arbesk Asset Save/Publish Controller.
 * Phase B: Updated for GNOME headerbar — buttons managed individually, no wrapper div.
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { publishAsset, updateAssetURI } from "../blockchain/wallet.js";
import { showDialog } from "./dialog.js";
console.log("[SAVE] module loaded, showDialog:", typeof showDialog);
import {
  clearScene,
  captureAssetThumbnail,
  showWelcomeOverlay,
  getPendingChildRefs,
  clearPendingChildRefs,
} from "../engine/scene-graph.js";
import { updateUrlAsset, updateUrlManifest } from "../services/url-utils.js";

const saveBtn = document.getElementById("saveAssetBtn");
const saveBtnText = document.getElementById("saveAssetBtnText");
const publishBtn = document.getElementById("publishAssetBtn");
const publishBtnText = document.getElementById("publishAssetBtnText");
const assetStatusName = document.getElementById("assetStatusName");
const assetStatusMeta = document.getElementById("assetStatusMeta");

let isSaving = false;
let isPublishing = false;
let isCreatingNew = false;

function updateAssetStatus(name, meta) {
  if (assetStatusName) assetStatusName.textContent = name;
  if (assetStatusMeta) assetStatusMeta.textContent = meta;
}

function updateButtonState() {
  const hasAsset =
    !!window.activeAssetManifestCid || getPendingChildRefs().length > 0;
  const hasWallet = !!window.walletAddress;
  const visible = hasAsset && hasWallet;

  if (saveBtn) saveBtn.hidden = !visible;
  if (publishBtn) publishBtn.hidden = !visible;

  if (saveBtnText) saveBtnText.textContent = "Save Draft";
  if (publishBtnText) {
    publishBtnText.textContent = window.activeAssetTokenId
      ? "Update Published Asset"
      : "Publish Asset";
  }
  if (publishBtn) {
    publishBtn.title = window.activeAssetTokenId
      ? "Update the asset token URI to the latest manifest CID"
      : "Publish this asset as a token";
  }
}

async function fetchAssetName(tokenId) {
  try {
    const { contract } = await import("../blockchain/wallet.js");
    const c = contract || window.contract;
    if (!c) return null;
    const cid = await c.methods.tokenURI(tokenId).call();
    if (!cid) return null;
    const manifest = await getFromRemoteIPFS(cid);
    return manifest.name || null;
  } catch {
    return null;
  }
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
  if (window.activeAssetName) return window.activeAssetName;

  // If no rename yet, try fetching from the token's stored manifest.
  if (window.activeAssetTokenId) {
    return (await fetchAssetName(window.activeAssetTokenId)) || "My Asset";
  }
  return "My Asset";
}

/**
 * Prompt the user for an asset name before publishing.
 * Always shows the dialog pre-filled with the current name.
 * Returns the final name or null if cancelled.
 */
async function ensureExplicitName() {
  const currentName = window.activeAssetName || "";
  console.log(
    "[PUBLISH] ensureExplicitName: currentName=",
    currentName,
    "isDefault:",
    isDefaultName(currentName)
  );
  const defaultValue = isDefaultName(currentName) ? "" : currentName;
  console.log(
    "[PUBLISH] ensureExplicitName: calling showDialog with defaultValue=",
    defaultValue
  );
  const input = await showDialog(
    "Name Your Asset",
    "Give your asset a descriptive name before publishing.",
    defaultValue
  );
  console.log("[PUBLISH] ensureExplicitName: showDialog returned:", input);
  if (input === null) {
    return null; // user cancelled
  }
  const name = input.trim();
  if (name) {
    window.activeAssetName = name;
    if (assetStatusName) assetStatusName.textContent = window.activeAssetName;
    return name;
  }
  return window.activeAssetName || "My Asset";
}

function advanceManifestVersion(manifest, latestCid) {
  manifest.version = (manifest.version || 0) + 1;
  manifest.prev_asset_manifest_cid =
    latestCid || window.activeAssetManifestCid || null;
}

async function prepareManifestForWrite(assetName) {
  let manifest;
  const pendingRefs = getPendingChildRefs();

  if (window.activeAssetManifestCid) {
    manifest = await getFromRemoteIPFS(window.activeAssetManifestCid);
  } else if (pendingRefs.length > 0) {
    manifest = {
      name: assetName,
      asset_id: `asset_${Date.now()}`,
      version: 1,
      timestamp: Date.now(),
      scene: { nodes: [] },
    };
    console.log(
      `[SAVE] creating fresh manifest for ${pendingRefs.length} pending child refs`
    );
  } else {
    return null;
  }

  manifest.name = assetName;
  manifest.asset_id ||= `asset_${Date.now()}`;
  manifest.scene ||= { nodes: [] };
  manifest.scene.nodes ||= [];

  for (const pendingNode of pendingRefs) {
    if (!manifest.scene.nodes.some((n) => n.node_id === pendingNode.node_id)) {
      manifest.scene.nodes.push(pendingNode);
    }
  }

  const prevCid = window.activeAssetManifestCid;
  if (prevCid) {
    try {
      const prevManifest = await getFromRemoteIPFS(prevCid);
      manifest.version = (prevManifest.version || 0) + 1;
      manifest.prev_asset_manifest_cid = prevCid;
    } catch {
      advanceManifestVersion(manifest, prevCid);
    }
  }
  return { manifest, prevCid };
}

async function onSaveAssetDraft() {
  if (isSaving) return;
  if (!window.walletAddress) return alert("Please connect your wallet first.");

  isSaving = true;
  if (saveBtn) saveBtn.disabled = true;
  if (saveBtnText) saveBtnText.textContent = "Saving…";

  try {
    const assetName = await resolveAssetName();
    const prepared = await prepareManifestForWrite(assetName);
    if (!prepared) {
      alert(
        "No asset data to save. Generate an asset or add linked worlds first."
      );
      return;
    }

    const { cid } = await saveManifest(prepared.manifest);
    window.latestAssetManifestCid = window.activeAssetManifestCid;
    window.activeAssetManifestCid = cid;

    clearPendingChildRefs();

    updateUrlManifest(cid, window.activeAssetTokenId || null);

    document.dispatchEvent(
      new CustomEvent("asset:draftSaved", { detail: { cid } })
    );
    updateAssetStatus(
      assetName,
      window.activeAssetTokenId
        ? `Asset Token #${window.activeAssetTokenId}`
        : "Draft Scene"
    );
  } catch (err) {
    console.error("Save asset draft failed:", err);
    alert("Save failed: " + err.message);
  } finally {
    isSaving = false;
    if (saveBtn) saveBtn.disabled = false;
    updateButtonState();
  }
}

async function onPublishAsset() {
  console.log("[PUBLISH] onPublishAsset called", {
    isPublishing,
    wallet: !!window.walletAddress,
    tokenId: window.activeAssetTokenId,
  });
  if (isPublishing) return;
  if (!window.walletAddress) return alert("Please connect your wallet first.");

  isPublishing = true;
  if (publishBtn) publishBtn.disabled = true;
  if (publishBtnText)
    publishBtnText.textContent = window.activeAssetTokenId
      ? "Updating…"
      : "Publishing…";

  try {
    console.log(
      "[PUBLISH] calling ensureExplicitName, currentName:",
      window.activeAssetName
    );
    const assetName = await ensureExplicitName();
    console.log("[PUBLISH] ensureExplicitName returned:", assetName);
    if (!assetName) {
      isPublishing = false;
      if (publishBtn) publishBtn.disabled = false;
      updateButtonState();
      return;
    }
    const prepared = await prepareManifestForWrite(assetName);
    if (!prepared) {
      alert(
        "No asset data to publish. Generate an asset or add linked worlds first."
      );
      return;
    }

    try {
      const thumbnail = await captureAssetThumbnail();
      if (thumbnail) {
        prepared.manifest.thumbnail = prepared.manifest.thumbnail?.cid
          ? { ...thumbnail, cid: prepared.manifest.thumbnail.cid }
          : thumbnail;
      }
    } catch (thumbnailError) {
      console.warn(
        "[PUBLISH] thumbnail capture skipped:",
        thumbnailError.message
      );
    }

    const { cid } = await publishManifest(prepared.prevCid, prepared.manifest);

    if (window.activeAssetTokenId) {
      const txHash = await updateAssetURI(window.activeAssetTokenId, cid);
      if (!txHash) throw new Error("Update transaction failed");
    } else {
      const tokenId =
        "0x" +
        Array.from(cid)
          .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
          .toString(16)
          .replace(/^-/, "");
      const txHash = await publishAsset(cid, tokenId);
      if (!txHash) throw new Error("Publish transaction failed");
      window.activeAssetTokenId = tokenId;
      updateUrlAsset(tokenId);

      const { showAssetEditors } = await import("./asset-editors.js");
      showAssetEditors(tokenId);
    }

    window.latestAssetManifestCid = window.activeAssetManifestCid;
    window.activeAssetManifestCid = cid;

    clearPendingChildRefs();

    document.dispatchEvent(
      new CustomEvent("asset:published", {
        detail: { tokenId: window.activeAssetTokenId, cid },
      })
    );
    updateAssetStatus(assetName, `Asset Token #${window.activeAssetTokenId}`);
  } catch (err) {
    console.error("Publish asset failed:", err);
    alert("Publish failed: " + err.message);
  } finally {
    isPublishing = false;
    if (publishBtn) publishBtn.disabled = false;
    updateButtonState();
  }
}

async function onCreateNewAsset() {
  if (isCreatingNew) return;
  if (window.activeAssetManifestCid) {
    const ok = confirm("Start a new asset? Any unsaved changes will be lost.");
    if (!ok) return;
  }

  isCreatingNew = true;

  try {
    const nameInput = prompt("Name your new asset:", "My Asset");
    window.activeAssetName = nameInput ? nameInput.trim() : "My Asset";
    clearScene();
    window.activeAssetTokenId = null;
    window.activeAssetManifestCid = null;
    window.latestAssetManifestCid = null;

    const url = new URL(window.location);
    url.searchParams.delete("asset");
    url.searchParams.delete("manifest");
    window.history.pushState({}, "", url);

    showWelcomeOverlay();
    document.dispatchEvent(new CustomEvent("scene:empty"));
    updateAssetStatus(window.activeAssetName, "Draft Scene");
  } catch (err) {
    console.error("Create new asset failed:", err);
  } finally {
    isCreatingNew = false;
  }
}

saveBtn?.addEventListener("click", onSaveAssetDraft);
publishBtn?.addEventListener("click", onPublishAsset);

// ─── Editable asset title (header bar) ───
// `#assetStatusName` is contenteditable; commit on Enter/blur, revert on Escape,
// and propagate the new name to the rest of the app.

function hasAssetContext() {
  return (
    !!window.activeAssetManifestCid ||
    !!window.activeAssetName ||
    getPendingChildRefs().length > 0
  );
}

function sanitizeName(raw) {
  return (raw || "").replace(/\s+/g, " ").trim();
}

function commitAssetName() {
  if (!assetStatusName) return;
  const name = sanitizeName(assetStatusName.textContent);

  // No open asset, or the field was cleared — restore the current label.
  if (!hasAssetContext() || !name) {
    assetStatusName.textContent = window.activeAssetName || "No asset open";
    return;
  }

  window.activeAssetName = name;
  assetStatusName.textContent = name; // normalize (strip stray newlines)
  document.dispatchEvent(
    new CustomEvent("asset:renamed", { detail: { name } })
  );
}

if (assetStatusName) {
  assetStatusName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      assetStatusName.blur(); // commit through the blur handler
    } else if (e.key === "Escape") {
      e.preventDefault();
      assetStatusName.textContent = window.activeAssetName || "No asset open";
      assetStatusName.blur();
    }
  });

  assetStatusName.addEventListener("blur", commitAssetName);

  // Force plain-text paste (no rich HTML or line breaks).
  assetStatusName.addEventListener("paste", (e) => {
    e.preventDefault();
    const text =
      (e.clipboardData || window.clipboardData)?.getData("text") || "";
    document.execCommand("insertText", false, text.replace(/\s+/g, " "));
  });
}

document.addEventListener("scene:ready", (e) => {
  const manifest = e.detail?.manifest;
  // Preserve an existing rename — don't overwrite with fallback defaults.
  const name = manifest?.name || window.activeAssetName || "Untitled Asset";
  if (manifest?.name || !window.activeAssetName) {
    window.activeAssetName = name;
  }
  updateAssetStatus(
    name,
    window.activeAssetTokenId
      ? `Asset Token #${window.activeAssetTokenId}`
      : "Draft Scene"
  );
  updateButtonState();
});

document.addEventListener("scene:empty", () => {
  if (saveBtn) saveBtn.hidden = true;
  if (publishBtn) publishBtn.hidden = true;
  updateAssetStatus("No asset open", "Create or open an asset");
});
document.addEventListener("wallet:connected", updateButtonState);
document.addEventListener("wallet:disconnected", () => {
  if (saveBtn) saveBtn.hidden = true;
  if (publishBtn) publishBtn.hidden = true;
});

export { onSaveAssetDraft, onPublishAsset, onCreateNewAsset };
