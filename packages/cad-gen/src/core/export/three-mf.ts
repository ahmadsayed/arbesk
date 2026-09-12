/**
 * Mesh to .3mf (OPC package, millimetres, Z-up).
 * @remarks Written by hand rather than via manifold's lib/export-3mf.js: that
 *   path pulls @jscadui/3mf-export, a second @gltf-transform and an esbuild-wasm
 *   peer, and offers no hook for the design sidecar (spec section 7).
 */
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import type { CadDesign, CadMesh } from "../../types.ts";
import {
  SIDECAR_PART_PATH, SIDECAR_REL_TYPE, serializeDesign, parseEmbeddedDesign,
} from "./embed.ts";

const MODEL_PATH = "3D/3dmodel.model";

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
  '  <Default Extension="json" ContentType="application/vnd.arbesk.cad+json"/>',
  "</Types>",
].join("\n");

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '  <Relationship Target="/' + MODEL_PATH +
    '" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
  '  <Relationship Target="/' + SIDECAR_PART_PATH +
    '" Id="rel1" Type="' + SIDECAR_REL_TYPE + '"/>',
  "</Relationships>",
].join("\n");

/** Renders the 3MF core-spec model part. */
function buildModelXml(mesh: CadMesh): string {
  const verts: string[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    verts.push(
      '          <vertex x="' + mesh.positions[i] +
      '" y="' + mesh.positions[i + 1] +
      '" z="' + mesh.positions[i + 2] + '"/>',
    );
  }
  const tris: string[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    tris.push(
      '          <triangle v1="' + mesh.indices[i] +
      '" v2="' + mesh.indices[i + 1] +
      '" v3="' + mesh.indices[i + 2] + '"/>',
    );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" ' +
      'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '  <metadata name="Application">Arbesk CAD</metadata>',
    "  <resources>",
    '    <object id="1" type="model">',
    "      <mesh>",
    "        <vertices>",
    verts.join("\n"),
    "        </vertices>",
    "        <triangles>",
    tris.join("\n"),
    "        </triangles>",
    "      </mesh>",
    "    </object>",
    "  </resources>",
    "  <build>",
    '    <item objectid="1"/>',
    "  </build>",
    "</model>",
  ].join("\n");
}

/**
 * Serialises a mesh plus its design document to .3mf bytes.
 * @remarks The design travels as a declared OPC part, so the package alone
 *   reconstructs the design state - and therefore its licence credits.
 */
export function meshTo3mf(mesh: CadMesh, design: CadDesign): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(CONTENT_TYPES),
    "_rels/.rels": strToU8(ROOT_RELS),
    [MODEL_PATH]: strToU8(buildModelXml(mesh)),
    [SIDECAR_PART_PATH]: strToU8(serializeDesign(design)),
  }, { level: 6 });
}

/**
 * Reads the design document back out of a .3mf package.
 * @returns null when the part is absent or unusable.
 */
export function readDesignFrom3mf(bytes: Uint8Array): CadDesign | null {
  try {
    const parts = unzipSync(bytes);
    const raw = parts[SIDECAR_PART_PATH];
    if (!raw) return null;
    return parseEmbeddedDesign(JSON.parse(strFromU8(raw)));
  } catch {
    return null;
  }
}
