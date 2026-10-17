import { describe, expect, it } from "bun:test";
import { followupActionsFor } from "@arbesk/asset-core/domain/generation-actions.js";

describe("followupActionsFor", () => {
  it("returns all five actions for a plain tripo3d generation", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "model" }))
      .toEqual(["retexture", "retopo", "split", "auto-rig", "animate"]);
  });
  it("returns all five for retopo/texture results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "retopo" })).toHaveLength(5);
    expect(followupActionsFor({ provider: "tripo3d", task: "texture" })).toHaveLength(5);
  });
  it("keeps only animate on rig-only results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "rig" })).toEqual(["animate"]);
  });
  it("split results drop Split and Retopo (retopo would merge the parts back)", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "split" })).toEqual(["retexture", "auto-rig", "animate"]);
  });
  it("returns nothing for animated results", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "animate" })).toEqual([]);
  });
  it("returns nothing for the mock provider", () => {
    expect(followupActionsFor({ provider: "mock", task: "model" })).toEqual([]);
  });
  it("returns nothing for a known non-glTF source format (3MF)", () => {
    // Tripo follow-up endpoints accept glTF/GLB only — offering the actions
    // would fail upstream (rig-check rejects non-GLB with code 1004).
    expect(followupActionsFor({ provider: "tripo3d", task: "model", format: "3mf" })).toEqual([]);
  });
  it("keeps all five actions for glb/gltf formats", () => {
    expect(followupActionsFor({ provider: "tripo3d", task: "model", format: "glb" })).toHaveLength(5);
    expect(followupActionsFor({ provider: "tripo3d", task: "model", format: "gltf" })).toHaveLength(5);
  });
  it("returns all five actions for an uploaded glTF/GLB model", () => {
    expect(followupActionsFor({ provider: "upload", task: "upload", format: "glb" }))
      .toEqual(["retexture", "retopo", "split", "auto-rig", "animate"]);
  });
  it("returns nothing for an uploaded 3MF model", () => {
    expect(followupActionsFor({ provider: "upload", task: "upload", format: "3mf" })).toEqual([]);
  });
});
