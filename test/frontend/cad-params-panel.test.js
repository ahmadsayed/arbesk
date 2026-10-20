// @test-env dom
/**
 * Inspector Parameters section: which rows show, and what typing, committing
 * and resetting do to the pending-edit store.
 * @remarks Asserts on the Alpine store and component methods (the source of
 *   truth); the x-for render is covered by E2E.
 */
import { beforeAll, beforeEach, describe, expect, it, jest, mock } from "bun:test";

const DESIGN = {
  code: "return box(P.w, P.d, 1);",
  parameters: {
    w: { value: 60, unit: "mm", min: 10, max: 200, label: "Width" },
    d: { value: 30, unit: "mm" },
    unused: { value: 5, unit: "mm" },
    c: { type: "color", value: "#112233", label: "Body colour" },
  },
  summary: "box",
};

const editMode = { editing: true, subs: new Set() };
let manifest;
let resolveDesign;
const scheduleCadPreview = jest.fn();
let base;
const pushUndoEntry = jest.fn();

mock.module("../../frontend/src/js/state/edit-mode.ts", () => ({
  isEditing: () => editMode.editing,
  subscribeEditMode: (fn) => {
    editMode.subs.add(fn);
    return () => editMode.subs.delete(fn);
  },
}));
mock.module("../../frontend/src/js/services/cad-design-source.ts", () => ({
  resolveCadDesign: (cid) => resolveDesign(cid),
}));
mock.module("../../frontend/src/js/services/cad-param-preview.ts", () => ({
  scheduleCadPreview,
  setCadParamBase: jest.fn(),
  getCadParamBase: () => base,
}));
mock.module("../../frontend/src/js/engine/undo-stack.ts", () => ({ pushUndoEntry }));
mock.module("@arbesk/asset-core/domain/asset.js", () => ({ getCurrentManifest: () => manifest }));

let panel;
let edits;
let state;
beforeAll(async () => {
  panel = await import("../../frontend/src/js/ui/cad-params-panel.ts");
  edits = await import("../../frontend/src/js/state/cad-param-edits.ts");
  await new Promise((r) => setTimeout(r, 0)); // let Alpine.start() run
  state = panel.cadParamsState;
});

const cadManifest = (design = DESIGN) => {
  resolveDesign = jest.fn(async () => design);
  manifest = {
    metadata: { cad: { summary: "box" } },
    scene: { nodes: [{ node_id: "n1", source: { cid: "bafyCad", path: "asset.3mf", format: "3mf" } }] },
  };
};

beforeEach(() => {
  edits.clearCadParamEdits();
  scheduleCadPreview.mockClear();
  pushUndoEntry.mockClear();
  editMode.editing = true;
  cadManifest();
});

const rowNames = () => state().rows.map((r) => r.name);
const row = (name) => state().rows.find((r) => r.name === name);

