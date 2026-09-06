/**
 * Barrel file: engine init + utilities.
 * @remarks Rendering functions are re-exported from sub-modules for backward
 *   compatibility.
 */

import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import { libraryState } from "../state/library-state.ts";
import { getReadableContract } from "../blockchain/read-contract.ts";
import { state } from "./state.ts";
import { getCssVar, hexToColor4 } from "./theme.ts";
import { clearScene } from "./cleanup.ts";
import {
  resetForNewAsset,
  renameAsset,
  adoptOpenedAsset,
  getActiveAssetManifestCid,
} from "@arbesk/asset-core/domain/asset.js";
import { adoptOpenedCollection } from "@arbesk/asset-core/domain/collection.js";

import {
  selectNode,
  selectSubMesh,
  deselectAll,
  selectNodeById,
  toggleNodeSelection,
  selectAllNodes,
} from "./scene-selection.ts";
import {
  frameAll,
  frameSelected,
  updateCameraRangeForScene,
  updateGridCoverage,
} from "./scene-camera.ts";
import {
  loadAssetManifest,
  handleLinkedAssetDropped,
} from "./scene-loader.ts";
import {
  initCameraPersistence,
  restoreCameraPose,
  hasStoredCameraPose,
  clearStoredCameraPose,
} from "./camera-persistence.ts";
import { resolvePickedNodeId } from "./scene-picking.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Re-exports — backward compatibility
// ═══════════════════════════════════════════════════════════════════════════

export { state, DEFAULT_WOOD_COLOR, MAX_CHILD_ASSET_DEPTH } from "./state.ts";

export {
  extractCid,
  detectAssetFormat,
  getManifestNodes,
  applyTransformMatrix,
  applyDefaultMaterial,
  getRenderableMeshes,
  getWorldBounds,
  centerImportedAsset,
} from "./transforms.ts";

export { createPlaceholder, disposePlaceholder } from "./placeholders.ts";

export {
  disposeNode,
  disposeNodeContent,
  disposeNodeSubtree,
  clearScene,
  clearPendingChildRefs,
  getPendingChildRefs,
  getPendingChildRefRemovals,
  clearPendingChildRefRemovals,
  getPendingPostProcessorEdits,
  clearPendingPostProcessorEdits,
  clearPendingPostProcessorEdit,
  getPendingTransformEdits,
  clearPendingTransformEdits,
  clearPendingTransformEdit,
  getPendingSourceOverrides,
  clearPendingSourceOverrides,
  stagePendingSourceOverride,
  clearPendingSourceOverride,
} from "./cleanup.ts";

export {
  loadAssetManifest,
  loadCollectionManifest,
  loadNode,
  loadAsset,
  waitForPendingLinkedDrops,
  replaceRootModelSource,
  createRootDraftSource,
} from "./scene-loader.ts";
export {
  deselectAll,
  selectNodeById,
  selectSubMesh,
} from "./scene-selection.ts";

// Exported for scene-loader.js

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
 * Viewport-relative panning with damped zoom-out.
 * @remarks Babylon's pan step is a constant world distance per pixel, so on
 *   a large model a drag covers a vanishing fraction of the viewport; the
 *   step is scaled to the visible extent instead.
 */
const PAN_TRACK_EXTENT = 100; // world units of visible height
const PAN_OUT_EXPONENT = 0.35; // damping curve above the tracking threshold

