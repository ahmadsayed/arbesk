/**
 * Bakes per-object colors into a composite 3MF source.
 * @remarks Colors are written as a 3MF core `<basematerials>` group that the
 *   edited `<object>`s reference via `pid`/`pindex`, so slicers and the
 *   viewer (to-gltf.ts) both see them. The model XML is edited in place as
 *   text — everything outside the touched tags stays byte-identical.
 */

import { getRuntime } from "../../runtime-state.ts";
import { sanitizeFileName } from "../../utils/uri.ts";
import { parse3mfModel } from "./parser.ts";
import { decompose, isComposite3mf } from "./decomposer.ts";
import { isZipBytes, strFromU8, unzipBytes } from "./zip.ts";

const COMPOSITE_3MF_PATH = "composite.3mf.json";

/** "#rgb…" picker value → 3MF displaycolor "#RRGGBBAA", or null if invalid. */
function toDisplayColor(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex || "");
  if (!m) return null;
  return `#${m[1]}${m[2] || "FF"}`.toUpperCase();
}

/**
 * Viewer mesh name → 3MF object ids.
 * @remarks Mirrors to-gltf.ts naming: a build item's node is named after its
 *   object, or `item_<i>` when unnamed; the mesh is `object_<id>` when unnamed.
 */
function objectIdsByMeshName(xml: string): Map<string, Set<string>> {
  const parsed = parse3mfModel(xml);
  const byName = new Map<string, Set<string>>();
  const add = (name: string, id: string) => {
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name)!.add(id);
  };
  for (const obj of parsed.objects) {
    if (obj.name) add(obj.name, obj.id);
    add(`object_${obj.id}`, obj.id);
  }
  for (const [i, item] of parsed.items.entries()) {
    const obj = parsed.objects.find((o) => o.id === item.objectId);
    if (obj && !obj.name) add(`item_${i}`, obj.id);
  }
  return byName;
}

