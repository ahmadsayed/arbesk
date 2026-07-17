import fs from "fs";
import path from "path";

const BOX_PATH = path.resolve(process.cwd(), "mock-gltf-assets/box.3mf");

async function loadBoxGltf() {
  const { unzipBytes, strFromU8 } = await import(
    "../../frontend/src/js/3mf/zip.js"
  );
  const { parse3mfModel } = await import(
    "../../frontend/src/js/3mf/parser.js"
  );
  const { parsed3mfToGltf } = await import(
    "../../frontend/src/js/3mf/to-gltf.js"
  );
  const entries = unzipBytes(new Uint8Array(fs.readFileSync(BOX_PATH)));
  return parsed3mfToGltf(parse3mfModel(strFromU8(entries["3D/3dmodel.model"])));
}

describe("parsed3mfToGltf", () => {
  it("converts the box sample into a valid glTF 2.0 document", async () => {
    const gltf = await loadBoxGltf();
    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.meshes).toHaveLength(1);
    const primitive = gltf.meshes[0].primitives[0];
    expect(gltf.accessors[primitive.attributes.POSITION]).toMatchObject({
      componentType: 5126,
      count: 8,
      type: "VEC3",
      min: [0, 0, 0],
      max: [10, 20, 30],
    });
    expect(gltf.accessors[primitive.indices]).toMatchObject({
      componentType: 5125,
      count: 36,
      type: "SCALAR",
    });
    expect(
      gltf.buffers[0].uri.startsWith("data:application/octet-stream;base64,")
    ).toBe(true);
    expect(gltf.buffers[0].byteLength).toBe(8 * 12 + 36 * 4);
  });

  it("parents build items to a Z-up to Y-up root node", async () => {
    const gltf = await loadBoxGltf();
    const root = gltf.nodes[gltf.scenes[0].nodes[0]];
    expect(root.rotation[0]).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(root.rotation[1]).toBe(0);
    expect(root.rotation[2]).toBe(0);
    expect(root.rotation[3]).toBeCloseTo(Math.SQRT1_2, 5);
    expect(root.children).toEqual([1]);
    expect(gltf.nodes[1].mesh).toBe(0);
    expect(gltf.nodes[1].matrix).toBeUndefined();
  });

  it("decodes back to the original vertex and index data", async () => {
    const gltf = await loadBoxGltf();
    const base64 = gltf.buffers[0].uri.split(",")[1];
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    const positions = new Float32Array(bytes.buffer, 0, 24);
    expect(Array.from(positions.slice(0, 6))).toEqual([0, 0, 0, 10, 0, 0]);
    const indices = new Uint32Array(bytes.buffer, 24 * 4, 36);
    expect(Array.from(indices.slice(0, 3))).toEqual([3, 2, 1]);
  });

  it("maps basematerials to glTF PBR materials and converts item transforms", async () => {
    const { parsed3mfToGltf } = await import(
      "../../frontend/src/js/3mf/to-gltf.js"
    );
    const parsed = {
      unit: "millimeter",
      objects: [
        {
          id: "1",
          name: "",
          pid: "2",
          pindex: 1,
          vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          triangles: [0, 1, 2],
        },
      ],
      basematerials: [
        { groupId: "2", name: "Red", color: "#FF0000FF" },
        { groupId: "2", name: "Green", color: "#00FF00FF" },
      ],
      items: [
        {
          objectId: "1",
          transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 6, 7],
        },
      ],
    };
    const gltf = parsed3mfToGltf(parsed);
    expect(gltf.materials).toHaveLength(1);
    expect(gltf.materials[0].name).toBe("Green");
    expect(
      gltf.materials[0].pbrMetallicRoughness.baseColorFactor
    ).toEqual([0, 1, 0, 1]);
    expect(gltf.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0);
    expect(gltf.meshes[0].primitives[0].material).toBe(0);
    expect(gltf.nodes[1].matrix).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      5, 6, 7, 1,
    ]);
  });

  it("maps rotated build-item transforms without transposing", async () => {
    const { parsed3mfToGltf } = await import(
      "../../frontend/src/js/3mf/to-gltf.js"
    );
    const parsed = {
      unit: "millimeter",
      objects: [
        {
          id: "1",
          name: "",
          pid: null,
          pindex: null,
          vertices: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          triangles: [0, 1, 2],
        },
      ],
      basematerials: [],
      items: [
        {
          objectId: "1",
          // rotation 90° about Z (+X → +Y) + translation (5,6,7)
          transform: [0, 1, 0, -1, 0, 0, 0, 0, 1, 5, 6, 7],
        },
      ],
    };
    const gltf = parsed3mfToGltf(parsed);
    expect(gltf.nodes[1].matrix).toEqual([
      0, 1, 0, 0,
      -1, 0, 0, 0,
      0, 0, 1, 0,
      5, 6, 7, 1,
    ]);
  });
});