function _updatePanSensibility() {
  const cam = state.camera;
  if (!cam) return;
  // Vertical extent of the perspective frustum at the target distance.
  const extent = Math.max(2 * cam.radius * Math.tan(cam.fov / 2), 0.0001);
  const canvas = state.engine?.getRenderingCanvas();
  const cssHeight = canvas?.clientHeight || 1;
  const stepPerPixel =
    extent <= PAN_TRACK_EXTENT
      ? extent / cssHeight
      : (PAN_TRACK_EXTENT / cssHeight) *
        Math.pow(extent / PAN_TRACK_EXTENT, PAN_OUT_EXPONENT);
  cam.panningSensibility = 1 / stepPerPixel;
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
  camera.upperRadiusLimit = 500;
  // Near plane must stay far below the closest reachable camera distance:
  // updateCameraRangeForScene() drops lowerRadiusLimit to 0.1 for large
  // models, and with the Babylon default minZ of 1 the near plane then
  // slices through walls the camera hugs (straight screen-parallel cuts).
  // Matches the chat-preview cameras.
  camera.minZ = 0.01;
  // Proportional wheel zoom: the step is a percentage of the current radius,
  // so zoom speed scales with how far out the camera is — large models get
  // large steps, small models keep a gentle feel. wheelPrecision (an absolute
  // step in world units) is ignored once wheelDeltaPercentage is set.
  camera.wheelDeltaPercentage = 0.01;
  camera.pinchDeltaPercentage = 0.01;
  // Tame post-release glide: with viewport-scaled pan steps (see
  // _updatePanSensibility) the default 0.9 inertia overshoots badly when
  // zoomed out, where each pixel is a large world step.
  camera.panningInertia = 0.6;
  camera.attachControl(canvas, true);
  state.camera = camera;
  initCameraPersistence(camera);

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
    console.warn("[SCENE] grid failed:", ((e as Error)).message);
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
    console.warn("[SCENE] axes failed:", ((e as Error)).message);
  }

  // Blender-style 2D orientation gizmo (top-right corner overlay).
  import("../ui/viewport-gizmo.ts")
    .then(({ initViewportGizmo }) => {
      initViewportGizmo(state.scene, camera);
      console.log("[SCENE] viewport gizmo initialized");
    })
    .catch((e) => {
      console.warn("[SCENE] viewport gizmo init failed:", e.message);
    });

  // Transform gizmo (move/rotate/scale) for the selected node.
  import("../ui/transform-gizmo.ts")
    .then(({ initTransformGizmo }) => {
      initTransformGizmo(state.scene, camera);
      console.log("[SCENE] transform gizmo initialized");
    })
    .catch((e) => {
      console.warn("[SCENE] transform gizmo init failed:", e.message);
    });

  // Model clock (version dial above the selected node).
  import("../ui/model-clock-gizmo.ts")
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
    _updatePanSensibility();
    updateGridCoverage();
    state.scene.render();
  };
  state.engine.runRenderLoop(state.renderLoopFn);

  // Also resize immediately on window resize and canvas ResizeObserver so
  // non-render-loop code (e.g. screenshots) sees the updated size right away.
  function resizeEngine() {
    if (!state.engine || !state.scene) return;
    state.engine.resize();
  }

  state.resizeEngineHandler = resizeEngine;
  window.addEventListener("resize", resizeEngine);

  state.resizeObserverInstance = new ResizeObserver(() => resizeEngine());
  state.resizeObserverInstance.observe(canvas);

  // Click-to-select. Single click selects/highlight; double-click opens the
  // Properties inspector. Track the last click to detect double-clicks.
  const DOUBLE_CLICK_MS = 300;
    let lastClickNodeId: string|null = null;
  let lastClickTime = 0;

  // Store the callback so it can be removed later
  /** @param {BABYLON.PointerInfo} pointerInfo */
  state.pointerObservableCallback = (pointerInfo) => {
    const pickResult = pointerInfo.pickInfo;
    if (pickResult.hit && pickResult.pickedMesh) {
      const mesh = pickResult.pickedMesh;
      // Walk the full parent chain: first nodeId for regular nodes, or the
      // childRef boundary for child assets (see scene-picking.ts).
      const { target, resolvedNodeId, isChildAssetNode } =
        resolvePickedNodeId(mesh);

      const now = Date.now();
      const isDoubleClick =
        resolvedNodeId &&
        resolvedNodeId === lastClickNodeId &&
        now - lastClickTime < DOUBLE_CLICK_MS;
      lastClickNodeId = resolvedNodeId || null;
      lastClickTime = now;

      if (resolvedNodeId) {
        // Ctrl/Cmd+click toggles the node in/out of the multi-selection;
        // it never triggers sub-mesh toggle or double-click dive/inspector.
        const domEvent = pointerInfo.event;
        if (domEvent && (domEvent.ctrlKey || domEvent.metaKey)) {
          toggleNodeSelection(resolvedNodeId, target);
          return;
        }

        if (isDoubleClick) {
          // Double-click opens the inspector; don't run the single-click
          // sub-mesh toggle on the second click.
          selectNode(resolvedNodeId, target);
          emit(EVENTS.NODE_DOUBLE_CLICKED, { nodeId: resolvedNodeId, mesh });
          return;
        }

        if (
          resolvedNodeId === state.highlightedNodeId &&
          state.selectedNodeIds.size === 1
        ) {
          // Sub-mesh toggle only applies to regular (non-child-asset) nodes
          // and is a single-selection feature.
          if (!isChildAssetNode && mesh.name) {
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

  // Ctrl/Cmd+A — select all loaded scene nodes (multi-select).
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== "a") return;
    const activeEl = (document.activeElement as HTMLElement|null);
    const tag = activeEl?.tagName?.toLowerCase();
    const editable =
      activeEl?.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select";
    if (editable) return; // don't steal select-all from form fields
    const ids = [...state.nodeAnchors.keys()];
    if (ids.length === 0) return;
    e.preventDefault();
    selectAllNodes(ids);
  });

  // Keyboard shortcuts — only fire when focus is on the canvas or body
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const activeEl = (document.activeElement as HTMLElement|null);
    const tag = activeEl?.tagName?.toLowerCase();
    const editable =
      activeEl?.isContentEditable ||
      tag === "input" ||
      tag === "textarea" ||
      tag === "select";
    if (editable) return; // don't steal keystrokes from form fields

    switch (e.key) {
      case "Escape":
        if (state.selectedNodeIds.size > 0) {
          e.preventDefault();
          deselectAll();
        }
        break;
      case "Home":
        e.preventDefault();
        frameAll();
        break;
      case "0":
        e.preventDefault();
        // Forget the saved pose, then re-frame — same view as a first load.
        clearStoredCameraPose();
        frameAll();
        break;
      case "f":
        if (state.selectedNodeIds.size > 0) {
          e.preventDefault();
          frameSelected();
        }
        break;
      case "g":
        e.preventDefault();
        // Module is already cached once the toolbar exists — no load cost.
        import("../ui/transform-gizmo.ts").then((m) => m.toggleGrid());
        break;
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Node accessors
// ═══════════════════════════════════════════════════════════════════════════

function getNodeAnchor(nodeId: string) {
  return state.nodeAnchors.get(nodeId) || null;
}

function getNodeMeshes(nodeId: string) {
  return state.nodeMeshes.get(nodeId) || [];
}

/**
 * Returns distinct sub-mesh names for a node.
 * @remarks Only useful when a glTF import produced multiple named meshes.
 */
function getNodeSubMeshes(nodeId: string) {
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

function getNodeChildRef(nodeId: string) {
  const anchor = state.nodeAnchors.get(nodeId);
  if (anchor) {
    // The manifest node itself may be a child_ref (outer anchor carries it).
    if (anchor.metadata?.childRef) {
      return {
        ...anchor.metadata.childRef,
        resolvedCid: anchor.metadata.resolvedCid || null,
      };
    }
    // Otherwise walk up to find a parent child_ref asset.
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

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function captureAssetThumbnail(options: { width?: number; height?: number; quality?: number; format?: string } = {}) {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
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
    const { writeToIPFS } = await import("../ipfs/write-to-ipfs.ts");
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
    console.warn("[THUMB] capture failed:", ((err as Error)).message);
    return null;
  }
}

// Forward outliner clicks to the scene selection system so that
// state.highlightedNodeId is updated and the transform gizmo attaches.
// `additive: true` (Ctrl/Cmd+click in the outliner) toggles membership in
// the multi-selection instead of collapsing it to a single node.
on(EVENTS.OUTLINER_NODE_SELECTED, (e: {nodeId?: string, additive?: boolean}) => {
  const nodeId = e?.nodeId;
  if (!nodeId) return;
  if (e.additive) {
    toggleNodeSelection(nodeId, null);
  } else {
    selectNodeById(nodeId);
  }
});

// After a manifest finishes loading, adapt the camera zoom range and viewport
// chrome to the model's real-world size (huge models are unviewable within
// the default radius limit of 500). Then: assets with a saved camera pose
// restore it; assets without one get framed whole. Framing unconditionally
// here once stomped the restored pose — keep the two paths exclusive.
on(EVENTS.SCENE_READY, (e: { manifestCid?: string }) => {
  updateCameraRangeForScene();
  if (e?.manifestCid && hasStoredCameraPose(e.manifestCid)) {
    restoreCameraPose(e.manifestCid);
  } else {
    frameAll();
  }
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
 * Stops the render loop while the Studio view is hidden (Library is active).
 * @remarks Avoids burning GPU/CPU on a hidden 0×0 canvas; the engine and
 *   scene are kept alive.
 */
export function pauseRenderLoop() {
  state.engine?.stopRenderLoop();
}

/**
 * Restarts the render loop when the Studio view becomes visible and resizes
 * the engine.
 * @remarks The canvas was hidden (0×0) while Library was active, so the
 *   drawing buffer must catch up before the next frame.
 */
export function resumeRenderLoop() {
  if (!state.engine || !state.renderLoopFn) return;
  state.engine.stopRenderLoop();
  state.engine.runRenderLoop(state.renderLoopFn);
  state.engine.resize();
}

/**
 * Loads the asset/manifest the current URL points at (?asset / ?manifest).
 * @remarks Anonymous deep links (public profiles) have no wallet contract, so
 *   the tokenURI read falls back to a read-only contract.
 */
export async function loadFromParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const manifestCid = urlParams.get("manifest");
  const assetTokenId = urlParams.get("asset");
  // The specific asset within a collection. Carried through in the event so the
  // asset-library handler opens that asset, not just the collection. On a full
  // page load asset-library reads this from the URL itself, but on an SPA
  // pushState handoff (Library → Studio) it does not re-read, so we pass it.
  const assetId = urlParams.get("assetId");

  if (assetTokenId) {
    // A profile subject's tokens may live on a different chain than the
    // viewer's wallet — read on the resolved subject chain when one is active.
    const subj = libraryState.get();
    const readChainId =
      subj.subjectAddress && subj.subjectChainId
        ? subj.subjectChainId
        : undefined;
    const contract = readChainId
      ? await getReadableContract(readChainId)
      : walletState.get().contract || (await getReadableContract());
    if (!contract) return;
    try {
      const cid: string | null = await contract.read.tokenURI([
        BigInt(assetTokenId),
      ]);
      if (cid) {
        adoptOpenedAsset(cid, { tokenId: String(assetTokenId) });
        adoptOpenedCollection(String(assetTokenId), { clearSelectedCollection: true });
        emit(EVENTS.ASSET_OPEN_BY_TOKEN_ID, {
          tokenId: assetTokenId,
          assetId: assetId || null,
        });
      }
    } catch {}
  } else if (manifestCid) {
    adoptOpenedAsset(manifestCid);
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
      if (getActiveAssetManifestCid()) {
        const ok = confirm(
          "Start a new asset? Any unsaved changes will be lost."
        );
        if (!ok) return;
      }

      clearScene();
      resetForNewAsset();
      // Emit before writing the new name below: SCENE_EMPTY re-renders the
      // header chrome ("No asset open" — ui/asset-chrome.js), which is
      // correct for the library close-out path but must not clobber the
      // fresh draft name.
      emit(EVENTS.SCENE_EMPTY);

      // Prompt for a name using the GNOME HIG dialog
      let activeAssetName;
      try {
        const { showDialog } = await import("../ui/dialog.ts");
        const name = await showDialog(
          "Name Your Asset",
          "Give your new asset a descriptive name.",
          ""
        );
        activeAssetName = (name && name.trim()) || "Untitled Asset";
      } catch {
        activeAssetName = "Untitled Asset";
      }
      renameAsset(activeAssetName);

      const nameEl = document.getElementById("assetNameDisplay");
      if (nameEl) nameEl.textContent = activeAssetName;
      import("../ui/sidebar.ts").then(function (m) {
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
