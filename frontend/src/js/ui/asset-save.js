/**
 * Arbesk Asset Save/Publish Controller.
 * Phase B: Updated for GNOME headerbar — buttons managed individually, no wrapper div.
 */

import { getFromRemoteIPFS, getArrayBufferFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import {
  contract as walletContract,
  publishAsset,
  updateAssetURI,
} from "../blockchain/wallet.js";
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
import { decomposeGLB } from "../gltf/glb-parser.js";
import { editCompositeColors } from "../gltf/material-editor.js";
import { editSourceColors } from "../gltf/source-color-editor.js";
import {
  getPendingSourceColorEdits,
  clearPendingSourceColorEdits,
} from "../engine/parametric-preview.js";
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

function requireWallet() {
  if (window.walletAddress) return true;
  showToast({ type: "error", title: "Wallet Not Connected", message: "Please connect your wallet first." });
  return false;
}

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
    publishBtnText.textContent = "Besk it";
  }
  if (publishBtn) {
    publishBtn.title = "Besk it: publish this asset";
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
    // Only process nodes with a source (not token children)
    if (!node.source?.cid) continue;
    if (node.child_ref) continue;

    const cid = node.source.cid;
    const format = (node.source.format || "gltf").toLowerCase();
    console.log(
      `Decompose save: checking node ${node.node_id} | sourceCid=${cid} format=${format}`
    );

    try {
      if (format === "glb") {
        const glbBuffer = await getArrayBufferFromRemoteIPFS(cid);
        const { compositeCid } = await decomposeGLB(glbBuffer);

        node.source.cid = compositeCid;
        node.source.path = "composite.gltf";
        node.source.format = "gltf";
        decomposed++;
        console.log(
          `Decompose save: node ${node.node_id} GLB decomposed | old=${cid} new=${compositeCid}`
        );
        continue;
      }

      const gltf = await getFromRemoteIPFS(cid);

      // Validate it looks like a glTF
      if (!gltf.asset || !gltf.asset.version) {
        console.log(`Decompose save: CID ${cid} is not a glTF, skipping`);
        continue;
      }

      // Skip if already composite
      if (isComposite(gltf)) {
        console.log(
          `Decompose save: node ${node.node_id} already composite, skipping`
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
        `Decompose save: node ${node.node_id} decomposed | old=${cid} new=${compositeCid}`
      );
    } catch (err) {
      console.warn(
        `Decompose save: failed to decompose node ${node.node_id}:`,
        err.message
      );
      // Continue with other nodes — don't block the save
    }
  }

  return decomposed;
}

/**
 * Resolve the canonical "latest" manifest CID for versioning.
 * Prefer the in-memory tip of the version chain (latest draft) so every
 * Save appends linearly. Only fall back to the on-chain tokenURI for
 * tokenized assets when no in-memory latest exists yet (e.g. on first load).
 * For drafts without a token, fall back to the currently loaded manifest.
 */
async function resolveLatestManifestCid() {
  if (window.latestAssetManifestCid) {
    return window.latestAssetManifestCid;
  }

  const tokenId = window.activeAssetTokenId;
  if (tokenId) {
    try {
      const c = walletContract || window.contract;
      if (c) {
        const onChainCid = await c.methods.tokenURI(String(tokenId)).call();
        if (onChainCid) {
          console.log(
            `Save: using on-chain tokenURI for token #${tokenId} → ${onChainCid}`
          );
          return onChainCid;
        }
      }
    } catch (err) {
      console.warn(
        `Save: failed to read on-chain tokenURI for #${tokenId}:`,
        err.message
      );
    }
  }
  return window.activeAssetManifestCid || null;
}

