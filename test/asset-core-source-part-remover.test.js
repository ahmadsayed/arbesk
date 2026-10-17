/**
 * Source part removal (packages/asset-core/src/formats/gltf/source-part-remover.ts):
 * the Studio's "Remove part" save step. Parts are unlinked from the glTF
 * scene graph by node name and the edited glTF is written under a new CID.
 */
import { afterAll, beforeEach, describe, expect, it, jest } from "bun:test";

const { initRuntime, _resetRuntimeForTesting } = await import("@arbesk/asset-core/runtime.js");
const ipfsRead = { getJSON: jest.fn(), getBytes: jest.fn(), getRawBytes: jest.fn() };
const ipfsWrite = { write: jest.fn(), writeJSON: jest.fn() };
initRuntime({ ipfsRead, ipfsWrite });

const { removeNodesByName, removeSourceParts, gltfNodeNameForMesh } = await import(
  "@arbesk/asset-core/formats/gltf/source-part-remover.js"
);

afterAll(() => _resetRuntimeForTesting());

/** The split goat, trimmed: head, a horn per side, and a nested piece. */
function goatGltf() {
  return {
    scenes: [{ nodes: [0, 1, 2, 3] }],
    nodes: [
      { name: "tripo_part_1", mesh: 0 },
      { name: "tripo_part_9", mesh: 1 },
      { name: "tripo_part_14", mesh: 2 },
      { name: "body", children: [4] },
      { name: "tripo_part_20", mesh: 3 },
    ],
  };
}

describe("removeNodesByName", () => {
  it("unlinks the named parts from the scene, keeping the rest", () => {
    const gltf = goatGltf();
    expect(removeNodesByName(gltf, ["tripo_part_9", "tripo_part_14"])).toBe(2);
    expect(gltf.scenes[0].nodes).toEqual([0, 3]);
    // Node data stays (orphaned): indices elsewhere remain valid.
    expect(gltf.nodes).toHaveLength(5);
  });

  it("unlinks nested parts from their parent", () => {
    const gltf = goatGltf();
    removeNodesByName(gltf, ["tripo_part_20"]);
    expect(gltf.nodes[3].children).toEqual([]);
  });

  it("maps Babylon multi-primitive mesh names back to the node", () => {
    expect(gltfNodeNameForMesh("tripo_part_9_primitive1")).toBe("tripo_part_9");
    const gltf = goatGltf();
    expect(removeNodesByName(gltf, ["tripo_part_9_primitive0"])).toBe(1);
  });

  it("removes nothing for unknown names", () => {
    const gltf = goatGltf();
    expect(removeNodesByName(gltf, ["horn"])).toBe(0);
    expect(gltf.scenes[0].nodes).toEqual([0, 1, 2, 3]);
  });
});

describe("removeSourceParts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ipfsRead.getBytes.mockResolvedValue(new TextEncoder().encode("{}"));
    ipfsRead.getJSON.mockResolvedValue(goatGltf());
    ipfsWrite.writeJSON.mockResolvedValue("bafyHornless");
  });

  it("writes the source without the parts under a new CID", async () => {
    const result = await removeSourceParts("bafyGoat", ["tripo_part_9", "tripo_part_14"], { assetName: "baby-goat" });
    expect(result).toEqual({ sourceCid: "bafyHornless", format: "gltf", removed: 2 });
    const [written, , opts] = ipfsWrite.writeJSON.mock.calls[0];
    expect(written.scenes[0].nodes).toEqual([0, 3]);
    expect(opts).toMatchObject({ compress: true, filename: "baby-goat_parts.gltf" });
  });

  it("keeps the source untouched when no named part exists", async () => {
    const result = await removeSourceParts("bafyGoat", ["horn"]);
    expect(result).toEqual({ sourceCid: "bafyGoat", removed: 0 });
    expect(ipfsWrite.writeJSON).not.toHaveBeenCalled();
  });
});
