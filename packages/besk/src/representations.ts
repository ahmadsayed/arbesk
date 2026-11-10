/**
 * Asset representations for the CLI and MCP: attach a file (a .blend, an STL,
 * the G-code a slicer made) to an asset, detach one, list them with a stale
 * marker, read one back. The format and its rules live in asset-core
 * (manifest/representations.ts); this module only uploads bytes and writes
 * the next asset version + collection entry, the way rename/metadata do.
 * Spec: docs/superpowers/specs/2026-11-10-asset-representations-design.md.
 *
 * Transport-free like helpers.ts: errors are thrown, cli.ts maps them to exit
 * codes and mcp.ts surfaces them as tool errors.
 */
import fs from "fs";
import path from "path";
import {
  defaultRole,
  derivedFromOf,
  encodingFor,
  hasRoomFor,
  isStale,
  listRepresentations,
  MAX_REPRESENTATION_BYTES,
  MAX_REPRESENTATIONS,
  PRIMARY_REF,
  representationId,
  representationSchema,
  withoutRepresentation,
  withRepresentation,
} from "@arbesk/asset-core/manifest/representations.js";
import { decodeRepresentation, encodeRepresentation } from "@arbesk/asset-core/manifest/representation-codec.js";
import type { Representation, RepresentationRole } from "@arbesk/asset-core/manifest/representations.js";
import { identityMatrix } from "@arbesk/asset-core/utils/collections.js";
import {
  detectFormat,
  getCollectionManifest,
  getManifest,
  readRawBytes,
  replaceAssetEntry,
  updateCollection,
  writeManifest,
  writeRawBytes,
} from "./catalog.ts";
import type { Session } from "./session.ts";

export const ROLES: readonly RepresentationRole[] = representationSchema.shape.role.options;

/** Shown before a `source` file is uploaded (spec R7). */
const PUBLIC_SOURCE_WARNING =
  "Everything on IPFS is public: anyone with the CID can read this file. " +
  "A source file can carry more than the model (other scenes, embedded images).";

type Manifest = Record<string, any>;

/** The asset a write targets: its collection, entry and current CID. */
export interface AssetTarget {
  tokenId: string;
  assetID: string;
  cid: string;
  name: string;
}

export interface AttachOptions extends AssetTarget {
  file: string;
  role?: string;
  id?: string;
  /** `primary`, another representation's id, or `none`. */
  from?: string;
  profile?: Record<string, string | number>;
  /** Called before the upload when the file is a `source` (spec R7). */
  onWarning?: (message: string) => void;
}

/* ---- the next asset version ---- */

const SOURCE_PATHS: Record<string, string> = {
  gltf: "composite.gltf",
  "3mf": "composite.3mf.json",
};

/** A single-node asset manifest whose model is a stored composite. */
function compositeWrapper(compositeCid: string, format: string, name: string, assetID: string, version: number): Manifest {
  const source: Record<string, string> = { cid: compositeCid, format };
  if (SOURCE_PATHS[format]) source.path = SOURCE_PATHS[format];
  return {
    type: "asset",
    name,
    asset_id: assetID,
    version,
    scene: { nodes: [{ node_id: "node_1", transform_matrix: identityMatrix(), source }] },
  };
}

function versionOf(manifest: Manifest): number {
  return typeof manifest.version === "number" ? manifest.version : 1;
}

/**
 * The asset manifest a representation write builds on. An entry `besk upload`
 * stored as a bare composite has no asset manifest (and so no `primary` to
 * derive from): it is wrapped in one whose model is that composite.
 */
function asAssetManifest(current: Manifest, target: AssetTarget): Manifest {
  if (Array.isArray(current?.scene?.nodes)) return current;
  return compositeWrapper(target.cid, detectFormat(current), current.name ?? target.name, target.assetID, versionOf(current));
}

