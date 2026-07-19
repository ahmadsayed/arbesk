/**
 * Chat preview service tests (jsdom) with a mocked Babylon runtime.
 *
 * Verifies the preview lifecycle: creation through the format-handler
 * pipeline, the live-preview cap with auto-collapse of the oldest preview,
 * snapshot capture on dispose, and the failure path.
 *
 * @jest-environment jsdom
 */

import { jest, expect, test, beforeAll, beforeEach } from "@jest/globals";

// ─── Babylon mock ───

class V3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  clone() {
    return new V3(this.x, this.y, this.z);
  }
  add(v) {
    return new V3(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  subtract(v) {
    return new V3(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  scale(s) {
    return new V3(this.x * s, this.y * s, this.z * s);
  }
  length() {
    return Math.hypot(this.x, this.y, this.z);
  }
  static Zero() {
    return new V3();
  }
  static Minimize(a, b) {
    return new V3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
  }
  static Maximize(a, b) {
    return new V3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  }
}

class FakeScene {
  constructor() {
    this.renderCalls = 0;
    this._disposed = false;
  }
  render() {
    this.renderCalls += 1;
  }
  dispose() {
    this._disposed = true;
  }
  isDisposed() {
    return this._disposed;
  }
}

class FakeEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this._disposed = false;
    this.loop = null;
  }
  runRenderLoop(fn) {
    this.loop = fn;
  }
  stopRenderLoop() {
    this.loop = null;
  }
  resize() {}
  dispose() {
    this._disposed = true;
  }
  isDisposed() {
    return this._disposed;
  }
}

class FakeCamera {
  constructor() {
    this.radius = 10;
  }
  attachControl() {}
  setTarget(v) {
    this.target = v;
  }
}

const fakeMesh = {
  getHierarchyBoundingVectors: () => ({
    min: new V3(0, 0, 0),
    max: new V3(2, 2, 2),
  }),
};

// ─── Setup ───

let createChatPreview;
let getChatPreview;
let disposeChatPreview;
let registerFormatHandler;
let lastLoadCtx;
let loadError = null;

function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.toBlob = (cb) => cb(new Blob(["img"], { type: "image/webp" }));
  return canvas;
}

beforeAll(async () => {
  global.BABYLON = {
    Engine: FakeEngine,
    Scene: FakeScene,
    ArcRotateCamera: FakeCamera,
    HemisphericLight: class {},
    Vector3: V3,
    SceneLoader: { ImportMeshAsync: jest.fn() },
  };
  global.IntersectionObserver = class {
    constructor(cb) {
      this.cb = cb;
    }
    observe() {}
    disconnect() {}
  };

  ({ registerFormatHandler } = await import(
    "../../frontend/src/js/formats/index.js"
  ));
  registerFormatHandler({
    format: "testfmt",
    extensions: [".testfmt"],
    load: async (src, ctx) => {
      if (loadError) throw loadError;
      lastLoadCtx = ctx;
      return { meshes: [fakeMesh], transformNodes: [] };
    },
    decomposeForSave: async () => null,
    isStoredForm: () => true,
  });

  ({ createChatPreview, getChatPreview, disposeChatPreview } = await import(
    "../../frontend/src/js/services/chat-preview.js"
  ));
});

beforeEach(() => {
  lastLoadCtx = null;
  loadError = null;
});

const SRC = { cid: "bafy-source", path: "asset.testfmt", format: "testfmt" };

test("returns null without a canvas or cid", async () => {
  expect(await createChatPreview("g1", null, SRC)).toBeNull();
  expect(await createChatPreview("g1", makeCanvas(), { cid: null })).toBeNull();
});

test("creates a live preview through the format-handler pipeline", async () => {
  const handle = await createChatPreview("g1", makeCanvas(), SRC);
  expect(handle).not.toBeNull();
  expect(getChatPreview("g1")).toBe(handle);
  expect(lastLoadCtx.cid).toBe("bafy-source");
  expect(typeof lastLoadCtx.importFromBlob).toBe("function");
  expect(lastLoadCtx.scene).toBeInstanceOf(FakeScene);
  await handle.dispose();
});

test("dispose captures a snapshot, renders a final frame, and cleans up", async () => {
  const handle = await createChatPreview("g1", makeCanvas(), SRC);
  const scene = lastLoadCtx.scene;
  const snapshot = await handle.dispose({ captureSnapshot: true });
  expect(snapshot).toBeInstanceOf(Blob);
  expect(scene.renderCalls).toBe(1);
  expect(scene.isDisposed()).toBe(true);
  expect(getChatPreview("g1")).toBeNull();
  // Second dispose is a no-op.
  expect(await handle.dispose({ captureSnapshot: true })).toBeNull();
});

test("disposeChatPreview by id returns null for unknown ids", async () => {
  expect(await disposeChatPreview("nope", { captureSnapshot: true })).toBeNull();
});

test("live-preview cap auto-collapses the oldest preview", async () => {
  const collapsed = [];
  const onAutoCollapse = (id, snapshot) => collapsed.push([id, snapshot]);

  await createChatPreview("g1", makeCanvas(), SRC, { onAutoCollapse });
  await createChatPreview("g2", makeCanvas(), SRC, { onAutoCollapse });
  await createChatPreview("g3", makeCanvas(), SRC, { onAutoCollapse });
  const fourth = await createChatPreview("g4", makeCanvas(), SRC, {
    onAutoCollapse,
  });

  expect(fourth).not.toBeNull();
  expect(collapsed).toHaveLength(1);
  expect(collapsed[0][0]).toBe("g1");
  expect(collapsed[0][1]).toBeInstanceOf(Blob);
  expect(getChatPreview("g1")).toBeNull();
  expect(getChatPreview("g4")).not.toBeNull();

  for (const id of ["g2", "g3", "g4"]) await disposeChatPreview(id);
});

test("returns null when the format load fails", async () => {
  loadError = new Error("boom");
  const handle = await createChatPreview("g1", makeCanvas(), SRC);
  expect(handle).toBeNull();
  expect(getChatPreview("g1")).toBeNull();
});
