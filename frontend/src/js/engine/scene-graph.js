/**
 * Arbesk Scene Graph
 *
 * Barrel file: engine init + utilities.
 * Rendering functions are imported from sub-modules and re-exported
 * for backward compatibility.
 */

import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { state } from "./state.js";
import { getCssVar, hexToColor4 } from "./theme.js";
import { clearScene } from "./cleanup.js";
import { getStateForNewAsset } from "../utils/new-asset.js";

import {
  selectNode,
  selectSubMesh,
  deselectAll,
  selectNodeById,
} from "./scene-selection.js";
import {
  frameAll,
  frameSelected,
  snapView,
  VIEW_FRONT,
  VIEW_RIGHT,
  VIEW_TOP,
} from "./scene-camera.js";
import {
  loadAssetManifest,
  handleLinkedAssetDropped,
} from "./scene-loader.js";

// ═══════════════════════════════════════════════════════════════════════════
// Re-exports — backward compatibility
// ═══════════════════════════════════════════════════════════════════════════

export { state, DEFAULT_WOOD_COLOR, MAX_CHILD_WORLD_DEPTH } from "./state.js";

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

export { createPlaceholder, disposePlaceholder } from "./placeholders.js";

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

export {
  loadAssetManifest,
  loadCollectionManifest,
  loadNode,
  loadAsset,
  waitForPendingLinkedDrops,
} from "./scene-loader.js";
export {
  deselectAll,
  selectNodeById,
  selectSubMesh,
} from "./scene-selection.js";

// Exported for scene-loader.js
export { createAnchorNode };

// ═══════════════════════════════════════════════════════════════════════════
// Theme listener
// ═══════════════════════════════════════════════════════════════════════════

function _syncViewportBackground() {
  if (!state.scene) return;
  const viewportBg = getCssVar("--viewport-bg") || "#1e1e1e";
  state.scene.clearColor =
    hexToColor4(viewportBg, 1) || new BABYLON.Color4(0.118, 0.118, 0.118, 1);
}

// Re-sync viewport background when the user toggles light / dark mode.
on(EVENTS.THEME_CHANGED, _syncViewportBackground);

// ═══════════════════════════════════════════════════════════════════════════
// Engine initialization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * When the canvas aspect ratio changes while the camera is in orthographic
 * mode, the explicitly-set frustum becomes stale and the scene stretches.
 * Re-balance the frustum so the smaller dimension is preserved and the larger
 * one is expanded to match the new canvas aspect ratio.
 */
function _updateOrthoFrustumOnResize() {
  const cam = state.camera;
  if (
    !cam ||
    cam.mode !== BABYLON.Camera.ORTHOGRAPHIC_CAMERA ||
    cam.orthoLeft == null ||
    cam.orthoRight == null ||
    cam.orthoBottom == null ||
    cam.orthoTop == null
  ) {
    return;
  }

  const canvas = state.engine.getRenderingCanvas();
  if (!canvas || canvas.height === 0) return;

  const halfW = (cam.orthoRight - cam.orthoLeft) / 2;
  const halfH = (cam.orthoTop - cam.orthoBottom) / 2;
  if (halfW === 0 || halfH === 0) return;

  const canvasAspect = canvas.width / canvas.height;
  const frustumAspect = halfW / halfH;

  let newHalfW = halfW;
  let newHalfH = halfH;
  if (canvasAspect > frustumAspect) {
    newHalfW = halfH * canvasAspect;
  } else {
    newHalfH = halfW / canvasAspect;
  }

  cam.orthoLeft = -newHalfW;
  cam.orthoRight = newHalfW;
  cam.orthoBottom = -newHalfH;
  cam.orthoTop = newHalfH;
}

/**
 * @param {string} name
 * @param {BABYLON.Scene} scene
 * @returns {BABYLON.TransformNode | BABYLON.Mesh}
 */
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

