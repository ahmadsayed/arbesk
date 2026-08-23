/**
 * Canonical Arbesk manifest schema (zod).
 *
 * Mirrors the validator that previously lived in `src/api/schemas.ts` — the
 * wire format is unchanged: `version` is the only required field, unknown
 * keys are tolerated (stripped from the parsed `data`, zod default), and all
 * other fields are optional.
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
  metadata: z
    .object({
      chat: z.array(chatProvenanceEntrySchema).optional(),
    })
    .optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
