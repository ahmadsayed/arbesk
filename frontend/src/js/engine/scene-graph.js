/**
 * Arbesk Scene Graph Parser
 *
 * Loads a fractal manifest from IPFS and recursively builds a Babylon.js scene.
 * Supports both raw GLB binaries and CID-referenced glTF JSON.
 */

import {
  getFromRemoteIPFS,
  getBlobFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { convertToDataURI } from "../gltf/uri_to_cid.js";

const LAZY_LOAD_DISTANCE_FACTOR = 2.0;
const DEFAULT_WOOD_COLOR = "#C19A6B"; // Light wooden color

/** @type {BABYLON.Engine} */
let engine = null;
/** @type {BABYLON.Scene} */
let scene = null;
/** @type {Map<string, BABYLON.TransformNode>} */
const nodeAnchors = new Map();
/** @type {Map<string, BABYLON.AbstractMesh[]>} */
const nodeMeshes = new Map();
/** @type {BABYLON.TransformNode|null} */
let rootSceneAnchor = null;

/**
 * Initialize the Babylon.js engine and scene.
 */
function initEngine() {
  const canvas = document.getElementById("renderCanvas");
  if (!canvas) {
    console.error("renderCanvas not found");
    return;
  }

  engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });
  scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.05, 0.05, 0.08, 1);

  // Camera
  const camera = new BABYLON.ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.5,
    10,
    BABYLON.Vector3.Zero(),
    scene
  );
  camera.attachControl(canvas, true);
  camera.wheelPrecision = 50;

  // Lighting
  const hemiLight = new BABYLON.HemisphericLight(
    "hemiLight",
    new BABYLON.Vector3(0, 1, 0),
    scene
  );
  hemiLight.intensity = 0.7;

  const dirLight = new BABYLON.DirectionalLight(
    "dirLight",
    new BABYLON.Vector3(-1, -2, -1),
    scene
  );
  dirLight.position = new BABYLON.Vector3(20, 40, 20);
  dirLight.intensity = 0.6;

  // Resize
  window.addEventListener("resize", () => engine.resize());

  // Click handling for node selection
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN) {
      const pickResult = scene.pick(scene.pointerX, scene.pointerY);
      if (pickResult.hit && pickResult.pickedMesh) {
        const mesh = pickResult.pickedMesh;
        let target = mesh;
        while (target && !target.metadata?.nodeId && target.parent) {
          target = target.parent;
        }
        if (target?.metadata?.nodeId) {
          selectNode(target.metadata.nodeId, target);
        }
      }
    }
  });

  engine.runRenderLoop(() => scene.render());
}

/**
 * Select a node and dispatch the node:selected event.
 */
function selectNode(nodeId, mesh) {
  window.selectedNodeId = nodeId;
  document.dispatchEvent(
    new CustomEvent("node:selected", {
      detail: { nodeId, mesh },
    })
  );
}

/**
 * Extract a CID from a source reference.
 */
function extractCid(src) {
  if (src && typeof src === "object" && src.cid) {
    return src.cid;
  }
  return src;
}

/**
 * Detect the asset format from its source reference.
 */
function detectAssetFormat(src) {
  if (src && typeof src === "object" && src.format) {
    return src.format.toLowerCase();
  }
  return "gltf";
}

/**
 * Apply a 4x4 column-major transform matrix to a mesh or transform node.
 */
function applyTransformMatrix(meshOrNode, matrixArray) {
  if (!matrixArray || matrixArray.length !== 16) return;

  const matrix = BABYLON.Matrix.FromValues(...matrixArray);
  const decomposed = matrix.decompose(
    BABYLON.Vector3.Zero(),
    BABYLON.Quaternion.Identity(),
    BABYLON.Vector3.Zero()
  );

  // decompose returns { scale, rotation, translation }
  // Babylon's Matrix.decompose signature: (scale, rotation, translation)
  const scale = new BABYLON.Vector3();
  const rotation = new BABYLON.Quaternion();
  const translation = new BABYLON.Vector3();
  matrix.decompose(scale, rotation, translation);

  meshOrNode.scaling = scale;
  meshOrNode.rotationQuaternion = rotation;
  meshOrNode.position = translation;
}

