/**
 * Asset representations (asset-core manifest/representations.ts): the schema,
 * the pure list helpers, staleness, ids and the brotli/raw encoding.
 *
 * Runs in the default node environment: jsdom's realm-mismatched Uint8Array
 * breaks the instanceof checks in utils/compression.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  representationSchema,
  listRepresentations,
  currentCidOf,
  isStale,
  withRepresentation,
  withoutRepresentation,
  encodeRepresentation,
  decodeRepresentation,
  representationId,
  defaultRole,
  encodingFor,
  MAX_REPRESENTATIONS,
  MAX_REPRESENTATION_BYTES,
} from "@arbesk/asset-core/manifest/representations.js";
import { validateManifest } from "@arbesk/asset-core/manifest/utils.js";
import { isBrotliFramed } from "@arbesk/asset-core/utils/compression.js";

const source = {
  id: "source",
  role: "source",
  format: "blend",
  name: "Bracket.blend",
  cid: "bafyBlend",
  bytes: 4812331,
  encoding: "raw",
  created_at: 1793900000000,
};

const gcode = {
  id: "gcode-original-prusa-mk4-petg",
  role: "machine",
  format: "gcode",
  name: "Bracket_0.2mm_PETG_MK4.gcode",
  cid: "bafyGcode",
  bytes: 812331,
  encoding: "brotli",
  derived_from: { ref: "primary", cid: "bafyModel" },
  tool: { name: "PrusaSlicer", version: "2.9.2" },
  profile: { printer: "Original Prusa MK4", material: "PETG", layer_mm: 0.2, nozzle_mm: 0.4 },
  stats: { print_time_s: 7420, filament_g: 38.5 },
  created_at: 1793900000000,
};

const manifest = (extra = {}) => ({
  type: "asset",
  version: 3,
  scene: { nodes: [{ node_id: "node_1", source: { cid: "bafyModel" } }] },
  ...extra,
});

describe("representationSchema", () => {
  test("accepts the spec's examples", () => {
    expect(representationSchema.safeParse(source).success).toBe(true);
    expect(representationSchema.safeParse(gcode).success).toBe(true);
  });

  test.each([
    ["an upper-case id", { id: "Source" }],
    ["an id with an underscore", { id: "my_file" }],
    ["an empty id", { id: "" }],
    ["a 65-character id", { id: "a".repeat(65) }],
    ["the reserved id primary", { id: "primary" }],
    ["an unknown role", { role: "print" }],
    ["an unknown encoding", { encoding: "gzip" }],
    ["a format with a dot", { format: ".stl" }],
    ["an upper-case format", { format: "STL" }],
    ["a file over 256 MB", { bytes: MAX_REPRESENTATION_BYTES + 1 }],
    ["a fractional size", { bytes: 1.5 }],
    ["a derived_from ref that is no id", { derived_from: { ref: "Not An Id", cid: "x" } }],
    ["a profile with an object value", { profile: { printer: { model: "MK4" } } }],
    ["a profile over 32 keys", { profile: Object.fromEntries(Array.from({ length: 33 }, (_, i) => ["k" + i, i])) }],
    ["no cid", { cid: undefined }],
  ])("rejects %s", (_label, patch) => {
    expect(representationSchema.safeParse({ ...source, ...patch }).success).toBe(false);
  });

  test("accepts a 64-character id and a 256 MB file", () => {
    const rep = { ...source, id: "a".repeat(64), bytes: MAX_REPRESENTATION_BYTES };
    expect(representationSchema.safeParse(rep).success).toBe(true);
  });

  test("keeps fields a newer client added to an entry", () => {
    const parsed = representationSchema.parse({ ...source, checksum: "abc" });
    expect(parsed.checksum).toBe("abc");
  });
});

describe("manifestSchema representations", () => {
  test("a parsed manifest keeps its representations", () => {
    const result = validateManifest(manifest({ representations: [source, gcode] }));
    expect(result.valid).toBe(true);
    expect(result.data.representations).toEqual([source, gcode]);
  });

  test("rejects duplicate ids", () => {
    const result = validateManifest(manifest({ representations: [source, { ...gcode, id: "source" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("duplicate representation id");
  });

  test(`rejects more than ${MAX_REPRESENTATIONS} entries`, () => {
    const reps = Array.from({ length: MAX_REPRESENTATIONS + 1 }, (_, i) => ({ ...source, id: "r" + i }));
    expect(validateManifest(manifest({ representations: reps })).valid).toBe(false);
    expect(validateManifest(manifest({ representations: reps.slice(1) })).valid).toBe(true);
  });
});

describe("listRepresentations", () => {
  test("returns the valid entries in stored order", () => {
    expect(listRepresentations(manifest({ representations: [gcode, source] }))).toEqual([gcode, source]);
  });

  test("leaves out entries that do not parse and tolerates a missing list", () => {
    expect(listRepresentations(manifest({ representations: [{ id: "BAD" }, source] }))).toEqual([source]);
    expect(listRepresentations(manifest())).toEqual([]);
    expect(listRepresentations(null)).toEqual([]);
    expect(listRepresentations(manifest({ representations: "nope" }))).toEqual([]);
  });
});

describe("isStale", () => {
  test("a representation without derived_from is never stale", () => {
    expect(isStale(manifest({ representations: [source] }), source)).toBe(false);
  });

  test("primary: fresh while the model's source CID matches, stale once it changes", () => {
    const m = manifest({ representations: [gcode] });
    expect(isStale(m, gcode)).toBe(false);
    m.scene.nodes[0].source.cid = "bafyModel2";
    expect(isStale(m, gcode)).toBe(true);
  });

  test("primary: stale when the asset has no source node", () => {
    expect(isStale({ version: 1, scene: { nodes: [{ node_id: "n", child_ref: {} }] } }, gcode)).toBe(true);
  });

  test("chained: follows another representation's CID", () => {
    const stl = { ...source, id: "stl", role: "mesh", format: "stl", cid: "bafyStl", derived_from: { ref: "source", cid: "bafyBlend" } };
    const m = manifest({ representations: [source, stl] });
    expect(isStale(m, stl)).toBe(false);
    const edited = withRepresentation(m, { ...source, cid: "bafyBlend2" });
    expect(isStale(edited, stl)).toBe(true);
    const removed = withoutRepresentation(m, "source");
    expect(isStale(removed, stl)).toBe(true);
  });

  test("currentCidOf names the primary model or another entry", () => {
    const m = manifest({ representations: [source] });
    expect(currentCidOf(m, "primary")).toBe("bafyModel");
    expect(currentCidOf(m, "source")).toBe("bafyBlend");
    expect(currentCidOf(m, "missing")).toBe(null);
    expect(currentCidOf({}, "primary")).toBe(null);
  });
});

describe("withRepresentation / withoutRepresentation", () => {
  test("adds an entry without touching the input", () => {
    const m = manifest();
    const next = withRepresentation(m, source);
    expect(next.representations).toEqual([source]);
    expect(m.representations).toBeUndefined();
    expect(next.version).toBe(3);
  });

  test("replaces the entry with the same id in place", () => {
    const m = manifest({ representations: [source, gcode] });
    const next = withRepresentation(m, { ...source, cid: "bafyBlend2" });
    expect(next.representations.map((r) => r.cid)).toEqual(["bafyBlend2", "bafyGcode"]);
    expect(m.representations[0].cid).toBe("bafyBlend");
  });

  test("refuses an invalid entry", () => {
    expect(() => withRepresentation(manifest(), { ...source, id: "primary" })).toThrow();
  });

  test(`refuses entry ${MAX_REPRESENTATIONS + 1} but replaces within a full list`, () => {
    const reps = Array.from({ length: MAX_REPRESENTATIONS }, (_, i) => ({ ...source, id: "r" + i }));
    const full = manifest({ representations: reps });
    expect(() => withRepresentation(full, { ...source, id: "one-more" })).toThrow("at most 32");
    expect(withRepresentation(full, { ...source, id: "r0", cid: "x" }).representations[0].cid).toBe("x");
  });

  test("removes by id, drops the field when empty, refuses an unknown id", () => {
    const m = manifest({ representations: [source, gcode] });
    expect(withoutRepresentation(m, "source").representations).toEqual([gcode]);
    expect("representations" in withoutRepresentation(manifest({ representations: [source] }), "source")).toBe(false);
    expect(() => withoutRepresentation(m, "nope")).toThrow('No representation with id "nope"');
    expect(m.representations).toHaveLength(2);
  });
});

describe("encodeRepresentation / decodeRepresentation", () => {
  const text = new TextEncoder().encode("G1 X10 Y10 E0.5\n".repeat(2000));

  test("text formats round-trip through the brotli frame", async () => {
    const { bytes, encoding } = await encodeRepresentation(text, "gcode");
    expect(encoding).toBe("brotli");
    expect(isBrotliFramed(bytes)).toBe(true);
    expect(bytes.length).toBeLessThan(text.length);
    expect(await decodeRepresentation(bytes, { encoding })).toEqual(text);
  });

  test("binary formats are stored raw and never sniffed on read", async () => {
    const framedLooking = new Uint8Array([0x41, 0x52, 0x42, 0x01, 9, 9, 9]);
    const { bytes, encoding } = await encodeRepresentation(framedLooking, "blend");
    expect(encoding).toBe("raw");
    expect(bytes).toBe(framedLooking);
    expect(await decodeRepresentation(bytes, { encoding: "raw" })).toBe(framedLooking);
  });

  test("a brotli entry whose bytes are not framed is an error", async () => {
    await expect(decodeRepresentation(new Uint8Array([1, 2, 3]), { encoding: "brotli" })).rejects.toThrow("not brotli-framed");
  });

  test("refuses a file over 256 MB", async () => {
    const huge = { byteLength: MAX_REPRESENTATION_BYTES + 1 };
    await expect(encodeRepresentation(huge, "blend")).rejects.toThrow("256 MB");
  });

  test("encodingFor follows the spec's text formats", () => {
    expect(["gcode", "gltf", "obj", "step"].map(encodingFor)).toEqual(["brotli", "brotli", "brotli", "brotli"]);
    expect(["blend", "stl", "glb", "3mf", "bgcode"].map(encodingFor)).toEqual(["raw", "raw", "raw", "raw", "raw"]);
  });
});

describe("representationId / defaultRole", () => {
  test("slugs format, printer and material", () => {
    expect(representationId("machine", "gcode", { printer: "Original Prusa MK4", material: "PETG" })).toBe(
      "gcode-original-prusa-mk4-petg",
    );
  });

  test("a source file is `source`, others their format", () => {
    expect(representationId("source", "blend")).toBe("source");
    expect(representationId("mesh", "stl")).toBe("stl");
    expect(representationId("machine", "gcode", { layer_mm: 0.2 })).toBe("gcode");
  });

  test("stays a valid id however long the profile", () => {
    const id = representationId("machine", "gcode", { printer: "x".repeat(100), material: "PLA" });
    expect(id.length).toBeLessThanOrEqual(64);
    expect(representationSchema.shape.id.safeParse(id).success).toBe(true);
  });

  test("defaultRole by format", () => {
    expect(["blend", "step", "stl", "3mf", "glb", "gcode", "bgcode", "zip", "BLEND"].map(defaultRole)).toEqual([
      "source", "source", "mesh", "mesh", "view", "machine", "machine", "other", "source",
    ]);
  });
});

describe("carry-forward through asset-core's manifest helpers (R3)", () => {
  test("bumpManifestVersion keeps the representations", async () => {
    const { bumpManifestVersion } = await import("@arbesk/asset-core/manifest/utils.js");
    const m = manifest({ representations: [source, gcode] });
    bumpManifestVersion(m, "bafyPrev");
    expect(m.version).toBe(4);
    expect(m.representations).toEqual([source, gcode]);
  });
});
