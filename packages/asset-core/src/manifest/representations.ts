/**
 * Asset representations: other files of the same asset (a `.blend` to edit,
 * an STL to share, a GLB to view, the G-code a slicer made), recorded in the
 * asset manifest's `representations` list.
 * @remarks Pure helpers; every client (Studio, besk, File Browser) reads and
 *   writes the list through these so the format is defined once. Staleness is
 *   computed from the manifest, never stored. Encoding the bytes is
 *   `representation-codec.ts`. Spec:
 *   docs/superpowers/specs/2026-11-10-asset-representations-design.md.
 */

// Worker-safe: only zod (via schema.ts). The brotli codec lives in
// representation-codec.ts, so a reader that only lists entries or computes
// staleness never pulls fflate or brotli-wasm.
import {
  MAX_REPRESENTATION_BYTES,
  MAX_REPRESENTATIONS,
  PRIMARY_REF,
  representationSchema,
} from "./schema.ts";
import type { Representation } from "./schema.ts";

type DerivedFrom = NonNullable<Representation["derived_from"]>;

export { MAX_REPRESENTATION_BYTES, MAX_REPRESENTATIONS, PRIMARY_REF, representationSchema };
export type { Representation };

export type RepresentationRole = Representation["role"];
export type RepresentationEncoding = Representation["encoding"];
export type { DerivedFrom };

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

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * The primary model's placement (`scene.nodes[0].transform_matrix`, identity
 * when absent): a rescale changes what a slicer would print without changing
 * the source CID.
 */
export function primaryTransformOf(manifest: ManifestLike | null | undefined): number[] | null {
  const node = manifest?.scene?.nodes?.[0];
  if (!node) return null;
  const matrix = node.transform_matrix;
  return Array.isArray(matrix) && matrix.length === 16 ? matrix.map(Number) : [...IDENTITY];
}

function sameMatrix(a: readonly number[] | null, b: readonly number[]): boolean {
  return a !== null && a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * What a new representation derived from `ref` records: the ref, its current
 * CID and, for `primary`, the model's placement.
 * @returns null when the ref names nothing.
 */
export function derivedFromOf(manifest: ManifestLike | null | undefined, ref: string): DerivedFrom | null {
  const cid = currentCidOf(manifest, ref);
  if (!cid) return null;
  if (ref !== PRIMARY_REF) return { ref, cid };
  const transform = primaryTransformOf(manifest);
  return transform ? { ref, cid, transform_matrix: transform } : { ref, cid };
}

/**
 * Whether a representation was made from something that has changed since.
 * @remarks Never stored: every client computes the same answer from the same
 *   manifest. A representation with no `derived_from` is never stale; one whose
 *   ref no longer exists is. `primary` means node 0 only: its source bytes
 *   (`source.cid`) and, when the entry recorded it, its `transform_matrix`.
 *   Other nodes and child_refs are not compared, a primary that is a live
 *   child_ref has no CID to derive from, and the Studio's first save of a
 *   monolithic generation output decomposes it to a new CID (the entry then
 *   reads stale although the geometry is the same).
 */
export function isStale(manifest: ManifestLike | null | undefined, rep: Representation): boolean {
  const from = rep.derived_from;
  if (!from) return false;
  if (currentCidOf(manifest, from.ref) !== from.cid) return true;
  if (from.ref !== PRIMARY_REF || !from.transform_matrix) return false;
  return !sameMatrix(primaryTransformOf(manifest), from.transform_matrix);
}

/**
 * Whether the manifest has room for an entry with this id: replacing one is
 * always allowed, adding one only below {@link MAX_REPRESENTATIONS}.
 * @remarks Counts the stored entries as they are, including ones this client
 *   cannot parse (a newer client's), which every write carries unchanged.
 */
export function hasRoomFor(manifest: ManifestLike | null | undefined, id: string): boolean {
  const current = storedEntries(manifest);
  return current.some((entry) => entry?.id === id) || current.length < MAX_REPRESENTATIONS;
}

function storedEntries(manifest: ManifestLike | null | undefined): Array<Record<string, any>> {
  return Array.isArray(manifest?.representations) ? manifest.representations : [];
}

/**
 * A copy of the manifest with `rep` added, or replacing the entry with its id.
 * @remarks Pure: the caller bumps the version and links the previous CID.
 * @throws when `rep` is invalid or the list would exceed
 *   {@link MAX_REPRESENTATIONS}.
 */
export function withRepresentation<M extends ManifestLike>(manifest: M, rep: Representation): M {
  const parsed = representationSchema.parse(rep);
  if (!hasRoomFor(manifest, parsed.id)) {
    throw new Error(`An asset holds at most ${MAX_REPRESENTATIONS} representations`);
  }
  // Entries this client cannot parse stay as they are (a newer client's);
  // every entry with the id is replaced by the one new entry.
  const current = storedEntries(manifest);
  const index = current.findIndex((entry) => entry?.id === parsed.id);
  const next = current.filter((entry) => entry?.id !== parsed.id);
  next.splice(index >= 0 ? index : next.length, 0, parsed);
  return { ...manifest, representations: next };
}

/**
 * A copy of the manifest without the representation `id`.
 * @remarks Representations derived from the removed one become stale. The
 *   field is dropped when the list empties.
 * @throws when the manifest has no representation with that id.
 */
export function withoutRepresentation<M extends ManifestLike>(manifest: M, id: string): M {
  const current = storedEntries(manifest);
  const next = current.filter((entry) => entry?.id !== id);
  if (next.length === current.length) {
    throw new Error(`No representation with id "${id}"`);
  }
  const copy: ManifestLike = { ...manifest, representations: next };
  if (next.length === 0) delete copy.representations;
  return copy as M;
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
