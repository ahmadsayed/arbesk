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
import { resolveChildRef } from "../blockchain/token-resolver.js";

const LAZY_LOAD_DISTANCE_FACTOR = 2.0;
const DEFAULT_WOOD_COLOR = "#C19A6B"; // Light wooden color
const MAX_CHILD_WORLD_DEPTH = 5;
const PLACEHOLDER_COLOR = "#E8D5B7"; // Warm sand for placeholders
const ERROR_PLACEHOLDER_COLOR = "#CC6666"; // Muted red for error placeholders

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

/** @type {Array<Object>} Pending child_ref nodes to be saved on next save/publish */
const pendingChildRefs = [];

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

  // Resize whenever the browser or studio panels change the canvas container size.
  const resizeEngine = () => {
    if (!engine) return;
    engine.resize();
  };

  window.addEventListener("resize", resizeEngine);

  const viewport = document.getElementById("viewport") || canvas.parentElement;
  if (window.ResizeObserver && viewport) {
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(resizeEngine);
    });
    resizeObserver.observe(viewport);
  }

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
async function loadAsset(src, parentNode, nodeId, variants, linkedAssetRef) {
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
        variants,
        linkedAssetRef,
        parentNode,
        result.transformNodes || []
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
        variants,
        linkedAssetRef,
        parentNode,
        result.transformNodes || []
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
    box.metadata = { nodeId, variants: variants || [], linkedAssetRef };
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
 * Return renderable meshes that can contribute to imported asset bounds.
 */
function getRenderableMeshes(meshes) {
  return meshes.filter(
    (mesh) =>
      mesh &&
      !mesh.isDisposed() &&
      typeof mesh.getTotalVertices === "function" &&
      mesh.getTotalVertices() > 0
  );
}

/**
 * Compute world-space bounds for a set of renderable meshes.
 */
function getWorldBounds(meshes) {
  let min = new BABYLON.Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY
  );
  let max = new BABYLON.Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  );

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    if (typeof mesh.refreshBoundingInfo === "function") {
      mesh.refreshBoundingInfo();
    }

    const boundingInfo = mesh.getBoundingInfo?.();
    const boundingBox = boundingInfo?.boundingBox;
    if (!boundingBox) continue;

    min = BABYLON.Vector3.Minimize(min, boundingBox.minimumWorld);
    max = BABYLON.Vector3.Maximize(max, boundingBox.maximumWorld);
  }

  if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) return null;

  const center = min.add(max).scale(0.5);
  const size = max.subtract(min);
  return { min, max, center, size };
}

/**
 * Shift imported root nodes so the asset's bounding-box center sits on its anchor.
 */
function centerImportedAsset(meshes, importedNodes, parentNode, nodeId) {
  const renderableMeshes = getRenderableMeshes(meshes);
  if (renderableMeshes.length === 0) return;

  const bounds = getWorldBounds(renderableMeshes);
  if (!bounds) return;

  const rootNodes = importedNodes.filter((node) => node?.parent === parentNode);
  if (rootNodes.length === 0) {
    console.warn(
      `[SCENE] unable to center asset nodeId=${nodeId}: no imported root nodes`
    );
    return;
  }

  parentNode.computeWorldMatrix(true);
  const inverseParentWorld = parentNode.getWorldMatrix().clone().invert();
  const localCenter = BABYLON.Vector3.TransformCoordinates(
    bounds.center,
    inverseParentWorld
  );

  if (!Number.isFinite(localCenter.x)) return;

  for (const rootNode of rootNodes) {
    rootNode.position.subtractInPlace(localCenter);
    rootNode.computeWorldMatrix(true);
    rootNode.metadata = rootNode.metadata || {};
    rootNode.metadata.centeringOffset = localCenter.clone();
  }

  console.log(
    `[SCENE] centered asset | nodeId=${nodeId} center=(${bounds.center.x.toFixed(
      3
    )}, ${bounds.center.y.toFixed(3)}, ${bounds.center.z.toFixed(
      3
    )}) size=(${bounds.size.x.toFixed(3)}, ${bounds.size.y.toFixed(
      3
    )}, ${bounds.size.z.toFixed(3)})`
  );
}