/**
 * Load a glTF or GLB asset into the scene under a parent node.
 */
async function loadAsset(src, parentNode, nodeId, history, childManifestId) {
  const cid = extractCid(src);
  const format = detectAssetFormat(src);
  console.log(`[SCENE] loadAsset nodeId=${nodeId} cid=${cid} format=${format}`);

  try {
    if (format === "glb") {
      // Raw GLB path: fetch binary blob from browser-backed IPFS cache.
      // This remains on-demand only: nothing is cached until the user opens it.
      const blob = await getBlobFromRemoteIPFS(cid);
      console.log(
        `[SCENE] GLB fetched | cid=${cid} size=${blob.size} bytes | type=${blob.type}`
      );
      const blobUrl = URL.createObjectURL(blob);

      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "",
        blobUrl,
        "",
        scene,
        null,
        ".glb"
      );
      URL.revokeObjectURL(blobUrl);
      console.log(`[SCENE] GLB loaded | meshes=${result.meshes.length}`);
      attachMetadata(
        result.meshes,
        nodeId,
        history,
        childManifestId,
        parentNode
      );
      applyDefaultMaterial(result.meshes);
      return result.meshes;
    } else {
      // glTF JSON path: fetch JSON, resolve CIDs, serve via Blob URL
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

      // Use Blob URL instead of data URI to avoid browser size limits
      const gltfBlob = new Blob([gltfString], { type: "application/json" });
      const blobUrl = URL.createObjectURL(gltfBlob);

      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "",
        blobUrl,
        "",
        scene,
        null,
        ".gltf"
      );
      URL.revokeObjectURL(blobUrl);
      console.log(`[SCENE] glTF loaded | meshes=${result.meshes.length}`);
      attachMetadata(
        result.meshes,
        nodeId,
        history,
        childManifestId,
        parentNode
      );
      applyDefaultMaterial(result.meshes);
      return result.meshes;
    }
  } catch (error) {
    console.error(`[SCENE] FAILED to load asset for node ${nodeId}:`, error);
    // Create a fallback placeholder mesh with default wood color
    const box = BABYLON.MeshBuilder.CreateBox(
      `placeholder_${nodeId}`,
      { size: 1 },
      scene
    );
    box.parent = parentNode;
    box.metadata = { nodeId, history: history || [], childManifestId };
    applyDefaultMaterial([box]);
    return [box];
  }
}

/**
 * Apply default light wooden material to meshes that have no explicit color.
 */
function applyDefaultMaterial(meshes) {
  const woodColor = BABYLON.Color3.FromHexString(DEFAULT_WOOD_COLOR);
  for (const mesh of meshes) {
    if (mesh.material) {
      if (mesh.material.diffuseColor) {
        mesh.material.diffuseColor = woodColor;
      } else if (mesh.material.albedoColor) {
        mesh.material.albedoColor = woodColor;
      }
      if (mesh.material.getSubMeshMaterials) {
        for (const mat of mesh.material.getSubMeshMaterials()) {
          if (mat.diffuseColor) mat.diffuseColor = woodColor;
          else if (mat.albedoColor) mat.albedoColor = woodColor;
        }
      }
    } else {
      const mat = new BABYLON.StandardMaterial("defaultWood", scene);
      mat.diffuseColor = woodColor;
      mesh.material = mat;
    }
  }
}

/**
 * Attach metadata and parent relationships to loaded meshes.
 */
function attachMetadata(meshes, nodeId, history, childManifestId, parentNode) {
  const meshArray = [];
  for (const mesh of meshes) {
    if (mesh.parent === null) {
      mesh.parent = parentNode;
    }
    mesh.metadata = {
      nodeId,
      history: history || [],
      childManifestId,
      isNodeRoot: mesh.parent === parentNode,
    };
    meshArray.push(mesh);
  }
  nodeMeshes.set(nodeId, meshArray);
}