async function prepareManifestForWrite(assetName) {
  let manifest;
  const pendingRefs = getPendingChildRefs();
  const pendingPP = getPendingPostProcessorEdits();
  const pendingColors = getPendingSourceColorEdits();

  if (window.activeAssetManifestCid) {
    manifest = await getFromRemoteIPFS(window.activeAssetManifestCid);
  } else if (
    pendingRefs.length > 0 ||
    pendingPP.size > 0 ||
    pendingColors.size > 0
  ) {
    manifest = {
      name: assetName,
      asset_id: `asset_${Date.now()}`,
      version: 1,
      timestamp: Date.now(),
      scene: { nodes: [] },
    };
    console.log(
      `Save: creating fresh manifest for ${pendingRefs.length} pending child refs / ${pendingPP.size} pending post-processor edits / ${pendingColors.size} pending source color edits`
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

  // Apply direct source color edits.
  // These mutate the source glTF/GLB asset and update node.source.cid.
  if (pendingColors.size > 0) {
    for (const [nodeId, nodeEdits] of pendingColors) {
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node || !node.source?.cid) continue;

      const colorMap = {};
      for (const [meshName, color] of nodeEdits) {
        colorMap[meshName] = color;
      }

      try {
        const result = await editSourceColors(node.source.cid, colorMap);
        node.source.cid = result.sourceCid;
        console.log(
          `Save: baked colors into source | node=${nodeId} newCid=${result.sourceCid} modified=${result.modified} skipped=${result.skipped}`
        );
      } catch (err) {
        console.warn(
          `Save: failed to bake colors into source for ${nodeId}:`,
          err.message
        );
      }
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
            `Save: baked colors into composite glTF | node=${nodeId} newCid=${result.compositeCid}`
          );
        } catch (err) {
          console.warn(
            `Save: failed to bake colors into composite glTF for ${nodeId}:`,
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
      `Save: applied ${pendingPP.size} pending post-processor edit(s)`
    );
  }

  // Decompose monolithic glTF nodes into composite (ipfs://) format.
  // Only affects glTF nodes that haven't been decomposed yet.
  // Runs on both Save Draft and Publish.
  const decomposedCount = await decomposeManifestNodes(manifest);
  if (decomposedCount > 0) {
    console.log(
      `Save: decomposed ${decomposedCount} glTF node(s) to composite format`
    );
  }

  // Determine the manifest that supplies the version number and chain link.
  // When the user has navigated to an older version (v2 of v1..v6), edits
  // should still append to the tip of the chain as the next linear version
  // (v7), not branch off as v3. Use latestAssetManifestCid as the previous
  // link; fall back to the currently loaded manifest if no latest is tracked.
  const activeCid = window.activeAssetManifestCid;
  const latestCid = await resolveLatestManifestCid();
  console.log(
    `Save: versioning base | active=${activeCid} latest=${window.latestAssetManifestCid} onChain=${window.activeAssetTokenId || "none"} chosenPrev=${latestCid}`
  );

  let prevManifest = null;
  let baseManifest = null;

  // baseManifest is the currently loaded manifest (used for fallback only).
  if (activeCid) {
    try {
      baseManifest = await getFromRemoteIPFS(activeCid);
    } catch {
      baseManifest = null;
    }
  }

  // prevManifest is the tip of the chain that supplies version + prev link
  // and is also the baseline for no-op detection. When the user has navigated
  // to an older version (v2 of v1..v6), edits/saves still append to the tip
  // as the next linear version (v7), not branch off as v3.
  if (latestCid) {
    try {
      prevManifest = await getFromRemoteIPFS(latestCid);
      manifest.version = (prevManifest.version || 0) + 1;
      manifest.prev_asset_manifest_cid = latestCid;
    } catch {
      advanceManifestVersion(manifest, latestCid);
    }
  }

  return { manifest, prevCid: latestCid, prevManifest: prevManifest || baseManifest };
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
    window.latestAssetManifestCid = cid;
    window.activeAssetManifestCid = cid;

    clearPendingChildRefs();
    clearPendingPostProcessorEdits();
    clearPendingSourceColorEdits();

    // Only rewrite the URL for non-tokenized drafts. For tokenized assets,
    // the ?asset=<tokenId> URL already anchors to the blockchain; avoid
    // stashing a draft manifest in query params.
    if (!window.activeAssetTokenId) {
      updateUrlManifest(cid);
    }

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
  if (!requireWallet()) return;

  isPublishing = true;
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.title = "Besking…";
  }
  if (publishBtnText) publishBtnText.textContent = "Besking…";
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
      if (publishBtnText) publishBtnText.textContent = "Besk it";
      updateButtonState();
      return;
    }

    announceStatus("Confirm transaction in MetaMask…");
    const { cid } = await publishManifest(prepared.prevCid, prepared.manifest);

    if (window.activeAssetTokenId) {
      const txHash = await updateAssetURI(window.activeAssetTokenId, cid);
      if (!txHash) throw new Error("Republish transaction failed");
      // Keep the URL clean and anchored to the token, not a specific manifest CID.
      updateUrlAsset(window.activeAssetTokenId);
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

    window.latestAssetManifestCid = cid;
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
  if (document.activeElement?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select") return;
  if (saveBtn && !saveBtn.hidden) {
    e.preventDefault();
    onSaveAssetDraft();
  }
});

// Asset name is set at creation time and displayed read-only in the header.

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
