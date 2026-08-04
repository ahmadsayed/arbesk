import { followupActionsFor } from "../../frontend/src/js/state/generation-actions.js";

describe("followupActionsFor", () => {
  it("returns all four actions for a plain tripo3d generation", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "model" }))
      .toEqual(["retexture", "retopo", "auto-rig", "animate"]);
  });
  it("returns all four for retopo/texture results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "retopo" })).toHaveLength(4);
    expect(followupActionsFor({ provider: "tripo3d", task: "texture" })).toHaveLength(4);
  });
  it("keeps only animate on rig-only results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "rig" })).toEqual(["animate"]);
  });
  it("returns nothing for animated results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "animate" })).toEqual([]);
  });
  it("returns nothing for the mock provider", () => {
    expect(followupActionsFor({ provider: "mock", task: "model" })).toEqual([]);
  });
});
