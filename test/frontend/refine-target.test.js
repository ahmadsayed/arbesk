import { beforeEach, describe, expect, jest, mock, test } from "bun:test";

const resolveCadDesign = jest.fn();
mock.module("../../frontend/src/js/services/cad-design-source.js", () => ({ resolveCadDesign }));

const rt = await import("../../frontend/src/js/ui/refine-target.js");
const DESIGN = { code: "return box(1,1,1);", parameters: { s: { value: 1, unit: "mm" } }, summary: "cube", turn: 1 };

beforeEach(() => resolveCadDesign.mockReset());

describe("decideGenerationRoute", () => {
  test("the chip decides; the selector only applies without one", () => {
    expect(rt.decideGenerationRoute({ activeKind: "cad", selectedProvider: "tripo3d", hasImage: false }))
      .toEqual({ mode: "cad-edit", provider: "cad" });
    expect(rt.decideGenerationRoute({ activeKind: "mesh", selectedProvider: "cad", hasImage: false }))
      .toEqual({ mode: "retexture", provider: "tripo3d" });
    expect(rt.decideGenerationRoute({ activeKind: null, selectedProvider: "cad", hasImage: false }))
      .toEqual({ mode: "fresh", provider: "cad" });
  });

  test("an attached image starts fresh with the selected provider", () => {
    expect(rt.decideGenerationRoute({ activeKind: "mesh", selectedProvider: "tripo3d", hasImage: true }))
      .toEqual({ mode: "fresh", provider: "tripo3d" });
    expect(rt.decideGenerationRoute({ activeKind: "cad", selectedProvider: "cad", hasImage: true }))
      .toEqual({ mode: "fresh", provider: "cad" });
  });

  test("chipProvider maps kinds to providers", () => {
    expect(rt.chipProvider("cad")).toBe("cad");
    expect(rt.chipProvider("mesh")).toBe("tripo3d");
  });
});

describe("cadChipFromManifest", () => {
  test("builds a cad chip from a manifest with metadata.cad", () => {
    const manifest = {
      metadata: { cad: { summary: "box" } },
      scene: { nodes: [{ node_id: "c", child_ref: {} }, { node_id: "r", source: { cid: "bafyRoot", format: "3mf" } }] },
    };
    expect(rt.cadChipFromManifest(manifest, "bafyM", "Box")).toEqual({
      kind: "cad", sourceAssetCid: "bafyRoot", manifestCid: "bafyM", name: "Box",
    });
  });

  test("returns null without metadata.cad or a root source", () => {
    expect(rt.cadChipFromManifest({ scene: { nodes: [{ source: { cid: "x" } }] } }, "m", "n")).toBeNull();
    expect(rt.cadChipFromManifest({ metadata: { cad: {} }, scene: { nodes: [] } }, "m", "n")).toBeNull();
  });
});

describe("resolveActiveDesign", () => {
  test("returns a held design without fetching", async () => {
    const v = { kind: "cad", sourceAssetCid: "bafy", manifestCid: null, name: "n", design: DESIGN };
    expect(await rt.resolveActiveDesign(v)).toBe(DESIGN);
    expect(resolveCadDesign).not.toHaveBeenCalled();
  });

  test("fetches once and caches on the version", async () => {
    resolveCadDesign.mockResolvedValue(DESIGN);
    const v = { kind: "cad", sourceAssetCid: "bafy", manifestCid: null, name: "n" };
    expect(await rt.resolveActiveDesign(v)).toBe(DESIGN);
    expect(await rt.resolveActiveDesign(v)).toBe(DESIGN);
    expect(resolveCadDesign).toHaveBeenCalledTimes(1);
    expect(v.design).toBe(DESIGN);
  });

  test("returns null when the design cannot be read", async () => {
    resolveCadDesign.mockResolvedValue(null);
    expect(await rt.resolveActiveDesign({ kind: "cad", sourceAssetCid: "x", manifestCid: null, name: "n" })).toBeNull();
  });
});

describe("isPriorDesignRejection", () => {
  test("recognises a 400 whose issues point at priorDesign", () => {
    const err = Object.assign(new Error("Invalid request body"), {
      status: 400, code: "VALIDATION_ERROR", details: { issues: [{ path: ["priorDesign", "code"], message: "too long" }] },
    });
    expect(rt.isPriorDesignRejection(err)).toBe(true);
    expect(rt.isPriorDesignRejection(Object.assign(new Error("x"), { status: 400, details: { issues: [{ path: ["prompt"] }] } }))).toBe(false);
    expect(rt.isPriorDesignRejection(new Error("plain"))).toBe(false);
  });
});
