/**
 * Arbesk Viewport Gizmo
 *
 * Blender-style 2D orientation overlay in the top-right corner of the viewport.
 * Shows the world X/Y/Z axes as colored lines that rotate with the camera.
 * When an axis points straight at the camera, it collapses to a dot.
 *
 * Replaces the previous in-scene X-Y-Z axis arrows.
 */

import { getCssVar } from "../engine/theme.js";

const GIZMO_SIZE = 84; // CSS pixels
const GIZMO_MARGIN = 12;
const AXIS_LENGTH = 26; // pixels from center to tip
const LABEL_OFFSET = 7; // pixels past the line tip

// Axis colors are read from CSS tokens (--axis-x / --axis-y / --axis-z)
// during init, with hardcoded Blender-style fallbacks if the tokens are missing.
let COLOR_X = "#e22b30"; // red
let COLOR_Y = "#43c142"; // green
let COLOR_Z = "#3478eb"; // blue

const AXIS_LABELS = { x: "X", y: "Y", z: "Z" };

let gizmoCanvas = null;
let gizmoCtx = null;
let observer = null;
let dpr = 1;

function initViewportGizmo(scene, camera) {
  // Pull axis colors from the SCSS token system.
  const ax = getCssVar("--axis-x");
  const ay = getCssVar("--axis-y");
  const az = getCssVar("--axis-z");
  if (ax) COLOR_X = ax;
  if (ay) COLOR_Y = ay;
  if (az) COLOR_Z = az;

  gizmoCanvas = document.getElementById("viewportGizmo");
  if (!gizmoCanvas) {
    console.warn("[GIZMO] #viewportGizmo canvas not found in DOM");
    return;
  }

  gizmoCtx = gizmoCanvas.getContext("2d");
  if (!gizmoCtx) {
    console.warn("[GIZMO] could not acquire 2D context");
    return;
  }

  resize();
  window.addEventListener("resize", resize);

  // Redraw every frame so the gizmo tracks the camera.
  observer = scene.onBeforeRenderObservable.add(() => draw(camera));
}

function resize() {
  if (!gizmoCanvas) return;
  dpr = window.devicePixelRatio || 1;
  gizmoCanvas.width = GIZMO_SIZE * dpr;
  gizmoCanvas.height = GIZMO_SIZE * dpr;
  gizmoCanvas.style.width = GIZMO_SIZE + "px";
  gizmoCanvas.style.height = GIZMO_SIZE + "px";
}

function draw(camera) {
  if (!gizmoCtx || !camera) return;

  // The view matrix is recomputed lazily by the render loop. By
  // onBeforeRender it's already in sync with the camera state.
  const viewMatrix = camera.getViewMatrix();

  // World axes → view space (TransformNormal because these are directions).
  const vx = BABYLON.Vector3.TransformNormal(
    BABYLON.Vector3.Right(),
    viewMatrix
  );
  const vy = BABYLON.Vector3.TransformNormal(BABYLON.Vector3.Up(), viewMatrix);
  const vz = BABYLON.Vector3.TransformNormal(
    BABYLON.Vector3.Forward(),
    viewMatrix
  );

  const cx = GIZMO_SIZE / 2;
  const cy = GIZMO_SIZE / 2;

  // Reset transform and clear.
  gizmoCtx.setTransform(1, 0, 0, 1, 0, 0);
  gizmoCtx.clearRect(0, 0, GizmoPx(), GizmoPx());
  gizmoCtx.scale(dpr, dpr);

  // Background disc — subtle, non-intrusive.
  gizmoCtx.beginPath();
  gizmoCtx.arc(cx, cy, GIZMO_SIZE / 2 - 2, 0, Math.PI * 2);
  gizmoCtx.fillStyle = "rgba(20, 20, 20, 0.55)";
  gizmoCtx.fill();
  gizmoCtx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  gizmoCtx.lineWidth = 1;
  gizmoCtx.stroke();

  // Draw the three axes. The Z axis is drawn first so the X/Y lines sit on top
  // of it in the rare case the projection puts them at the same point.
  drawAxis(vx, AXIS_LABELS.x, COLOR_X, cx, cy);
  drawAxis(vy, AXIS_LABELS.y, COLOR_Y, cx, cy);
  drawAxis(vz, AXIS_LABELS.z, COLOR_Z, cx, cy);
}

function drawAxis(viewDir, label, color, cx, cy) {
  // Project to 2D (Y is flipped in screen space).
  const dx = viewDir.x * AXIS_LENGTH;
  const dy = -viewDir.y * AXIS_LENGTH;

  // Hide degenerate / near-zero projections (axis pointing straight at camera) by
  // drawing only the central dot.
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    gizmoCtx.beginPath();
    gizmoCtx.arc(cx, cy, 3, 0, Math.PI * 2);
    gizmoCtx.fillStyle = color;
    gizmoCtx.fill();
    return;
  }

  // Axis line.
  gizmoCtx.beginPath();
  gizmoCtx.moveTo(cx, cy);
  gizmoCtx.lineTo(cx + dx, cy + dy);
  gizmoCtx.strokeStyle = color;
  gizmoCtx.lineWidth = 2;
  gizmoCtx.lineCap = "round";
  gizmoCtx.stroke();

  // Label at the tip.
  gizmoCtx.fillStyle = color;
  gizmoCtx.font = "600 10px system-ui, sans-serif";
  gizmoCtx.textAlign = "center";
  gizmoCtx.textBaseline = "middle";
  gizmoCtx.fillText(
    label,
    cx + dx + LABEL_OFFSET * Math.sign(dx || 1),
    cy + dy
  );
}

function GizmoPx() {
  return GIZMO_SIZE * dpr;
}

export { initViewportGizmo };
