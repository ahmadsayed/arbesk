import { beforeEach, describe, expect, it, jest, mock } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { meshTo3mf, readDesignFrom3mf } from "@arbesk/cad-gen";

const SAVED = {
  code: "return [box(P.width, 1, 1), color(box(1, 1, 1), P.lid)];",
  parameters: {
    width: { value: 60, unit: "mm" },
    lid: { type: "color", value: "#d33a2c" },
  },
  summary: "box",
  turn: 2,
};
const EDITED = {
  ...SAVED,
  parameters: { width: { value: 80, unit: "mm" }, lid: { type: "color", value: "#2c7ad3" } },
};
const TRI = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };

const written = [];
const calls = [];
let bakedColors;
const handler = {
  format: "3mf",
  decomposeForSave: jest.fn(async (node) => {
    calls.push("decompose:" + node.source.cid);
    return { cid: "bafyComposite", path: "composite.3mf.json", format: "3mf" };
  }),
  editSourceColors: jest.fn(async (node, map) => {
    calls.push("colors:" + node.source.cid);
    return { sourceCid: "bafyRecoloured", format: "3mf", path: "composite.3mf.json", modified: Object.keys(map).length };
  }),
};
const showToast = jest.fn();
const settle = jest.fn(async () => {});
const setBase = jest.fn();
let pending;

mock.module("../../frontend/src/js/ipfs/write-to-ipfs.ts", () => ({
  writeToIPFS: jest.fn(async (bytes, name) => {
    written.push({ bytes, name });
    calls.push("write");
    return "bafyRaw";
  }),
}));
mock.module("../../frontend/src/js/formats/index.ts", () => ({ resolveFormatHandler: () => handler }));
mock.module("../../frontend/src/js/ui/toasts.ts", () => ({ showToast }));
mock.module("@arbesk/asset-core/formats/3mf/color-editor.js", () => ({
  readSourceColors: jest.fn(async () => bakedColors),
}));
mock.module("../../frontend/src/js/services/cad-param-preview.ts", () => ({
  whenCadPreviewsSettled: settle,
  setCadParamBase: setBase,
}));
let current = new Map();
mock.module("../../frontend/src/js/state/cad-param-edits.ts", () => ({
  getPendingCadParamEdits: () => pending,
  getCadParamEdit: (id) => current.get(id),
  clearCadParamEdits: jest.fn(),
  cadPartIndex: (name) => {
    const m = /^(?:part-|object_)(\d+)$/.exec(name);
    return m ? Number(m[1]) - 1 : null;
  },
}));

const save = await import("../../frontend/src/js/services/asset-save/cad-param-save.ts");
const edits = await import("../../frontend/src/js/state/cad-param-edits.ts");

function okEdit(overrides = {}) {
  return {
    nodeId: "n1",
    savedDesign: SAVED,
    design: EDITED,
    bytes: meshTo3mf([TRI, { ...TRI, color: "#2c7ad3" }], EDITED),
    stats: { triangles: 2, bboxMm: { min: [0, 0, 0], max: [80, 1, 1] } },
    partColors: [undefined, "#2c7ad3"],
    status: "ok",
    ...overrides,
  };
}

function manifest() {
  return {
    asset_id: "a1",
    name: "Bracket",
    metadata: { cad: { summary: "box", stats: { triangles: 1, bboxMm: { min: [0, 0, 0], max: [60, 1, 1] } } } },
    scene: { nodes: [{ node_id: "n1", source: { cid: "bafyOld", path: "composite.3mf.json", format: "3mf" } }] },
  };
}

const CTX = { assetName: "Bracket", assetId: "a1", dedupMap: new Map() };

beforeEach(() => {
  written.length = 0;
  calls.length = 0;
  bakedColors = {};
  handler.decomposeForSave.mockClear();
  handler.editSourceColors.mockClear();
  showToast.mockClear();
  setBase.mockClear();
  edits.clearCadParamEdits.mockClear();
});

