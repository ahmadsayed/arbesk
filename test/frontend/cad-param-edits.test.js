import { beforeEach, describe, expect, it } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";

const SAVED = {
  code: "return box(P.w, P.d, 1);",
  parameters: {
    w: { value: 60, unit: "mm", min: 10, max: 200 },
    d: { value: 30, unit: "mm" },
    c: { type: "color", value: "#112233" },
  },
  summary: "box",
  turn: 2,
};

let edits;
let unsaved;
beforeEach(async () => {
  resetModules();
  edits = await import("../../frontend/src/js/state/cad-param-edits.ts");
  unsaved = await import("../../frontend/src/js/state/unsaved-changes.ts");
  edits.clearCadParamEdits();
});

describe("cad-param-edits", () => {
  it("records an edit with the new values and keeps the saved design", () => {
    const edit = edits.setCadParamValues("n1", SAVED, { w: 80, c: "#00ff00" });
    expect(edit.design.parameters.w).toEqual({ value: 80, unit: "mm", min: 10, max: 200 });
    expect(edit.design.parameters.c).toEqual({ type: "color", value: "#00ff00" });
    expect(edit.design.parameters.d.value).toBe(30);
    expect(edit.savedDesign).toBe(SAVED);
    expect(edit.status).toBe("rendering");
    expect(edit.bytes).toBeNull();
    expect(edits.getCadParamEdit("n1")).toBe(edit);
    expect(unsaved.hasUnsavedChanges()).toBe(true);
  });

  it("equal-to-saved drops the edit", () => {
    edits.setCadParamValues("n1", SAVED, { w: 80 });
    edits.setCadParamValues("n1", SAVED, { w: 60 });
    expect(edits.getCadParamEdit("n1")).toBeUndefined();
    expect(unsaved.hasUnsavedChanges()).toBe(false);
  });

  it("cadParamValues reads every value of a design", () => {
    expect(edits.cadParamValues(SAVED)).toEqual({ w: 60, d: 30, c: "#112233" });
  });

  it("a scene teardown drops every edit", async () => {
    const { emit, EVENTS } = await import("@arbesk/asset-core/events/bus.js");
    edits.setCadParamValues("n1", SAVED, { w: 80 });
    emit(EVENTS.SCENE_CLEARED);
    expect(edits.getPendingCadParamEdits().size).toBe(0);
  });

  it("clearCadParamEdits clears only the named nodes", () => {
    edits.setCadParamValues("n1", SAVED, { w: 80 });
    edits.setCadParamValues("n2", SAVED, { w: 90 });
    edits.clearCadParamEdits(["n1"]);
    expect([...edits.getPendingCadParamEdits().keys()]).toEqual(["n2"]);
  });
});
