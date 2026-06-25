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
import { composeGlTFAsync } from "../gltf/async-gltf.js";
import {
  resolveChildRef,
  resolveCollectionChildRef,
  clearResolutionCache,
} from "../blockchain/token-resolver.js";
import { CHAIN_IDS } from "../constants/chains.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { uiState } from "../state/ui-state.js";

import { applyColor, applyScale } from "./time-travel.js";
import { state, DEFAULT_WOOD_COLOR, MAX_CHILD_WORLD_DEPTH } from "./state.js";
import { getCssVar, hexToColor3, hexToColor4 } from "./theme.js";

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
  getPendingPostProcessorEdits,
  clearPendingPostProcessorEdits,
  clearPendingPostProcessorEdit,
  getPendingTransformEdits,
  clearPendingTransformEdits,
  clearPendingTransformEdit,
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
  getPendingPostProcessorEdits,
  clearPendingPostProcessorEdits,
  clearPendingPostProcessorEdit,
  getPendingTransformEdits,
  clearPendingTransformEdits,
  clearPendingTransformEdit,
} from "./cleanup.js";

// Re-sync viewport background when the user toggles light / dark mode.
// Registered at module load so it catches the initial theme:changed emit.
on(EVENTS.THEME_CHANGED, () => {
  if (state.scene) {
    const viewportBg = getCssVar("--viewport-bg") || "#1e1e1e";
    state.scene.clearColor =
      hexToColor4(viewportBg, 1) || new BABYLON.Color4(0.118, 0.118, 0.118, 1);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// View presets — Blender-style 1/3/7 orthographic view snapping
// ═══════════════════════════════════════════════════════════════════════════

const VIEW_FRONT = { name: "Front", alpha: 0, beta: Math.PI / 2 };
const VIEW_RIGHT = { name: "Right", alpha: Math.PI / 2, beta: Math.PI / 2 };
const VIEW_TOP = { name: "Top", alpha: 0, beta: 0.01 };

// ═══════════════════════════════════════════════════════════════════════════
// Engine initialization
// ═══════════════════════════════════════════════════════════════════════════

function createAnchorNode(name, scene) {
  if (
    typeof BABYLON !== "undefined" &&
    typeof BABYLON.TransformNode === "function"
  ) {
    return new BABYLON.TransformNode(name, scene);
  }
  console.warn(
    "[SCENE] BABYLON.TransformNode not available, using invisible Mesh fallback"
  );
  const fallback = BABYLON.MeshBuilder.CreateBox(name, { size: 0.001 }, scene);
  fallback.isVisible = false;
  fallback.isPickable = false;
  return fallback;
}

function initEngine() {
  const canvas = document.getElementById("renderCanvas");
  if (!canvas) {
    // Non-Studio pages (e.g. library.html) may import modules that pull in
    // scene-graph.js; missing canvas there is expected, not an error.
    console.log("[SCENE] renderCanvas not present — skipping 3D engine init");
    return;
  }

  state.engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });

  state.scene = new BABYLON.Scene(state.engine);
  // Read viewport background from the SCSS token system so the 3D scene
  // matches the surrounding chrome in both light and dark modes.
  const viewportBg = getCssVar("--viewport-bg") || "#1e1e1e";
  state.scene.clearColor =
    hexToColor4(viewportBg, 1) || new BABYLON.Color4(0.118, 0.118, 0.118, 1);

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
  state.camera = camera;

  // Custom ortho-mode wheel zoom. Babylon's default wheel handler changes
  // `radius`, which has no effect on the ortho frustum when the four
  // orthoLeft/Right/Top/Bottom properties are set explicitly. We scale
  // those four bounds proportionally instead.
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (
        state.camera &&
        state.camera.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA
      ) {
        e.preventDefault();
        // Smooth exponential zoom: deltaY ~100 per tick → ~10% step
        const factor = Math.exp(e.deltaY * 0.0015);
        const cam = state.camera;
        cam.orthoLeft *= factor;
        cam.orthoRight *= factor;
        cam.orthoTop *= factor;
        cam.orthoBottom *= factor;
      }
    },
    { passive: false }
  );

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

  // Ground plane grid — semi-transparent plane
  try {
    const grid = BABYLON.MeshBuilder.CreateGround(
      "groundGrid",
      { width: 40, height: 40, subdivisions: 20 },
      state.scene
    );
    grid.isPickable = false;
    grid.metadata = { isViewportChrome: true };

    const mat = new BABYLON.StandardMaterial("gridMat", state.scene);
    mat.wireframe = true;
    mat.emissiveColor = new BABYLON.Color3(0.35, 0.35, 0.35);
    mat.disableLighting = true;
    mat.alpha = 0.3;
    mat.backFaceCulling = false;
    grid.material = mat;
    console.log("[SCENE] ground grid created");
  } catch (e) {
    console.warn("[SCENE] grid failed:", e.message);
  }

  // Blender-style in-scene axes (cross on the ground plane).
  // Uses the same color scheme as the corner viewport gizmo for consistency.
  try {
    const AXIS_LEN = 20;
    const AXIS_Y = 0.02; // slightly above grid to prevent z-fighting
    const axisColors = {
      x: new BABYLON.Color3(0.886, 0.169, 0.188), // #e22b30 red
      z: new BABYLON.Color3(0.204, 0.471, 0.922), // #3478eb blue
    };

    // X axis (red) — full width cross through origin
    const xAxis = BABYLON.MeshBuilder.CreateLines(
      "axisX",
      {
        points: [
          new BABYLON.Vector3(-AXIS_LEN, AXIS_Y, 0),
          new BABYLON.Vector3(AXIS_LEN, AXIS_Y, 0),
        ],
      },
      state.scene
    );
    xAxis.color = axisColors.x;
    xAxis.isPickable = false;
    xAxis.metadata = { isViewportChrome: true };

    // Z axis (blue) — full depth cross through origin
    const zAxis = BABYLON.MeshBuilder.CreateLines(
      "axisZ",
      {
        points: [
          new BABYLON.Vector3(0, AXIS_Y, -AXIS_LEN),
          new BABYLON.Vector3(0, AXIS_Y, AXIS_LEN),
        ],
      },
      state.scene
    );
    zAxis.color = axisColors.z;
    zAxis.isPickable = false;
    zAxis.metadata = { isViewportChrome: true };

    console.log("[SCENE] in-scene axes created");
  } catch (e) {
    console.warn("[SCENE] axes failed:", e.message);
  }

  // Blender-style 2D orientation gizmo (top-right corner overlay).
  import("../ui/viewport-gizmo.js")
    .then(({ initViewportGizmo }) => {
      initViewportGizmo(state.scene, camera);
      console.log("[SCENE] viewport gizmo initialized");
    })
    .catch((e) => {
      console.warn("[SCENE] viewport gizmo init failed:", e.message);
    });

  // Transform gizmo (move/rotate/scale) for the selected node.
  import("../ui/transform-gizmo.js")
    .then(({ initTransformGizmo }) => {
      initTransformGizmo(state.scene, camera);
      console.log("[SCENE] transform gizmo initialized");
    })
    .catch((e) => {
      console.warn("[SCENE] transform gizmo init failed:", e.message);
    });

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
      // Walk the full parent chain. Track the first nodeId seen (for regular
      // nodes) but do NOT stop — continue until a childRef boundary is found
      // or the chain ends. A childRef boundary means we are inside a child
      // world; the parent manifest's node_id is on the outer anchor above it.
      let firstNodeId = null;
      let childWorldNodeId = null;

      while (target) {
        if (target.metadata?.childRef) {
          // childAnchor: its parent is the outer anchor whose metadata.nodeId
          // is the parent-manifest node_id (manifest-loaded path).
          // Fall back to childAnchor's own nodeId for freshly-dropped nodes.
          childWorldNodeId =
            target.parent?.metadata?.nodeId || target.metadata?.nodeId || null;
          break;
        }
        if (target.metadata?.nodeId && !firstNodeId) {
          firstNodeId = target.metadata.nodeId;
        }
        target = target.parent;
      }

      const resolvedNodeId = childWorldNodeId || firstNodeId;
      const isChildWorldNode = !!childWorldNodeId;

      if (resolvedNodeId) {
        if (resolvedNodeId === state.highlightedNodeId) {
          // Sub-mesh toggle only applies to regular (non-child-world) nodes.
          if (!isChildWorldNode && mesh.name) {
            if (state.highlightedSubMeshName === mesh.name) {
              selectNode(resolvedNodeId, target);
            } else {
              selectSubMesh(resolvedNodeId, mesh.name);
            }
          }
          return;
        }
        selectNode(resolvedNodeId, target);
        return;
      }
    }
    // Clicked empty space → deselect
    if (state.highlightedNodeId) {
      deselectAll();
    }
  }, BABYLON.PointerEventTypes.POINTERPICK);

  state.pointerObservableCallback = null; // managed by Babylon internally

  // Selection highlight layer — Arbesk amber glow around picked meshes
  state.highlightLayer = new BABYLON.HighlightLayer(
    "highlightLayer",
    state.scene
  );
  state.highlightLayer.innerGlow = false;
  state.highlightLayer.outerGlow = true;
  state.highlightLayer.blurHorizontalSize = 0.4;
  state.highlightLayer.blurVerticalSize = 0.4;
  state.highlightLayer.alpha = 0.7;

  // Keyboard shortcuts — only fire when focus is on the canvas or body
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    const editable =
      document.activeElement?.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select";
    if (editable) return; // don't steal keystrokes from form fields

    switch (e.key) {
      case "Escape":
        if (state.highlightedNodeId) {
          e.preventDefault();
          deselectAll();
        }
        break;
      case "Home":
        e.preventDefault();
        frameAll();
        break;
      case "f":
        if (state.highlightedNodeId) {
          e.preventDefault();
          frameSelected();
        }
        break;
      case "1":
        e.preventDefault();
        snapView(VIEW_FRONT);
        break;
      case "3":
        e.preventDefault();
        snapView(VIEW_RIGHT);
        break;
      case "7":
        e.preventDefault();
        snapView(VIEW_TOP);
        break;
    }
  });
}

