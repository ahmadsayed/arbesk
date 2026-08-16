/**
 * Camera pose persistence
 *
 * Stores the viewport camera pose (orbit angles, radius, target, ortho
 * frustum) in localStorage, keyed per asset manifest CID. Reopening the same
 * asset in the same browser restores the exact view the user left it in.
 * Best-effort: storage failures (private mode, quota) are silently ignored.
 */

import { state } from "./state.ts";
import { getActiveAssetManifestCid } from "../domain/asset.ts";

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

function _readPose(manifestCid: string): StoredCameraPose | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + manifestCid);
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

function _writePose(manifestCid: string, pose: StoredCameraPose) {
  try {
    localStorage.setItem(STORAGE_PREFIX + manifestCid, JSON.stringify(pose));
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
      const manifestCid = getActiveAssetManifestCid();
      if (!manifestCid) return;

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
      _writePose(manifestCid, pose);
    }, SAVE_DEBOUNCE_MS);
  });
}

/**
 * Restore the stored camera pose for a manifest, if any. Snaps instantly
 * (no animation) so the view lands exactly where the user left it.
 *
 * @returns true when a stored pose was applied
 */
export function restoreCameraPose(manifestCid: string): boolean {
  const camera = state.camera;
  if (!camera || !manifestCid) return false;

  const pose = _readPose(manifestCid);
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

  console.log(`[CAMERA] restored stored pose for ${manifestCid}`);
  return true;
}
