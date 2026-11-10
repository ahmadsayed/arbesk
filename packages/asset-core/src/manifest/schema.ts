/**
 * Canonical Arbesk manifest schema.
 * @remarks Wire format: `version` is the only required field; unknown keys are
 *   tolerated (stripped from the parsed `data`); all other fields are optional.
 */

import { z } from "zod";

const ethereumAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

const transformMatrixSchema = z.array(z.number()).length(16).optional();

// Thumbnails are captured client-side and uploaded to IPFS directly; the
// manifest stores a metadata object (never a bare CID string). Only `cid` is
// load-bearing — the manifest chain walker unpins it with the manifest — the
// rest is best-effort metadata written by the frontend
// (engine/scene-graph.js captureAssetThumbnail).
const thumbnailSchema = z.object({
  cid: z.string().min(1),
  type: z.string().optional(),
  mime: z.string().optional(),
  format: z.string().optional(),
  path: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  bytes: z.number().optional(),
  timestamp: z.number().optional(),
});

const chatProvenanceEntrySchema = z.object({
  prompt: z.string().min(1),
  provider: z.string().min(1),
  task: z.string().min(1),
  taskId: z.string().min(1).optional(),
  timestamp: z.number(),
});

const sourceSchema = z.object({
  cid: z.string().min(1),
  uri: z.string().optional(),
});

const childRefSchema = z.object({
  collection: z.object({
    chainId: z.number().int().nonnegative(),
    contractAddress: ethereumAddressSchema,
    tokenId: z.string().min(1),
  }),
  assetID: z.string().min(1),
});

const nodeSchema = z.object({
  node_id: z.string().min(1),
  transform_matrix: transformMatrixSchema,
  source: sourceSchema.optional(),
  // Reference image a model was generated from (image-to-3D provenance).
  reference_image: z
    .object({
      cid: z.string().min(1),
      mime: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  child_ref: childRefSchema.optional(),
});

// System-computed model facts (deterministic only — no heuristics). Every
// field optional: a format that cannot derive a field simply omits it.
const computedMetadataSchema = z.object({
  format: z.enum(["glb", "gltf", "3mf"]).optional(),
  dimensions: z
    .object({
      width: z.number(),
      height: z.number(),
      depth: z.number(),
      unit: z.string().optional(),
    })
    .optional(),
  bounds: z
    .object({
      min: z.array(z.number()).length(3),
      max: z.array(z.number()).length(3),
    })
    .optional(),
  center: z.array(z.number()).length(3).optional(),
  origin: z.array(z.number()).length(3).optional(),
  animation_clips: z.array(z.string()).optional(),
  triangle_count: z.number().int().nonnegative().optional(),
  vertex_count: z.number().int().nonnegative().optional(),
  mesh_count: z.number().int().nonnegative().optional(),
  node_count: z.number().int().nonnegative().optional(),
  material_count: z.number().int().nonnegative().optional(),
  texture_count: z.number().int().nonnegative().optional(),
  rigged: z.boolean().optional(),
  bone_count: z.number().int().nonnegative().optional(),
});

/** Most representations one asset manifest may hold. */
export const MAX_REPRESENTATIONS = 32;
/** Largest file (decoded bytes) one representation may record: 256 MB. */
export const MAX_REPRESENTATION_BYTES = 256 * 1024 * 1024;
/** The reserved id of the asset's own model (`scene.nodes[0].source`). */
export const PRIMARY_REF = "primary";

const REPRESENTATION_ID = /^[a-z0-9-]{1,64}$/;
const MAX_DETAIL_KEYS = 32;

// tool / profile / stats: small free-form maps of strings and numbers.
const representationDetailSchema = z
  .record(z.union([z.string(), z.number()]))
  .refine((detail) => Object.keys(detail).length <= MAX_DETAIL_KEYS, {
    message: `at most ${MAX_DETAIL_KEYS} keys`,
  });

/**
 * One other file of the same asset (a `.blend` to edit, an STL to share, the
 * G-code a slicer made). Passthrough so a client that parses a manifest keeps
 * fields a newer client added to an entry.
 */
export const representationSchema = z
  .object({
    id: z
      .string()
      .regex(REPRESENTATION_ID, "id must be 1-64 of [a-z0-9-]")
      .refine((id) => id !== PRIMARY_REF, { message: `"${PRIMARY_REF}" is reserved` }),
    role: z.enum(["source", "mesh", "view", "machine", "other"]),
    format: z.string().regex(/^[a-z0-9]{1,16}$/, "format is the lower-case extension without a dot"),
    name: z.string().min(1).max(255),
    cid: z.string().min(1),
    bytes: z.number().int().nonnegative().max(MAX_REPRESENTATION_BYTES),
    encoding: z.enum(["raw", "brotli"]),
    derived_from: z
      .object({
        ref: z.union([z.literal(PRIMARY_REF), z.string().regex(REPRESENTATION_ID)]),
        cid: z.string().min(1),
      })
      .optional(),
    tool: representationDetailSchema.optional(),
    profile: representationDetailSchema.optional(),
    stats: representationDetailSchema.optional(),
    created_at: z.number(),
  })
  .passthrough();

export type Representation = z.infer<typeof representationSchema>;

const representationsSchema = z
  .array(representationSchema)
  .max(MAX_REPRESENTATIONS)
  .superRefine((reps, ctx) => {
    const seen = new Set<string>();
    reps.forEach((rep, index) => {
      if (seen.has(rep.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: `duplicate representation id "${rep.id}"`,
        });
      }
      seen.add(rep.id);
    });
  });

export const manifestSchema = z.object({
  version: z.union([z.string().min(1), z.number()]),
  type: z.enum(["asset", "scene", "collection", "world"]).optional(),
  assetID: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  source_asset: sourceSchema.optional(),
  scene: z
    .object({
      nodes: z.array(nodeSchema),
    })
    .optional(),
  assets: z.record(z.string().min(1)).optional(),
  prev_manifest_cid: z.union([z.string().min(1), z.null()]).optional(),
  prev_asset_manifest_cid: z.union([z.string().min(1), z.null()]).optional(),
  thumbnail: thumbnailSchema.optional(),
  comments_archive_cid: z.string().min(1).optional(),
  // Other files of the same asset (manifest/representations.ts). In the
  // canonical schema so a parsed copy never drops them on the next save.
  representations: representationsSchema.optional(),
  metadata: z
    .object({
      chat: z.array(chatProvenanceEntrySchema).optional(),
      annotations: z.record(z.unknown()).optional(),
      computed: computedMetadataSchema.passthrough().optional(),
    })
    .optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
