/**
 * Asset representations: other files of the same asset (a `.blend` to edit,
 * an STL to share, a GLB to view, the G-code a slicer made), recorded in the
 * asset manifest's `representations` list.
 * @remarks Pure helpers; every client (Studio, besk, File Browser) reads and
 *   writes the list through these so the format is defined once. Staleness is
 *   computed from the manifest, never stored. Spec:
 *   docs/superpowers/specs/2026-11-10-asset-representations-design.md.
 */

import { compressAuto, decompressAuto, isBrotliFramed } from "../utils/compression.ts";
import {
  MAX_REPRESENTATION_BYTES,
  MAX_REPRESENTATIONS,
  PRIMARY_REF,
  representationSchema,
} from "./schema.ts";
import type { Representation } from "./schema.ts";

export { MAX_REPRESENTATION_BYTES, MAX_REPRESENTATIONS, PRIMARY_REF, representationSchema };
export type { Representation };

export type RepresentationRole = Representation["role"];
export type RepresentationEncoding = Representation["encoding"];

/** A manifest as the helpers see it: only the fields they read. */
type ManifestLike = Record<string, any>;

// Text formats compress well and are stored brotli-framed; the rest raw.
const TEXT_FORMATS = new Set([
  "gcode", "gltf", "obj", "mtl", "step", "stp", "iges", "igs",
  "scad", "dxf", "svg", "ply", "txt", "json", "csv",
]);

const ROLE_BY_FORMAT: Record<string, RepresentationRole> = {
  blend: "source", step: "source", stp: "source", f3d: "source",
  fcstd: "source", scad: "source", iges: "source", igs: "source",
  stl: "mesh", obj: "mesh", ply: "mesh", "3mf": "mesh",
  glb: "view", gltf: "view", usdz: "view",
  gcode: "machine", bgcode: "machine",
};

/**
 * The role a file of this format usually plays (`--role` default).
 * @remarks A 3MF defaults to `mesh`: only a sliced one is `machine`, which the
 *   caller has to say.
 */
export function defaultRole(format: string): RepresentationRole {
  return ROLE_BY_FORMAT[format.toLowerCase()] ?? "other";
}

/** The encoding a file of this format is stored with. */
export function encodingFor(format: string): RepresentationEncoding {
  return TEXT_FORMATS.has(format.toLowerCase()) ? "brotli" : "raw";
}

/**
 * The manifest's valid representations, in stored order.
 * @remarks Tolerant read: an entry that does not parse is left out, so one bad
 *   entry from another client never hides the rest.
 */
export function listRepresentations(manifest: ManifestLike | null | undefined): Representation[] {
  const list = manifest?.representations;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const parsed = representationSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The current CID of what `ref` names: the primary model's
 * `scene.nodes[0].source.cid`, or another representation's `cid`.
 * @returns null when the ref names nothing (no source node, removed entry).
 */
export function currentCidOf(manifest: ManifestLike | null | undefined, ref: string): string | null {
  if (ref === PRIMARY_REF) {
    const cid = manifest?.scene?.nodes?.[0]?.source?.cid;
    return typeof cid === "string" && cid ? cid : null;
  }
  return listRepresentations(manifest).find((rep) => rep.id === ref)?.cid ?? null;
}

/**
 * Whether a representation was made from something that has changed since.
 * @remarks Never stored: every client computes the same answer from the same
 *   manifest. A representation with no `derived_from` is never stale; one whose
 *   ref no longer exists is.
 */
export function isStale(manifest: ManifestLike | null | undefined, rep: Representation): boolean {
  if (!rep.derived_from) return false;
  return currentCidOf(manifest, rep.derived_from.ref) !== rep.derived_from.cid;
}

/**
 * A copy of the manifest with `rep` added, or replacing the entry with its id.
 * @remarks Pure: the caller bumps the version and links the previous CID.
 * @throws when `rep` is invalid or the list would exceed
 *   {@link MAX_REPRESENTATIONS}.
 */
export function withRepresentation<M extends ManifestLike>(manifest: M, rep: Representation): M {
  const parsed = representationSchema.parse(rep);
  const current = Array.isArray(manifest.representations) ? manifest.representations : [];
  const index = current.findIndex((entry: { id?: string }) => entry?.id === parsed.id);
  const next = [...current];
  if (index >= 0) {
    next[index] = parsed;
  } else {
    if (current.length >= MAX_REPRESENTATIONS) {
      throw new Error(`An asset holds at most ${MAX_REPRESENTATIONS} representations`);
    }
    next.push(parsed);
  }
  return { ...manifest, representations: next };
}

/**
 * A copy of the manifest without the representation `id`.
 * @remarks Representations derived from the removed one become stale. The
 *   field is dropped when the list empties.
 * @throws when the manifest has no representation with that id.
 */
export function withoutRepresentation<M extends ManifestLike>(manifest: M, id: string): M {
  const current = Array.isArray(manifest.representations) ? manifest.representations : [];
  const next = current.filter((entry: { id?: string }) => entry?.id !== id);
  if (next.length === current.length) {
    throw new Error(`No representation with id "${id}"`);
  }
  const copy: ManifestLike = { ...manifest, representations: next };
  if (next.length === 0) delete copy.representations;
  return copy as M;
}

/**
 * Encode a file for storage: brotli-framed for text formats, raw otherwise.
 * @throws when the file exceeds {@link MAX_REPRESENTATION_BYTES}.
 */
export async function encodeRepresentation(
  bytes: Uint8Array,
  format: string,
): Promise<{ bytes: Uint8Array; encoding: RepresentationEncoding }> {
  if (bytes.byteLength > MAX_REPRESENTATION_BYTES) {
    throw new Error("A representation is at most 256 MB");
  }
  const encoding = encodingFor(format);
  if (encoding === "raw") return { bytes, encoding };
  // q5 ("binary" hint): q11 takes minutes on a long print's G-code.
  return { bytes: await compressAuto(bytes, { codec: "brotli", hint: "binary" }), encoding };
}

/**
 * Decode stored bytes back to the file, following the entry's `encoding`
 * (never sniffing a raw file, whose first bytes could look like a frame).
 * @throws when a `brotli` entry's bytes are not brotli-framed.
 */
export async function decodeRepresentation(
  bytes: Uint8Array,
  rep: Pick<Representation, "encoding">,
): Promise<Uint8Array> {
  if (rep.encoding === "raw") return bytes;
  if (!isBrotliFramed(bytes)) {
    throw new Error("Representation bytes are not brotli-framed");
  }
  return decompressAuto(bytes);
}

function slug(value: string | number): string {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A stable id from role, format and profile, e.g.
 * `gcode-original-prusa-mk4-petg`; a source file is `source`.
 */
export function representationId(
  role: RepresentationRole,
  format: string,
  profile?: Record<string, string | number> | null,
): string {
  const base = role === "source" ? "source" : slug(format) || role;
  const parts = [base, profile?.printer, profile?.material]
    .filter((part): part is string | number => part !== undefined && part !== null && part !== "")
    .map(slug)
    .filter(Boolean);
  return parts.join("-").slice(0, 64).replace(/-+$/, "");
}
