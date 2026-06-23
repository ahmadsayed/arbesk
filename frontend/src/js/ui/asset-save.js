/**
 * Arbesk Asset Save/Publish Controller.
 * Phase B: Updated for GNOME headerbar — buttons managed individually, no wrapper div.
 */

import {
  getFromRemoteIPFS,
  getArrayBufferFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { writeToIPFS } from "../ipfs/write-to-ipfs.js";
import { saveManifest } from "../services/api.js";
import {
  contract as walletContract,
  publishAsset,
  updateAssetURI,
  updateEditors,
  CollaboratorRole,
} from "../blockchain/wallet.js";
import { computeRoot, getProof } from "../gltf/merkle-editors.js";
import { getContractAddress } from "../blockchain/network-config.js";
import { showDialog } from "./dialog.js";
import {
  clearScene,
  captureAssetThumbnail,
  dismissCreatePulse,
  getPendingChildRefs,
  clearPendingChildRefs,
  getPendingPostProcessorEdits,
  clearPendingPostProcessorEdits,
  getPendingTransformEdits,
  clearPendingTransformEdits,
} from "../engine/scene-graph.js";
import { updateUrlAsset, updateUrlManifest } from "../services/url-utils.js";
import { isComposite } from "../gltf/decomposer.js";
import {
  decomposeAndStoreAsync,
  decomposeGLBAsync,
  editSourceColorsAsync,
} from "../gltf/async-gltf.js";
import { editCompositeColors } from "../gltf/material-editor.js";
import {
  getPendingSourceColorEdits,
  clearPendingSourceColorEdits,
} from "../engine/parametric-preview.js";

import { showToast } from "./toasts.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";

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
    title: "Wallet Not Connected",
    message: "Please connect your wallet first.",
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

function announceStatus(message) {
  const el = document.getElementById("srStatus");
  if (el) {
    el.textContent = "";
    // Force screen reader announcement by clearing then setting
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  }
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
  try {
    const { contract } = await import("../blockchain/wallet.js");
    const c = contract || walletState.get().contract;
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
    assetState.set({ activeAssetName: name });
    if (assetStatusName) assetStatusName.textContent = name;
    return name;
  }
  return "Untitled Asset";
}

function advanceManifestVersion(manifest, latestCid) {
  manifest.version = (manifest.version || 0) + 1;
  manifest.prev_asset_manifest_cid =
    latestCid || assetState.get().activeAssetManifestCid || null;
}

/**
 * Derive a deterministic collection token ID from the user's wallet address.
 * Uses keccak256(soliditySha3(address)) so the contract can recompute
 * and verify ownership. One wallet = one default collection.
 */
function deriveDefaultCollectionId(walletAddr) {
  return window.Web3.utils.soliditySha3({
    type: "address",
    value: walletAddr,
  });
}

/**
 * Derive a deterministic named collection token ID from wallet + name.
 * Same keccak256 ABI-encoding approach; unique per wallet+name pair.
 */
function deriveNamedCollectionId(walletAddr, name) {
  return window.Web3.utils.soliditySha3(
    { type: "address", value: walletAddr },
    { type: "string", value: name }
  );
}

/**
 * Merge an asset's CID into a collection manifest's `assets` map.
 * Pure function — does not touch IPFS or chain state.
 */
function mergeAssetIntoCollection(collectionManifest, assetID, assetCid) {
  const base = collectionManifest
    ? { ...collectionManifest }
    : {
        type: "collection",
        asset_id: `collection_${Date.now()}`,
        version: 0,
        assets: {},
      };
  const assets = { ...(base.assets || {}) };
  assets[assetID] = assetCid;
  return {
    ...base,
    type: "collection",
    assets,
  };
}

/**
 * Derive the assetID an asset occupies within its collection. Reuses the
 * existing assetID if the asset has one; otherwise derives a fresh one from
 * the given seed (e.g. Date.now()) the first time the asset is besked.
 */
function deriveDefaultAssetId(existingAssetId, fallbackSeed) {
  if (existingAssetId) return existingAssetId;
  return `asset_${fallbackSeed}`;
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
        const { compositeCid, bundleCid } = await decomposeGLBAsync(
          glbBuffer,
          true,
          {
            assetName: manifest.name,
            assetId: manifest.asset_id,
          }
        );

        node.source.cid = compositeCid;
        node.source.path = "composite.gltf";
        node.source.format = "gltf";
        if (bundleCid) node.source.bundleCid = bundleCid;
        decomposed++;
        console.log(
          `Decompose save: node ${node.node_id} GLB decomposed | old=${cid} new=${compositeCid} bundle=${bundleCid || "none"}`
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
      const { compositeCid, bundleCid } = await decomposeAndStoreAsync(gltf, {
        assetName: manifest.name,
        assetId: manifest.asset_id,
      });

      // Update the node's source to point to the composite
      node.source.cid = compositeCid;
      node.source.path = "composite.gltf";
      if (bundleCid) node.source.bundleCid = bundleCid;
      decomposed++;
      console.log(
        `Decompose save: node ${node.node_id} decomposed | old=${cid} new=${compositeCid} bundle=${bundleCid || "none"}`
      );
    } catch (err) {
      if (isRateLimitError(err)) throw err;
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
  if (assetState.get().latestAssetManifestCid) {
    return assetState.get().latestAssetManifestCid;
  }

  const tokenId = assetState.get().activeAssetTokenId;
  if (tokenId) {
    try {
      const c = walletContract || walletState.get().contract;
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
  return assetState.get().activeAssetManifestCid || null;
}

async function prepareManifestForWrite(assetName) {
  let manifest;
  const pendingRefs = getPendingChildRefs();
  const pendingPP = getPendingPostProcessorEdits();
  const pendingTransforms = getPendingTransformEdits();
  const pendingColors = getPendingSourceColorEdits();

  if (assetState.get().activeAssetManifestCid) {
    manifest = await getFromRemoteIPFS(assetState.get().activeAssetManifestCid);
    manifest.type = "asset";
  } else if (
    pendingRefs.length > 0 ||
    pendingPP.size > 0 ||
    pendingTransforms.size > 0 ||
    pendingColors.size > 0
  ) {
    manifest = {
      type: "asset",
      name: assetName,
      asset_id: `asset_${Date.now()}`,
      version: 1,
      timestamp: Date.now(),
      scene: { nodes: [] },
    };
    console.log(
      `Save: creating fresh manifest for ${pendingRefs.length} pending child refs / ${pendingPP.size} pending post-processor edits / ${pendingTransforms.size} pending transform edits / ${pendingColors.size} pending source color edits`
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
        const result = await editSourceColorsAsync(node.source.cid, colorMap, {
          assetName: manifest.name,
          assetId: manifest.asset_id,
        });
        node.source.cid = result.sourceCid;
        // The edited source is always glTF JSON now; keep the node's
        // format/path truthful so the loader doesn't treat it as a binary GLB.
        if (result.format) node.source.format = result.format;
        if (result.path) node.source.path = result.path;
        // The composite JSON changed via a color bake; the organizational
        // bundle (if any) now points at the stale JSON, so drop it. Re-creating
        // the bundle for a JSON-only edit isn't worth the extra upload.
        delete node.source.bundleCid;
        console.log(
          `Save: baked colors into source | node=${nodeId} newCid=${result.sourceCid} format=${node.source.format} modified=${result.modified} skipped=${result.skipped}`
        );
      } catch (err) {
        if (isRateLimitError(err)) throw err;
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
            pp.color || null,
            {
              assetName: manifest.name,
              assetId: manifest.asset_id,
            }
          );
          node.source.cid = result.compositeCid;
          // Composite JSON changed via a color bake; drop the stale bundle.
          delete node.source.bundleCid;
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

  // Apply viewport gizmo transform edits.
  // Updates node.transform_matrix so the saved manifest renders the node
  // in its edited position/rotation/scale on next load.
  if (pendingTransforms.size > 0) {
    for (const [nodeId, matrixArray] of pendingTransforms) {
      const node = manifest.scene.nodes.find((n) => n.node_id === nodeId);
      if (!node) continue;
      node.transform_matrix = matrixArray;
      console.log(`Save: applied transform edit | node=${nodeId}`);
    }
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
  const activeCid = assetState.get().activeAssetManifestCid;
  const latestCid = await resolveLatestManifestCid();
  console.log(
    `Save: versioning base | active=${activeCid} latest=${
      assetState.get().latestAssetManifestCid
    } onChain=${
      assetState.get().activeAssetTokenId || "none"
    } chosenPrev=${latestCid}`
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

  return {
    manifest,
    prevCid: latestCid,
    prevManifest: prevManifest || baseManifest,
  };
}

async function saveAssetDraftCore(
  assetName,
  { captureThumbnail = false, publishContext = null } = {}
) {
  const prepared = await prepareManifestForWrite(assetName);
  if (!prepared) {
    return { ok: false, reason: "empty" };
  }

  if (captureThumbnail) {
    try {
      const thumbnail = await captureAssetThumbnail();
      if (thumbnail) {
        prepared.manifest.thumbnail = prepared.manifest.thumbnail?.cid
          ? { ...thumbnail, cid: prepared.manifest.thumbnail.cid }
          : thumbnail;
      }
    } catch (thumbnailError) {
      console.warn("[SAVE] thumbnail capture skipped:", thumbnailError.message);
    }
  }

  if (
    prepared.prevManifest &&
    manifestsSemanticallyEqual(prepared.manifest, prepared.prevManifest)
  ) {
    return {
      ok: false,
      reason: "no-changes",
      cid: prepared.prevCid,
      manifest: prepared.prevManifest,
    };
  }

  const { cid } = await saveManifest(prepared.manifest, { publishContext });

  assetState.set({
    latestAssetManifestCid: cid,
    activeAssetManifestCid: cid,
  });

  clearPendingChildRefs();
  clearPendingPostProcessorEdits();
  clearPendingTransformEdits();
  clearPendingSourceColorEdits();

  return {
    ok: true,
    cid,
    manifest: prepared.manifest,
    prevCid: prepared.prevCid,
  };
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
    console.error("Save asset draft failed:", err);
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
      } else if (result.reason === "no-changes") {
        showToast({
          type: "info",
          title: "No Changes",
          message: "Nothing new to publish.",
        });
      }
      return;
    }

    const { cid: assetCid, manifest: publishedManifest } = result;

    // Use the manifest's own asset_id as the collection key for new assets;
    // it is generated from Date.now() at creation time and is unique per draft.
    // For updates to an existing asset, activeAssetId is already set and reused.
    const assetID = deriveDefaultAssetId(
      assetState.get().activeAssetId,
      publishedManifest?.asset_id || `asset_${Date.now()}`
    );
    assetState.set({ activeAssetId: assetID });

    announceStatus("Confirm transaction in MetaMask…");
    const walletAddr = walletState.get().walletAddress;

    // Fetch the current collection manifest (if one exists yet) and merge
    // this asset's new CID into its assets map. If no collection token
    // exists yet, this besk lazily mints the default collection.
    const c = walletContract || walletState.get().contract;
    const preferredCollectionId =
      assetState.get().selectedCollectionId ||
      assetState.get().activeCollectionTokenId;
    let existingCollectionTokenId = null;
    let collectionManifest = null;
    if (preferredCollectionId) {
      try {
        const collectionCid = await c.methods
          .tokenURI(String(preferredCollectionId))
          .call();
        if (collectionCid && collectionCid !== "") {
          collectionManifest = await getFromRemoteIPFS(collectionCid);
          existingCollectionTokenId = preferredCollectionId;
        }
      } catch {
        // tokenURI reverted or IPFS fetch failed; treat as new collection
      }
    }

    // In-memory state is unreliable across reloads / fresh sessions / E2E
    // isolation: it can be empty even when a default collection was already
    // minted on-chain. Without this fallback the code would try to re-mint an
    // existing token and hit `TokenAlreadyMinted`. Probe the chain for the
    // derived default collection ID and, if it exists, route to republish.
    if (!existingCollectionTokenId) {
      const defaultTokenId = deriveDefaultCollectionId(walletAddr);
      try {
        // ownerOf reverts (ERC721NonexistentToken) when the token doesn't
        // exist; a successful call proves it does.
        await c.methods.ownerOf(String(defaultTokenId)).call();
        existingCollectionTokenId = defaultTokenId;
        const collectionCid = await c.methods
          .tokenURI(String(defaultTokenId))
          .call();
        if (collectionCid && collectionCid !== "") {
          collectionManifest = await getFromRemoteIPFS(collectionCid);
        }
      } catch {
        // Token doesn't exist on-chain — genuine first publish, fall through
        // to the mint path below.
      }
    }
    const mergedCollection = mergeAssetIntoCollection(
      collectionManifest,
      assetID,
      assetCid
    );
    mergedCollection.version = (mergedCollection.version || 0) + 1;
    mergedCollection.prev_asset_manifest_cid = existingCollectionTokenId
      ? await (walletContract || walletState.get().contract).methods
          .tokenURI(String(existingCollectionTokenId))
          .call()
      : null;

    const { cid: collectionCid } = await saveManifest(mergedCollection, {
      publishContext: null,
    });

    if (existingCollectionTokenId) {
      const tokenId = existingCollectionTokenId;
      let editorList = await _loadEditorList(tokenId);
      // When localStorage is empty (fresh browser context or E2E isolation),
      // fall back to a default editor list with the current wallet as Editor.
      if (!editorList) {
        editorList = [{ address: walletAddr, role: CollaboratorRole.Editor }];
      }
      const currentVersion = await _getEditorSetVersion(tokenId);
      const proofResult = getProof(
        editorList,
        walletAddr,
        tokenId,
        currentVersion
      );
      if (!proofResult) throw new Error("Not an authorized editor");
      const txHash = await updateAssetURI(
        tokenId,
        collectionCid,
        proofResult.proof
      );
      if (!txHash) throw new Error("Republish transaction failed");
      updateUrlAsset(tokenId);
      announceStatus("Collection republished successfully.");
    } else {
      const tokenId = deriveDefaultCollectionId(walletAddr);
      const editorList = [
        { address: walletAddr, role: CollaboratorRole.Editor },
      ];
      const editorRoot = computeRoot(editorList, tokenId, 1);
      const editorListUri = _saveEditorListLocally(tokenId, editorList, null);
      const txHash = await publishAsset(
        collectionCid,
        tokenId,
        editorRoot,
        editorListUri || ""
      );
      if (!txHash) throw new Error("Publish transaction failed");
      assetState.set({
        activeCollectionTokenId: tokenId,
        activeAssetTokenId: tokenId,
      });
      updateUrlAsset(tokenId);

      const { showAssetEditors } = await import("./asset-editors.js");
      showAssetEditors(tokenId);
      announceStatus("Default collection published and minted.");
    }

    // latestCid / activeCid / pending edits were already updated by saveAssetDraftCore.

    emit(EVENTS.ASSET_PUBLISHED, {
      tokenId: assetState.get().activeAssetTokenId,
      cid: assetCid,
    });
    updateAssetStatus(assetName, "Published");
  } catch (err) {
    console.error("Publish asset failed:", err);
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
  // Preserve an existing rename — don't overwrite with fallback defaults.
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

// ── Merkle Editor Helpers ──

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";

function _editorListKey(tokenId) {
  return EDITOR_LIST_PREFIX + tokenId;
}

function _saveEditorListLocally(tokenId, editorList, ipfsCid) {
  try {
    localStorage.setItem(
      _editorListKey(tokenId),
      JSON.stringify({
        list: editorList,
        cid: ipfsCid || null,
        saved: Date.now(),
      })
    );
  } catch (e) {
    console.warn("Failed to save editor list locally:", e.message);
  }
  return ipfsCid || "";
}

async function _loadEditorList(tokenId) {
  try {
    const stored = localStorage.getItem(_editorListKey(tokenId));
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.cid) {
        try {
          const fresh = await getFromRemoteIPFS(parsed.cid);
          if (Array.isArray(fresh)) {
            _saveEditorListLocally(tokenId, fresh, parsed.cid);
            return fresh;
          }
        } catch {
          // IPFS fetch failed, use cached
        }
      }
      if (Array.isArray(parsed.list)) return parsed.list;
    }
  } catch {
    // localStorage unavailable or corrupted
  }
  return null;
}

async function _getEditorSetVersion(tokenId) {
  try {
    const { contract } = await import("../blockchain/wallet.js");
    const c = contract || walletState.get().contract;
    if (!c) return 1;
    const version = await c.methods.editorSetVersion(tokenId).call();
    return Number(version);
  } catch {
    return 1;
  }
}