/**
 * Load a single manifest node into the scene.
 */
async function loadNode(node, parentNode) {
  console.log(
    `[SCENE] loadNode node_id=${node.node_id} source=${JSON.stringify(
      node.source
    )} historyCount=${(node.history || []).length}`
  );
  const anchor = new BABYLON.TransformNode(`anchor_${node.node_id}`, scene);
  anchor.parent = parentNode;
  applyTransformMatrix(anchor, node.transform_matrix);
  nodeAnchors.set(node.node_id, anchor);

  let meshes = [];
  if (node.source) {
    meshes = await loadAsset(
      node.source,
      anchor,
      node.node_id,
      node.history,
      node.child_manifest_id
    );
  } else {
    console.warn(
      `[SCENE] node ${node.node_id} has no source — no geometry to load`
    );
  }

  // Create lazy-load anchor for child manifest if present
  if (node.child_manifest_id) {
    const childAnchor = new BABYLON.TransformNode(
      `child_anchor_${node.node_id}`,
      scene
    );
    childAnchor.parent = anchor;
    childAnchor.metadata = {
      lazyManifestId: node.child_manifest_id,
      loaded: false,
    };

    // Double-click handler for lazy loading
    for (const mesh of meshes) {
      mesh.metadata = mesh.metadata || {};
      mesh.metadata.childManifestId = node.child_manifest_id;
      mesh.metadata.hasLazyChild = true;
    }
  }

  return { anchor, meshes };
}

/**
 * Load a manifest and all its root nodes.
 */
async function loadManifest(manifestCid, parentAnchor = null) {
  console.log(`[SCENE] loadManifest cid=${manifestCid}`);

  // Top-level manifest loads should replace the currently rendered world.
  // Child manifest loads (lazy nesting) must keep the existing parent scene intact.
  if (
    !parentAnchor &&
    (rootSceneAnchor || nodeMeshes.size > 0 || nodeAnchors.size > 0)
  ) {
    clearScene();
  }

  const manifest = await getFromRemoteIPFS(manifestCid);
  console.log(
    `[SCENE] manifest loaded | nodes=${manifest?.nodes?.length || 0} version=${
      manifest?.version
    }`
  );
  if (!manifest || !manifest.nodes) {
    console.warn("[SCENE] Manifest has no nodes:", manifestCid);
    return manifest;
  }

  const rootAnchor =
    parentAnchor || new BABYLON.TransformNode("root_anchor", scene);
  if (!parentAnchor) {
    rootSceneAnchor = rootAnchor;
  }

  for (const node of manifest.nodes) {
    await loadNode(node, rootAnchor);
  }

  if (!parentAnchor) {
    window.activeManifestId = manifestCid;
    document.dispatchEvent(
      new CustomEvent("scenegraph:ready", {
        detail: { manifest, manifestCid },
      })
    );
  }

  return manifest;
}

/**
 * Lazy-load a child manifest into a parent anchor.
 */
async function loadChildManifest(childManifestId, parentAnchor) {
  if (!parentAnchor || parentAnchor.metadata?.loaded) return;
  console.log("Lazy loading child manifest:", childManifestId);
  if (parentAnchor.metadata) parentAnchor.metadata.loaded = true;
  await loadManifest(childManifestId, parentAnchor);
}

/**
 * Check camera distance to nodes with lazy children and trigger loads.
 */