describe("applyCadParameterEdits", () => {
  it("points the node at a new CID with edited sidecar", async () => {
    const m = manifest();
    await save.applyCadParameterEdits(m, new Map([["n1", okEdit()]]), CTX);
    expect(m.scene.nodes[0].source).toEqual({ cid: "bafyComposite", path: "composite.3mf.json", format: "3mf" });
    expect(written[0].name).toBe("asset.3mf");
    const design = readDesignFrom3mf(written[0].bytes);
    expect(design.parameters.width.value).toBe(80);
    expect(design.summary).toBe("Parameters: width 60→80 mm, lid #d33a2c→#2c7ad3");
    expect(handler.decomposeForSave.mock.calls[0][0].source).toEqual({ cid: "bafyRaw", path: "asset.3mf", format: "3mf" });
  });

  it("keeps the rendered model bytes", async () => {
    const edit = okEdit();
    await save.applyCadParameterEdits(manifest(), new Map([["n1", edit]]), CTX);
    const model = (b) => strFromU8(unzipSync(b)["3D/3dmodel.model"]);
    expect(model(written[0].bytes)).toBe(model(edit.bytes));
  });

  it("carries baked colours by name", async () => {
    bakedColors = { "part-1": "#aabbcc", "part-3": "#112233" };
    const m = manifest();
    await save.applyCadParameterEdits(m, new Map([["n1", okEdit()]]), CTX);
    expect(handler.editSourceColors).toHaveBeenCalledTimes(1);
    expect(handler.editSourceColors.mock.calls[0][1]).toEqual({ "part-1": "#aabbcc" });
    expect(m.scene.nodes[0].source.cid).toBe("bafyRecoloured");
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      message: "Colours reset on part-3 (the part count changed).",
    }));
  });

  it("script colour wins", async () => {
    bakedColors = { "part-2": "#aabbcc" };
    await save.applyCadParameterEdits(manifest(), new Map([["n1", okEdit()]]), CTX);
    expect(handler.editSourceColors).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("updates metadata.cad.stats", async () => {
    const m = manifest();
    await save.applyCadParameterEdits(m, new Map([["n1", okEdit()]]), CTX);
    expect(m.metadata.cad.stats).toEqual({ triangles: 2, bboxMm: { min: [0, 0, 0], max: [80, 1, 1] } });
  });

  it("rejects an edit with no successful preview before writing anything", async () => {
    await expect(
      save.applyCadParameterEdits(manifest(), new Map([["n1", okEdit({ status: "error", bytes: null })]]), CTX),
    ).rejects.toThrow("CAD parameters have no successful preview");
    expect(written).toHaveLength(0);
  });

  it("returns the saved design per node", async () => {
    const edit = okEdit();
    const saved = await save.applyCadParameterEdits(manifest(), new Map([["n1", edit]]), CTX);
    expect(saved.get("n1").design.parameters.width.value).toBe(80);
    expect(saved.get("n1").design.summary).toMatch(/^Parameters: /);
    expect(saved.get("n1").edit).toBe(edit);
  });
});

describe("settledCadParamEdits", () => {
  it("waits for in-flight render", async () => {
    pending = new Map([["n1", okEdit({ status: "rendering", bytes: null })]]);
    settle.mockImplementationOnce(async () => {
      pending.set("n1", okEdit());
    });
    const snapshot = await save.settledCadParamEdits();
    expect(settle).toHaveBeenCalled();
    expect(snapshot.get("n1").status).toBe("ok");
    expect(snapshot).not.toBe(pending);
  });
});

describe("finishCadParameterSave", () => {
  it("moves the base on and clears the saved edits", () => {
    const edit = okEdit();
    current = new Map([["n1", edit]]);
    save.finishCadParameterSave(new Map([["n1", { design: EDITED, edit }]]));
    expect(setBase).toHaveBeenCalledWith("n1", EDITED);
    expect(edits.clearCadParamEdits).toHaveBeenCalledWith(["n1"]);
  });

  it("keeps an edit made while the save was uploading", () => {
    const edit = okEdit();
    current = new Map([["n1", okEdit({ status: "rendering" })]]);
    save.finishCadParameterSave(new Map([["n1", { design: EDITED, edit }]]));
    expect(setBase).toHaveBeenCalledWith("n1", EDITED);
    expect(edits.clearCadParamEdits).not.toHaveBeenCalled();
  });

  it("does nothing without saved CAD edits", () => {
    save.finishCadParameterSave(new Map());
    expect(edits.clearCadParamEdits).not.toHaveBeenCalled();
  });
});
