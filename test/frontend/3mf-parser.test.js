import fs from "fs";
import path from "path";

const BOX_PATH = path.resolve(process.cwd(), "mock-gltf-assets/box.3mf");

async function loadBoxParsed() {
  const { unzipBytes, strFromU8 } = await import(
    "../../frontend/src/js/3mf/zip.js"
  );
  const { parse3mfModel } = await import(
    "../../frontend/src/js/3mf/parser.js"
  );
  const entries = unzipBytes(new Uint8Array(fs.readFileSync(BOX_PATH)));
  return parse3mfModel(strFromU8(entries["3D/3dmodel.model"]));
}

describe("parse3mfModel", () => {
  it("parses the box sample mesh", async () => {
    const parsed = await loadBoxParsed();
    expect(parsed.unit).toBe("millimeter");
    expect(parsed.objects).toHaveLength(1);
    const [box] = parsed.objects;
    expect(box.id).toBe("1");
    expect(box.vertices).toHaveLength(24); // 8 vertices × xyz
    expect(box.vertices.slice(0, 6)).toEqual([0, 0, 0, 10, 0, 0]);
    expect(box.triangles).toHaveLength(36); // 12 triangles × v1v2v3
    expect(box.triangles.slice(0, 3)).toEqual([3, 2, 1]);
    expect(box.pid).toBeNull();
    expect(parsed.basematerials).toHaveLength(0);
    expect(parsed.items).toEqual([{ objectId: "1", transform: null }]);
  });

  it("parses basematerials, pid/pindex, and item transforms", async () => {
    const { parse3mfModel } = await import(
      "../../frontend/src/js/3mf/parser.js"
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="2">
      <basematerial name="Red" displaycolor="#FF0000FF" />
      <basematerial name="Green" displaycolor="#00FF00FF" />
    </basematerials>
    <object id="1" type="model" pid="2" pindex="1">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" />
          <vertex x="1" y="0" z="0" />
          <vertex x="0" y="1" z="0" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 5 6 7" />
  </build>
</model>`;
    const parsed = parse3mfModel(xml);
    expect(parsed.basematerials).toEqual([
      { groupId: "2", name: "Red", color: "#FF0000FF" },
      { groupId: "2", name: "Green", color: "#00FF00FF" },
    ]);
    expect(parsed.objects[0].pid).toBe("2");
    expect(parsed.objects[0].pindex).toBe(1);
    expect(parsed.items[0].transform).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1, 5, 6, 7,
    ]);
  });

  it("throws on <components> objects", async () => {
    const { parse3mfModel } = await import(
      "../../frontend/src/js/3mf/parser.js"
    );
    const xml = `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <components><component objectid="2" /></components>
    </object>
  </resources>
  <build><item objectid="1" /></build>
</model>`;
    expect(() => parse3mfModel(xml)).toThrow(/components/);
  });

  it("normalizes multiple objects/items and applies the pindex default", async () => {
    const { parse3mfModel } = await import(
      "../../frontend/src/js/3mf/parser.js"
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="2">
      <basematerial name="Plain" />
    </basematerials>
    <object id="1" type="model" pid="2">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" />
          <vertex x="1" y="0" z="0" />
          <vertex x="0" y="1" z="0" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2" />
        </triangles>
      </mesh>
    </object>
    <object id="2" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" />
          <vertex x="2" y="0" z="0" />
          <vertex x="0" y="2" z="0" />
        </vertices>
        <triangles>
          <triangle v1="2" v2="1" v3="0" />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
    <item objectid="2" />
  </build>
</model>`;
    const parsed = parse3mfModel(xml);
    expect(parsed.objects).toHaveLength(2);
    // pid set without pindex → pindex defaults to 0 (3MF core spec)
    expect(parsed.objects[0].pindex).toBe(0);
    // displaycolor absent → default gray
    expect(parsed.basematerials[0].color).toBe("#CCCCCCFF");
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[1].objectId).toBe("2");
  });
});