/**
 * Attach metadata and parent relationships to loaded meshes.
 */
function attachMetadata(
  meshes,
  nodeId,
  variants,
  linkedAssetRef,
  parentNode,
  transformNodes = []
) {
  const meshArray = [];
  const importedNodes = [...transformNodes, ...meshes];

  for (const transformNode of transformNodes) {
    if (transformNode.parent === null) {
      transformNode.parent = parentNode;
    }
    transformNode.metadata = {
      ...(transformNode.metadata || {}),
      nodeId,
      variants: variants || [],
      linkedAssetRef,
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
      variants: variants || [],
      linkedAssetRef,
      isNodeRoot: mesh.parent === parentNode,
    };
    meshArray.push(mesh);
  }

  centerImportedAsset(meshArray, importedNodes, parentNode, nodeId);
  nodeMeshes.set(nodeId, meshArray);
}

function getManifestNodes(manifest) {
  return manifest?.scene?.nodes || [];
}

/**
 * Create a placeholder mesh for token child nodes that are loading or failed.
 */
function createPlaceholder(nodeId, parentNode, state) {
  const color = state === "error" ? ERROR_PLACEHOLDER_COLOR : PLACEHOLDER_COLOR;
  const box = BABYLON.MeshBuilder.CreateBox(
    `placeholder_${nodeId}`,
    { size: 0.5 },
    scene
  );
  box.parent = parentNode;
  box.metadata = {
    nodeId,
    isPlaceholder: true,
    placeholderState: state,
  };

  const mat = new BABYLON.StandardMaterial(`placeholderMat_${nodeId}`, scene);
  mat.diffuseColor = BABYLON.Color3.FromHexString(color);
  mat.alpha = state === "loading" ? 0.6 : 0.8;
  box.material = mat;

  if (state === "loading") {
    // Pulse animation for loading
    const pulseAnim = new BABYLON.Animation(
      `pulse_${nodeId}`,
      "scaling",
      30,
      BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
      BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
    );
    pulseAnim.setKeys([
      { frame: 0, value: new BABYLON.Vector3(1, 1, 1) },
      { frame: 15, value: new BABYLON.Vector3(1.2, 1.2, 1.2) },
      { frame: 30, value: new BABYLON.Vector3(1, 1, 1) },
    ]);
    box.animations = [pulseAnim];
    scene.beginAnimation(box, 0, 30, true);
  }

  return box;
}

