/**
 * Render scheduler: full frame rate while the scene is active, a low-rate
 * safety-net refresh when idle.
 */
import { describe, expect, test } from "bun:test";
import {
  createRenderScheduler,
  ACTIVE_WINDOW_MS,
  IDLE_INTERVAL_MS,
} from "../../frontend/src/js/engine/render-scheduler.ts";

function observable() {
  const handlers = new Set();
  return {
    add: (fn) => (handlers.add(fn), fn),
    remove: (fn) => handlers.delete(fn),
    fire: (...a) => handlers.forEach((fn) => fn(...a)),
    get size() {
      return handlers.size;
    },
  };
}

function fakeScene() {
  return {
    animatables: [],
    animationGroups: [],
    onNewMeshAddedObservable: observable(),
    onMeshRemovedObservable: observable(),
    onNewMaterialAddedObservable: observable(),
    onNewTransformNodeAddedObservable: observable(),
    onPointerObservable: observable(),
    onKeyboardObservable: observable(),
    getEngine: () => ({ onResizeObservable: resizeObs }),
  };
}
let resizeObs;

function setup() {
  resizeObs = observable();
  const scene = fakeScene();
  const camera = { onViewMatrixChangedObservable: observable() };
  let now = 0;
  const sched = createRenderScheduler(scene, camera, { now: () => now });
  return { scene, camera, sched, advance: (ms) => (now += ms) };
}

describe("createRenderScheduler", () => {
  test("renders the first frame, then throttles to the idle interval", () => {
    const { sched, advance } = setup();
    expect(sched.shouldRender()).toBe(true);
    advance(ACTIVE_WINDOW_MS + 1);
    expect(sched.shouldRender()).toBe(true); // idle interval elapsed since frame 1
    advance(16);
    expect(sched.shouldRender()).toBe(false);
    advance(IDLE_INTERVAL_MS);
    expect(sched.shouldRender()).toBe(true);
  });

  test("renders every frame within the active window after invalidate()", () => {
    const { sched, advance } = setup();
    advance(ACTIVE_WINDOW_MS + 1);
    sched.shouldRender();
    sched.invalidate();
    for (let i = 0; i < 10; i++) {
      advance(16);
      expect(sched.shouldRender()).toBe(true);
    }
    advance(ACTIVE_WINDOW_MS);
    sched.shouldRender();
    advance(16);
    expect(sched.shouldRender()).toBe(false);
  });

  test.each([
    ["pointer input", (s) => s.scene.onPointerObservable.fire()],
    ["keyboard input", (s) => s.scene.onKeyboardObservable.fire()],
    ["camera movement", (s) => s.camera.onViewMatrixChangedObservable.fire()],
    ["mesh added", (s) => s.scene.onNewMeshAddedObservable.fire()],
    ["mesh removed", (s) => s.scene.onMeshRemovedObservable.fire()],
    ["material added", (s) => s.scene.onNewMaterialAddedObservable.fire()],
    ["engine resize", () => resizeObs.fire()],
  ])("%s wakes the scheduler", (_label, trigger) => {
    const s = setup();
    s.advance(ACTIVE_WINDOW_MS + 1);
    s.sched.shouldRender();
    s.advance(16);
    expect(s.sched.shouldRender()).toBe(false);
    trigger(s);
    expect(s.sched.shouldRender()).toBe(true);
  });

  test("renders every frame while an animation is running", () => {
    const { scene, sched, advance } = setup();
    advance(ACTIVE_WINDOW_MS + 1);
    sched.shouldRender();
    scene.animatables.push({});
    advance(16);
    expect(sched.shouldRender()).toBe(true);
    scene.animatables.length = 0;
    scene.animationGroups.push({ isPlaying: true });
    advance(16);
    expect(sched.shouldRender()).toBe(true);
    scene.animationGroups[0].isPlaying = false;
    advance(16);
    expect(sched.shouldRender()).toBe(false);
  });

  test("dispose() detaches every observer", () => {
    const { scene, camera, sched } = setup();
    sched.dispose();
    expect(scene.onPointerObservable.size).toBe(0);
    expect(scene.onNewMeshAddedObservable.size).toBe(0);
    expect(camera.onViewMatrixChangedObservable.size).toBe(0);
    expect(resizeObs.size).toBe(0);
  });
});
