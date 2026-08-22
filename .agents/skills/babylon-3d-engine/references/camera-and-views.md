# Camera & Views — ArcRotateCamera Setup

The Studio viewport is **perspective-only** — the same projection as the
library and chat preview cameras. Ortho mode and the 1/3/7 view snap presets
were removed: Babylon's ortho path has no working wheel zoom (with explicit
`orthoLeft/Right/Top/Bottom` the engine's wheel input decays `radius`
invisibly, and with them unset the frustum derives from canvas pixel size),
which made ortho the substrate of repeated clipping regressions. One
projection path keeps the Studio behaving identically to the previews by
construction. Do not reintroduce ortho casually.

## Camera Creation

```js
const camera = new BABYLON.ArcRotateCamera(
  "camera",
  -Math.PI / 2,   // alpha (horizontal rotation)
  Math.PI / 3,    // beta (vertical rotation)
  15,             // radius (distance from target)
  BABYLON.Vector3.Zero(), // target
  scene
);
camera.lowerRadiusLimit = 2;
camera.upperRadiusLimit = 500;
camera.minZ = 0.01;              // below the closest reachable camera distance
camera.wheelDeltaPercentage = 0.01; // proportional zoom: step scales with radius
camera.pinchDeltaPercentage = 0.01;
camera.panningInertia = 0.6;     // tame glide with viewport-scaled pan steps
camera.attachControl(canvas, true);
```

## Content-Adaptive Range & Clip Planes

`updateCameraRangeForScene()` (in `scene-camera.ts`, runs on `SCENE_READY`)
scales the zoom range and clip planes from the model's largest dimension:

- `lowerRadiusLimit = 0.1` (close zoom-in stays possible on huge models),
  `upperRadiusLimit = max(50, maxDim * 10)`. The 50 floor matters: at 500 a
  ~1-unit model shrinks to a couple of pixels at max zoom-out —
  indistinguishable from being clipped.
- `maxZ = max(maxDim * 100, maxLimit * 4)` and `minZ = maxZ / 1e5` — a fixed
  1:1e5 near/far ratio, comfortable for 24-bit depth. Fixed plane VALUES
  cannot serve every model: a small fixed minZ against a huge maxZ collapses
  depth precision until surfaces z-fight and slice through each other, while
  a large fixed minZ slices small models on close zoom.
- The ground grid and in-scene axes scale with the model so they keep framing
  it; `updateGridCoverage()` grows the grid in power-of-two steps when the
  camera zooms out far enough to see past the plane's edge (extent scales
  with `radius / sin(beta)` — grazing angles need more ground).

## Camera Framing

### Frame all (Home key)

```js
function frameAll() {
  const bounds = scene.getWorldExtends();
  const center = bounds.min.add(bounds.max).scale(0.5);
  const size = bounds.max.subtract(bounds.min);
  const maxDim = Math.max(size.x, size.y, size.z);
  const radius = maxDim * 1.5;

  animateCameraTo(center, radius);
}
```

Fit the largest dimension, not the 3D diagonal — the diagonal inflates the
radius by up to √3 and leaves the model small in the viewport. The production
version derives the radius from the camera fov:
`radius = (maxDim * 1.2) / (2 * tan(fov / 2))`.

### Frame selected (F key)

```js
function frameSelected(nodeId) {
  const meshes = state.nodeMeshes.get(nodeId);
  if (!meshes || meshes.length === 0) return;

  const bounds = new BABYLON.BoundingInfo(
    BABYLON.Vector3.Zero(), BABYLON.Vector3.Zero()
  );
  for (const mesh of meshes) {
    if (!mesh.isDisposed()) {
      bounds.reconstruct(mesh.getBoundingInfo());
    }
  }
  const center = bounds.boundingBox.centerWorld;
  animateCameraTo(center, 5);
}
```

### Smooth animation helper

```js
function animateCameraTo(target, radius) {
  BABYLON.Animation.CreateAndStartAnimation(
    "camTarget", camera, "target", 60, 18,
    camera.target, target, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "camRadius", camera, "radius", 60, 18,
    camera.radius, radius, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
}
```

## Pan Feel

Babylon's pan step is a CONSTANT world distance per pixel (no radius factor
in the input chain), so on a large model a drag covers a vanishing fraction of
the viewport. `_updatePanSensibility()` in `scene-graph.ts` runs every frame
and scales the step to the visible extent (`2 * radius * tan(fov/2)`): exact
cursor tracking up to 100 world units of visible height, sublinear
(`^0.35`) damping above it.

## Camera Pose Persistence

`camera-persistence.ts` saves `{alpha, beta, radius, target}` per asset to
localStorage (debounced 1s, flushed on tab hide/close) and restores it on
`SCENE_READY` — assets without a stored pose get framed whole instead. A
90-frame post-restore settle re-applies the pose to defeat Babylon v9
smooth-transition drift; any pointer/wheel input cancels it immediately.

## Gizmo Overlay

The viewport gizmo is a separate 2D canvas rendered on top of the 3D canvas:

```js
// gizmoCanvas.width and gizmoCanvas.height are set in JS after mount
// CSS controls display size, JS controls backing store (DPR-aware)
```

The gizmo canvas has `pointer-events: none` so it never intercepts scene interactions.

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Model sliced on close zoom | `minZ` too large for the model scale | Let `updateCameraRangeForScene()` scale planes (1:1e5 ratio) |
| Surfaces z-fight / slice each other | `maxZ` oversized vs `minZ` — depth precision collapsed | Keep the pinned 1:1e5 ratio; shrink `maxZ` to content |
| Camera spins wildly | `beta` exactly 0 causes gimbal lock | Keep a small positive `beta` |
| Framing snaps instantly | No animation | Use `CreateAndStartAnimation` with 18 frames (~300ms) |
| Gizmo blocks clicks | Missing `pointer-events: none` | Set in CSS |