/**
 * Load a token-based child world (child_ref node).
 * Resolves the on-chain token reference, fetches the child manifest,
 * and recursively loads it under the parent anchor.
 *
 * @param {Object} node - The manifest node with child_ref
 * @param {BABYLON.TransformNode} anchor - The anchor for this node
 * @param {number} depth - Current recursion depth
 * @param {Set<string>} resolvingCids - CIDs currently being resolved (cycle protection)
 */
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

  // Self-reference check: build a fingerprint of this reference
  const refKey = `${childRef.chainId}:${childRef.contractAddress}:${childRef.tokenId}`;
  if (resolvingCids.has(refKey)) {
    console.warn(
      `[SCENE] circular child_ref detected at node ${node.node_id}, ref=${refKey}`
    );
    const placeholder = createPlaceholder(node.node_id, anchor, "error");
    return [placeholder];
  }
  resolvingCids.add(refKey);

  // Show loading placeholder
  const loadingPlaceholder = createPlaceholder(node.node_id, anchor, "loading");

  try {
    console.log(
      `[SCENE] resolving token child node ${node.node_id} depth=${depth}`
    );

    // Resolve the token reference to a manifest CID
    const resolution = await resolveChildRef(childRef);
    if (!resolution.resolved || !resolution.manifestCid) {
      console.warn(
        `[SCENE] token child resolution failed for node ${node.node_id}: ${resolution.error}`
      );
      loadingPlaceholder.dispose();
      const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
      return [errorPlaceholder];
    }

    console.log(
      `[SCENE] token child node ${node.node_id} resolved → ${resolution.manifestCid}`
    );

    // Create a child anchor for the resolved manifest
    const childAnchor = new BABYLON.TransformNode(
      `child_anchor_${node.node_id}`,
      scene
    );
    childAnchor.parent = anchor;
    childAnchor.metadata = {
      childRef,
      resolvedCid: resolution.manifestCid,
      loaded: true,
    };

    // Remove loading placeholder and load the child manifest
    loadingPlaceholder.dispose();

    // Load the child manifest recursively under the child anchor
    await loadAssetManifest(
      resolution.manifestCid,
      childAnchor,
      depth + 1,
      resolvingCids
    );

    // Return empty — the child manifest's own nodes are tracked separately
    return [];
  } catch (err) {
    console.error(
      `[SCENE] failed to load token child node ${node.node_id}:`,
      err
    );
    loadingPlaceholder.dispose();
    const errorPlaceholder = createPlaceholder(node.node_id, anchor, "error");
    return [errorPlaceholder];
  }
}

/**
 * Load a single manifest node into the scene.
 */
async function loadNode(node, parentNode, depth, resolvingCids) {
  console.log(
    `[SCENE] loadNode node_id=${node.node_id} source=${JSON.stringify(
      node.source
    )} childRef=${!!node.child_ref} variantCount=${
      (node.variants || []).length
    }`
  );
  const anchor = new BABYLON.TransformNode(`anchor_${node.node_id}`, scene);
  anchor.parent = parentNode;
  applyTransformMatrix(anchor, node.transform_matrix);
  nodeAnchors.set(node.node_id, anchor);

  let meshes = [];

  // Handle token-based child world (child_ref)
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
    meshes = await loadAsset(
      node.source,
      anchor,
      node.node_id,
      node.variants,
      node.linked_asset_manifest_cid
    );
  } else {
    console.warn(
      `[SCENE] node ${node.node_id} has no source — no geometry to load`
    );
  }

  // Create lazy-load anchor for child manifest if present
  if (node.linked_asset_manifest_cid) {
    const childAnchor = new BABYLON.TransformNode(
      `child_anchor_${node.node_id}`,
      scene
    );
    childAnchor.parent = anchor;
    childAnchor.metadata = {
      lazyManifestCid: node.linked_asset_manifest_cid,
      loaded: false,
    };

    // Double-click handler for lazy loading
    for (const mesh of meshes) {
      mesh.metadata = mesh.metadata || {};
      mesh.metadata.linkedAssetManifestCid = node.linked_asset_manifest_cid;
      mesh.metadata.hasLazyChild = true;
    }
  }

  return { anchor, meshes };
}

/**
 * Load a manifest and all its root nodes.
 *
 * @param {string} manifestCid
 * @param {BABYLON.TransformNode|null} parentAnchor
 * @param {number} depth - Current recursion depth for child worlds
 * @param {Set<string>} resolvingCids - Set of ref keys being resolved (cycle protection)
 */
