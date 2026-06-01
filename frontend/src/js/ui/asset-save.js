/**
 * Arbesk Asset Save/Publish Controller.
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { publishAsset, updateAssetURI } from "../blockchain/wallet.js";
import {
  clearScene,
  captureAssetThumbnail,
  showWelcomeOverlay,
  getPendingChildRefs,
  clearPendingChildRefs,
} from "../engine/scene-graph.js";

const saveSection = document.getElementById("saveAssetSection");
const saveBtn = document.getElementById("saveAssetBtn");
const saveBtnText = document.getElementById("saveAssetBtnText");
const publishBtn = document.getElementById("publishAssetBtn");
const publishBtnText = document.getElementById("publishAssetBtnText");
const newAssetTopBtn = document.getElementById("newAssetTopBtn");
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
  if (!saveSection) return;

  const hasAsset =
    !!window.activeAssetManifestCid || getPendingChildRefs().length > 0;
  const hasWallet = !!window.walletAddress;
  saveSection.hidden = !hasAsset || !hasWallet;

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

function updateUrlAsset(tokenId) {
  const url = new URL(window.location);
  url.searchParams.delete("manifest");
  url.searchParams.set("asset", String(tokenId));
  window.history.pushState({}, "", url);
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

async function resolveAssetName() {
  if (window.activeAssetTokenId) {
    return (await fetchAssetName(window.activeAssetTokenId)) || "My Asset";
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
    // No existing manifest but we have pending child refs — create a fresh manifest
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

  // Merge pending token child refs into the manifest nodes
  for (const pendingNode of pendingRefs) {
    // Don't duplicate if already in manifest
    if (!manifest.scene.nodes.some((n) => n.node_id === pendingNode.node_id)) {
      manifest.scene.nodes.push(pendingNode);
    }
  }

  // Bump version from the manifest we loaded (the previous version)
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
  return manifest;
}

async function onSaveAssetDraft() {
  if (isSaving) return;
  if (!window.walletAddress) return alert("Please connect your wallet first.");

  isSaving = true;
  if (saveBtn) saveBtn.disabled = true;
  if (saveBtnText) saveBtnText.textContent = "Saving…";

  try {
    const assetName = await resolveAssetName();
    const manifest = await prepareManifestForWrite(assetName);
    if (!manifest) {
      alert(
        "No asset data to save. Generate an asset or add linked worlds first."
      );
      return;
    }
    const response = await fetch("/api/assets/save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save asset draft");
    }
    const { cid } = await response.json();
    window.latestAssetManifestCid = window.activeAssetManifestCid;
    window.activeAssetManifestCid = cid;

    // Clear pending child refs since they've been persisted
    clearPendingChildRefs();

    // Update URL to point to the latest draft manifest so the user sees
    // their current work. tokenID-based loading (Publish) returns the
    // on-chain tokenURI which only updates on Publish, not Save.
    const url = new URL(window.location);
    url.searchParams.set("manifest", cid);
    if (window.activeAssetTokenId) {
      url.searchParams.set("asset", String(window.activeAssetTokenId));
    } else {
      url.searchParams.delete("asset");
    }
    window.history.pushState({}, "", url);

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
  if (isPublishing) return;
  if (!window.walletAddress) return alert("Please connect your wallet first.");

  isPublishing = true;
  if (publishBtn) publishBtn.disabled = true;
  if (publishBtnText)
    publishBtnText.textContent = window.activeAssetTokenId
      ? "Updating…"
      : "Publishing…";

  try {
    const assetName = await resolveAssetName();
    const manifest = await prepareManifestForWrite(assetName);
    if (!manifest) {
      alert(
        "No asset data to publish. Generate an asset or add linked worlds first."
      );
      return;
    }

    try {
      const thumbnail = await captureAssetThumbnail();
      if (thumbnail) {
        manifest.thumbnail = manifest.thumbnail?.cid
          ? { ...thumbnail, cid: manifest.thumbnail.cid }
          : thumbnail;
      }
    } catch (thumbnailError) {
      console.warn(
        "[PUBLISH] thumbnail capture skipped:",
        thumbnailError.message
      );
    }

    const response = await fetch("/api/assets/publish-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    if (!response.ok) throw new Error("Failed to publish manifest to IPFS");
    const cid = await response.text();

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

    // Clear pending child refs since they've been persisted
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
  if (newAssetTopBtn) newAssetTopBtn.disabled = true;

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
    if (saveSection) saveSection.hidden = true;
  } catch (err) {
    console.error("Create new asset failed:", err);
  } finally {
    isCreatingNew = false;
    if (newAssetTopBtn) newAssetTopBtn.disabled = false;
  }
}

saveBtn?.addEventListener("click", onSaveAssetDraft);
publishBtn?.addEventListener("click", onPublishAsset);
newAssetTopBtn?.addEventListener("click", onCreateNewAsset);

document.addEventListener("scene:ready", (e) => {
  const manifest = e.detail?.manifest;
  const name = manifest?.name || window.activeAssetName || "Untitled Asset";
  window.activeAssetName = name;
  updateAssetStatus(
    name,
    window.activeAssetTokenId
      ? `Asset Token #${window.activeAssetTokenId}`
      : "Draft Scene"
  );
  updateButtonState();
});

document.addEventListener("scene:empty", () => {
  if (saveSection) saveSection.hidden = true;
  updateAssetStatus("No asset open", "Create or open an asset");
});
document.addEventListener("wallet:connected", updateButtonState);
document.addEventListener("wallet:disconnected", () => {
  if (saveSection) saveSection.hidden = true;
});

export { onSaveAssetDraft, onPublishAsset, onCreateNewAsset };
