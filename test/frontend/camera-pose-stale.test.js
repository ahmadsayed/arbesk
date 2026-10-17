// @test-env dom
/**
 * Stale stored camera poses (engine/camera-persistence.ts): a pose saved when
 * the model had a different size or place (e.g. 3MF parts before renders
 * moved from millimetres to metres) is discarded on load, so the asset gets
 * framed instead of the camera snapping to empty space.
 */
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

let persistence;
let state;
/** World bounds the mocked transforms module reports for the scene. */
let sceneBounds = null;

const KEY = "arbesk:cameraPose:token:42:root";

beforeAll(async () => {
  await mock.module("@arbesk/asset-core/domain/asset.js", () => ({
    getActiveAssetManifestCid: () => "bafyManifest",
    getActiveAssetTokenId: () => "42",
    getActiveAssetId: () => null,
  }));
  await mock.module("../../frontend/src/js/state/wallet-state.js", () => ({
    walletState: { get: () => ({}) },
  }));
  await mock.module("../../frontend/src/js/engine/transforms.js", () => ({
    getRenderableMeshes: (meshes) => meshes,
    getWorldBounds: () => sceneBounds,
  }));
  ({ state } = await import("../../frontend/src/js/engine/state.js"));
  persistence = await import("../../frontend/src/js/engine/camera-persistence.js");
});

/** gridfinity today: ~0.25 m across, sitting on the floor at the origin. */
const GRIDFINITY = { center: { x: 0.105, y: 0.023, z: 0.105 }, size: { x: 0.25, y: 0.046, z: 0.25 } };

function storePose(pose) {
  localStorage.setItem(KEY, JSON.stringify({ alpha: -1.57, beta: 1.05, ...pose }));
}

beforeEach(() => {
  localStorage.clear();
  sceneBounds = GRIDFINITY;
  state.scene = { meshes: [{ isDisposed: () => false, metadata: null }] };
});

describe("stale pose detection", () => {
  /** Stores a pose for the open asset and reports whether it survives. */
  const kept = (radius, target, bounds = GRIDFINITY) => {
    sceneBounds = bounds;
    storePose({ radius, target });
    return persistence.hasStoredCameraPose();
  };

  test("a normal close-up or zoomed-out view is kept", () => {
    expect(kept(0.4, [0.1, 0.02, 0.1])).toBe(true);
    // Zooming out to the 50-unit floor of the camera range is legitimate.
    expect(kept(50, [0.1, 0.02, 0.1])).toBe(true);
  });

  test("a radius the camera range can no longer reach is stale (mm-era 250 m bin)", () => {
    expect(kept(356, [105, 23, 105])).toBe(false);
  });

  test("a target far outside the view of the model is stale (floating-era bin)", () => {
    expect(kept(0.35, [0.1, 22.9, 0.1])).toBe(false);
  });

  test("large models keep a proportionally large valid range", () => {
    const cave = { center: { x: 0, y: 40, z: 0 }, size: { x: 300, y: 80, z: 300 } };
    expect(kept(2500, [30, 40, -20], cave)).toBe(true);
    expect(kept(3100, [0, 40, 0], cave)).toBe(false);
  });
});

describe("hasStoredCameraPose", () => {
  test("keeps and reports a plausible stored pose", () => {
    storePose({ radius: 0.4, target: [0.1, 0.02, 0.1] });
    expect(persistence.hasStoredCameraPose()).toBe(true);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  test("drops a stale pose so the asset is framed instead", () => {
    storePose({ radius: 356, target: [105, 23, 105] });
    expect(persistence.hasStoredCameraPose()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  test("with no renderable geometry the stored pose is trusted as before", () => {
    sceneBounds = null;
    storePose({ radius: 356, target: [105, 23, 105] });
    expect(persistence.hasStoredCameraPose()).toBe(true);
  });
});