async function loadAssetManifest(
  manifestCid,
  parentAnchor = null,
  depth = 0,
  resolvingCids = new Set()
) {
  console.log(`[SCENE] loadAssetManifest cid=${manifestCid} depth=${depth}`);

  // Top-level manifest loads should replace the currently rendered asset.
  // Child manifest loads (lazy nesting) must keep the existing parent scene intact.
  if (
    !parentAnchor &&
    depth === 0 &&
    (rootSceneAnchor || nodeMeshes.size > 0 || nodeAnchors.size > 0)
  ) {
    clearScene();
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
    parentAnchor || new BABYLON.TransformNode("root_anchor", scene);
  if (!parentAnchor) {
    rootSceneAnchor = rootAnchor;
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

/**
 * Lazy-load a child manifest into a parent anchor.
 */
async function loadLinkedAssetManifest(linkedAssetManifestCid, parentAnchor) {
  if (!parentAnchor || parentAnchor.metadata?.loaded) return;
  console.log("Lazy loading child manifest:", linkedAssetManifestCid);
  if (parentAnchor.metadata) parentAnchor.metadata.loaded = true;
  await loadAssetManifest(linkedAssetManifestCid, parentAnchor);
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
          loadLinkedAssetManifest(
            mesh.metadata.linkedAssetManifestCid,
            childAnchor
          );
          mesh.metadata.childLoaded = true;
        }
      }
    }
  }
}

/**
 * Clear pending child refs
 */
function clearPendingChildRefs() {
  pendingChildRefs.length = 0;
}

/**
 * Get the list of pending child_ref nodes to be included in the next save.
 */
function getPendingChildRefs() {
  return [...pendingChildRefs];
}

/**
 * Handle a linked asset being dropped onto the scene canvas.
 * Creates a token child node with child_ref, resolves it, and loads the child world.
 */
async function handleLinkedAssetDropped(event) {
  const detail = event.detail;
  if (!detail) return;

  const { token_id, standard, resolution, chainId, contractAddress } = detail;
  if (!token_id) return;

  const resolvedChainId = chainId || window.chainId || 314159;
  const resolvedContractAddr =
    contractAddress || window.contractAddress || null;

  if (!resolvedContractAddr) {
    console.warn(
      "[SCENE] Cannot add token child: no contract address available. Connect wallet first."
    );
    alert("Please connect your wallet before adding linked assets.");
    return;
  }

  // Check for duplicates: don't add the same token twice
  const refKey = `${resolvedChainId}:${resolvedContractAddr.toLowerCase()}:${String(
    token_id
  )}`;
  if (pendingChildRefs.some((ref) => ref.node_id.endsWith(refKey))) {
    console.warn(`[SCENE] token child ${refKey} already in scene — skipping`);
    return;
  }

  // Check against already-loaded nodes too
  for (const [nodeId] of nodeAnchors) {
    if (nodeId.endsWith(refKey)) {
      console.warn(`[SCENE] token child ${refKey} already in scene — skipping`);
      return;
    }
  }

  // Build the node_id
  const shortAddr = resolvedContractAddr.slice(2, 10).toLowerCase();
  const nodeId = `child_token_${resolvedChainId}_${shortAddr}_${token_id}`;

  // Build the child_ref
  const childRef = {
    type: "token",
    chainId: resolvedChainId,
    contractAddress: resolvedContractAddr,
    tokenId: String(token_id),
    standard: standard || "ERC721",
    resolution: resolution || "latest",
  };

  // Build the node entry
  const nodeEntry = {
    node_id: nodeId,
    transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], // identity matrix
    child_ref: childRef,
  };

  console.log(`[SCENE] adding token child node: ${nodeId}`, childRef);

  // Ensure there's a root anchor (create if scene is empty)
  if (!rootSceneAnchor) {
    rootSceneAnchor = new BABYLON.TransformNode("root_anchor", scene);
    hideWelcomeOverlay();
  }

  // Store in pending list for save
  pendingChildRefs.push(nodeEntry);

  // Load the token child into the scene
  await loadNode(nodeEntry, rootSceneAnchor, 0, new Set());

  // Dispatch event so save/publish can include child refs
  document.dispatchEvent(
    new CustomEvent("scene:tokenChildAdded", {
      detail: { nodeId, childRef },
    })
  );
}

/**
 * Clear the entire scene, disposing all meshes, anchors, and cameras.
 * Keeps the engine running.
 */
