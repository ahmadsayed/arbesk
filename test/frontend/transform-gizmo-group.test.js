/**
 * @jest-environment jsdom
 *
 * Group-pivot drag math: with 2+ nodes selected the gizmo moves a synthetic
 * pivot at the selection centroid and every anchor follows via its drag-start
 * relative matrix. A translation drag must move every anchor by the SAME
 * world-space offset regardless of each anchor's own scale.
 */
import { expect, test, describe, beforeEach, afterEach } from "@jest/globals";
import { state } from "../../frontend/src/js/engine/state.js";
import { emit, EVENTS } from "../../frontend/src/js/events/bus.js";
import { initTransformGizmo } from "../../frontend/src/js/ui/transform-gizmo.js";

// ── Minimal, exact matrix mock ──────────────────────────────────────────────
// Babylon row-vector semantics: v' = v × M; A.multiply(B) applies A first.
// Only diagonal-scale + translation matrices occur in this test (rotations
// are identity), so M = [sx 0 0 0 / 0 sy 0 0 / 0 0 sz 0 / tx ty tz 1].
class MockMatrix {
  constructor(sx = 1, sy = 1, sz = 1, tx = 0, ty = 0, tz = 0) {
    this.m = [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, tx, ty, tz, 1];
  }
  static Identity() {
    return new MockMatrix();
  }
  static Compose(scale, _rotation, position) {
    return new MockMatrix(
      scale.x, scale.y, scale.z,
      position.x, position.y, position.z
    );
  }
  static Invert(a) {
    const m = a.m;
    return new MockMatrix(
      1 / m[0], 1 / m[5], 1 / m[10],
      -m[12] / m[0], -m[13] / m[5], -m[14] / m[10]
    );
  }
  multiply(other) {
    const r = new MockMatrix();
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += this.m[row * 4 + k] * other.m[k * 4 + col];
        r.m[row * 4 + col] = sum;
      }
    }
    return r;
  }
  decompose(scale, rotation, position) {
    scale.x = this.m[0]; scale.y = this.m[5]; scale.z = this.m[10];
    position.x = this.m[12]; position.y = this.m[13]; position.z = this.m[14];
    rotation.x = 0; rotation.y = 0; rotation.z = 0; rotation.w = 1;
    return true;
  }
}

