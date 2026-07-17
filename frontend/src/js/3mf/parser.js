// @ts-nocheck — TODO: add JSDoc typedefs for Parsed3mf and drop this header
/**
 * 3MF core-spec parser: turns the XML of a `.model` part into a neutral
 * Parsed3mf structure. No DOM, Babylon, or IPFS dependencies.
 *
 * Extension elements (slice, production, beam lattice) are ignored.
 * <components> objects are rejected explicitly — not supported in v1.
 */

import { XMLParser } from "fast-xml-parser";

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (tagName) =>
    ["object", "vertex", "triangle", "item", "basematerial"].includes(tagName),
};

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse a 3MF core model document.
 *
 * @param {string} xml - contents of the `.model` part
 * @returns {{
 *   unit: string,
 *   objects: Array<{id: string, name: string, pid: string|null, pindex: number|null, vertices: number[], triangles: number[]}>,
 *   basematerials: Array<{groupId: string, name: string, color: string}>,
 *   items: Array<{objectId: string, transform: number[]|null}>,
 * }}
 */
export function parse3mfModel(xml) {
  let doc;
  try {
    doc = new XMLParser(PARSER_OPTIONS).parse(xml);
  } catch (err) {
    throw new Error(`[3MF] invalid model XML: ${err.message}`);
  }
  const model = doc?.model;
  if (!model) throw new Error("[3MF] missing <model> root element");

  const resources = model.resources || {};

  const basematerials = [];
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

  const objects = toArray(resources.object).map((obj) => {
    if (!obj.mesh) {
      throw new Error(
        `[3MF] object ${obj["@_id"]} has no <mesh> (<components> objects are not supported)`
      );
    }
    const vertices = [];
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
    const triangles = [];
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

  const items = toArray(model.build?.item).map((item) => ({
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