/** Version + 1, linked back to the CID it follows. */
function nextVersion(manifest: Manifest, prevCid: string): Manifest {
  return {
    ...manifest,
    version: versionOf(manifest) + 1,
    prev_asset_manifest_cid: prevCid,
    timestamp: Date.now(),
  };
}

async function writeVersion(session: Session, target: AssetTarget, next: Manifest): Promise<string> {
  const newCid = await writeManifest(next);
  await updateCollection(session, target.tokenId, (draft) => {
    replaceAssetEntry(draft, target.assetID, target.cid, newCid);
  });
  return newCid;
}

/* ---- attach ---- */

/**
 * The `profile` a slicer file records, from `--printer`/`--material` and
 * `--layer`/`--nozzle` (mm). Undefined when none is given.
 */
export function profileFrom(opts: {
  printer?: string;
  material?: string;
  layer?: unknown;
  nozzle?: unknown;
}): Record<string, string | number> | undefined {
  const profile: Record<string, string | number> = {};
  if (opts.printer) profile.printer = opts.printer;
  if (opts.material) profile.material = opts.material;
  for (const [key, field] of [["layer", "layer_mm"], ["nozzle", "nozzle_mm"]] as const) {
    if (opts[key] === undefined) continue;
    const mm = Number(opts[key]);
    if (!Number.isFinite(mm) || mm <= 0) throw new Error(key + " must be a positive number (mm)");
    profile[field] = mm;
  }
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function formatOf(file: string): string {
  const format = path.extname(file).slice(1).toLowerCase();
  if (!format) throw new Error("The file needs an extension to name its format: " + file);
  return format;
}

function roleOf(role: string | undefined, format: string): RepresentationRole {
  if (role === undefined) return defaultRole(format);
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new Error("Unknown role " + role + " (" + ROLES.join(", ") + ")");
  }
  return role as RepresentationRole;
}

/**
 * What the new file was made from (spec R6): `--from` when given (`none` for
 * nothing), else the primary model for a machine or mesh file.
 */
function derivedFrom(manifest: Manifest, role: RepresentationRole, from: string | undefined) {
  if (from === "none") return undefined;
  const ref = from ?? (role === "machine" || role === "mesh" ? PRIMARY_REF : undefined);
  if (!ref) return undefined;
  const derived = derivedFromOf(manifest, ref);
  if (derived) return derived;
  // The default is a convenience: an asset whose model is a live reference
  // has no source CID to record.
  if (from === undefined) return undefined;
  throw new Error(
    ref === PRIMARY_REF
      ? "The asset's model has no stored source to derive from (use --from none)"
      : "No representation " + ref + " to derive from",
  );
}

function checkSize(file: string): number {
  if (!fs.existsSync(file)) {
    throw Object.assign(new Error("File not found: " + file), { code: "FILE_NOT_FOUND" });
  }
  const size = fs.statSync(file).size;
  if (size > MAX_REPRESENTATION_BYTES) {
    throw new Error("A representation is at most 256 MB (" + file + " is " + size + " bytes)");
  }
  return size;
}

function checkRoom(manifest: Manifest, id: string): void {
  if (!hasRoomFor(manifest, id)) {
    throw new Error("An asset holds at most " + MAX_REPRESENTATIONS + " representations");
  }
}

/**
 * Validate the entry as it will be recorded, before anything is uploaded
 * (the CID is the one field not known yet): a bad format or a name over 255
 * characters must not leave a public orphan upload behind.
 */
function checkEntry(entry: Omit<Representation, "cid">): void {
  const parsed = representationSchema.safeParse({ ...entry, cid: "pending" });
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  throw new Error("Cannot attach: " + issue.path.join(".") + " " + issue.message);
}

/**
 * Upload a file and record it as a representation of the asset: writes the
 * next asset version (adding the entry, or replacing the one with its id) and
 * updates the collection. Every check runs before the upload.
 */
