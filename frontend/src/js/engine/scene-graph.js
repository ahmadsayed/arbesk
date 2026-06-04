/**
 * Arbesk Scene Graph
 *
 * Loads a fractal manifest from IPFS and recursively builds a Babylon.js state.scene.
 * Re-exports from sub-modules for backward compatibility.
 */

import {
  getFromRemoteIPFS,
  getBlobFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { convertToDataURI } from "../gltf/uri_to_cid.js";
import {
  resolveChildRef,
  clearResolutionCache,
} from "../blockchain/token-resolver.js";
import { applyColor, applyScale } from "./time-travel.js";

import { state, DEFAULT_WOOD_COLOR, MAX_CHILD_WORLD_DEPTH } from "./state.js";

import {
  extractCid,
  detectAssetFormat,
  getManifestNodes,
  applyTransformMatrix,
  applyDefaultMaterial,
  getRenderableMeshes,
  getWorldBounds,
  centerImportedAsset,
} from "./transforms.js";

import { createPlaceholder, disposePlaceholder } from "./placeholders.js";
import {
  disposeNode,
  clearScene,
  clearPendingChildRefs,
  getPendingChildRefs,
} from "./cleanup.js";

// Re-export state and constants
export { state, DEFAULT_WOOD_COLOR, MAX_CHILD_WORLD_DEPTH } from "./state.js";

// Re-export transforms
export {
  extractCid,
  detectAssetFormat,
  getManifestNodes,
  applyTransformMatrix,
  applyDefaultMaterial,
  getRenderableMeshes,
  getWorldBounds,
  centerImportedAsset,
} from "./transforms.js";

// Re-export placeholders (internal use)
export { createPlaceholder, disposePlaceholder } from "./placeholders.js";

// Re-export cleanup
export {
  disposeNode,
  clearScene,
  clearPendingChildRefs,
  getPendingChildRefs,
} from "./cleanup.js";

// ═══════════════════════════════════════════════════════════════════════════
// Engine initialization
// ═══════════════════════════════════════════════════════════════════════════

function initEngine() {
  const canvas = document.getElementById("renderCanvas");
  if (!canvas) {
    console.error("renderCanvas not found");
    return;
  }

  state.engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });

  state.scene = new BABYLON.Scene(state.engine);
  state.scene.clearColor = new BABYLON.Color4(0.12, 0.12, 0.14, 1);

  // ArcRotateCamera for orbit controls
  const camera = new BABYLON.ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 3,
    15,
    BABYLON.Vector3.Zero(),
    state.scene
  );
  camera.lowerRadiusLimit = 2;
  camera.upperRadiusLimit = 50;
  camera.attachControl(canvas, true);

  const hemiLight = new BABYLON.HemisphericLight(
    "hemiLight",
    new BABYLON.Vector3(0, 1, 0),
    state.scene
  );
  hemiLight.intensity = 0.7;

  const dirLight = new BABYLON.DirectionalLight(
    "dirLight",
    new BABYLON.Vector3(-0.5, -1, -0.5),
    state.scene
  );
  dirLight.intensity = 0.5;

  state.engine.runRenderLoop(() => state.scene.render());

  window.addEventListener("resize", () => state.engine.resize());
  state.resizeEngineHandler = () => state.engine.resize();
  state.resizeObserverInstance = new ResizeObserver(() =>
    state.engine.resize()
  );
  state.resizeObserverInstance.observe(canvas);

  // Click-to-select
  state.scene.onPointerObservable.add((pointerInfo) => {
    const pickResult = pointerInfo.pickInfo;
    if (pickResult.hit && pickResult.pickedMesh) {
      const mesh = pickResult.pickedMesh;
      let target = mesh;
      while (target) {
        if (target.metadata?.nodeId) {
          selectNode(target.metadata.nodeId, target);
          return;
        }
        target = target.parent;
      }
    }
  }, BABYLON.PointerEventTypes.POINTERPICK);

  state.pointerObservableCallback = null; // managed by Babylon internally
}

