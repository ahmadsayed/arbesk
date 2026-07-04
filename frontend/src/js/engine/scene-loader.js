// @ts-nocheck
/**
 * Arbesk Scene Loader
 *
 * Extracted from scene-graph.js - handles IPFS asset loading, manifest parsing,
 * token child world resolution, collection manifest loading, and drag/drop
 * linked asset composition.
 */

import {
  getFromRemoteIPFS,
  getBlobFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { composeGlTFToBlobAsync } from "../gltf/async-gltf.js";
import {
  resolveChildRef,
  resolveCollectionChildRef,
  clearResolutionCache,
} from "../blockchain/token-resolver.js";
import { emit, EVENTS } from "../events/bus.js";
import { assetState, tagManifestCid } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { state, MAX_CHILD_WORLD_DEPTH } from "./state.js";
import {
  extractCid,
  detectAssetFormat,
  getManifestNodes,
  applyTransformMatrix,
  applyDefaultMaterial,
  centerImportedAsset,
} from "./transforms.js";
import { createPlaceholder, disposePlaceholder } from "./placeholders.js";
import { applyColor, applyScale } from "./time-travel.js";
import { disposeNode, clearScene } from "./cleanup.js";
import { createAnchorNode } from "./scene-graph.js";

async function loadAsset(src, parentNode, nodeId) {
  const cid = extractCid(src);
  const format = detectAssetFormat(src);
  console.log(`[SCENE] loadAsset nodeId=${nodeId} cid=${cid} format=${format}`);

  try {
    if (format === "glb") {
      const blob = await getBlobFromRemoteIPFS(cid);
      console.log(
        `[SCENE] GLB fetched | cid=${cid} size=${blob.size} bytes | type=${blob.type}`
      );
      const blobUrl = URL.createObjectURL(blob);

      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "",
        blobUrl,
        "",
        state.scene,
        null,
        ".glb"
      );
      URL.revokeObjectURL(blobUrl);
      console.log(`[SCENE] GLB loaded | meshes=${result.meshes.length}`);
      attachMetadata(
        result.meshes,
        nodeId,
        parentNode,
        result.transformNodes || []
      );
      return result.meshes;
    } else {
      console.log(`[SCENE] fetching glTF JSON from gateway | cid=${cid}`);
      const gltfJson = await getFromRemoteIPFS(cid);
      console.log(
        `[SCENE] glTF JSON fetched | hasBuffers=${!!gltfJson?.buffers} | bufferCount=${
          gltfJson?.buffers?.length || 0
        }`
      );

      const gltfBlob = await composeGlTFToBlobAsync(gltfJson);
      console.log(`[SCENE] glTF composed | bytes=${gltfBlob.size}`);

      const blobUrl = URL.createObjectURL(gltfBlob);

      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "",
        blobUrl,
        "",
        state.scene,
        null,
        ".gltf"
      );
      URL.revokeObjectURL(blobUrl);
      console.log(`[SCENE] glTF loaded | meshes=${result.meshes.length}`);
      attachMetadata(
        result.meshes,
        nodeId,
        parentNode,
        result.transformNodes || []
      );
      return result.meshes;
    }
  } catch (error) {
    console.error(`[SCENE] FAILED to load asset for node ${nodeId}:`, error);
    const box = BABYLON.MeshBuilder.CreateBox(
      `placeholder_${nodeId}`,
      { size: 1 },
      state.scene
    );
    box.parent = parentNode;
    box.metadata = { nodeId };
    applyDefaultMaterial([box]);
    return [box];
  }
}

function attachMetadata(meshes, nodeId, parentNode, transformNodes = []) {
  const meshArray = [];
  const importedNodes = [...transformNodes, ...meshes];

  for (const transformNode of transformNodes) {
    if (transformNode.parent === null) {
      transformNode.parent = parentNode;
    }
    transformNode.metadata = {
      ...(transformNode.metadata || {}),
      nodeId,
      isNodeRoot: transformNode.parent === parentNode,
    };
  }

  for (const mesh of meshes) {
    if (mesh.parent === null) {
      mesh.parent = parentNode;
    }
    mesh.metadata = {
      ...(mesh.metadata || {}),
      nodeId,
      isNodeRoot: mesh.parent === parentNode,
    };
    meshArray.push(mesh);
  }

  centerImportedAsset(meshArray, importedNodes, parentNode, nodeId);
  state.nodeMeshes.set(nodeId, meshArray);
  state._nonChromeMeshCache = null;
}