export async function attachRepresentation(
  session: Session,
  opts: AttachOptions,
): Promise<{ cid: string; representation: Representation; replaced: boolean }> {
  const size = checkSize(opts.file);
  const format = formatOf(opts.file);
  const role = roleOf(opts.role, format);
  const base = asAssetManifest((await getManifest(opts.cid)) as Manifest, opts);
  const id = opts.id ?? representationId(role, format, opts.profile);
  const idCheck = representationSchema.shape.id.safeParse(id);
  if (!idCheck.success) throw new Error("Invalid id " + JSON.stringify(id) + ": " + idCheck.error.issues[0].message);
  checkRoom(base, id);
  const derived = derivedFrom(base, role, opts.from);

  const name = path.basename(opts.file);
  const entry: Omit<Representation, "cid"> = {
    id,
    role,
    format,
    name,
    bytes: size,
    encoding: encodingFor(format),
    ...(derived && { derived_from: derived }),
    ...(opts.profile && Object.keys(opts.profile).length > 0 && { profile: opts.profile }),
    created_at: Date.now(),
  };
  checkEntry(entry);
  if (role === "source") opts.onWarning?.(PUBLIC_SOURCE_WARNING);

  const raw = new Uint8Array(fs.readFileSync(opts.file));
  const encoded = await encodeRepresentation(raw, format);
  const representation: Representation = {
    ...entry,
    bytes: raw.byteLength,
    encoding: encoded.encoding,
    cid: await writeRawBytes(encoded.bytes, name),
  };
  const replaced = Array.isArray(base.representations) && base.representations.some((rep: { id?: string }) => rep?.id === id);
  const next = withRepresentation(nextVersion(base, opts.cid), representation);
  return { cid: await writeVersion(session, opts, next), representation, replaced };
}

/* ---- detach / list / read ---- */

/** Remove a representation: writes the next asset version without it. */
export async function detachRepresentation(
  session: Session,
  target: AssetTarget & { id: string },
): Promise<{ cid: string }> {
  const current = (await getManifest(target.cid)) as Manifest;
  findRepresentation(current, target.id);
  const next = nextVersion(withoutRepresentation(current, target.id), target.cid);
  return { cid: await writeVersion(session, target, next) };
}

export interface RepresentationSummary {
  id: string;
  role: string;
  format: string;
  name: string;
  bytes: number;
  cid: string;
  derivedFrom: string | null;
  stale: boolean;
  profile?: Record<string, string | number>;
  tool?: Record<string, string | number>;
  stats?: Record<string, string | number>;
}

/** The manifest's representations with their computed stale marker. */
export function describeRepresentations(manifest: Manifest): RepresentationSummary[] {
  return listRepresentations(manifest).map((rep) => ({
    id: rep.id,
    role: rep.role,
    format: rep.format,
    name: rep.name,
    bytes: rep.bytes,
    cid: rep.cid,
    derivedFrom: rep.derived_from?.ref ?? null,
    stale: isStale(manifest, rep),
    ...(rep.profile && { profile: rep.profile }),
    ...(rep.tool && { tool: rep.tool }),
    ...(rep.stats && { stats: rep.stats }),
  }));
}

/**
 * The manifest's representation `id`.
 * @throws `code: "NOT_FOUND"` naming the ids the asset has.
 */
function findRepresentation(manifest: Manifest, id: string): Representation {
  const list = listRepresentations(manifest);
  const representation = list.find((rep) => rep.id === id);
  if (representation) return representation;
  const known = list.map((rep) => rep.id);
  throw Object.assign(
    new Error("No representation " + id + (known.length ? " (has: " + known.join(", ") + ")" : " (the asset has none)")),
    { code: "NOT_FOUND" },
  );
}

/** Fetch one representation's file, decoded. */
export async function readRepresentation(
  manifest: Manifest,
  id: string,
): Promise<{ representation: Representation; bytes: Uint8Array }> {
  const representation = findRepresentation(manifest, id);
  const bytes = await decodeRepresentation(await readRawBytes(representation.cid), representation);
  return { representation, bytes };
}