function checkLazyLoads() {
  if (!scene || !scene.activeCamera) return;
  const camera = scene.activeCamera;

  for (const [nodeId, anchor] of nodeAnchors) {
    const meshes = nodeMeshes.get(nodeId);
    if (!meshes || meshes.length === 0) continue;

    for (const mesh of meshes) {
      if (!mesh.metadata?.hasLazyChild || mesh.metadata?.childLoaded) continue;

      const boundingInfo = mesh.getBoundingInfo();
      if (!boundingInfo) continue;

      const radius = boundingInfo.boundingSphere.radiusWorld;
      const distance = BABYLON.Vector3.Distance(
        camera.position,
        mesh.getAbsolutePosition()
      );

      if (distance < radius * LAZY_LOAD_DISTANCE_FACTOR) {
        const childAnchor = scene.getTransformNodeByName(
          `child_anchor_${nodeId}`
        );
        if (childAnchor) {
          loadChildManifest(mesh.metadata.childManifestId, childAnchor);
          mesh.metadata.childLoaded = true;
        }
      }
    }
  }
}

/**
 * Clear the entire scene, disposing all meshes, anchors, and cameras.
 * Keeps the engine running.
 */
function clearScene() {
  if (!scene) {
    window.activeManifestId = null;
    return;
  }

  for (const [, meshes] of nodeMeshes) {
    for (const mesh of meshes) {
      if (mesh && !mesh.isDisposed()) {
        mesh.dispose();
      }
    }
  }
  nodeMeshes.clear();

  for (const [, anchor] of nodeAnchors) {
    if (anchor && !anchor.isDisposed()) {
      anchor.dispose();
    }
  }
  nodeAnchors.clear();

  if (rootSceneAnchor && !rootSceneAnchor.isDisposed()) {
    rootSceneAnchor.dispose();
  }
  rootSceneAnchor = null;

  // Babylon importers may leave behind transform nodes or meshes that are not
  // represented in our tracking maps. For one-node-per-world history scrubbing,
  // a top-level clear should remove every rendered world artifact.
  for (const transformNode of [...scene.transformNodes]) {
    if (transformNode && !transformNode.isDisposed()) {
      transformNode.dispose();
    }
  }

  for (const mesh of [...scene.meshes]) {
    if (mesh && !mesh.isDisposed()) {
      mesh.dispose();
    }
  }

  window.activeManifestId = null;
}

/**
 * Get the anchor node for a given nodeId.
 */
function getNodeAnchor(nodeId) {
  return nodeAnchors.get(nodeId) || null;
}

/**
 * Get the meshes for a given nodeId.
 */
function getNodeMeshes(nodeId) {
  return nodeMeshes.get(nodeId) || [];
}

/**
 * Dispose all meshes and anchors for a node.
 */
function disposeNode(nodeId) {
  const meshes = nodeMeshes.get(nodeId);
  if (meshes) {
    for (const mesh of meshes) {
      mesh.dispose();
    }
    nodeMeshes.delete(nodeId);
  }
  const anchor = nodeAnchors.get(nodeId);
  if (anchor) {
    anchor.dispose();
    nodeAnchors.delete(nodeId);
  }
}

// Initialize on DOM ready
function showWelcomeOverlay() {
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.hidden = false;
}