describe("showCadParams", () => {
  it("lists only used parameters", async () => {
    await panel.showCadParams("n1");
    expect(state().visible).toBe(true);
    expect(rowNames()).toEqual(["w", "d"]);
  });

  it("dynamic shows all", async () => {
    cadManifest({ ...DESIGN, code: "const k = 'w'; return box(P[k], 1, 1);" });
    await panel.showCadParams("n1");
    expect(rowNames()).toEqual(["w", "d", "unused", "c"]);
  });

  it("describes length and colour rows", async () => {
    cadManifest({ ...DESIGN, code: "return color(box(P.w, P.d, 1), P.c);" });
    await panel.showCadParams("n1");
    expect(row("w")).toMatchObject({ kind: "length", label: "Width", value: 60, min: 10, max: 200, hasRange: true });
    expect(row("d")).toMatchObject({ kind: "length", label: "d", hasRange: false });
    expect(row("c")).toMatchObject({ kind: "color", label: "Body colour", value: "#112233" });
  });

  it("hidden for non-CAD nodes", async () => {
    manifest = { metadata: {}, scene: { nodes: [{ node_id: "n1", source: { cid: "bafyGlb" } }] } };
    await panel.showCadParams("n1");
    expect(state().visible).toBe(false);
  });

  it("hidden when the design cannot be read", async () => {
    resolveDesign = jest.fn(async () => null);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await panel.showCadParams("n1");
    expect(state().visible).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("newer runtime", async () => {
    cadManifest({ ...DESIGN, code: "return futureHelper(P.w);" });
    await panel.showCadParams("n1");
    expect(state().visible).toBe(true);
    expect(state().blocked).toBe(true);
    expect(state().statusText).toBe("This part was made with a newer CAD runtime — refresh the page.");
    expect(state().editable).toBe(false);
  });

  it("hideCadParams hides the section", async () => {
    await panel.showCadParams("n1");
    panel.hideCadParams();
    expect(state().visible).toBe(false);
  });
});

describe("after a save", () => {
  it("follows a save to the new saved values", async () => {
    await panel.showCadParams("n1");
    base = { ...DESIGN, parameters: { ...DESIGN.parameters, w: { ...DESIGN.parameters.w, value: 90 } } };
    try {
      edits.clearCadParamEdits(["n1"]);
      expect(row("w").value).toBe(90);
    } finally {
      base = undefined;
    }
  });
});

describe("editing", () => {
  let c;
  beforeEach(async () => {
    await panel.showCadParams("n1");
    c = panel.cadParamsPanel();
  });

  it("input schedules preview, change pushes one undo entry", () => {
    for (const v of ["61", "62", "63", "64", "65"]) c.onInput("w", v);
    c.onCommit("w", "65");
    expect(scheduleCadPreview).toHaveBeenCalledWith("n1");
    expect(edits.getCadParamEdit("n1").design.parameters.w.value).toBe(65);
    expect(pushUndoEntry).toHaveBeenCalledTimes(1);
    const entry = pushUndoEntry.mock.calls[0][0];
    expect(entry.type).toBe("cad-params");
    expect(entry.items[0]).toMatchObject({ nodeId: "n1", before: { w: 60 }, after: { w: 65 } });
  });

  it("clamps on commit", () => {
    c.onCommit("w", "999");
    expect(edits.getCadParamEdit("n1").design.parameters.w.value).toBe(200);
    expect(row("w").value).toBe(200);
  });

  it("empty or non-numeric input is ignored", () => {
    c.onInput("w", "");
    c.onCommit("w", "abc");
    expect(edits.getCadParamEdit("n1")).toBeUndefined();
    expect(row("w").value).toBe(60);
    expect(pushUndoEntry).not.toHaveBeenCalled();
  });

  it("View mode disables inputs", async () => {
    editMode.editing = false;
    for (const fn of editMode.subs) fn();
    expect(state().editable).toBe(false);
    expect(state().hint).toBe("Switch to Edit to change parameters.");
    c.onCommit("w", "70");
    expect(edits.getCadParamEdit("n1")).toBeUndefined();
  });

  it("status follows the store", async () => {
    expect(state().statusText).toBe("Saved values");
    c.onCommit("w", "70");
    expect(state().statusText).toBe("Rebuilding…");
    edits.markCadParamRendered("n1", { bytes: new Uint8Array([1]), stats: {} });
    expect(state().statusText).toBe("Preview up to date · not saved");
  });

  it("error status", () => {
    c.onCommit("w", "70");
    edits.markCadParamFailed("n1", "CAD_KERNEL_FAILED", "fillet does not fit");
    expect(state().statusText).toBe("fillet does not fit");
    expect(state().status).toBe("error");
  });

  it("an undo moves the commit baseline", () => {
    c.onCommit("w", "80");
    // What the cad-params undo applier does: back to the saved value.
    edits.setCadParamValues("n1", DESIGN, { w: 60 });
    c.onCommit("w", "70");
    expect(pushUndoEntry).toHaveBeenCalledTimes(2);
    expect(pushUndoEntry.mock.calls[1][0].items[0]).toMatchObject({ before: { w: 60 }, after: { w: 70 } });
  });

  it("a render landing mid-drag keeps the gesture's baseline", () => {
    c.onInput("w", "70");
    edits.markCadParamRendered("n1", { bytes: new Uint8Array([1]), stats: {} });
    c.onInput("w", "75");
    c.onCommit("w", "75");
    expect(pushUndoEntry.mock.calls[0][0].items[0]).toMatchObject({ before: { w: 60 }, after: { w: 75 } });
  });

  it("Reset restores saved values", () => {
    c.onCommit("w", "70");
    c.reset();
    expect(edits.getCadParamEdit("n1")).toBeUndefined();
    expect(row("w").value).toBe(60);
    expect(pushUndoEntry).toHaveBeenCalledTimes(2);
  });

  it("a colour input updates the colour parameter", async () => {
    cadManifest({ ...DESIGN, code: "return color(box(P.w, P.d, 1), P.c);" });
    await panel.showCadParams("n1");
    c.onCommit("c", "#00FF00");
    expect(edits.getCadParamEdit("n1").design.parameters.c.value).toBe("#00ff00");
  });
});

describe("colorParameterForPart", () => {
  const design = {
    ...DESIGN,
    parameters: { ...DESIGN.parameters, lid: { type: "color", value: "#d33a2c" }, trim: { type: "color", value: "#d33a2c" } },
  };

  it("finds the colour parameter whose value is the part's colour", () => {
    expect(panel.colorParameterForPart(design, "#112233")).toBe("c");
    expect(panel.colorParameterForPart(design, "#D33A2C")).toBe("lid");
  });

  it("first parameter wins on equal values", () => {
    expect(panel.colorParameterForPart(design, "#d33a2c")).toBe("lid");
  });

  it("tolerates a one-step rounding difference and rejects others", () => {
    expect(panel.colorParameterForPart(design, "#d33b2c")).toBe("lid");
    expect(panel.colorParameterForPart(design, "#ffffff")).toBeNull();
    expect(panel.colorParameterForPart(design, undefined)).toBeNull();
  });
});

describe("routeCadPartColor", () => {
  const coloured = { ...DESIGN, code: "return [box(P.w, P.d, 1), color(box(1, 1, 1), P.c)];" };

  beforeEach(async () => {
    cadManifest(coloured);
    await panel.showCadParams("n1");
  });

  it("routes a CAD part colour to its parameter", () => {
    expect(panel.routeCadPartColor("n1", "part-2", "#112233", "#00FF00", true)).toBe(true);
    expect(edits.getCadParamEdit("n1").design.parameters.c.value).toBe("#00ff00");
    expect(pushUndoEntry).toHaveBeenCalledTimes(1);
  });

  it("keeps routing through a drag with no render in between", () => {
    expect(panel.routeCadPartColor("n1", "part-2", "#112233", "#00ff00")).toBe(true);
    expect(panel.routeCadPartColor("n1", "part-2", "#112233", "#00ff40")).toBe(true);
    expect(panel.routeCadPartColor("n1", "part-2", "#112233", "#00ff80", true)).toBe(true);
    expect(edits.getCadParamEdit("n1").design.parameters.c.value).toBe("#00ff80");
    expect(pushUndoEntry).toHaveBeenCalledTimes(1);
    expect(pushUndoEntry.mock.calls[0][0].items[0]).toMatchObject({ before: { c: "#112233" }, after: { c: "#00ff80" } });
  });

  it("uses the rendered part colours once a preview exists", () => {
    panel.routeCadPartColor("n1", "part-2", "#112233", "#00ff00");
    edits.markCadParamRendered("n1", { bytes: new Uint8Array([1]), stats: {}, partColors: [undefined, "#00ff00"] });
    // The viewport may still show the old colour; the route holds.
    expect(panel.routeCadPartColor("n1", "part-2", "#112233", "#0000ff")).toBe(true);
    expect(edits.getCadParamEdit("n1").design.parameters.c.value).toBe("#0000ff");
  });

  it("falls back to the source bake for a part with no colour parameter", () => {
    expect(panel.routeCadPartColor("n1", "part-1", "#cccccc", "#00ff00")).toBe(false);
    expect(edits.getCadParamEdit("n1")).toBeUndefined();
  });

  it("does nothing for another node or in View mode", () => {
    expect(panel.routeCadPartColor("other", "part-2", "#112233", "#00ff00")).toBe(false);
    editMode.editing = false;
    for (const fn of editMode.subs) fn();
    expect(panel.routeCadPartColor("n1", "part-2", "#112233", "#00ff00")).toBe(false);
  });
});
