/**
 * Arbesk Asset Save/Publish Controller.
 * Phase B: Updated for GNOME headerbar — buttons managed individually, no wrapper div.
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { publishAsset, updateAssetURI } from "../blockchain/wallet.js";
import { showDialog } from "./dialog.js";
import {
  clearScene,
  captureAssetThumbnail,
  dismissCreatePulse,
  getPendingChildRefs,
  clearPendingChildRefs,
  getPendingPostProcessorEdits,
  clearPendingPostProcessorEdits,
} from "../engine/scene-graph.js";
import { updateUrlAsset, updateUrlManifest } from "../services/url-utils.js";
import { decomposeAndStore, isComposite } from "../gltf/decomposer.js";
import { editCompositeColors } from "../gltf/material-editor.js";
import { updateBurnButton } from "./collaborators.js";
import { showToast } from "./toasts.js";

const saveBtn = document.getElementById("saveAssetBtn");
const saveBtnText = document.getElementById("saveAssetBtnText");
const publishBtn = document.getElementById("publishAssetBtn");
const publishBtnText = document.getElementById("publishAssetBtnText");
const assetStatusName = document.getElementById("assetStatusName");
const assetStatusMeta = document.getElementById("assetStatusMeta");

let isSaving = false;
let isPublishing = false;

function announceStatus(message) {
  const el = document.getElementById("srStatus");
  if (el) {
    el.textContent = "";
    // Force screen reader announcement by clearing then setting
    requestAnimationFrame(() => { el.textContent = message; });
  }
}

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

  if (saveBtnText) saveBtnText.textContent = "Save";
  if (saveBtn) saveBtn.title = "Save Draft (Ctrl+S)";
  if (publishBtnText) {
    publishBtnText.textContent = window.activeAssetTokenId ? "Republish" : "Publish";
  }
  if (publishBtn) {
    publishBtn.title = window.activeAssetTokenId
      ? "Republish the asset with the latest manifest CID"
      : "Publish this asset as a token";
  }

  // Show burn button only for published (tokenized) assets
  updateBurnButton();
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
 * Prompt for a name only if it hasn't been explicitly set.
 * Returns the final name or null if cancelled.
 */
async function ensureExplicitName() {
  const currentName = window.activeAssetName || "";
  if (!isDefaultName(currentName)) {
    return currentName; // already explicitly named — skip dialog
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
    window.activeAssetName = name;
    if (assetStatusName) assetStatusName.textContent = window.activeAssetName;
    return name;
  }
  return "Untitled Asset";
}

function advanceManifestVersion(manifest, latestCid) {
  manifest.version = (manifest.version || 0) + 1;
  manifest.prev_asset_manifest_cid =
    latestCid || window.activeAssetManifestCid || null;
}

/**
 * Compare two manifests for semantic equality, ignoring auto-generated fields.
 */
