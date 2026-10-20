import { afterEach, beforeEach, describe, expect, it, jest, mock } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const SAVED = {
  code: "return box(P.w, 1, 1);",
  parameters: { w: { value: 60, unit: "mm" } },
  summary: "box",
};

class FakeRenderError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let render;
let replace;
let restore;
let applyUndo;
let edits;
let preview;
let pending;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  jest.useFakeTimers();
  resetModules();
  pending = [];
  render = jest.fn(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  replace = jest.fn(async () => true);
  restore = jest.fn(async () => true);
  applyUndo = null;
  mock.module("../../frontend/src/js/services/cad-render.ts", () => ({ renderCadDesignInWorker: render }));
  mock.module("../../frontend/src/js/engine/scene-loader.ts", () => ({
    replaceNodeModelFromBytes: replace,
    reloadNodeModel: restore,
  }));
  mock.module("../../frontend/src/js/engine/undo-controller.ts", () => ({
    registerUndoApplier: (type, fn) => { if (type === "cad-params") applyUndo = fn; },
  }));
  mock.module("@arbesk/asset-core/domain/asset.js", () => ({
    getCurrentManifest: () => ({ scene: { nodes: [
      { node_id: "A", source: { cid: "bafyA", path: "asset.3mf", format: "3mf" } },
      { node_id: "B", source: { cid: "bafyB", path: "asset.3mf", format: "3mf" } },
    ] } }),
  }));
  edits = await import("../../frontend/src/js/state/cad-param-edits.ts");
  preview = await import("../../frontend/src/js/services/cad-param-preview.ts");
  edits.clearCadParamEdits();
});

afterEach(() => jest.useRealTimers());

const ok = (w) => ({ bytes: new Uint8Array([w]), summary: "", stats: { triangles: 12 }, partColors: [] });

function edit(nodeId, w) {
  edits.setCadParamValues(nodeId, SAVED, { w });
  preview.scheduleCadPreview(nodeId);
}

describe("scheduleCadPreview", () => {
  it("debounces 300 ms", () => {
    edit("A", 61);
    jest.advanceTimersByTime(50);
    edit("A", 62);
    jest.advanceTimersByTime(50);
    edit("A", 63);
    jest.advanceTimersByTime(299);
    expect(render).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0].parameters.w.value).toBe(63);
  });

  it("newest values win", async () => {
    edit("A", 61);
    jest.advanceTimersByTime(300);
    edit("A", 70);
    jest.advanceTimersByTime(300);
    expect(render).toHaveBeenCalledTimes(1);
    pending[0].resolve(ok(61));
    await flush();
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1][0].parameters.w.value).toBe(70);
    pending[1].resolve(ok(70));
    await flush();
    await preview.whenCadPreviewsSettled();
    expect(edits.getCadParamEdit("A").status).toBe("ok");
    expect(edits.getCadParamEdit("A").bytes).toEqual(new Uint8Array([70]));
  });

  it("result applies to the node it was scheduled for", async () => {
    edit("A", 61);
    jest.advanceTimersByTime(300);
    pending[0].resolve(ok(61));
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toBe("A");
    expect(replace.mock.calls[0][1]).toEqual({ cid: "bafyA", path: "asset.3mf", format: "3mf" });
    expect(edits.getCadParamEdit("B")).toBeUndefined();
  });

  it("failure keeps preview", async () => {
    edit("A", 61);
    jest.advanceTimersByTime(300);
    pending[0].reject(new FakeRenderError("CAD_KERNEL_FAILED", "boom"));
    await flush();
    const e = edits.getCadParamEdit("A");
    expect(e.status).toBe("error");
    expect(e.error).toBe("boom");
    expect(e.errorCode).toBe("CAD_KERNEL_FAILED");
    expect(replace).not.toHaveBeenCalled();
  });

  it("drops a stale result when the edit was reverted mid-render", async () => {
    edit("A", 61);
    jest.advanceTimersByTime(300);
    edits.setCadParamValues("A", SAVED, { w: 60 });
    pending[0].resolve(ok(61));
    await flush();
    expect(edits.getCadParamEdit("A")).toBeUndefined();
  });

  it("reverting to the saved values reloads the stored model", async () => {
    edit("A", 61);
    jest.advanceTimersByTime(300);
    pending[0].resolve(ok(61));
    await flush();
    edit("A", 60);
    jest.advanceTimersByTime(300);
    await flush();
    expect(render).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith("A", { cid: "bafyA", path: "asset.3mf", format: "3mf" });
  });

  it("undo after save re-renders and marks dirty", async () => {
    edits.clearCadParamEdits();
    preview.setCadParamBase("A", SAVED);
    applyUndo({ nodeId: "A", before: { w: 50 }, after: { w: 60 } }, "before");
    expect(edits.getCadParamEdit("A").design.parameters.w.value).toBe(50);
    jest.advanceTimersByTime(300);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