/**
 * Decide how a node's child_ref should be resolved: same-collection lookup
 * or cross-collection asset lookup.
 * Pure decision logic - no I/O.
 */
function buildChildRefResolutionPlan(childRef, activeCollectionAssets) {
  if (!childRef) return { kind: "invalid" };

  if (childRef.assetID) {
    if (childRef.collection === "self") {
      return {
        kind: "same-collection",
        assetID: childRef.assetID,
        assetsMap: activeCollectionAssets,
      };
    }
    if (childRef.collection && childRef.collection.tokenId) {
      return {
        kind: "cross-collection-asset",
        collectionRef: childRef.collection,
        assetID: childRef.assetID,
      };
    }
  }

  return { kind: "invalid" };
}

// ═══════════════════════════════════════════════════════════════════════════
// Token child world loading
// ═══════════════════════════════════════════════════════════════════════════

async function loadTokenChildNode(node, anchor, depth, resolvingCids) {
  const childRef = node.child_ref;
  if (!childRef) return [];

  if (depth >= MAX_CHILD_WORLD_DEPTH) {
    console.warn(
      `[SCENE] max child world depth (${MAX_CHILD_WORLD_DEPTH}) reached at node ${node.node_id}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const plan = buildChildRefResolutionPlan(
    childRef,
    state.activeCollectionAssets
  );

  // Same-collection self-reference cycle: a node referencing its own
  // assetID via collection:"self" is always a cycle, independent of depth.
  if (
    plan.kind === "same-collection" &&
    plan.assetID === state.activeCollectionCurrentAssetID
  ) {
    console.warn(
      `[SCENE] self-referencing same-collection child_ref rejected at node ${node.node_id}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const refKey =
    plan.kind === "cross-collection-asset"
      ? `${plan.collectionRef.chainId}:${plan.collectionRef.contractAddress}:${plan.collectionRef.tokenId}:${plan.assetID}`
      : `self:${plan.assetID}`;

  if (resolvingCids.has(refKey)) {
    console.warn(
      `[SCENE] circular child_ref detected at node ${node.node_id}, ref=${refKey}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }

  const loadingPlaceholder = createPlaceholder(node.node_id, anchor, "loading");

  resolvingCids.add(refKey);
  try {
    console.log(
      `[SCENE] resolving child node ${node.node_id} depth=${depth} kind=${plan.kind}`
    );

    let resolution;
    if (plan.kind === "invalid") {
      resolution = { resolved: false, error: "Invalid child_ref shape" };
    } else {
      resolution = await resolveCollectionChildRef(
        plan.kind === "same-collection"
          ? { collection: "self", assetID: plan.assetID }
          : { collection: plan.collectionRef, assetID: plan.assetID },
        plan.kind === "same-collection" ? plan.assetsMap : null
      );
    }

    if (resolution.nestedCollectionRef) {
      // assetID resolved to a nested collection, not a direct asset CID:
      // recurse via the cross-collection token path.
      resolution = await resolveChildRef({
        type: "token",
        chainId: resolution.nestedCollectionRef.chainId,
        contractAddress: resolution.nestedCollectionRef.contractAddress,
        tokenId: resolution.nestedCollectionRef.tokenId,
        standard: "ERC721",
        resolution: "latest",
      });
    }

    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] child resolution failed for node ${node.node_id}: ${resolution.error}`
      );
      disposePlaceholder(loadingPlaceholder);
      const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
      return [errorPlaceholder];
    }

    console.log(
      `[SCENE] child node ${node.node_id} resolved → ${resolution.manifestCid}`
    );

    const childAnchor = createAnchorNode(
      `child_anchor_${node.node_id}`,
      state.scene
    );
    childAnchor.parent = anchor;
    childAnchor.metadata = {
      childRef,
      resolvedCid: resolution.manifestCid,
      loaded: true,
      nodeId: node.node_id,
    };

    if (!state.nodeAnchors.has(node.node_id)) {
      state.nodeAnchors.set(node.node_id, childAnchor);
    }

    disposePlaceholder(loadingPlaceholder);

    await loadAssetManifest(
      resolution.manifestCid,
      childAnchor,
      depth + 1,
      resolvingCids
    );

    return [];
  } catch (err) {
    console.error(`[SCENE] failed to load child node ${node.node_id}:`, err);
    disposePlaceholder(loadingPlaceholder);
    const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
    return [errorPlaceholder];
  } finally {
    resolvingCids.delete(refKey);
  }
}

async function loadNode(node, parentNode, depth, resolvingCids) {
  console.log(
    `[SCENE] loadNode node_id=${node.node_id} source=${JSON.stringify(
      node.source
    )} childRef=${!!node.child_ref}`
  );
  const anchor = createAnchorNode(`anchor_${node.node_id}`, state.scene);
  anchor.parent = parentNode;
  applyTransformMatrix(anchor, node.transform_matrix);
  state.nodeAnchors.set(node.node_id, anchor);

  let meshes = [];

  if (node.child_ref) {
    // Tag the outer anchor with the child_ref so the inspector / dive button
    // can resolve it directly from the manifest node_id.
    anchor.metadata = { nodeId: node.node_id, childRef: node.child_ref };
    meshes = await loadTokenChildNode(
      node,
      anchor,
      depth || 0,
      resolvingCids || new Set()
    );
    return { anchor, meshes };
  }

  if (node.source) {
    meshes = await loadAsset(node.source, anchor, node.node_id);
  } else {
    console.warn(
      `[SCENE] node ${node.node_id} has no source - no geometry to load`
    );
  }

  const pp = node.post_processor;
  if (meshes.length > 0 && pp) {
    applyColor(meshes, pp.color, pp.meshOverrides || null);
    applyScale(meshes, pp.scale);
  }

  return { anchor, meshes };
}

async function loadAssetManifest(
  manifestCid,
  parentAnchor = null,
  depth = 0,
  resolvingCids = new Set()
) {
  console.log(`[SCENE] loadAssetManifest cid=${manifestCid} depth=${depth}`);

  if (
    !parentAnchor &&
    depth === 0 &&
    (state.rootSceneAnchor ||
      state.nodeMeshes.size > 0 ||
      state.nodeAnchors.size > 0)
  ) {
    clearScene();
  }

  if (depth === 0) {
    clearResolutionCache();
  }

  const manifest = await getFromRemoteIPFS(manifestCid);

  // Collection manifests don't have scene.nodes - delegate to
  // loadCollectionManifest and auto-load the first asset.
  if (manifest?.type === "collection") {
    const { assetEntries } = await loadCollectionManifest(manifestCid, null);
    const firstAsset = assetEntries.find((e) => e.kind === "asset");
    if (firstAsset) {
      return loadAssetManifest(
        firstAsset.value,
        parentAnchor,
        depth,
        resolvingCids
      );
    }
    return manifest;
  }

  console.log(
    `[SCENE] manifest loaded | nodes=${
      getManifestNodes(manifest).length
    } version=${manifest?.version}`
  );
  if (!manifest || getManifestNodes(manifest).length === 0) {
    console.warn("[SCENE] Asset manifest has no scene nodes:", manifestCid);
    return manifest;
  }

  const rootAnchor =
    parentAnchor || createAnchorNode("root_anchor", state.scene);
  if (!parentAnchor) {
    state.rootSceneAnchor = rootAnchor;
  }

  await Promise.all(
    getManifestNodes(manifest).map((node) =>
      loadNode(node, rootAnchor, depth, resolvingCids)
    )
  );

  if (!parentAnchor) {
    assetState.set({
      activeAssetManifestCid: manifestCid,
      currentManifest: tagManifestCid(manifest, manifestCid),
    });
    emit(EVENTS.SCENE_READY, { manifest, manifestCid });
  }

  return manifest;
}

/**
 * Load a collection manifest and populate the active-collection state.
 * Does NOT render any 3D content - returns the manifest plus a flat list
 * of its entries so gallery UI can let the user pick which asset to open.
 *
 * @param {string} collectionCid
 * @param {{chainId: number, contractAddress: string, tokenId: string}} collectionRef
 * @returns {Promise<{manifest: Object, assetEntries: Array<{assetID: string, kind: string, value: any}>}>}
 */
async function loadCollectionManifest(collectionCid, collectionRef) {
  const manifest = await getFromRemoteIPFS(collectionCid);
  if (!manifest || manifest.type !== "collection") {
    throw new Error(`CID ${collectionCid} is not a collection manifest`);
  }

  state.activeCollectionAssets = manifest.assets || {};
  state.activeCollectionRef = collectionRef || null;

  const assetEntries = Object.entries(manifest.assets || {}).map(
    ([assetID, value]) => ({
      assetID,
      kind: typeof value === "string" ? "asset" : "collection",
      value,
    })
  );

  return { manifest, assetEntries };
}

// ═══════════════════════════════════════════════════════════════════════════
// Drag/drop - linked asset composition
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the scene node to add when a user pulls in another collection's
 * asset. "fork" freezes the asset's current CID into a plain source node;
 * "live-ref" embeds a child_ref pointing back at the original collection,
 * so future edits there propagate automatically.
 */
function buildForkOrLiveRefNode(choice, ref, assetID, resolvedAssetCid) {
  const nodeId = `linked_${ref.collectionRef.tokenId}_${assetID}`;
  const baseNode = {
    node_id: nodeId,
    transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  };
  if (choice === "fork") {
    return {
      ...baseNode,
      source: { cid: resolvedAssetCid },
    };
  }
  if (choice === "live-ref") {
    return {
      ...baseNode,
      child_ref: { collection: ref.collectionRef, assetID },
    };
  }
  throw new Error(`Unknown fork/live-ref choice: ${choice}`);
}

/**
 * BigInt-safe token id normalization so "0x2a" and "42" compare equal.
 */
function normalizeTokenId(id) {
  if (id == null) return "";
  try {
    return BigInt(id).toString();
  } catch {
    return String(id);
  }
}

/**
 * True when a dropped linked asset is the asset currently open in the
 * Studio (same collection token + same assetID). A live-ref to itself is a
 * guaranteed cycle, so such drops must be fork-only.
 */
function isSelfLinkedAssetDrop(collectionRef, assetID) {
  const active = state.activeCollectionRef;
  if (!active || !state.activeCollectionCurrentAssetID) return false;
  if (assetID !== state.activeCollectionCurrentAssetID) return false;
  if (Number(active.chainId) !== Number(collectionRef.chainId)) return false;
  const activeContract = (active.contractAddress || "").toLowerCase();
  const droppedContract = (collectionRef.contractAddress || "").toLowerCase();
  if (activeContract !== droppedContract) return false;
  return (
    normalizeTokenId(active.tokenId) === normalizeTokenId(collectionRef.tokenId)
  );
}

async function handleLinkedAssetDropped(event) {
  const detail = event;
  if (!detail) return;

  const {
    token_id: tokenId,
    _standard = "ERC721",
    resolution: _resolutionMode = "latest",
    chainId: eventChainId,
    contractAddress: eventContractAddress,
  } = detail;
  if (!tokenId) return;

  if (detail.assetID) {
    const collectionRef = {
      chainId: Number(eventChainId || walletState.get().chainId),
      contractAddress:
        eventContractAddress || walletState.get().contractAddress,
      tokenId,
    };
    const isSelfDrop = isSelfLinkedAssetDrop(collectionRef, detail.assetID);

    const { showForkOrLiveRefDialog } = await import("../ui/dialog.js");
    const choice = await showForkOrLiveRefDialog(detail.assetID, {
      allowLiveRef: !isSelfDrop,
    });
    if (!choice) return; // user cancelled
    if (isSelfDrop && choice === "live-ref") {
      console.warn(
        `[SCENE] live-ref self-add rejected for asset ${detail.assetID}`
      );
      return;
    }

    const { resolveCollectionChildRef } = await import(
      "../blockchain/token-resolver.js"
    );
    const resolution = await resolveCollectionChildRef(
      { collection: collectionRef, assetID: detail.assetID },
      null
    );
    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] could not resolve dropped asset ${detail.assetID}: ${resolution.error}`
      );
      return;
    }

    const nodeEntry = buildForkOrLiveRefNode(
      choice,
      { collectionRef },
      detail.assetID,
      resolution.manifestCid
    );
    state.pendingChildRefs.push(nodeEntry);
    disposeNode(nodeEntry.node_id);

    const parentNode = state.rootSceneAnchor || state.scene;
    if (choice === "live-ref") {
      await loadTokenChildNode(nodeEntry, parentNode, 1, new Set());
    } else {
      await loadAsset(nodeEntry.source, parentNode, nodeEntry.node_id);
    }
    return;
  }

  // Legacy drops without assetID are no longer supported - the caller must
  // include an assetID so the drop handler can route through the collection
  // resolution path above.
  console.warn(
    `[SCENE] linked asset drop ignored: no assetID for token #${tokenId}`
  );
}

export {
  loadAsset,
  loadNode,
  loadAssetManifest,
  loadCollectionManifest,
  buildForkOrLiveRefNode,
  handleLinkedAssetDropped,
};