/* ---- carry-forward for model uploads (spec R3) ---- */

/**
 * The collection entry for a newly uploaded model. `besk upload` and saved
 * generations store the bare composite; when the version they replace holds
 * representations, the entry is instead the next asset version wrapping that
 * composite, so the list is kept (and becomes stale against the new model).
 * @returns the entry and the CID it replaces (`prevCid`, undefined for a new
 *   asset), which the collection write must still find there.
 */
export async function nextModelEntry(
  tokenId: string,
  assetID: string,
  name: string,
  compositeCid: string,
): Promise<{ entryCid: string; prevCid: string | undefined }> {
  const { manifest: collection } = await getCollectionManifest(tokenId);
  const prevCid: string | undefined = collection?.assets?.[assetID];
  if (!prevCid) return { entryCid: compositeCid, prevCid };
  const prev = (await getManifest(prevCid)) as Manifest;
  if (!Array.isArray(prev?.representations) || prev.representations.length === 0) {
    return { entryCid: compositeCid, prevCid };
  }
  const format = detectFormat(await getManifest(compositeCid));
  const next = compositeWrapper(compositeCid, format, name, assetID, versionOf(prev));
  const entryCid = await writeManifest({ ...nextVersion(next, prevCid), representations: prev.representations });
  return { entryCid, prevCid };
}

/* ---- history (spec R4) ---- */

export interface RepresentationChange {
  change: "added" | "replaced" | "removed";
  id: string;
  /** e.g. "Added G-code (Original Prusa MK4, PETG)". */
  text: string;
}

const FORMAT_LABELS: Record<string, string> = {
  gcode: "G-code", bgcode: "binary G-code", blend: "Blender file", stl: "STL",
  obj: "OBJ", "3mf": "3MF", step: "STEP", stp: "STEP", glb: "GLB", gltf: "glTF",
  usdz: "USDZ", f3d: "Fusion file", fcstd: "FreeCAD file", scad: "OpenSCAD file",
};

function changeText(change: RepresentationChange["change"], rep: Representation): string {
  const verb = { added: "Added", replaced: "Replaced", removed: "Removed" }[change];
  const label = FORMAT_LABELS[rep.format] ?? rep.format.toUpperCase();
  const details = [rep.profile?.printer, rep.profile?.material].filter((part) => part !== undefined && part !== "");
  return verb + " " + label + (details.length ? " (" + details.join(", ") + ")" : "");
}

/**
 * What changed in the representation list between two versions: entries
 * added, replaced (same id, other file) and removed, in that order.
 */
export function representationChanges(prev: Manifest | null, next: Manifest): RepresentationChange[] {
  const before = new Map(listRepresentations(prev).map((rep) => [rep.id, rep]));
  const after = listRepresentations(next);
  const changes: RepresentationChange[] = [];
  for (const rep of after) {
    const old = before.get(rep.id);
    if (!old) changes.push({ change: "added", id: rep.id, text: changeText("added", rep) });
    else if (old.cid !== rep.cid) changes.push({ change: "replaced", id: rep.id, text: changeText("replaced", rep) });
  }
  const kept = new Set(after.map((rep) => rep.id));
  for (const rep of before.values()) {
    if (!kept.has(rep.id)) changes.push({ change: "removed", id: rep.id, text: changeText("removed", rep) });
  }
  return changes;
}

/**
 * The representation changes each version made, for a history ordered oldest
 * → newest. The oldest version is compared with nothing (its list is "added"
 * only when it has one). A version that cannot be read reports no change.
 */
export async function historyRepresentationChanges(entries: ReadonlyArray<{ cid: string }>): Promise<RepresentationChange[][]> {
  const manifests = await Promise.all(
    entries.map((entry) => (getManifest(entry.cid) as Promise<Manifest>).catch(() => null)),
  );
  return manifests.map((manifest, i) => (manifest ? representationChanges(i > 0 ? manifests[i - 1] : null, manifest) : []));
}