function selectNode(nodeId, mesh) {
  if (nodeId === state.highlightedNodeId && !state.highlightedSubMeshName)
    return;
  clearHighlight();
  state.highlightedSubMeshName = null;
  const meshes = state.nodeMeshes.get(nodeId);
  if (meshes && state.highlightLayer) {
    const amber =
      hexToColor3(getCssVar("--highlight-amber")) ||
      BABYLON.Color3.FromHexString("#D4A017");
    for (const m of meshes) {
      if (m && !m.isDisposed()) state.highlightLayer.addMesh(m, amber);
    }
  }
  state.highlightedNodeId = nodeId;
  uiState.set({ selectedNodeId: nodeId });
  emit(EVENTS.NODE_SELECTED, { nodeId, mesh });
}

function selectSubMesh(nodeId, meshName) {
  if (nodeId !== state.highlightedNodeId) {
    clearHighlight();
    state.highlightedNodeId = nodeId;
    uiState.set({ selectedNodeId: nodeId });
  } else {
    clearHighlight();
  }
  const meshes = state.nodeMeshes.get(nodeId);
  if (meshes && state.highlightLayer) {
    const amber =
      hexToColor3(getCssVar("--highlight-amber")) ||
      BABYLON.Color3.FromHexString("#D4A017");
    for (const m of meshes) {
      if (m && !m.isDisposed() && m.name === meshName)
        state.highlightLayer.addMesh(m, amber);
    }
  }
  state.highlightedSubMeshName = meshName;
  emit(EVENTS.SUBMESH_SELECTED, { nodeId, meshName });
}

