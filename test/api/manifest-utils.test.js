import { jest } from "@jest/globals";
import {
  getSceneNodes,
  bumpManifestVersion,
  validateManifest,
} from "../../src/api/manifest-utils.js";

describe("getSceneNodes", () => {
  it("returns the existing nodes array", () => {
    const manifest = { scene: { nodes: [{ node_id: "a" }] } };
    expect(getSceneNodes(manifest)).toEqual([{ node_id: "a" }]);
  });

  it("creates a scene object when missing", () => {
    const manifest = {};
    const nodes = getSceneNodes(manifest);
    expect(nodes).toEqual([]);
    expect(manifest.scene).toEqual({ nodes: [] });
  });

  it("creates a nodes array when missing", () => {
    const manifest = { scene: {} };
    const nodes = getSceneNodes(manifest);
    expect(nodes).toEqual([]);
    expect(manifest.scene).toEqual({ nodes: [] });
  });
});

describe("bumpManifestVersion", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("increments version from 0 to 1 when unset", () => {
    const manifest = {};
    bumpManifestVersion(manifest);
    expect(manifest.version).toBe(1);
  });

  it("increments an existing version", () => {
    const manifest = { version: 5 };
    bumpManifestVersion(manifest);
    expect(manifest.version).toBe(6);
  });

  it("sets a current timestamp", () => {
    const manifest = {};
    bumpManifestVersion(manifest);
    expect(manifest.timestamp).toBe(1_700_000_000_000);
  });

  it("sets prev_asset_manifest_cid when a previous CID is provided", () => {
    const manifest = {};
    bumpManifestVersion(manifest, "bafyPrev");
    expect(manifest.prev_asset_manifest_cid).toBe("bafyPrev");
  });

  it("does not overwrite prev_asset_manifest_cid when no previous CID is given", () => {
    const manifest = { prev_asset_manifest_cid: "bafyExisting" };
    bumpManifestVersion(manifest);
    expect(manifest.prev_asset_manifest_cid).toBe("bafyExisting");
  });

  it("leaves prev_asset_manifest_cid unchanged when explicitly passed null", () => {
    const manifest = { prev_asset_manifest_cid: "bafyExisting" };
    bumpManifestVersion(manifest, null);
    expect(manifest.prev_asset_manifest_cid).toBe("bafyExisting");
  });
});

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const result = validateManifest({ version: 1 });
    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ version: 1 });
  });

  it("accepts a manifest with scene nodes", () => {
    const manifest = {
      version: 1,
      scene: {
        nodes: [
          {
            node_id: "a",
            transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          },
        ],
      },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
  });

  it("rejects a manifest with an invalid node", () => {
    const result = validateManifest({ version: 1, scene: { nodes: [{}] } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/node_id/);
  });

  it("rejects an empty object", () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/version/);
  });
});