function selectNode(nodeId, mesh) {
  window.selectedNodeId = nodeId;
  document.dispatchEvent(
    new CustomEvent("node:selected", {
      detail: { nodeId, mesh },
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Asset loading
// ═══════════════════════════════════════════════════════════════════════════

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
      applyDefaultMaterial(result.meshes);
      return result.meshes;
    } else {
      console.log(`[SCENE] fetching glTF JSON from gateway | cid=${cid}`);
      const gltfJson = await getFromRemoteIPFS(cid);
      console.log(
        `[SCENE] glTF JSON fetched | hasBuffers=${!!gltfJson?.buffers} | bufferCount=${
          gltfJson?.buffers?.length || 0
        }`
      );

      const resolvedGltf = await convertToDataURI(gltfJson);
      const gltfString = JSON.stringify(resolvedGltf);
      console.log(`[SCENE] glTF stringified | chars=${gltfString.length}`);

      const gltfBlob = new Blob([gltfString], { type: "application/json" });
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
      applyDefaultMaterial(result.meshes);
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

  const refKey = `${childRef.chainId}:${childRef.contractAddress}:${childRef.tokenId}`;
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
      `[SCENE] resolving token child node ${node.node_id} depth=${depth}`
    );

    const resolution = await resolveChildRef(childRef);
    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] token child resolution failed for node ${node.node_id}: ${resolution.error}`
      );
      disposePlaceholder(loadingPlaceholder);
      const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
      return [errorPlaceholder];
    }

    console.log(
      `[SCENE] token child node ${node.node_id} resolved → ${resolution.manifestCid}`
    );

    const childAnchor = new BABYLON.TransformNode(
      `child_anchor_${node.node_id}`,
      state.scene
    );
    childAnchor.parent = anchor;
    childAnchor.metadata = {
      childRef,
      resolvedCid: resolution.manifestCid,
      loaded: true,
    };

    state.nodeAnchors.set(node.node_id, childAnchor);

    disposePlaceholder(loadingPlaceholder);

    await loadAssetManifest(
      resolution.manifestCid,
      childAnchor,
      depth + 1,
      resolvingCids
    );

    return [];
  } catch (err) {
    console.error(
      `[SCENE] failed to load token child node ${node.node_id}:`,
      err
    );
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
  const anchor = new BABYLON.TransformNode(
    `anchor_${node.node_id}`,
    state.scene
  );
  anchor.parent = parentNode;
  applyTransformMatrix(anchor, node.transform_matrix);
  state.nodeAnchors.set(node.node_id, anchor);

  let meshes = [];

  if (node.child_ref) {
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
      `[SCENE] node ${node.node_id} has no source — no geometry to load`
    );
  }

  if (meshes.length > 0 && node.appearance) {
    applyColor(meshes, node.appearance.color);
    applyScale(meshes, node.appearance.scale);
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
    parentAnchor || new BABYLON.TransformNode("root_anchor", state.scene);
  if (!parentAnchor) {
    state.rootSceneAnchor = rootAnchor;
  }

  for (const node of getManifestNodes(manifest)) {
    await loadNode(node, rootAnchor, depth, resolvingCids);
  }

  if (!parentAnchor) {
    window.activeAssetManifestCid = manifestCid;
    document.dispatchEvent(
      new CustomEvent("scene:ready", {
        detail: { manifest, manifestCid },
      })
    );
  }

  return manifest;
}

// ═══════════════════════════════════════════════════════════════════════════
// Drag/drop — linked asset composition
// ═══════════════════════════════════════════════════════════════════════════

async function handleLinkedAssetDropped(event) {
  const detail = event.detail;
  if (!detail) return;

  const {
    token_id: tokenId,
    standard = "ERC721",
    resolution: resolutionMode = "latest",
    chainId: eventChainId,
    contractAddress: eventContractAddress,
  } = detail;
  if (!tokenId) return;

  const resolvedChainId = Number(eventChainId || window.chainId || 31415822);
  const resolvedContractAddr =
    eventContractAddress || window.contractAddress || window._contractAddress;

  if (!resolvedContractAddr) {
    console.warn("[SCENE] No contract address available for linked asset drop");
    return;
  }

  if (!window.walletAddress) {
    console.warn("[SCENE] Wallet not connected — cannot resolve linked asset");
    return;
  }

  const refKey = `${resolvedChainId}:${resolvedContractAddr}:${tokenId}`;

  // Prevent duplicate drops for the same reference
  for (const [, anchor] of state.nodeAnchors) {
    if (
      anchor.metadata?.childRef &&
      `${anchor.metadata.childRef.chainId}:${anchor.metadata.childRef.contractAddress}:${anchor.metadata.childRef.tokenId}` ===
        refKey
    ) {
      console.warn(
        `[SCENE] duplicate child_ref drop ignored: token #${tokenId}`
      );
      return;
    }
  }

  const shortAddr =
    resolvedContractAddr.slice(0, 8) + resolvedContractAddr.slice(-6);
  const nodeId = `child_token_${resolvedChainId}_${shortAddr}_${tokenId}`;

  const childRef = {
    type: "token",
    chainId: resolvedChainId,
    contractAddress: resolvedContractAddr,
    tokenId,
    standard,
    resolution: resolutionMode,
  };

  // Resolve the token manifest first so we can derive the display name.
  const resolvedRef = {
    ...childRef,
    chainId: resolvedChainId,
    contractAddress: resolvedContractAddr,
  };
  const childResolution = await resolveChildRef(resolvedRef, {
    validate: true,
  });
  const resolvedCid = childResolution?.manifestCid || null;

  if (!resolvedCid) {
    console.warn(
      `[SCENE] could not resolve linked asset preview for token #${tokenId}: ${
        childResolution?.error || "unknown error"
      }`
    );
    return;
  }

  const nodeEntry = {
    node_id: nodeId,
    name: childResolution?.manifest?.name || `World #${tokenId}`,
    transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    child_ref: childRef,
  };

  state.pendingChildRefs.push(nodeEntry);

  disposeNode(nodeId);

  // Render the child world immediately into the scene
  const parentNode = state.rootSceneAnchor || state.scene;
  await loadTokenChildNode(nodeEntry, parentNode, 1, new Set());

  document.dispatchEvent(
    new CustomEvent("scene:tokenChildAdded", {
      detail: {
        nodeId,
        chainId: resolvedChainId,
        contractAddress: resolvedContractAddr,
        tokenId,
        resolvedCid,
      },
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Node accessors
// ═══════════════════════════════════════════════════════════════════════════

function getNodeAnchor(nodeId) {
  return state.nodeAnchors.get(nodeId) || null;
}

function getNodeMeshes(nodeId) {
  return state.nodeMeshes.get(nodeId) || [];
}

function getNodeChildRef(nodeId) {
  if (nodeId && nodeId.startsWith("child_token_")) {
    const anchor = state.nodeAnchors.get(nodeId);
    if (anchor && anchor.metadata?.childRef) {
      return {
        ...anchor.metadata.childRef,
        resolvedCid: anchor.metadata.resolvedCid || null,
      };
    }
    const childAnchor = state.scene?.getTransformNodeByName(
      `child_anchor_${nodeId}`
    );
    if (childAnchor?.metadata?.childRef) {
      return {
        ...childAnchor.metadata.childRef,
        resolvedCid: childAnchor.metadata.resolvedCid || null,
      };
    }
  }

  const anchor = state.nodeAnchors.get(nodeId);
  if (anchor) {
    let current = anchor.parent;
    while (current) {
      if (current.metadata?.childRef) {
        return {
          ...current.metadata.childRef,
          resolvedCid: current.metadata.resolvedCid || null,
        };
      }
      current = current.parent;
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Welcome overlay
// ═══════════════════════════════════════════════════════════════════════════

function showWelcomeOverlay() {
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.hidden = false;
}

function hideWelcomeOverlay() {
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.hidden = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Thumbnail capture
// ═══════════════════════════════════════════════════════════════════════════

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function captureAssetThumbnail(options = {}) {
  const canvas = document.getElementById("renderCanvas");
  if (!canvas) return null;

  try {
    const width = options.width || 512;
    const height = options.height || 288;
    const quality = options.quality || 0.85;
    const format = options.format || "webp";
    const mime = `image/${format}`;

    const thumbnailCanvas = document.createElement("canvas");
    thumbnailCanvas.width = width;
    thumbnailCanvas.height = height;
    const ctx = thumbnailCanvas.getContext("2d");
    if (!ctx) return null;

    const sourceWidth = canvas.width;
    const sourceHeight = canvas.height;
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = width / height;

    let sx = 0,
      sy = 0,
      sw = sourceWidth,
      sh = sourceHeight;

    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }

    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, width, height);

    const blob = await canvasToBlob(thumbnailCanvas, mime, quality);
    if (!blob) return null;

    const dataUrl = await blobToDataUrl(blob);

    return {
      type: "snapshot",
      dataUrl,
      mime,
      format,
      path: `thumbnail.${format}`,
      width,
      height,
      bytes: blob.size,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.warn("[THUMB] capture failed:", err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock registration
// ═══════════════════════════════════════════════════════════════════════════

function registerMockNode(nodeId, mesh, _history = []) {
  const anchor = new BABYLON.TransformNode(`anchor_${nodeId}`, state.scene);
  mesh.parent = anchor;
  mesh.metadata = {
    nodeId,
    isNodeRoot: true,
  };
  state.nodeMeshes.set(nodeId, [mesh]);
  state.nodeAnchors.set(nodeId, anchor);
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

export {
  loadAssetManifest,
  loadNode,
  loadAsset,
  getNodeAnchor,
  getNodeMeshes,
  getNodeChildRef,
  registerMockNode,
  captureAssetThumbnail,
  showWelcomeOverlay,
  hideWelcomeOverlay,
};

// ═══════════════════════════════════════════════════════════════════════════
// DOM initialization
// ═══════════════════════════════════════════════════════════════════════════

(function init() {
  if (typeof document === "undefined") return;
  document.addEventListener("DOMContentLoaded", () => {
    initEngine();

    const urlParams = new URLSearchParams(window.location.search);
    const manifestCid = urlParams.get("manifest");
    const assetTokenId = urlParams.get("asset");

    if (assetTokenId && window.contract) {
      window.contract.methods
        .tokenURI(assetTokenId)
        .call()
        .then((cid) => {
          if (cid) {
            window.activeAssetTokenId = String(assetTokenId);
            window.activeAssetManifestCid = cid;
            window.latestAssetManifestCid = cid;
            document.dispatchEvent(
              new CustomEvent("asset:openByTokenId", {
                detail: { tokenId: assetTokenId },
              })
            );
          }
        })
        .catch(() => {});
    } else if (manifestCid) {
      window.activeAssetManifestCid = manifestCid;
      window.latestAssetManifestCid = manifestCid;
      loadAssetManifest(manifestCid);
      hideWelcomeOverlay();
    }

    function startNewAsset() {
      clearScene();
      showWelcomeOverlay();
      window.activeAssetManifestCid = null;
      window.latestAssetManifestCid = null;
      window.activeAssetName = null;
      window.activeAssetTokenId = null;
      const nameEl = document.getElementById("assetNameDisplay");
      if (nameEl) nameEl.textContent = "Untitled Asset";
      const statusEl = document.getElementById("assetStatusName");
      if (statusEl) statusEl.textContent = "No asset open";
      const metaEl = document.getElementById("assetStatusMeta");
      if (metaEl) metaEl.textContent = "Create or open an asset";
      document.dispatchEvent(new CustomEvent("scene:empty"));
      import("/js/ui/sidebar.js").then(function (m) {
        m.switchView("create");
      });
      var promptInput = document.getElementById("promptInput");
      if (promptInput)
        setTimeout(function () {
          promptInput.focus();
        }, 100);
    }

    // Both the welcome-overlay button and the persistent header button.
    ["newAssetBtn", "newAssetTopBtn"].forEach(function (id) {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener("click", startNewAsset);
    });

    // Ctrl+N / Cmd+N — start a new asset.
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        startNewAsset();
      }
    });

    document.addEventListener("asset:linkedDropped", handleLinkedAssetDropped);
  });
})();
