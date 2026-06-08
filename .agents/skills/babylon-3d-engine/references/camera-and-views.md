# Camera & Views — ArcRotateCamera Setup

## Camera Creation

```js
const camera = new BABYLON.ArcRotateCamera(
  "camera",
  -Math.PI / 2,   // alpha (horizontal rotation)
  Math.PI / 2.5,  // beta (vertical rotation)
  10,             // radius (distance from target)
  BABYLON.Vector3.Zero(), // target
  scene
);
camera.attachControl(canvas, true);
```

## View Presets (Blender Convention)

| View | alpha | beta | What you see |
|------|-------|------|-------------|
| Front (key `1`) | 0 | π/2 | Camera on +Z, looking at -Z face |
| Right (key `3`) | π/2 | π/2 | Camera on +X, looking at -X face |
| Top (key `7`) | 0 | 0.01 | Camera above (+Y), looking down — beta=0.01 avoids gimbal lock |

```js
function snapView({ alpha, beta }) {
  BABYLON.Animation.CreateAndStartAnimation(
    "camAlpha", camera, "alpha", 60, 18,
    camera.alpha, alpha, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
  BABYLON.Animation.CreateAndStartAnimation(
    "camBeta", camera, "beta", 60, 18,
    camera.beta, beta, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
  );
}
```

## Orthographic Mode

**Critical:** Do not rely on Babylon's `radius`-derived ortho frustum. Set all four corners explicitly:

```js
const aspect = canvas.width / canvas.height;
const halfH = 5;  // world units
const halfW = halfH * aspect;

camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
camera.orthoLeft   = -halfW;
camera.orthoRight  = +halfW;
camera.orthoBottom = -halfH;
camera.orthoTop    = +halfH;
camera.radius = 10; // used for direction calc, not visible area
```

### Wheel zoom in ortho mode

Babylon's default wheel handler scales `radius`, which doesn't affect the frustum when corners are explicit:

```js
canvas.addEventListener("wheel", (e) => {
  if (state.camera?.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA) {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0015);
    camera.orthoLeft   *= factor;
    camera.orthoRight  *= factor;
    camera.orthoTop    *= factor;
    camera.orthoBottom *= factor;
  }
}, { passive: false });
```

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
| Ortho view is 100× too large | Relying on `radius`-derived frustum | Set `orthoLeft/Right/Top/Bottom` explicitly |
| Wheel zoom doesn't work in ortho | Default handler scales `radius` | Add custom wheel listener for ortho mode |
| Camera spins wildly | `beta` exactly 0 causes gimbal lock | Use `beta = 0.01` for top view |
| Framing snaps instantly | No animation | Use `CreateAndStartAnimation` with 18 frames (~300ms) |
| Gizmo blocks clicks | Missing `pointer-events: none` | Set in CSS |