function clearScene() {
  if (!scene) {
    window.activeAssetManifestCid = null;
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
  // represented in our tracking maps. For one-node-per-asset history scrubbing,
  // a top-level clear should remove every rendered asset artifact.
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

  window.activeAssetManifestCid = null;

  // Clear pending child refs
  pendingChildRefs.length = 0;
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
 * Check if a node is a token-based child node (has child_ref).
 * Returns the child_ref data if found, null otherwise.
 */
function getNodeChildRef(nodeId) {
  // Check if nodeId itself is a token child (starts with child_token_)
  if (nodeId && nodeId.startsWith("child_token_")) {
    const anchor = nodeAnchors.get(nodeId);
    if (anchor && anchor.metadata?.childRef) {
      return anchor.metadata.childRef;
    }
    // Also check child anchors for nested token children
    const childAnchor = scene?.getTransformNodeByName(`child_anchor_${nodeId}`);
    if (childAnchor?.metadata?.childRef) {
      return childAnchor.metadata.childRef;
    }
  }

  // Check ancestor anchors for token child context
  const anchor = nodeAnchors.get(nodeId);
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
 * Capture the current rendered asset as a small WebP thumbnail for publish.
 * Returns null when the scene/canvas is unavailable or the browser cannot encode WebP.
 */
async function captureAssetThumbnail(options = {}) {
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

// Listen for linked asset drops from the asset library or drop zone
document.addEventListener("asset:linkedDropped", handleLinkedAssetDropped);

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
  initEngine();

  // Parse asset tokenId from URL first (TokenID is the primary reference)
  const urlParams = new URLSearchParams(window.location.search);
  const assetTokenId = urlParams.get("asset");
  const manifestCid = urlParams.get("manifest"); // legacy fallback

  if (assetTokenId) {
    // TokenID-based loading — assetLibrary.js will handle contract lookup
    // Welcome overlay stays visible until load succeeds
    document.dispatchEvent(
      new CustomEvent("asset:openByTokenId", {
        detail: { tokenId: assetTokenId },
      })
    );
  } else if (manifestCid || window.activeAssetManifestCid) {
    // Legacy CID-based loading (draft asset not yet minted)
    hideWelcomeOverlay();
    loadAssetManifest(manifestCid || window.activeAssetManifestCid);
  } else {
    showWelcomeOverlay();
    document.dispatchEvent(new CustomEvent("scene:empty"));
  }

  // Periodic lazy load check
  setInterval(checkLazyLoads, 500);

  // Welcome overlay buttons
  const newAssetBtn = document.getElementById("newAssetBtn");
  if (newAssetBtn) {
    newAssetBtn.addEventListener("click", () => {
      if (!window.activeAssetName) {
        const nameInput = prompt("Name your new asset:", "My Asset");
        window.activeAssetName = nameInput ? nameInput.trim() : "My Asset";
      }
      hideWelcomeOverlay();
      clearScene();
      window.activeAssetTokenId = null;
      window.latestAssetManifestCid = null;
      const url = new URL(window.location);
      url.searchParams.delete("asset");
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
        loadLinkedAssetManifest(
          target.metadata.linkedAssetManifestCid,
          childAnchor
        );
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
  mesh.metadata = {
    nodeId,
    variants: history,
    isNodeRoot: true,
    linkedAssetRef: null,
  };
  nodeMeshes.set(nodeId, [mesh]);
  nodeAnchors.set(nodeId, anchor);
}

export {
  scene,
  engine,
  loadAssetManifest,
  loadNode,
  loadAsset,
  loadLinkedAssetManifest,
  getNodeAnchor,
  getNodeMeshes,
  getNodeChildRef,
  disposeNode,
  applyTransformMatrix,
  extractCid,
  detectAssetFormat,
  registerMockNode,
  clearScene,
  captureAssetThumbnail,
  showWelcomeOverlay,
  hideWelcomeOverlay,
  getPendingChildRefs,
  clearPendingChildRefs,
};
