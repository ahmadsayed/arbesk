/**
 * Persists the viewport camera pose in localStorage, keyed per asset.
 * @remarks Keyed per asset (not per manifest version) so the pose follows the
 *   asset across publishes and restores; unsaved drafts fall back to a per-CID
 *   key. Storage failures are ignored (best-effort). The storage key is
 *   snapshotted when the move happens (never the debounced write), so a pose
 *   is never written under a later asset's key. Assets with no stored pose get
 *   the default view, and the pending write is flushed on tab close/hide.
 */

import { state } from "./state.ts";
import {
  getActiveAssetManifestCid,
  getActiveAssetTokenId,
  getActiveAssetId,
} from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../state/wallet-state.ts";
import { getRenderableMeshes, getWorldBounds } from "./transforms.ts";

const STORAGE_PREFIX = "arbesk:cameraPose:";
const SAVE_DEBOUNCE_MS = 1000;

interface StoredCameraPose {
  alpha: number;
  beta: number;
  radius: number;
  target: [number, number, number];
}

/**
 * Starting view for assets with no stored pose.
 * @remarks Must match the camera creation values in initEngine().
 */
const DEFAULT_POSE: StoredCameraPose = {
  alpha: -Math.PI / 2,
  beta: Math.PI / 3,
  radius: 15,
  target: [0, 0, 0],
};

/**
 * Storage key for the currently-open asset: the canonical asset identity when
 * it has one, otherwise the unsaved draft's manifest CID.
 */
function _poseStorageKey(fallbackCid: string | null): string | null {
  const tokenId = getActiveAssetTokenId();
  if (tokenId) {
    const { chainId, contractAddress } = walletState.get();
    const assetId = getActiveAssetId() || "root";
    if (chainId && contractAddress) {
      return `${chainId}:${contractAddress.toLowerCase()}:${tokenId}:${assetId}`;
    }
    return `token:${tokenId}:${assetId}`;
  }
  const cid = getActiveAssetManifestCid() || fallbackCid;
  return cid ? `cid:${cid}` : null;
}

function _readPose(key: string): StoredCameraPose | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const pose = JSON.parse(raw);
    if (
      typeof pose?.alpha !== "number" ||
      typeof pose?.beta !== "number" ||
      typeof pose?.radius !== "number" ||
      !Array.isArray(pose?.target) ||
      pose.target.length !== 3 ||
      pose.target.some((v: unknown) => typeof v !== "number")
    ) {
      return null;
    }
    return pose;
  } catch {
    return null;
  }
}

function _writePose(key: string, pose: StoredCameraPose) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(pose));
  } catch {
    // Quota exceeded or storage disabled — persistence is best-effort.
  }
}

function _applyPose(camera: BABYLON.ArcRotateCamera, pose: StoredCameraPose) {
  // Cancel leftover inertia and in-flight camera animations FIRST. Babylon
  // ADDS inertial offsets to the camera every frame (decaying at 0.9), so a
  // gesture from the previous asset/view would otherwise keep dragging the
  // camera away from the restored pose — and the drifted pose then gets
  // saved over the good one.
  camera.inertialAlphaOffset = 0;
  camera.inertialBetaOffset = 0;
  camera.inertialRadiusOffset = 0;
  camera.inertialPanningX = 0;
  camera.inertialPanningY = 0;
  camera.getScene()?.stopAnimation(camera);

  camera.alpha = pose.alpha;
  camera.beta = pose.beta;
  camera.radius = pose.radius;
  camera.target = new BABYLON.Vector3(
    pose.target[0],
    pose.target[1],
    pose.target[2]
  );
}

/**
 * Frames to keep enforcing a freshly restored pose.
 * @remarks Babylon v9's per-frame camera writers keep dragging the camera
 *   after a restore, long enough that the drifted pose gets saved over the
 *   good one.
 */
const SETTLE_FRAMES = 90;

function _settlePose(camera: BABYLON.ArcRotateCamera, pose: StoredCameraPose) {
  const scene = camera.getScene();
  if (!scene) return;

  let frames = 0;
  const stop = () => {
    if (renderObs) scene.onAfterRenderObservable.remove(renderObs);
    if (pointerObs) scene.onPointerObservable.remove(pointerObs);
    renderObs = null;
    pointerObs = null;
  };
  let renderObs: any = scene.onAfterRenderObservable.add(() => {
    if (++frames > SETTLE_FRAMES) {
      stop();
      return;
    }
    _applyPose(camera, pose);
  });
  let pointerObs: any = scene.onPointerObservable.add((pi: any) => {
    if (
      pi.type === BABYLON.PointerEventTypes.POINTERDOWN ||
      pi.type === BABYLON.PointerEventTypes.POINTERWHEEL
    ) {
      stop();
    }
  });
}

/** Pose captured at move time, waiting for the debounce window to elapse. */
let _pendingSave: { key: string; pose: StoredCameraPose } | null = null;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