export function initEngine() {
  // Idempotent: in the SPA the router may call this on every Studio entry, but
  // the engine must be created exactly once and then kept alive.
  if (state.engine) return;

  const canvas = document.getElementById("renderCanvas");
  if (!canvas) {
    // Defensive: the single-page shell always has #renderCanvas, but keep the
    // guard so importing this module in a non-Studio context is harmless.
    console.log("[SCENE] renderCanvas not present — skipping 3D engine init");
    return;
  }

  state.engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });

  state.scene = new BABYLON.Scene(state.engine);
  // Sync viewport background with the current SCSS theme token.
  _syncViewportBackground();

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
    console.warn("[SCENE] grid failed:", (/** @type {Error} */ (e)).message);
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
    console.warn("[SCENE] axes failed:", (/** @type {Error} */ (e)).message);
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

  // Model clock (version dial above the selected node).
  import("../ui/model-clock-gizmo.js")
    .then(({ initModelClockGizmo }) => {
      initModelClockGizmo(state.scene, camera);
      console.log("[SCENE] model clock gizmo initialized");
    })
    .catch((e) => {
      console.warn("[SCENE] model clock gizmo init failed:", e.message);
    });

  // Resize the drawing buffer at the start of every render loop iteration so
  // the camera always uses the current canvas CSS size. Doing this only in
  // window/ResizeObserver handlers leaves a one-frame race during CSS
  // transitions (e.g. sidebar collapse) where a render can use the new canvas
  // size with the old projection matrix and show stretching.
  // Stored on state so the router can pause/resume the exact same callback when
  // toggling between the Studio and Library views.
  state.renderLoopFn = () => {
    state.engine.resize();
    _updateOrthoFrustumOnResize();
    state.scene.render();
  };
  state.engine.runRenderLoop(state.renderLoopFn);

  // Also resize immediately on window resize and canvas ResizeObserver so
  // non-render-loop code (e.g. screenshots) sees the updated size right away.
  function resizeEngine() {
    if (!state.engine || !state.scene) return;
    state.engine.resize();
    _updateOrthoFrustumOnResize();
  }

  state.resizeEngineHandler = resizeEngine;
  window.addEventListener("resize", resizeEngine);

  state.resizeObserverInstance = new ResizeObserver(() => resizeEngine());
  state.resizeObserverInstance.observe(canvas);

  // Click-to-select. Single click selects/highlight; double-click opens the
  // Properties inspector. Track the last click to detect double-clicks.
  const DOUBLE_CLICK_MS = 300;
  /** @type {string|null} */
  let lastClickNodeId = null;
  let lastClickTime = 0;

  // Store the callback so it can be removed later
  /** @param {BABYLON.PointerInfo} pointerInfo */
  state.pointerObservableCallback = (pointerInfo) => {
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

      const now = Date.now();
      const isDoubleClick =
        resolvedNodeId &&
        resolvedNodeId === lastClickNodeId &&
        now - lastClickTime < DOUBLE_CLICK_MS;
      lastClickNodeId = resolvedNodeId || null;
      lastClickTime = now;

      if (resolvedNodeId) {
        if (isDoubleClick) {
          // Double-click opens the inspector; don't run the single-click
          // sub-mesh toggle on the second click.
          selectNode(resolvedNodeId, target);
          emit(EVENTS.NODE_DOUBLE_CLICKED, { nodeId: resolvedNodeId, mesh });
          return;
        }

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
    // Clicked empty space → deselect.
    if (state.highlightedNodeId) {
      deselectAll();
    }
  };
  state.scene.onPointerObservable.add(
    state.pointerObservableCallback,
    BABYLON.PointerEventTypes.POINTERPICK
  );

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
    const activeEl = /** @type {HTMLElement|null} */ (document.activeElement);
    const tag = activeEl?.tagName?.toLowerCase();
    const editable =
      activeEl?.isContentEditable ||
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

// ═══════════════════════════════════════════════════════════════════════════
// Node accessors
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string} nodeId
 * @returns {BABYLON.TransformNode | null}
 */
function getNodeAnchor(nodeId) {
  return state.nodeAnchors.get(nodeId) || null;
}

/**
 * @param {string} nodeId
 * @returns {BABYLON.AbstractMesh[]}
 */
function getNodeMeshes(nodeId) {
  return state.nodeMeshes.get(nodeId) || [];
}

/**
 * Return distinct sub-mesh names for a node. Only useful when a GLTF
 * import produced multiple named meshes (e.g. "flowercenter", "Sphere").
 *
 * @param {string} nodeId
 * @returns {Array<{name: string, mesh: BABYLON.AbstractMesh}>}
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

/**
 * @param {string} nodeId
 * @returns {any | null}
 */
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

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} type
 * @param {number} quality
 * @returns {Promise<Blob|null>}
 */