class MockVector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  static Zero() { return new MockVector3(); }
  addInPlace(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  scaleInPlace(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  copyFrom(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  copyFromFloats(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

class MockQuaternion {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  static Identity() { return new MockQuaternion(); }
  copyFrom(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
}

class MockTransformNode {
  constructor() {
    this.position = new MockVector3();
    this.scaling = new MockVector3(1, 1, 1);
    this.rotationQuaternion = new MockQuaternion();
    this.parent = null;
    this._world = MockMatrix.Identity();
  }
  isDisposed() { return false; }
  computeWorldMatrix() {
    if (this.parent) this.parent.computeWorldMatrix();
    const local = new MockMatrix(
      this.scaling.x, this.scaling.y, this.scaling.z,
      this.position.x, this.position.y, this.position.z
    );
    this._world = this.parent ? local.multiply(this.parent._world) : local;
    return this._world;
  }
  getWorldMatrix() { return this._world; }
  getAbsolutePosition() {
    return new MockVector3(this.position.x, this.position.y, this.position.z);
  }
  dispose() {}
}

function mkObservable() {
  const callbacks = [];
  return { add: (cb) => callbacks.push(cb), fire: (...args) => callbacks.forEach((cb) => cb(...args)) };
}

describe("transform-gizmo group drag", () => {
  let viewport;
  let beforeRender;
  let dragStart;
  let attachedNode;

  beforeEach(() => {
    const positionGizmo = {
      onDragStartObservable: mkObservable(),
      onDragEndObservable: mkObservable(),
      planarGizmoEnabled: false,
    };
    dragStart = positionGizmo.onDragStartObservable;

    global.BABYLON = {
      GizmoManager: class {
        constructor() {
          this.gizmos = {
            positionGizmo,
            rotationGizmo: { onDragStartObservable: mkObservable(), onDragEndObservable: mkObservable() },
            scaleGizmo: { onDragStartObservable: mkObservable(), onDragEndObservable: mkObservable() },
          };
        }
        attachToNode(node) { attachedNode = node; }
      },
      TransformNode: MockTransformNode,
      Vector3: MockVector3,
      Quaternion: MockQuaternion,
      Matrix: MockMatrix,
    };

    viewport = document.createElement("div");
    viewport.id = "viewport";
    document.body.appendChild(viewport);

    state.gizmoManager = null;
    state.transformMode = null;
    state.highlightedNodeId = null;
    state.selectedNodeIds = new Set();
    state.nodeAnchors = new Map();
    state.isGizmoDragging = false;

    initTransformGizmo(
      { onBeforeRenderObservable: { add: (cb) => { beforeRender = cb; } } },
      null
    );
  });

  afterEach(() => {
    viewport.remove();
    state.selectedNodeIds = new Set();
    delete global.BABYLON;
  });

  test("translate drag moves every selected anchor by the same world offset regardless of scale", () => {
    // Two anchors at opposite sides of the origin, one scaled 2×, one 1×.
    const big = new MockTransformNode();
    big.position.copyFromFloats(10, 0, 0);
    big.scaling.copyFromFloats(2, 2, 2);
    const small = new MockTransformNode();
    small.position.copyFromFloats(-10, 0, 0);
    small.scaling.copyFromFloats(1, 1, 1);
    state.nodeAnchors.set("big", big);
    state.nodeAnchors.set("small", small);
    state.selectedNodeIds = new Set(["big", "small"]);
    state.highlightedNodeId = "small";

    emit(EVENTS.NODE_SELECTED, { nodeId: "small", mesh: null });

    // Gizmo attached to the group pivot at the centroid (origin).
    const pivot = attachedNode;
    expect(pivot).toBeTruthy();

    // Simulate a translate drag of Δ = (0, 5, 0) on the pivot.
    dragStart.fire();
    pivot.position.copyFromFloats(0, 5, 0);
    beforeRender();

    // Both anchors must move by exactly Δ in world space — scale must not
    // amplify the offset.
    expect(big.position.x).toBeCloseTo(10);
    expect(big.position.y).toBeCloseTo(5);
    expect(big.position.z).toBeCloseTo(0);
    expect(small.position.x).toBeCloseTo(-10);
    expect(small.position.y).toBeCloseTo(5);
    expect(small.position.z).toBeCloseTo(0);

    // Scales must survive the drag untouched.
    expect(big.scaling.x).toBeCloseTo(2);
    expect(small.scaling.x).toBeCloseTo(1);
  });

  test("nested anchors (Ctrl+A over child worlds) are not double-transformed", () => {
    // Top-level models "outer" and "other"; "inner" lives inside "outer"'s
    // child world (its anchor chain bottoms out at the outer anchor).
    const outer = new MockTransformNode();
    outer.position.copyFromFloats(10, 0, 0);
    const childAnchor = new MockTransformNode();
    childAnchor.parent = outer;
    const inner = new MockTransformNode();
    inner.parent = childAnchor;
    inner.position.copyFromFloats(1, 0, 0);
    const other = new MockTransformNode();
    other.position.copyFromFloats(-10, 0, 0);

    state.nodeAnchors.set("outer", outer);
    state.nodeAnchors.set("inner", inner);
    state.nodeAnchors.set("other", other);
    state.selectedNodeIds = new Set(["outer", "inner", "other"]);
    state.highlightedNodeId = "outer";
    outer.computeWorldMatrix();
    inner.computeWorldMatrix();
    other.computeWorldMatrix();

    emit(EVENTS.NODE_SELECTED, { nodeId: "outer", mesh: null });
    const pivot = attachedNode;
    expect(pivot).toBeTruthy();

    dragStart.fire();
    pivot.position.copyFromFloats(0, 5, 0);
    beforeRender();

    outer.computeWorldMatrix();
    inner.computeWorldMatrix();

    // "inner" rides along with its parent — it must move by exactly Δ, not
    // 2×Δ from being dragged directly AND via the parent.
    expect(inner.getWorldMatrix().m[12]).toBeCloseTo(11);
    expect(inner.getWorldMatrix().m[13]).toBeCloseTo(5);
    expect(other.position.y).toBeCloseTo(5);
  });
});
