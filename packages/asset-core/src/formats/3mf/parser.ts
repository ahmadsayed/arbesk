/**
 * Parses the XML of a 3MF `.model` part into a neutral Parsed3mf structure.
 * @remarks No DOM, Babylon, or IPFS dependencies. Extension elements (slice,
 *   production, beam lattice) are ignored; `<components>` objects are
 *   rejected (not supported in v1).
 */

import { XMLParser } from "fast-xml-parser";

export interface Parsed3mfObject {
  id: string;
  name: string;
  pid: string | null;
  pindex: number | null;
  vertices: number[];
  triangles: number[];
}

export interface Parsed3mfBaseMaterial {
  groupId: string;
  name: string;
  color: string;
}

export interface Parsed3mfItem {
  objectId: string;
  transform: number[] | null;
}

export interface Parsed3mf {
  unit: string;
  objects: Parsed3mfObject[];
  basematerials: Parsed3mfBaseMaterial[];
  items: Parsed3mfItem[];
}

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName: string) =>
    ["object", "vertex", "triangle", "item", "basematerial"].includes(tagName),
};

function toArray(value: any): any[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * @param xml - contents of the `.model` part
 */
export function parse3mfModel(xml: string): Parsed3mf {
  let doc: any;
  try {
    doc = new XMLParser(PARSER_OPTIONS).parse(xml);
  } catch (err) {
    throw new Error(`[3MF] invalid model XML: ${(err as Error).message}`);
  }
  const model = doc?.model;
  if (!model) throw new Error("[3MF] missing <model> root element");

  const resources = model.resources || {};

  const basematerials: Parsed3mfBaseMaterial[] = [];
  for (const group of toArray(resources.basematerials)) {
    const groupId = String(group["@_id"]);
    for (const mat of toArray(group.basematerial)) {
      basematerials.push({
        groupId,
        name: mat["@_name"] || "",
        color: mat["@_displaycolor"] || "#CCCCCCFF",
      });
    }
  }

  const objects: Parsed3mfObject[] = toArray(resources.object).map((obj) => {
    if (!obj.mesh) {
      throw new Error(
        `[3MF] object ${obj["@_id"]} has no <mesh> (<components> objects are not supported)`
      );
    }
    const vertices: number[] = [];
    let vertexIndex = 0;
    for (const v of toArray(obj.mesh.vertices?.vertex)) {
      const x = Number(v["@_x"]);
      const y = Number(v["@_y"]);
      const z = Number(v["@_z"]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(
          `[3MF] object ${obj["@_id"]} vertex ${vertexIndex} has an invalid coordinate`
        );
      }
      vertices.push(x, y, z);
      vertexIndex++;
    }
    const triangles: number[] = [];
    let triangleIndex = 0;
    for (const t of toArray(obj.mesh.triangles?.triangle)) {
      const v1 = Number(t["@_v1"]);
      const v2 = Number(t["@_v2"]);
      const v3 = Number(t["@_v3"]);
      if (!Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) {
        throw new Error(
          `[3MF] object ${obj["@_id"]} triangle ${triangleIndex} has an invalid index`
        );
      }
      triangles.push(v1, v2, v3);
      triangleIndex++;
    }
    return {
      id: String(obj["@_id"]),
      name: obj["@_name"] || "",
      pid: obj["@_pid"] != null ? String(obj["@_pid"]) : null,
      pindex:
        obj["@_pindex"] != null
          ? Number(obj["@_pindex"])
          : obj["@_pid"] != null
            ? 0
            : null,
      vertices,
      triangles,
    };
  });

  const items: Parsed3mfItem[] = toArray(model.build?.item).map((item) => ({
    objectId: String(item["@_objectid"]),
    transform:
      typeof item["@_transform"] === "string"
        ? item["@_transform"].trim().split(/\s+/).map(Number)
        : null,
  }));

  return {
    unit: model["@_unit"] || "millimeter",
    objects,
    basematerials,
    items,
  };
}
