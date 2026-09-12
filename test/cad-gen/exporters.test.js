/**
 * Core exporter tests: GLB, 3MF and the design-document sidecar.
 *
 * The asset-core round trip is the important one - it proves the package is
 * readable by Arbesk's own 3MF parser, the closest available proxy for
 * third-party slicer validity.
 */
import { unzipSync, strFromU8 } from "fflate";
import {
  meshToGlb, meshTo3mf, readDesignFrom3mf, serializeDesign, parseEmbeddedDesign,
  attributionsFor,
} from "@arbesk/cad-gen";
import { detectFormat } from "@arbesk/asset-core/formats/index.js";

/** A unit tetrahedron: 4 vertices, 4 triangles. */
const MESH = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
  indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
};

const DESIGN = {
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 2,
};

/** Reads the JSON chunk out of a GLB container. */
function readGlbJson(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
}

describe("meshTo3mf", () => {
  it("writes a 3MF package with the required OPC parts", () => {
    const bytes = meshTo3mf(MESH, DESIGN);
    expect(detectFormat(bytes)).toBe("3mf");
    const parts = unzipSync(bytes);
    expect(Object.keys(parts)).toContain("[Content_Types].xml");
    expect(Object.keys(parts)).toContain("_rels/.rels");
    expect(Object.keys(parts)).toContain("3D/3dmodel.model");
    const model = strFromU8(parts["3D/3dmodel.model"]);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain("<vertices>");
    expect((model.match(/<triangle /g) || []).length).toBe(4);
    expect(model).toContain("<build>");
    expect(model).toContain('<item objectid="1"/>');
  });

  it("writes every vertex at its true millimetre coordinate", () => {
    const model = strFromU8(unzipSync(meshTo3mf(MESH, DESIGN))["3D/3dmodel.model"]);
    expect(model).toContain('<vertex x="10" y="0" z="0"/>');
    expect(model).toContain('<vertex x="0" y="0" z="10"/>');
  });

  it("is readable by asset-core's own 3MF parser and converts to glTF", async () => {
    // The closest available proxy for third-party slicer validity. Note the
    // direction: asset-core's compose() goes composite -> bytes, so reading a
    // package back is the parser plus the 3MF-to-glTF converter, not compose().
    const { unzipBytes, strFromU8 } = await import("@arbesk/asset-core/formats/3mf/zip.js");
    const { parse3mfModel } = await import("@arbesk/asset-core/formats/3mf/parser.js");
    const { parsed3mfToGltf } = await import("@arbesk/asset-core/formats/3mf/to-gltf.js");

    const entries = unzipBytes(meshTo3mf(MESH, DESIGN));
    const gltf = parsed3mfToGltf(parse3mfModel(strFromU8(entries["3D/3dmodel.model"])));

    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.meshes).toHaveLength(1);
    const primitive = gltf.meshes[0].primitives[0];
    expect(gltf.accessors[primitive.attributes.POSITION]).toMatchObject({
      componentType: 5126, count: 4, type: "VEC3",
      min: [0, 0, 0], max: [10, 10, 10],
    });
    expect(gltf.accessors[primitive.indices]).toMatchObject({
      componentType: 5125, count: 12, type: "SCALAR",
    });
  });

  it("embeds the design document as a declared part", () => {
    const bytes = meshTo3mf(MESH, DESIGN);
    const parts = unzipSync(bytes);
    expect(Object.keys(parts)).toContain("Metadata/arbesk_cad.json");
    expect(strFromU8(parts["_rels/.rels"])).toContain("https://arbesk.io/3mf/cad-design");

    const design = readDesignFrom3mf(bytes);
    expect(design.code).toBe(DESIGN.code);
    expect(design.parameters.s.value).toBe(10);
    expect(design.summary).toBe("cube");
  });

  it("returns null for a package without the sidecar", () => {
    expect(readDesignFrom3mf(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("meshToGlb", () => {
  it("writes a GLB with the magic header", () => {
    const bytes = meshToGlb(MESH, DESIGN);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)).toBe(0x46546c67);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("applies the mm to m and Z-up to Y-up transform on the node, not the vertices", () => {
    const json = readGlbJson(meshToGlb(MESH, DESIGN));
    const m = json.nodes[0].matrix;
    expect(m[0]).toBeCloseTo(0.001, 9);
    expect(m[6]).toBeCloseTo(-0.001, 9);
    expect(m[9]).toBeCloseTo(0.001, 9);
    expect(json.meshes[0].primitives[0].attributes.POSITION).toBe(1);
  });

  it("embeds the design document in asset extras", () => {
    const json = readGlbJson(meshToGlb(MESH, DESIGN));
    expect(json.asset.extras.arbesk_cad.code).toBe(DESIGN.code);
    expect(json.asset.extras.arbesk_units).toBe("mm");
  });

  it("declares the accessor bounds glTF requires", () => {
    const json = readGlbJson(meshToGlb(MESH, DESIGN));
    const position = json.accessors[1];
    expect(position.min).toEqual([0, 0, 0]);
    expect(position.max).toEqual([10, 10, 10]);
    expect(position.count).toBe(4);
  });

  it("4-byte aligns every bufferView offset", () => {
    const json = readGlbJson(meshToGlb(MESH, DESIGN));
    for (const view of json.bufferViews) {
      expect(view.byteOffset % 4).toBe(0);
    }
  });

  it("keeps the binary chunk the declared length", () => {
    const bytes = meshToGlb(MESH, DESIGN);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const jsonLength = view.getUint32(12, true);
    const binLength = view.getUint32(20 + jsonLength, true);
    expect(20 + jsonLength + 8 + binLength).toBe(bytes.length);
  });
});

describe("the design sidecar", () => {
  it("round-trips through serializeDesign and parseEmbeddedDesign", () => {
    expect(parseEmbeddedDesign(JSON.parse(serializeDesign(DESIGN)))).toEqual(DESIGN);
  });

  it("rejects a payload that is not a design document", () => {
    expect(parseEmbeddedDesign({ hello: "world" })).toBeNull();
    expect(parseEmbeddedDesign(null)).toBeNull();
  });

  it("carries the licence credit out of the exported file", () => {
    // The point of embedding the CODE rather than a stored credit list: the
    // same pure function the server used recomputes the attribution from the
    // file alone, so a part opened later cannot disagree with the response
    // that produced it, and cannot hold a stale credit either.
    const design = { ...DESIGN, code: "return phoneStand(P.t, P.lift, P.w);" };
    const exported = readDesignFrom3mf(meshTo3mf(MESH, design));

    const credits = attributionsFor(exported.code);
    expect(credits).toHaveLength(1);
    expect(credits[0].helper).toBe("phoneStand");
    expect(credits[0].licence).toBe("CC-BY");
    expect(credits[0].author).toBe("DrLex");
  });

  it("credits nothing for a design that calls no ported helper", () => {
    expect(attributionsFor(readDesignFrom3mf(meshTo3mf(MESH, DESIGN)).code)).toEqual([]);
  });
});
