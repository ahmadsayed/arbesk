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

/**
 * True when a stored pose exists for the currently-open asset.
 * @remarks Read-only — does not apply, flush, or settle.
 */
export function hasStoredCameraPose(fallbackCid?: string): boolean {
  const key = _poseStorageKey(fallbackCid ?? null);
  return key ? _readPose(key) !== null : false;
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