function _flushPendingSave() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (_pendingSave) {
    _writePose(_pendingSave.key, _pendingSave.pose);
    _pendingSave = null;
  }
}

/**
 * Starts persisting the camera pose on every view change (debounced to one
 * write per second).
 */
export function initCameraPersistence(camera: BABYLON.ArcRotateCamera) {
  camera.onViewMatrixChangedObservable.add(() => {
    // Snapshot the key AND pose now — the write may fire after the user has
    // switched assets, and must still land under this asset's key.
    const key = _poseStorageKey(null);
    if (!key) return;

    const pose: StoredCameraPose = {
      alpha: camera.alpha,
      beta: camera.beta,
      radius: camera.radius,
      target: [camera.target.x, camera.target.y, camera.target.z],
    };
    _pendingSave = { key, pose };

    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushPendingSave, SAVE_DEBOUNCE_MS);
  });

  // The debounce timer dies with the page — flush so the last movement
  // before closing/hiding the tab is still persisted.
  window.addEventListener("beforeunload", _flushPendingSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") _flushPendingSave();
  });
}

/** The loaded model's centre and size, as the camera range sees it. */
interface ModelExtent {
  center: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
}

/**
 * True when a stored pose no longer fits the loaded model.
 * @remarks Poses outlive the geometry they were saved for: 3MF parts once
 *   rendered 1000× larger (millimetres as scene units) and older ones were
 *   placed ~20 m up, so their saved views now point at empty space. A pose is
 *   stale when its radius is beyond the zoom range updateCameraRangeForScene
 *   allows for this model, or when its target is so far from the model that
 *   the model is out of view (further than the camera distance, with a
 *   10×-size margin).
 */
function isStaleCameraPose(pose: StoredCameraPose, extent: ModelExtent): boolean {
  const maxDim = Math.max(extent.size.x, extent.size.y, extent.size.z);
  const maxRadius = Math.max(50, maxDim * 10); // mirrors updateCameraRangeForScene
  if (pose.radius > maxRadius * 1.01) return true;
  const [tx, ty, tz] = pose.target;
  const offset = Math.hypot(
    tx - extent.center.x,
    ty - extent.center.y,
    tz - extent.center.z
  );
  return offset > Math.max(maxDim * 10, pose.radius);
}

/** World extent of the scene's renderable, non-chrome meshes, if any. */
function _sceneExtent(): ModelExtent | null {
  const meshes = (state.scene?.meshes ?? []).filter(
    (m: BABYLON.AbstractMesh) => m && !m.isDisposed() && !m.metadata?.isViewportChrome
  );
  const renderable = getRenderableMeshes(meshes);
  return renderable.length > 0 ? getWorldBounds(renderable) : null;
}

/**
 * True when a usable stored pose exists for the currently-open asset.
 * @remarks Does not apply, flush, or settle. A stale pose (see
 *   isStaleCameraPose) is forgotten here, so the caller frames the asset
 *   instead of restoring a view of empty space.
 */
export function hasStoredCameraPose(fallbackCid?: string): boolean {
  const key = _poseStorageKey(fallbackCid ?? null);
  const pose = key ? _readPose(key) : null;
  if (!key || !pose) return false;
  const extent = _sceneExtent();
  if (extent && isStaleCameraPose(pose, extent)) {
    console.log(`[CAMERA] discarding stale stored pose | key=${key} radius=${pose.radius}`);
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      // Best-effort, same as writes — storage may be unavailable.
    }
    return false;
  }
  return true;
}

/**
 * Forgets the stored camera pose for the currently-open asset.
 * @remarks The next load frames the asset whole, and any pending debounced
 *   write is dropped so it cannot rewrite the pose right after the clear.
 */
export function clearStoredCameraPose(): void {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  _pendingSave = null;
  const key = _poseStorageKey(null);
  if (!key) return;
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Best-effort, same as writes — storage may be unavailable.
  }
}

/**
 * Restores the stored camera pose for the currently-open asset, if any.
 * @remarks Snaps instantly (no animation); assets with no stored pose get the
 *   default view so a scene never inherits the previous scene's camera.
 * @returns true when a stored pose was applied.
 */
export function restoreCameraPose(fallbackCid?: string): boolean {
  const camera = state.camera;
  if (!camera) return false;

  const key = _poseStorageKey(fallbackCid ?? null);
  if (!key) return false;

  // Land the PREVIOUS asset's pending pose BEFORE applying the restore —
  // _applyPose fires onViewMatrixChanged, whose echo capture would otherwise
  // overwrite that pending write and silently lose the user's last movement.
  _flushPendingSave();

  const pose = _readPose(key);
  if (!pose) {
    _applyPose(camera, DEFAULT_POSE);
    _settlePose(camera, DEFAULT_POSE);
    return false;
  }

  _applyPose(camera, pose);
  _settlePose(camera, pose);
  return true;
}
