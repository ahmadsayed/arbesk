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

/**
 * Start persisting the camera pose on every view change (debounced to one
 * write per second). Call once after the camera is created in initEngine().
 */
export function initCameraPersistence(camera: BABYLON.ArcRotateCamera) {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  camera.onViewMatrixChangedObservable.add(() => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      // Key the pose to the asset open at save time, not at camera-create
      // time — the camera outlives individual assets in the SPA.
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
      _writePose(key, pose);
    }, SAVE_DEBOUNCE_MS);
  });
}

/**
 * Restore the stored camera pose for the currently-open asset, if any.
 * Snaps instantly (no animation) so the view lands exactly where the user
 * left it.
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
  if (!pose) return false;

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

  console.log(`[CAMERA] restored stored pose for ${key}`);
  return true;
}
