/**
 * Collection-write helpers: the single canonical implementation of the
 * collection-manifest literal, the version-chain mutation (version bump +
 * prev link), and the composite-source sniff used by Studio and the besk CLI.
 */
import {
  buildCollectionManifest,
  applyCollectionMutation,
} from "@arbesk/asset-core/utils/collections.js";
import { resolveCompositeSourceCid } from "@arbesk/asset-core/catalog/index.js";

describe("buildCollectionManifest", () => {
  test("produces the exact v1 collection literal", () => {
    const m = buildCollectionManifest("Studio Room");
    expect(m).toEqual({
      type: "collection",
      name: "Studio Room",
      asset_id: expect.stringMatching(/^collection_\d+$/),
      version: 1,
      timestamp: expect.any(Number),
      assets: {},
      prev_asset_manifest_cid: null,
    });
  });
});

describe("applyCollectionMutation", () => {
  const base = {
    type: "collection",
    name: "c",
    asset_id: "collection_1",
    version: 3,
    timestamp: 1,
    assets: { a: "cidA" },
    prev_asset_manifest_cid: "cidPrev",
  };

  test("bumps version, links prev cid, applies the mutation, does not mutate the input", () => {
    const next = applyCollectionMutation(base, "bafyCurrent", (draft) => {
      draft.assets.b = "cidB";
    });
    expect(next.version).toBe(4);
    expect(next.prev_asset_manifest_cid).toBe("bafyCurrent");
    expect(next.assets).toEqual({ a: "cidA", b: "cidB" });
    // input untouched
    expect(base.version).toBe(3);
    expect(base.assets).toEqual({ a: "cidA" });
  });

  test("treats a missing version as 0", () => {
    const noVersion = { type: "collection", assets: {} };
    const next = applyCollectionMutation(noVersion, "bafyC", () => {});
    expect(next.version).toBe(1);
  });
});

describe("resolveCompositeSourceCid", () => {
  test("returns the root node source cid for a wrapping asset manifest", () => {
    const m = { type: "asset", scene: { nodes: [{ source: { cid: "bafyComposite" } }] } };
    expect(resolveCompositeSourceCid(m)).toBe("bafyComposite");
  });

  test("returns null when the manifest IS the composite (has glTF markers)", () => {
    expect(resolveCompositeSourceCid({ nodes: [], meshes: [] })).toBeNull();
    expect(resolveCompositeSourceCid({ arbesk_format: "3mf" })).toBeNull();
    expect(resolveCompositeSourceCid({})).toBeNull();
  });
});
