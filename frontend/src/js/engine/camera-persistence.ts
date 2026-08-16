/**
 * Camera pose persistence
 *
 * Stores the viewport camera pose (orbit angles, radius, target, ortho
 * frustum) in localStorage, keyed per ASSET (chain:contract:token:assetId),
 * not per manifest version — the pose follows the asset across publishes and
 * version-history restores. Reopening the same asset in the same browser
 * restores the exact view the user left it in. Unsaved drafts (no on-chain
 * identity) fall back to a per-manifest-CID key. Best-effort: storage
 * failures (private mode, quota) are silently ignored.
 *
 * Correctness notes:
 * - The storage key is snapshotted WHEN THE MOVE HAPPENS, not when the
 *   debounced write fires — so a pose can never be written under the key of
 *   an asset the user switched to in the meantime.
 * - Assets with no stored pose get the default starting view on load, so a
 *   scene never inherits the camera of whatever was open before it.
 * - The pending write is flushed on tab close/hide so the last second of
 *   movement isn't lost.
 */

import { state } from "./state.ts";
import {
  getActiveAssetManifestCid,
  getActiveAssetTokenId,
  getActiveAssetId,
} from "../domain/asset.ts";
import { walletState } from "../state/wallet-state.ts";

const STORAGE_PREFIX = "arbesk:cameraPose:";
const SAVE_DEBOUNCE_MS = 1000;

interface StoredCameraPose {
  alpha: number;
  beta: number;
  radius: number;
  target: [number, number, number];
  mode: number;
  orthoLeft?: number | null;
  orthoRight?: number | null;
  orthoBottom?: number | null;
  orthoTop?: number | null;
}

/**
 * Starting view for assets with no stored pose. Must match the camera
 * creation values in initEngine() (scene-graph.ts).
 */
const DEFAULT_POSE: StoredCameraPose = {
  alpha: -Math.PI / 2,
  beta: Math.PI / 3,
  radius: 15,
  target: [0, 0, 0],
  mode: 0, // BABYLON.Camera.PERSPECTIVE_CAMERA
};

/**
 * Storage key for the currently-open asset: the canonical asset identity
 * when it has one, otherwise the manifest CID of the unsaved draft.
 *
 * @param fallbackCid - manifest CID to use when no asset identity exists
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
  camera.alpha = pose.alpha;
  camera.beta = pose.beta;
  camera.radius = pose.radius;
  camera.target = new BABYLON.Vector3(
    pose.target[0],
    pose.target[1],
    pose.target[2]
  );

  if (
    pose.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA &&
    pose.orthoLeft != null &&
    pose.orthoRight != null &&
    pose.orthoBottom != null &&
    pose.orthoTop != null
  ) {
    camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = pose.orthoLeft;
    camera.orthoRight = pose.orthoRight;
    camera.orthoBottom = pose.orthoBottom;
    camera.orthoTop = pose.orthoTop;
  } else {
    camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
  }
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
 * Start persisting the camera pose on every view change (debounced to one
 * write per second). Call once after the camera is created in initEngine().
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
      mode: camera.mode,
    };
    if (camera.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA) {
      pose.orthoLeft = camera.orthoLeft;
      pose.orthoRight = camera.orthoRight;
      pose.orthoBottom = camera.orthoBottom;
      pose.orthoTop = camera.orthoTop;
    }
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
 * Restore the stored camera pose for the currently-open asset, if any.
 * Snaps instantly (no animation) so the view lands exactly where the user
 * left it. Assets with no stored pose get the default starting view, so a
 * scene never inherits the previous scene's camera.
 *
 * @param fallbackCid - manifest CID to fall back on when the asset has no
 *                      on-chain identity yet
 * @returns true when a stored pose was applied
 */
export function restoreCameraPose(fallbackCid?: string): boolean {
  const camera = state.camera;
  if (!camera) return false;

  const key = _poseStorageKey(fallbackCid ?? null);
  if (!key) return false;

  const pose = _readPose(key);
  if (!pose) {
    _applyPose(camera, DEFAULT_POSE);
    return false;
  }

  _applyPose(camera, pose);
  console.log(`[CAMERA] restored stored pose for ${key}`);
  return true;
}