function nextResourceId(xml: string): number {
  let max = 0;
  for (const m of xml.matchAll(/\sid="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

/** Drops `<basematerials>` groups that nothing references any more. */
function pruneUnreferencedGroups(xml: string): string {
  return xml.replace(
    /\n?[ \t]*<basematerials\b[^>]*\sid="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/basematerials>)/g,
    (group, id) =>
      new RegExp(`\\s(?:pid|matid|basematerialid)="${id}"`).test(xml) ? group : ""
  );
}

/**
 * Points each colored object at a fresh basematerials entry.
 * @param colorMap - viewer mesh name → "#RRGGBB"
 */
export function applyObjectColors(
  modelXml: string,
  colorMap: Record<string, string>
): { model: string; modified: number; skipped: number } {
  const byName = objectIdsByMeshName(modelXml);
  const colorById = new Map<string, string>();
  let skipped = 0;
  for (const [meshName, hex] of Object.entries(colorMap)) {
    const ids = byName.get(meshName);
    const color = toDisplayColor(hex);
    if (!ids || !color) {
      skipped++;
      continue;
    }
    for (const id of ids) colorById.set(id, color);
  }
  if (colorById.size === 0) return { model: modelXml, modified: 0, skipped };

  const groupId = nextResourceId(modelXml);
  const palette = [...new Set(colorById.values())];

  let model = modelXml.replace(/<object\b[^>]*>[\s\S]*?<\/object>/g, (block) => {
    const id = /^<object\b[^>]*\sid="([^"]+)"/.exec(block)?.[1];
    const color = id && colorById.get(id);
    if (!color) return block;
    return block
      .replace(/^<object\b[^>]*>/, (tag) =>
        tag
          .replace(/\s(?:pid|pindex)="[^"]*"/g, "")
          .replace(/\s*(\/?)>$/, ` pid="${groupId}" pindex="${palette.indexOf(color)}"$1>`)
      )
      // Triangle-level properties override the object's; drop them so the
      // new color applies to every face.
      .replace(/<triangle\b[^>]*>/g, (tag) => tag.replace(/\s(?:pid|p1|p2|p3)="[^"]*"/g, ""));
  });

  const bases = palette
    .map((c) => `\n      <base name="${c}" displaycolor="${c}"/>`)
    .join("");
  model = model.replace(
    /<resources\b[^>]*>/,
    (tag) => `${tag}\n    <basematerials id="${groupId}">${bases}\n    </basematerials>`
  );

  return { model: pruneUnreferencedGroups(model), modified: colorById.size, skipped };
}

/**
 * Bakes colors into a 3MF source and stores the edited composite.
 * @remarks A raw .3mf source is decomposed first, so the result is always a
 *   composite 3MF JSON.
 */
export async function editSourceColors(
  sourceCid: string,
  colorMap: Record<string, string>,
  options: {
    assetName?: string;
    assetId?: string;
    dedupMap?: Map<string, string> | null;
  } = {}
): Promise<{ sourceCid: string; format: string; path: string; modified: number; skipped: number }> {
  const { assetName, assetId, dedupMap = null } = options;
  if (!sourceCid) throw new Error("[3MF] editSourceColors: sourceCid is required");

  const bytes = new Uint8Array(await getRuntime().ipfsRead.getBytes(sourceCid));
  let composite: any;
  let baseCid = sourceCid;
  if (isZipBytes(bytes)) {
    ({ composite, compositeCid: baseCid } = await decompose(bytes, { assetName, assetId, dedupMap }));
  } else {
    composite = JSON.parse(strFromU8(bytes));
    if (!isComposite3mf(composite)) {
      throw new Error(`[3MF] editSourceColors: unrecognized 3MF source | cid=${sourceCid}`);
    }
  }

  const { model, modified, skipped } = applyObjectColors(composite.model, colorMap);
  const result = { format: "3mf", path: COMPOSITE_3MF_PATH, modified, skipped };
  if (modified === 0) return { sourceCid: baseCid, ...result };

  const newCid = await getRuntime().ipfsWrite.writeJSON({ ...composite, model }, null, {
    assetId,
    filename: `${sanitizeFileName(assetName || assetId || "composite")}_colored.3mf.json`,
  });
  console.log(`[3MF-COLOR] source ${sourceCid} → ${newCid} | modified=${modified} skipped=${skipped}`);
  return { sourceCid: newCid, ...result };
}

/**
 * Object-level colours already baked into a model, by viewer mesh name.
 * @returns mesh name (the object's name, else `object_<id>`) → "#rrggbb";
 *   objects without an object-level basematerials reference are left out.
 */
export function readObjectColors(modelXml: string): Record<string, string> {
  const parsed = parse3mfModel(modelXml);
  const colors: Record<string, string> = {};
  for (const obj of parsed.objects) {
    if (obj.pid === null || obj.pindex === null) continue;
    const entry = parsed.basematerials.filter((m) => m.groupId === obj.pid)[obj.pindex];
    if (entry) colors[obj.name || `object_${obj.id}`] = entry.color.slice(0, 7).toLowerCase();
  }
  return colors;
}

/** The model XML of a raw .3mf or composite 3MF source. */
async function sourceModelXml(sourceCid: string): Promise<string> {
  const bytes = new Uint8Array(await getRuntime().ipfsRead.getBytes(sourceCid));
  if (!isZipBytes(bytes)) return JSON.parse(strFromU8(bytes)).model;
  const entries = unzipBytes(bytes);
  const modelPath = Object.keys(entries).find((p) => p.endsWith(".model"));
  if (!modelPath) throw new Error(`[3MF] no .model part in package | cid=${sourceCid}`);
  return strFromU8(entries[modelPath]);
}

/** readObjectColors for a stored source (raw .3mf or composite 3MF), by CID. */
export async function readSourceColors(sourceCid: string): Promise<Record<string, string>> {
  return readObjectColors(await sourceModelXml(sourceCid));
}