function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * @param {{width?: number, height?: number, quality?: number, format?: string}} [options]
 * @returns {Promise<object|null>}
 */
async function captureAssetThumbnail(options = {}) {
  const canvas = /** @type {HTMLCanvasElement|null} */ (
    document.getElementById("renderCanvas")
  );
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
    console.warn("[THUMB] capture failed:", (/** @type {Error} */ (err)).message);
    return null;
  }
}

on(EVENTS.OUTLINER_REMOVE_REQUESTED, (/** @type {{nodeId?: string}} */ payload) => {
  // TODO(#18): implement node removal from manifest
  console.warn(
    "[SCENE] outliner:removeRequested not yet implemented for nodeId:",
    payload?.nodeId
  );
});

// Forward outliner clicks to the scene selection system so that
// state.highlightedNodeId is updated and the transform gizmo attaches.
on(EVENTS.OUTLINER_NODE_SELECTED, (/** @type {{nodeId?: string}} */ e) => {
  const nodeId = e?.nodeId;
  if (nodeId) selectNodeById(nodeId);
});

// ═══════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════

export {
  getNodeAnchor,
  getNodeMeshes,
  getNodeSubMeshes,
  getNodeChildRef,
  captureAssetThumbnail,
  dismissCreatePulse,
};

// ═══════════════════════════════════════════════════════════════════════════
// Render-loop lifecycle (SPA view switching)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stop the render loop while the Studio view is hidden (Library is active) so a
 * hidden 0×0 canvas doesn't burn GPU/CPU. The engine and scene are kept alive.
 */
export function pauseRenderLoop() {
  state.engine?.stopRenderLoop();
}

/**
 * Restart the render loop when the Studio view becomes visible again and resize
 * the engine — the canvas was hidden (0×0) while Library was active, so the
 * drawing buffer needs to catch up before the next frame.
 */
export function resumeRenderLoop() {
  if (!state.engine || !state.renderLoopFn) return;
  state.engine.stopRenderLoop();
  state.engine.runRenderLoop(state.renderLoopFn);
  state.engine.resize();
  _updateOrthoFrustumOnResize();
}

/**
 * Load whatever asset/manifest the current URL points at (?asset / ?manifest).
 * Extracted from the old DOMContentLoaded bootstrap so the router can invoke it
 * on Studio entry — both on a cold deep-link and on the Library → Studio handoff.
 */
export function loadFromParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const manifestCid = urlParams.get("manifest");
  const assetTokenId = urlParams.get("asset");
  // The specific asset within a collection. Carried through in the event so the
  // asset-library handler opens that asset, not just the collection. On a full
  // page load asset-library reads this from the URL itself, but on an SPA
  // pushState handoff (Library → Studio) it does not re-read, so we pass it.
  const assetId = urlParams.get("assetId");

  const { contract } = walletState.get();
  if (assetTokenId && contract) {
    contract.methods
      .tokenURI(assetTokenId)
      .call()
      .then((/** @type {string|null} */ cid) => {
        if (cid) {
          assetState.set({
            activeAssetTokenId: String(assetTokenId),
            activeCollectionTokenId: String(assetTokenId),
            selectedCollectionId: null,
            activeAssetManifestCid: cid,
            latestAssetManifestCid: cid,
          });
          emit(EVENTS.ASSET_OPEN_BY_TOKEN_ID, {
            tokenId: assetTokenId,
            assetId: assetId || null,
          });
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
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM initialization
// ═══════════════════════════════════════════════════════════════════════════

(function init() {
  if (typeof document === "undefined") return;
  document.addEventListener("DOMContentLoaded", () => {
    // NOTE: engine creation (initEngine) and URL-driven asset loading
    // (loadFromParams) are now owned by the router (app/router.js) so the
    // Babylon engine is created lazily on first Studio entry, not on every page
    // load. This block only wires the Studio-view UI handlers.

    async function startNewAsset() {
      if (assetState.get().activeAssetManifestCid) {
        const ok = confirm(
          "Start a new asset? Any unsaved changes will be lost."
        );
        if (!ok) return;
      }

      clearScene();
      assetState.set(getStateForNewAsset(assetState.get()));

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
      import("../ui/sidebar.js").then(function (m) {
        m.switchView("chat");
      });
      const promptInput = document.getElementById("promptInput");
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
