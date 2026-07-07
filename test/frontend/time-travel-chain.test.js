/**
 * @jest-environment jsdom
 */
import { jest, expect, test, describe, beforeAll } from "@jest/globals";

// time-travel.js statically imports scene-graph (engine-heavy) and remote-ipfs;
// mock both before the dynamic import.
jest.unstable_mockModule(
  "../../frontend/src/js/engine/scene-graph.js",
  () => ({ getNodeMeshes: () => [] })
);

const getFromRemoteIPFS = jest.fn();
jest.unstable_mockModule("../../frontend/src/js/ipfs/remote-ipfs.js", () => ({
  getFromRemoteIPFS,
}));

let walkManifestChain;
beforeAll(async () => {
  ({ walkManifestChain } = await import(
    "../../frontend/src/js/engine/time-travel.js"
  ));
});

const NODE_A = {
  node_id: "node-a",
  source: { cid: "src-a" },
  post_processor: { color: "#ff0000" },
};
const NODE_A_V1 = {
  node_id: "node-a",
  source: { cid: "src-a" },
  post_processor: null,
};
const NODE_B = { node_id: "node-b", source: { cid: "src-b" } };

const MANIFESTS = {
  "cid-v2": {
    version: 2,
    name: "Test",
    timestamp: "2026-07-07T00:00:00Z",
    prev_asset_manifest_cid: "cid-v1",
    scene: { nodes: [NODE_A, NODE_B] },
  },
  "cid-v1": {
    version: 1,
    name: "Test",
    timestamp: "2026-07-06T00:00:00Z",
    prev_asset_manifest_cid: null,
    scene: { nodes: [NODE_A_V1] },
  },
};

describe("walkManifestChain per-node snapshots", () => {
  test("each entry carries a nodes map keyed by node_id", async () => {
    getFromRemoteIPFS.mockImplementation(async (cid) => MANIFESTS[cid]);
    const chain = await walkManifestChain("cid-v2");

    expect(chain).toHaveLength(2);
    // Chronological order: v1 first.
    expect(chain[0].version).toBe(1);
    expect(Object.keys(chain[0].nodes)).toEqual(["node-a"]);
    expect(Object.keys(chain[1].nodes).sort()).toEqual(["node-a", "node-b"]);

    // Snapshots are strings and change when post_processor changes.
    expect(typeof chain[0].nodes["node-a"]).toBe("string");
    expect(chain[0].nodes["node-a"]).not.toBe(chain[1].nodes["node-a"]);
  });

  test("nodes without node_id are skipped", async () => {
    getFromRemoteIPFS.mockImplementation(async () => ({
      version: 1,
      scene: { nodes: [{ source: { cid: "anon" } }] },
    }));
    const chain = await walkManifestChain("cid-anon-only");
    expect(chain[0].nodes).toEqual({});
  });
});
