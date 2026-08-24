import {
  manifestSchema,
  validateManifest,
  getSceneNodes,
  bumpManifestVersion,
} from "@arbesk/asset-core/manifest/utils.js";

describe("asset-core manifest module", () => {
  test("exposes the zod manifestSchema", () => {
    expect(manifestSchema).toBeDefined();
    expect(typeof manifestSchema.safeParse).toBe("function");
  });

  test("validateManifest accepts a minimal valid manifest", () => {
    const m = { version: 1, scene: { nodes: [] }, timestamp: new Date().toISOString() };
    expect(validateManifest(m).valid).toBe(true);
  });

  test("validateManifest rejects a non-object with errors", () => {
    const r = validateManifest(42);
    expect(r.valid).toBe(false);
    expect(r.errors?.length).toBeGreaterThan(0);
  });

  test("validateManifest strips unknown keys (current wire contract)", () => {
    const r = validateManifest({ version: 1, unknownField: "x" });
    expect(r.valid).toBe(true);
    expect(r.data).toEqual({ version: 1 });
  });

  test("getSceneNodes creates scene.nodes when missing", () => {
    const m = {};
    expect(Array.isArray(getSceneNodes(m))).toBe(true);
    expect(m.scene.nodes).toEqual([]);
  });

  test("bumpManifestVersion increments and chains prev cid", () => {
    const m = { version: 3 };
    bumpManifestVersion(m, "bafyprev");
    expect(m.version).toBe(4);
    expect(m.prev_asset_manifest_cid).toBe("bafyprev");
    expect(typeof m.timestamp).toBe("number");
  });
});