/**
 * Highlight a node by ID alone (from outliner or programmatic selection).
 * Does not re-fire node:selected if already highlighted.
 */
function selectNodeById(nodeId) {
  selectNode(nodeId, null);
}

/**
 * Remove all meshes from the highlight layer without changing selection state.
 */
function clearHighlight() {
  if (!state.highlightLayer) return;
  const prevId = state.highlightedNodeId;
  if (!prevId) return;
  const meshes = state.nodeMeshes.get(prevId);
  if (meshes) {
    for (const m of meshes) {
      if (m && !m.isDisposed()) {
        try {
          state.highlightLayer.removeMesh(m);
        } catch (_) {
          // mesh may not be in the highlight layer
        }
      }
    }
  }
}

/**
 * Deselect the current node: clear highlight, reset state, dispatch event.
 */
function deselectAll() {
  clearHighlight();
  state.highlightedNodeId = null;
  state.highlightedSubMeshName = null;
  uiState.set({ selectedNodeId: null });
  emit(EVENTS.NODE_DESELECTED);
}

/**
 * Frame the ArcRotateCamera to a bounding box, keeping current alpha/beta.
 */
function frameCameraToBounds(bounds) {
  if (!state.camera || !bounds) return;

  const cam = state.camera;
  const diagonal = Math.sqrt(
    bounds.size.x * bounds.size.x +
      bounds.size.y * bounds.size.y +
      bounds.size.z * bounds.size.z
  );
  const fov = cam.fov || 0.8; // radians, default ~45°
  const radius = (diagonal * 0.6) / Math.tan(fov / 2);

  // Animate to the new target + radius over 300ms
  BABYLON.Animation.CreateAndStartAnimation(
    "frameAnim",
    cam,
    "target",
    60,
    20,
    cam.target,
    bounds.center,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "frameRadiusAnim",
    cam,
    "radius",
    60,
    20,
    cam.radius,
    Math.max(radius, cam.lowerRadiusLimit),
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
}

/**
 * Frame all non-chrome meshes in the scene (Home key).
 */
function frameAll() {
  if (!state.scene) return;

  const allMeshes = state.scene.meshes.filter(
    (m) => m && !m.isDisposed() && !m.metadata?.isViewportChrome
  );
  const renderable = getRenderableMeshes(allMeshes);
  if (renderable.length === 0) return;

  const bounds = getWorldBounds(renderable);
  if (!bounds) return;

  frameCameraToBounds(bounds);
}

/**
 * Frame the currently highlighted node (F key).
 */
function frameSelected() {
  if (!state.highlightedNodeId) return;

  const meshes = state.nodeMeshes.get(state.highlightedNodeId);
  if (!meshes) return;

  const renderable = getRenderableMeshes(meshes);
  if (renderable.length === 0) return;

  const bounds = getWorldBounds(renderable);
  if (!bounds) return;

  frameCameraToBounds(bounds);
}

/**
 * Snap the camera to an orthographic view preset (1=Front, 3=Right, 7=Top).
 * Frames the scene first to compute good camera parameters, converts the
 * perspective radius to ortho radius, then animates alpha + beta + radius.
 */
function snapView(preset) {
  if (!state.camera || !state.scene) return;

  const cam = state.camera;
  const canvas = state.engine.getRenderingCanvas();

  const allMeshes = state.scene.meshes.filter(
    (m) => m && !m.isDisposed() && !m.metadata?.isViewportChrome
  );
  const renderable = getRenderableMeshes(allMeshes);

  let target = cam.target.clone();

  if (renderable.length > 0) {
    const bounds = getWorldBounds(renderable);
    if (bounds) {
      target = bounds.center.clone();

      // Projected bounds on the ortho view plane per view direction.
      // Front (1) = look -Z → visible X×Y
      // Right (3) = look +X → visible Z×Y
      // Top   (7) = look -Y → visible X×Z
      let spanW, spanH;
      if (preset.name === "Right") {
        spanW = bounds.size.z;
        spanH = bounds.size.y;
      } else if (preset.name === "Top") {
        spanW = bounds.size.x;
        spanH = bounds.size.z;
      } else {
        spanW = bounds.size.x;
        spanH = bounds.size.y;
      }

      // Set the ortho frustum EXPLICITLY, matched to the canvas aspect ratio.
      const canvasAspect = canvas.width / canvas.height;
      const sceneAspect = spanW / spanH;
      const padding = 1.1;
      let halfW, halfH;
      if (sceneAspect > canvasAspect) {
        halfW = (spanW * padding) / 2;
        halfH = halfW / canvasAspect;
      } else {
        halfH = (spanH * padding) / 2;
        halfW = halfH * canvasAspect;
      }

      cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
      cam.orthoLeft = -halfW;
      cam.orthoRight = halfW;
      cam.orthoBottom = -halfH;
      cam.orthoTop = halfH;
      // Radius is irrelevant for ortho rendering but ArcRotateCamera uses
      // it for direction calc — keep a safe distance.
      cam.radius = (spanW + spanH) / 2 + 2;

      console.log(
        `[VIEW] ${preset.name} | span=${spanW.toFixed(1)}×${spanH.toFixed(
          1
        )} halfW=${halfW.toFixed(1)} halfH=${halfH.toFixed(1)} canvas=${
          canvas.width
        }×${canvas.height}`
      );
    }
  }

  // Animate target + alpha + beta. Ortho frustum is already set.
  BABYLON.Animation.CreateAndStartAnimation(
    "snapTarget",
    cam,
    "target",
    60,
    18,
    cam.target.clone(),
    target,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "snapAlpha",
    cam,
    "alpha",
    60,
    18,
    cam.alpha,
    preset.alpha,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "snapBeta",
    cam,
    "beta",
    60,
    18,
    cam.beta,
    preset.beta,
    BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
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
      return result.meshes;
    } else {
      console.log(`[SCENE] fetching glTF JSON from gateway | cid=${cid}`);
      const gltfJson = await getFromRemoteIPFS(cid);
      console.log(
        `[SCENE] glTF JSON fetched | hasBuffers=${!!gltfJson?.buffers} | bufferCount=${
          gltfJson?.buffers?.length || 0
        }`
      );

      const resolvedGltf = await composeGlTFAsync(gltfJson);
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

/**
 * Decide how a node's child_ref should be resolved: same-collection lookup
 * or cross-collection asset lookup.
 * Pure decision logic — no I/O.
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
      `[SCENE] node ${node.node_id} has no source — no geometry to load`
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

  // Collection manifests don't have scene.nodes — delegate to
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
    assetState.set({ activeAssetManifestCid: manifestCid });
    emit(EVENTS.SCENE_READY, { manifest, manifestCid });
  }

  return manifest;
}

/**
 * Load a collection manifest and populate the active-collection state.
 * Does NOT render any 3D content — returns the manifest plus a flat list
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
// Drag/drop — linked asset composition
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

async function handleLinkedAssetDropped(event) {
  const detail = event;
  if (!detail) return;

  const {
    token_id: tokenId,
    standard = "ERC721",
    resolution: resolutionMode = "latest",
    chainId: eventChainId,
    contractAddress: eventContractAddress,
  } = detail;
  if (!tokenId) return;

  if (detail.assetID) {
    const { showForkOrLiveRefDialog } = await import("../ui/dialog.js");
    const choice = await showForkOrLiveRefDialog(detail.assetID);
    if (!choice) return; // user cancelled

    const { resolveCollectionChildRef } = await import(
      "../blockchain/token-resolver.js"
    );
    const collectionRef = {
      chainId: Number(eventChainId || walletState.get().chainId),
      contractAddress:
        eventContractAddress || walletState.get().contractAddress,
      tokenId,
    };
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

  // Legacy drops without assetID are no longer supported — the caller must
  // include an assetID so the drop handler can route through the collection
  // resolution path above.
  console.warn(
    `[SCENE] linked asset drop ignored: no assetID for token #${tokenId}`
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

/**
 * Return distinct sub-mesh names for a node. Only useful when a GLTF
 * import produced multiple named meshes (e.g. "flowercenter", "Sphere").
 */
function getNodeSubMeshes(nodeId) {
  const meshes = state.nodeMeshes.get(nodeId);
  if (!meshes) return [];
  const seen = new Set();
  const result = [];
  for (const m of meshes) {
    if (m && !m.isDisposed() && m.name && !seen.has(m.name)) {
      seen.add(m.name);
      result.push({ name: m.name, mesh: m });
    }
  }
  return result;
}

function getNodeChildRef(nodeId) {
  const anchor = state.nodeAnchors.get(nodeId);
  if (anchor) {
    // The manifest node itself may be a child_ref (outer anchor carries it).
    if (anchor.metadata?.childRef) {
      return {
        ...anchor.metadata.childRef,
        resolvedCid: anchor.metadata.resolvedCid || null,
      };
    }
    // Otherwise walk up to find a parent child_ref world.
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

  // Fallback for legacy child_token_* anchors.
  if (nodeId && nodeId.startsWith("child_token_")) {
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

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Create-button pulse — subtle empty-state hint on the sidebar Create icon.
// Auto-dismissed on first meaningful interaction.
// ═══════════════════════════════════════════════════════════════════════════

const _chatPulseBtn = document.querySelector(
  '.sidebar-switcher-btn[data-view="chat"]'
);

function dismissCreatePulse() {
  _chatPulseBtn?.classList.remove("pulse");
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

    // Upload thumbnail bytes directly to IPFS — no backend middleman.
    // The browser already writes glTF buffers and textures this way.
    const { writeToIPFS } = await import("../ipfs/write-to-ipfs.js");
    const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
    if (blob.size > THUMBNAIL_MAX_BYTES) {
      throw new Error(`thumbnail too large (${blob.size} bytes)`);
    }
    const cid = await writeToIPFS(blob, `thumbnail.${format}`);
    console.log(`[THUMB] uploaded thumbnail → ${cid} (${blob.size} bytes)`);

    return {
      type: "snapshot",
      cid,
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
  const anchor = createAnchorNode(`anchor_${nodeId}`, state.scene);
  mesh.parent = anchor;
  mesh.metadata = {
    nodeId,
    isNodeRoot: true,
  };
  state.nodeMeshes.set(nodeId, [mesh]);
  state.nodeAnchors.set(nodeId, anchor);
}

on(EVENTS.OUTLINER_REMOVE_REQUESTED, (payload) => {
  // TODO(#18): implement node removal from manifest
  console.warn(
    "[SCENE] outliner:removeRequested not yet implemented for nodeId:",
    payload?.nodeId
  );
});

// Forward outliner clicks to the scene selection system so that
// state.highlightedNodeId is updated and the transform gizmo attaches.
on(EVENTS.OUTLINER_NODE_SELECTED, (e) => {
  const nodeId = e?.nodeId;
  if (nodeId) selectNodeById(nodeId);
});

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

export {
  loadAssetManifest,
  loadCollectionManifest,
  loadNode,
  loadAsset,
  getNodeAnchor,
  getNodeMeshes,
  getNodeSubMeshes,
  getNodeChildRef,
  registerMockNode,
  captureAssetThumbnail,
  dismissCreatePulse,
  deselectAll,
  selectNodeById,
  selectSubMesh,
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

    const { contract } = walletState.get();
    if (assetTokenId && contract) {
      contract.methods
        .tokenURI(assetTokenId)
        .call()
        .then((cid) => {
          if (cid) {
            assetState.set({
              activeAssetTokenId: String(assetTokenId),
              activeCollectionTokenId: String(assetTokenId),
              selectedCollectionId: null,
              activeAssetManifestCid: cid,
              latestAssetManifestCid: cid,
            });
            emit(EVENTS.ASSET_OPEN_BY_TOKEN_ID, { tokenId: assetTokenId });
          }
        })
        .catch(() => {});
    } else if (manifestCid) {
      assetState.set({
        activeAssetManifestCid: manifestCid,
        latestAssetManifestCid: manifestCid,
      });
      loadAssetManifest(manifestCid);
      dismissCreatePulse();
    }

    async function startNewAsset() {
      if (assetState.get().activeAssetManifestCid) {
        const ok = confirm(
          "Start a new asset? Any unsaved changes will be lost."
        );
        if (!ok) return;
      }

      clearScene();
      assetState.set({
        activeAssetManifestCid: null,
        latestAssetManifestCid: null,
        activeAssetTokenId: null,
        activeAssetId: null,
        activeCollectionTokenId: null,
      });

      // Prompt for a name using the GNOME HIG dialog
      let activeAssetName;
      try {
        const { showDialog } = await import("../ui/dialog.js");
        const name = await showDialog(
          "Name Your Asset",
          "Give your new asset a descriptive name.",
          ""
        );
        activeAssetName = (name && name.trim()) || "Untitled Asset";
      } catch {
        activeAssetName = "Untitled Asset";
      }
      assetState.set({ activeAssetName });

      const nameEl = document.getElementById("assetNameDisplay");
      if (nameEl) nameEl.textContent = activeAssetName;
      const statusEl = document.getElementById("assetStatusName");
      if (statusEl) statusEl.textContent = activeAssetName;
      const metaEl = document.getElementById("assetStatusMeta");
      if (metaEl) metaEl.textContent = "Draft Scene";
      emit(EVENTS.SCENE_EMPTY);
      import("/js/ui/sidebar.js").then(function (m) {
        m.switchView("chat");
      });
      var promptInput = document.getElementById("promptInput");
      if (promptInput)
        setTimeout(function () {
          promptInput.focus();
        }, 100);
    }

    const newBtn = document.getElementById("newAssetBtn");
    if (newBtn) newBtn.addEventListener("click", startNewAsset);

    // Ctrl+N / Cmd+N — start a new asset.
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        startNewAsset();
      }
    });

    // Esc — dismiss the create pulse, then future: deselect, close inspector.
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (_chatPulseBtn?.classList.contains("pulse")) {
        e.preventDefault();
        dismissCreatePulse();
      }
    });

    on(EVENTS.ASSET_LINKED_DROPPED, handleLinkedAssetDropped);
  });
})();
