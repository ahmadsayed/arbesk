import { afterAll, describe, expect, it, jest } from "bun:test";
import fs from "fs";
import path from "path";

const BOX_PATH = path.resolve(process.cwd(), "mock-gltf-assets/box.3mf");

const store = new Map();
let seq = 0;
const { initRuntime, _resetRuntimeForTesting } = await import(
  "@arbesk/asset-core/runtime.js"
);
initRuntime({
  ipfsRead: {
    getJSON: jest.fn(async (cid) => JSON.parse(new TextDecoder().decode(store.get(cid)))),
    getBytes: jest.fn(async (cid) => {
      const bytes = store.get(cid);
      if (!bytes) throw new Error(`fake IPFS miss: ${cid}`);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }),
  },
  ipfsWrite: {
    write: jest.fn(async (data) => {
      const cid = `bafyFake${String(seq++).padStart(4, "0")}`;
      store.set(cid, data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)));
      return cid;
    }),
    writeJSON: jest.fn(async (json) => {
      const cid = `bafyFake${String(seq++).padStart(4, "0")}`;
      store.set(cid, new TextEncoder().encode(JSON.stringify(json)));
      return cid;
    }),
  },
});
afterAll(() => _resetRuntimeForTesting());

const { applyObjectColors, editSourceColors } = await import(
  "@arbesk/asset-core/formats/3mf/color-editor.js"
);
const { parse3mfModel } = await import("@arbesk/asset-core/formats/3mf/parser.js");
const { parsed3mfToGltf } = await import("@arbesk/asset-core/formats/3mf/to-gltf.js");

const TRI = `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>`;

function model(resources, items = `<item objectid="1"/><item objectid="2"/>`) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
${resources}
  </resources>
  <build>${items}</build>
</model>`;
}

const TWO_PARTS = model(
  `    <object id="1" name="part-1" type="model">${TRI}</object>
    <object id="2" name="part-2" type="model">${TRI}</object>`
);

function renderedColors(xml) {
  const gltf = parsed3mfToGltf(parse3mfModel(xml));
  return gltf.meshes.map((m) =>
    m.primitives[0].material === undefined
      ? null
      : gltf.materials[m.primitives[0].material].pbrMetallicRoughness.baseColorFactor
  );
}

describe("applyObjectColors", () => {
  it("colors named objects through a basematerials group the viewer renders", () => {
    const { model: out, modified, skipped } = applyObjectColors(TWO_PARTS, {
      "part-1": "#ff0000",
      "part-2": "#00ff00",
    });
    expect({ modified, skipped }).toEqual({ modified: 2, skipped: 0 });
    expect(out).toContain('<base name="#FF0000FF" displaycolor="#FF0000FF"/>');
    expect(renderedColors(out)).toEqual([
      [1, 0, 0, 1],
      [0, 1, 0, 1],
    ]);
  });

  it("leaves untouched objects and unmatched names alone", () => {
    const { model: out, modified, skipped } = applyObjectColors(TWO_PARTS, {
      "part-2": "#0000ff",
      nope: "#ffffff",
    });
    expect({ modified, skipped }).toEqual({ modified: 1, skipped: 1 });
    expect(out).toContain('<object id="1" name="part-1" type="model">');
    expect(renderedColors(out)).toEqual([null, [0, 0, 1, 1]]);
  });

  it("returns the model unchanged when nothing matches", () => {
    const result = applyObjectColors(TWO_PARTS, { nope: "#ffffff", "part-1": "red" });
    expect(result).toEqual({ model: TWO_PARTS, modified: 0, skipped: 2 });
  });

  it("re-coloring replaces the old group instead of accumulating", () => {
    const once = applyObjectColors(TWO_PARTS, { "part-1": "#ff0000", "part-2": "#ff0000" }).model;
    const twice = applyObjectColors(once, { "part-1": "#00ff00", "part-2": "#00ff00" }).model;
    expect(twice.match(/<basematerials\b/g)).toHaveLength(1);
    expect(renderedColors(twice)).toEqual([
      [0, 1, 0, 1],
      [0, 1, 0, 1],
    ]);
  });

  it("keeps a pre-existing group still referenced by another object", () => {
    const xml = model(
      `    <basematerials id="5"><base name="Blue" displaycolor="#0000FF"/></basematerials>
    <object id="1" name="a" type="model" pid="5" pindex="0">${TRI}</object>
    <object id="2" name="b" type="model" pid="5" pindex="0">${TRI}</object>`
    );
    const { model: out } = applyObjectColors(xml, { a: "#ff0000" });
    expect(out).toContain('<basematerials id="5">');
    expect(out).toContain('<object id="1" name="a" type="model" pid="6" pindex="0">');
    expect(renderedColors(out)).toEqual([
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ]);
  });

  it("drops triangle-level properties so the object color covers every face", () => {
    const xml = model(
      `    <object id="1" name="a" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" pid="9" p1="1"/></triangles></mesh></object>`,
      `<item objectid="1"/>`
    );
    const { model: out } = applyObjectColors(xml, { a: "#ff0000" });
    expect(out).toContain('<triangle v1="0" v2="1" v3="2"/>');
  });

  it("matches unnamed objects by their viewer node name", () => {
    const xml = model(`    <object id="7" type="model">${TRI}</object>`, `<item objectid="7"/>`);
    const { modified } = applyObjectColors(xml, { item_0: "#ff0000" });
    expect(modified).toBe(1);
  });
});

describe("editSourceColors (3MF)", () => {
  it("writes a new composite whose model carries the color", async () => {
    const composite = {
      arbesk_format: "composite-3mf",
      modelPath: "3D/3dmodel.model",
      contentTypes: "<Types/>",
      rootRels: "<Relationships/>",
      modelRels: null,
      model: TWO_PARTS,
      parts: {},
    };
    store.set("bafySrc", new TextEncoder().encode(JSON.stringify(composite)));

    const result = await editSourceColors("bafySrc", { "part-1": "#ff0000" });

    expect(result.sourceCid).not.toBe("bafySrc");
    expect(result).toMatchObject({ format: "3mf", path: "composite.3mf.json", modified: 1 });
    const stored = JSON.parse(new TextDecoder().decode(store.get(result.sourceCid)));
    expect(renderedColors(stored.model)[0]).toEqual([1, 0, 0, 1]);
    expect(stored.contentTypes).toBe("<Types/>");
  });

  it("decomposes a raw .3mf source before coloring", async () => {
    store.set("bafyRaw", new Uint8Array(fs.readFileSync(BOX_PATH)));
    const result = await editSourceColors("bafyRaw", { object_1: "#00ff00" });
    const stored = JSON.parse(new TextDecoder().decode(store.get(result.sourceCid)));
    expect(stored.arbesk_format).toBe("composite-3mf");
    expect(renderedColors(stored.model)).toEqual([[0, 1, 0, 1]]);
  });

  it("keeps the source CID when no part matches", async () => {
    const result = await editSourceColors("bafySrc", { nope: "#ff0000" });
    expect(result.sourceCid).toBe("bafySrc");
    expect(result.modified).toBe(0);
  });
});