function hideWelcomeOverlay() {
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.hidden = true;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error || new Error("Blob read failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Capture the current rendered world as a small WebP thumbnail for publish.
 * Returns null when the scene/canvas is unavailable or the browser cannot encode WebP.
 */
async function captureWorldThumbnail(options = {}) {
  if (!scene || !engine) return null;

  const canvas = engine.getRenderingCanvas();
  if (!canvas || !canvas.width || !canvas.height) return null;

  const width = options.width || 512;
  const height = options.height || 288;
  const quality = options.quality ?? 0.82;

  scene.render();

  const thumbnailCanvas = document.createElement("canvas");
  thumbnailCanvas.width = width;
  thumbnailCanvas.height = height;

  const ctx = thumbnailCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#0d0d14";
  ctx.fillRect(0, 0, width, height);

  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;

  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else if (sourceRatio < targetRatio) {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, width, height);

  const blob = await canvasToBlob(thumbnailCanvas, "image/webp", quality);
  if (!blob || blob.type !== "image/webp") {
    console.warn("[SCENE] WebP thumbnail capture unavailable in this browser");
    return null;
  }

  const dataUrl = await blobToDataUrl(blob);
  return {
    type: "snapshot",
    dataUrl,
    mime: "image/webp",
    format: "webp",
    path: "thumbnail.webp",
    width,
    height,
    bytes: blob.size,
    timestamp: Date.now(),
  };
}

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initEngine();

  // Parse world tokenId from URL first (TokenID is the primary reference)
  const urlParams = new URLSearchParams(window.location.search);
  const worldTokenId = urlParams.get("world");
  const manifestCid = urlParams.get("manifest"); // legacy fallback

  if (worldTokenId) {
    // TokenID-based loading — gallery.js will handle contract lookup
    // Welcome overlay stays visible until load succeeds
    document.dispatchEvent(
      new CustomEvent("world:loadByTokenId", {
        detail: { tokenId: worldTokenId },
      })
    );
  } else if (manifestCid || window.activeManifestId) {
    // Legacy CID-based loading (draft world not yet minted)
    hideWelcomeOverlay();
    loadManifest(manifestCid || window.activeManifestId);
  } else {
    showWelcomeOverlay();
    document.dispatchEvent(new CustomEvent("scenegraph:empty"));
  }

  // Periodic lazy load check
  setInterval(checkLazyLoads, 500);

  // Welcome overlay buttons
  const newWorldBtn = document.getElementById("newWorldBtn");
  if (newWorldBtn) {
    newWorldBtn.addEventListener("click", () => {
      if (!window.activeWorldName) {
        const nameInput = prompt("Name your new world:", "My World");
        window.activeWorldName = nameInput ? nameInput.trim() : "My World";
      }
      hideWelcomeOverlay();
      clearScene();
      window.activeTokenId = null;
      window.latestManifestId = null;
      const url = new URL(window.location);
      url.searchParams.delete("world");
      url.searchParams.delete("manifest");
      window.history.pushState({}, "", url);
      const sidebar = document.getElementById("chatSidebar");
      if (sidebar) sidebar.classList.remove("collapsed");
    });
  }
});

// Handle manual lazy-load trigger via double-click
document.addEventListener("dblclick", () => {
  if (!scene) return;
  const pickResult = scene.pick(scene.pointerX, scene.pointerY);
  if (pickResult.hit && pickResult.pickedMesh) {
    const mesh = pickResult.pickedMesh;
    let target = mesh;
    while (target && !target.metadata?.hasLazyChild && target.parent) {
      target = target.parent;
    }
    if (target?.metadata?.hasLazyChild && !target.metadata?.childLoaded) {
      const nodeId = target.metadata.nodeId;
      const childAnchor = scene.getTransformNodeByName(
        `child_anchor_${nodeId}`
      );
      if (childAnchor) {
        loadChildManifest(target.metadata.childManifestId, childAnchor);
        target.metadata.childLoaded = true;
      }
    }
  }
});

/**
 * Register an externally created mesh as a node for engine integration.
 * Useful for mock / demo flows that create meshes directly via MeshBuilder.
 */
function registerMockNode(nodeId, mesh, history = []) {
  const anchor = new BABYLON.TransformNode(`anchor_${nodeId}`, scene);
  mesh.parent = anchor;
  mesh.metadata = { nodeId, history, isNodeRoot: true, childManifestId: null };
  nodeMeshes.set(nodeId, [mesh]);
  nodeAnchors.set(nodeId, anchor);
}

export {
  scene,
  engine,
  loadManifest,
  loadNode,
  loadAsset,
  loadChildManifest,
  getNodeAnchor,
  getNodeMeshes,
  disposeNode,
  applyTransformMatrix,
  extractCid,
  detectAssetFormat,
  registerMockNode,
  clearScene,
  captureWorldThumbnail,
  showWelcomeOverlay,
  hideWelcomeOverlay,
};
