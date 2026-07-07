// @ts-nocheck
/**
 * Model Clock — version dial floating above the selected node.
 *
 * A filtered lens over the same manifest chain as the scene clock: it shows
 * only the versions where the selected node changed (store.versionsForNode).
 * Committing a version reloads the whole scene at that version.
 *
 * Positioned each frame by projecting the top-center of the node's bounding
 * box to screen space (constant screen size). Initialized from scene-graph.js
 * after the engine is ready — meshes are read from engine/state.js directly
 * to avoid a circular import with scene-graph.
 */

import * as store from "../state/version-history-store.js";
import { createVersionClock } from "./version-clock.js";
import { on, EVENTS } from "../events/bus.js";
import { state } from "../engine/state.js";

const ROOT_ID = "modelClock";
const ABOVE_OFFSET_PX = 12; // gap between bounding-box top and the dial

function initModelClock(scene, camera) {
  const viewport = document.getElementById("viewport");
  if (!viewport || document.getElementById(ROOT_ID)) return;

  let selectedNodeId = null;

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.className = "model-clock";
  root.hidden = true;

  const clock = createVersionClock({
    onCommit(index) {
      const filtered = store.versionsForNode(selectedNodeId);
      const entry = filtered[index];
      if (entry && entry.cid !== store.getState().activeCid) {
        store.loadVersion(entry.cid);
      }
    },
  });
  root.appendChild(clock.el);
  viewport.appendChild(root);

  // Collapsed ↔ expanded (same pattern as the scene clock).
  root.addEventListener("pointerenter", () => root.classList.add("expanded"));
  root.addEventListener("pointerleave", () => {
    if (!root.contains(document.activeElement)) {
      root.classList.remove("expanded");
    }
  });
  root.addEventListener("focusin", () => root.classList.add("expanded"));
  root.addEventListener("focusout", () => root.classList.remove("expanded"));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      root.classList.remove("expanded");
      clock.el.blur();
    }
  });

  function render() {
    const filtered = selectedNodeId
      ? store.versionsForNode(selectedNodeId)
      : [];
    root.hidden = filtered.length === 0;
    if (root.hidden) {
      root.classList.remove("expanded");
      return;
    }
    const s = store.getState();
    const activeIdx = filtered.findIndex((e) => e.cid === s.activeCid);
    clock.update({
      entries: filtered,
      // Scene may sit on a version between two node-changes; snap the hand to
      // the newest filtered entry at or before it.
      activeIndex: activeIdx !== -1 ? activeIdx : filtered.length - 1,
      publishedIndex: filtered.findIndex((e) => e.cid === s.publishedCid),
      loading: s.isLoading,
    });
  }

  on(EVENTS.NODE_SELECTED, (e) => {
    selectedNodeId = e?.nodeId || state.highlightedNodeId;
    render();
  });
  on(EVENTS.NODE_DESELECTED, () => {
    selectedNodeId = null;
    render();
  });
  on(EVENTS.SCENE_EMPTY, () => {
    selectedNodeId = null;
    render();
  });
  store.subscribe(render);

  // ─── Per-frame positioning ───

  function reposition() {
    if (root.hidden) return;
    if (state.isGizmoDragging) {
      root.style.visibility = "hidden";
      return;
    }

    const meshes = state.nodeMeshes.get(selectedNodeId);
    if (!meshes || meshes.length === 0) {
      root.style.visibility = "hidden";
      return;
    }

    let min = null;
    let max = null;
    for (const mesh of meshes) {
      if (!mesh || mesh.isDisposed()) continue;
      const bb = mesh.getBoundingInfo().boundingBox;
      min = min
        ? BABYLON.Vector3.Minimize(min, bb.minimumWorld)
        : bb.minimumWorld.clone();
      max = max
        ? BABYLON.Vector3.Maximize(max, bb.maximumWorld)
        : bb.maximumWorld.clone();
    }
    if (!min) {
      root.style.visibility = "hidden";
      return;
    }

    const top = new BABYLON.Vector3(
      (min.x + max.x) / 2,
      max.y,
      (min.z + max.z) / 2
    );
    const engine = scene.getEngine();
    const projected = BABYLON.Vector3.Project(
      top,
      BABYLON.Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(
        engine.getRenderWidth(),
        engine.getRenderHeight()
      )
    );

    // Behind the camera or outside the depth range → hide.
    if (projected.z < 0 || projected.z > 1) {
      root.style.visibility = "hidden";
      return;
    }

    // Projection is in render-buffer pixels; convert to CSS pixels.
    const canvas = engine.getRenderingCanvas();
    const sx = canvas.clientWidth / engine.getRenderWidth();
    const sy = canvas.clientHeight / engine.getRenderHeight();
    root.style.visibility = "";
    root.style.transform =
      `translate(${projected.x * sx}px, ` +
      `${projected.y * sy - ABOVE_OFFSET_PX}px) translate(-50%, -100%)`;
  }

  scene.onBeforeRenderObservable.add(reposition);
}

export { initModelClock };