function manifestsSemanticallyEqual(a, b) {
  if (!a || !b) return false;
  const strip = (m) => {
    const copy = JSON.parse(JSON.stringify(m));
    delete copy.timestamp;
    delete copy.version;
    delete copy.prev_asset_manifest_cid;
    return copy;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Decompose all monolithic glTF source nodes in a manifest.
 * Fetches each glTF, decomposes buffers/images to separate IPFS CIDs,
 * and updates node.source.cid to point to the composite JSON.
 * Already-composite nodes (ipfs:// URIs) are skipped.
 *
 * @param {object} manifest - The manifest being prepared for write
 * @returns {Promise<number>} Count of nodes decomposed
 */
async function decomposeManifestNodes(manifest) {
  let decomposed = 0;
  const nodes = manifest.scene?.nodes || [];

  for (const node of nodes) {
    // Only process nodes with a glTF source (not token children, not GLB)
    if (!node.source?.cid) continue;
    if (node.source.format === "glb") continue;
    if (node.child_ref) continue;

    const cid = node.source.cid;
    console.log(
      `[DECOMPOSE-SAVE] checking node ${node.node_id} | sourceCid=${cid}`
    );

    try {
      const gltf = await getFromRemoteIPFS(cid);

      // Validate it looks like a glTF
      if (!gltf.asset || !gltf.asset.version) {
        console.log(`[DECOMPOSE-SAVE] CID ${cid} is not a glTF, skipping`);
        continue;
      }

      // Skip if already composite
      if (isComposite(gltf)) {
        console.log(
          `[DECOMPOSE-SAVE] node ${node.node_id} already composite, skipping`
        );
        continue;
      }

      // Decompose and store
      const { compositeCid } = await decomposeAndStore(gltf);

      // Update the node's source to point to the composite
      node.source.cid = compositeCid;
      node.source.path = "composite.gltf";
      decomposed++;
      console.log(
        `[DECOMPOSE-SAVE] node ${node.node_id} decomposed | old=${cid} new=${compositeCid}`
      );
    } catch (err) {
      console.warn(
        `[DECOMPOSE-SAVE] failed to decompose node ${node.node_id}:`,
        err.message
      );
      // Continue with other nodes — don't block the save
    }
  }

  return decomposed;
}

async function prepareManifestForWrite(assetName) {
  let manifest;
  const pendingRefs = getPendingChildRefs();
  const pendingPP = getPendingPostProcessorEdits();

  if (window.activeAssetManifestCid) {
    manifest = await getFromRemoteIPFS(window.activeAssetManifestCid);
  } else if (pendingRefs.length > 0 || pendingPP.size > 0) {
    manifest = {
      name: assetName,
      asset_id: `asset_${Date.now()}`,
      version: 1,
      timestamp: Date.now(),
      scene: { nodes: [] },
    };
    console.log(
      `[SAVE] creating fresh manifest for ${pendingRefs.length} pending child refs / ${pendingPP.size} pending post-processor edits`
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

  // Apply post-processor edits.
  // Decomposed nodes: bake colors directly into the composite glTF.
  // Monolithic nodes: store as node.post_processor (runtime overlay).
  if (pendingPP.size > 0) {
    for (const [nodeId, pp] of pendingPP) {
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node) continue;

      const isDecomposed =
        node.source?.path === "composite.gltf" && node.source?.cid;

      if (isDecomposed && (pp.color || pp.meshOverrides)) {
        // Bake colors into the composite glTF (only the JSON changes)
        try {
          const result = await editCompositeColors(
            node.source.cid,
            pp.meshOverrides || null,
            pp.color || null
          );
          node.source.cid = result.compositeCid;
          console.log(
            `[SAVE] baked colors into composite glTF | node=${nodeId} newCid=${result.compositeCid}`
          );
        } catch (err) {
          console.warn(
            `[SAVE] failed to bake colors into composite glTF for ${nodeId}:`,
            err.message
          );
        }

        // Scale still goes to post_processor (geometry, not material)
        if (
          pp.scale &&
          (pp.scale.x !== 1 || pp.scale.y !== 1 || pp.scale.z !== 1)
        ) {
          node.post_processor ||= {};
          node.post_processor.scale = { ...pp.scale };
        } else if (node.post_processor) {
          delete node.post_processor.scale;
        }
        // Clean up empty post_processor
        if (
          node.post_processor &&
          Object.keys(node.post_processor).length === 0
        ) {
          delete node.post_processor;
        }
      } else {
        // Monolithic node — store as post_processor overlay
        node.post_processor ||= {};
        if (pp.color !== undefined) node.post_processor.color = pp.color;
        if (pp.scale !== undefined) node.post_processor.scale = { ...pp.scale };
        if (pp.meshOverrides && Object.keys(pp.meshOverrides).length > 0)
          node.post_processor.meshOverrides = { ...pp.meshOverrides };
        else if (node.post_processor.meshOverrides)
          delete node.post_processor.meshOverrides;
      }
    }
    console.log(
      `[SAVE] applied ${pendingPP.size} pending post-processor edit(s)`
    );
  }

  // Decompose monolithic glTF nodes into composite (ipfs://) format.
  // Only affects glTF nodes that haven't been decomposed yet.
  // Runs on both Save Draft and Publish.
  const decomposedCount = await decomposeManifestNodes(manifest);
  if (decomposedCount > 0) {
    console.log(
      `[SAVE] decomposed ${decomposedCount} glTF node(s) to composite format`
    );
  }

  const prevCid = window.activeAssetManifestCid;
  let prevManifest = null;
  if (prevCid) {
    try {
      prevManifest = await getFromRemoteIPFS(prevCid);
      manifest.version = (prevManifest.version || 0) + 1;
      manifest.prev_asset_manifest_cid = prevCid;
    } catch {
      advanceManifestVersion(manifest, prevCid);
    }
  }
  return { manifest, prevCid, prevManifest };
}

async function onSaveAssetDraft() {
  if (isSaving) return;
  if (!window.walletAddress) {
    showToast({ type: "error", title: "Wallet Not Connected", message: "Please connect your wallet first." });
    return;
  }

  isSaving = true;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.title = "Saving…";
  }
  if (saveBtnText) saveBtnText.textContent = "Saving…";
  announceStatus("Saving draft…");

  try {
    const assetName = await resolveAssetName();
    const prepared = await prepareManifestForWrite(assetName);
    if (!prepared) {
      announceStatus("No asset data to save.");
      showToast({
        type: "warning",
        title: "Nothing to Save",
        message: "Generate an asset or add linked worlds first.",
      });
      return;
    }

    if (
      prepared.prevManifest &&
      manifestsSemanticallyEqual(prepared.manifest, prepared.prevManifest)
    ) {
      showToast({
        type: "info",
        title: "No Changes",
        message: "Nothing new to save.",
      });
      isSaving = false;
      if (saveBtn) saveBtn.disabled = false;
      if (saveBtnText) saveBtnText.textContent = "Save Draft";
      updateButtonState();
      return;
    }

    const { cid } = await saveManifest(prepared.manifest);
    window.latestAssetManifestCid = window.activeAssetManifestCid;
    window.activeAssetManifestCid = cid;

    clearPendingChildRefs();
    clearPendingPostProcessorEdits();

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
    announceStatus("Draft saved.");
  } catch (err) {
    console.error("Save asset draft failed:", err);
    announceStatus("Save failed: " + err.message);
    showToast({
      type: "error",
      title: "Save Failed",
      message: err.message,
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
  if (!window.walletAddress) {
    showToast({ type: "error", title: "Wallet Not Connected", message: "Please connect your wallet first." });
    return;
  }

  isPublishing = true;
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.title = window.activeAssetTokenId ? "Republishing…" : "Publishing…";
  }
  if (publishBtnText)
    publishBtnText.textContent = window.activeAssetTokenId
      ? "Republishing…"
      : "Publishing…";
  announceStatus(window.activeAssetTokenId ? "Republishing asset…" : "Publishing asset…");

  try {
    const assetName = await ensureExplicitName();
    if (!assetName) {
      isPublishing = false;
      if (publishBtn) publishBtn.disabled = false;
      updateButtonState();
      return;
    }
    const prepared = await prepareManifestForWrite(assetName);
    if (!prepared) {
      announceStatus("No asset data to publish.");
      showToast({
        type: "warning",
        title: "Nothing to Publish",
        message: "Generate an asset or add linked worlds first.",
      });
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

    if (
      prepared.prevManifest &&
      manifestsSemanticallyEqual(prepared.manifest, prepared.prevManifest)
    ) {
      showToast({
        type: "info",
        title: "No Changes",
        message: "Nothing new to publish.",
      });
      isPublishing = false;
      if (publishBtn) publishBtn.disabled = false;
      if (publishBtnText)
        publishBtnText.textContent = window.activeAssetTokenId
          ? "Republish"
          : "Publish";
      updateButtonState();
      return;
    }

    announceStatus("Confirm transaction in MetaMask…");
    const { cid } = await publishManifest(prepared.prevCid, prepared.manifest);

    if (window.activeAssetTokenId) {
      const txHash = await updateAssetURI(window.activeAssetTokenId, cid);
      if (!txHash) throw new Error("Republish transaction failed");
      announceStatus("Asset republished successfully.");
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
      announceStatus("Asset published and minted.");
    }

    window.latestAssetManifestCid = window.activeAssetManifestCid;
    window.activeAssetManifestCid = cid;

    clearPendingChildRefs();
    clearPendingPostProcessorEdits();

    document.dispatchEvent(
      new CustomEvent("asset:published", {
        detail: { tokenId: window.activeAssetTokenId, cid },
      })
    );
    updateAssetStatus(assetName, `Asset Token #${window.activeAssetTokenId}`);
  } catch (err) {
    console.error("Publish asset failed:", err);
    announceStatus("Publish failed: " + err.message);
    showToast({
      type: "error",
      title: "Publish Failed",
      message: err.message,
      actions: [{ label: "Retry", onClick: onPublishAsset }],
    });
  } finally {
    isPublishing = false;
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.title = window.activeAssetTokenId
        ? "Republish the asset with the latest manifest CID"
        : "Publish this asset as a token";
    }
    updateButtonState();
  }
}

export { onSaveAssetDraft, onPublishAsset };

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
