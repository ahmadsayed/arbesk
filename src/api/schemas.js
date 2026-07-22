import { z } from "zod";

// ─── Primitives ─────────────────────────────────────────────────────────────

export const cidSchema = z
  .string()
  .min(1)
  .refine((v) => /^[a-zA-Z0-9]+$/.test(v), {
    message: "CID must be alphanumeric",
  });

export const ethereumAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

export const tokenIdSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform((v) => String(v));

export const chainIdSchema = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((v) => Number.isFinite(v) && v > 0, {
    message: "chainId must be a positive number",
  });

// ─── Route Body Schemas ─────────────────────────────────────────────────────

export const createSessionSchema = z.object({
  message: z.string().min(1, "message is required"),
  signature: z.string().min(1, "signature is required"),
  eoaAddress: ethereumAddressSchema.optional(),
});

export const generateAssetSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
  nodeId: z.string().min(1, "nodeId is required"),
  provider: z.string().optional(),
  providerKey: z.string().max(200).optional(),
  refineTaskId: z.string().max(64).optional(),
});

export const snapshotCommentsSchema = z.object({
  tokenId: tokenIdSchema,
  chainId: chainIdSchema.optional(),
  contractAddress: ethereumAddressSchema.optional(),
  assetId: z.string().min(1, "assetId is required"),
});

export const unpinSchema = z.object({
  cid: cidSchema,
  // uint256-safe: decimal string, never a JS number.
  tokenId: z.string().regex(/^\d+$/, "tokenId must be a decimal string"),
  chainId: z.number().int().positive().optional(),
  contractAddress: ethereumAddressSchema.optional(),
  proof: z
    .array(
      z
        .string()
        .regex(/^0x[a-fA-F0-9]{64}$/, "proof entries must be bytes32 hex"),
    )
    .optional(),
});

export const uploadUrlsSchema = z.object({
  count: z.number().int().min(1).max(200).optional().default(1),
});

export const resolveEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("a valid email is required")
    .max(254),
});

export const ownedQuerySchema = z.object({
  address: ethereumAddressSchema,
  chainId: chainIdSchema,
  force: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "1"),
});

export const sharedQuerySchema = z.object({
  address: ethereumAddressSchema,
  chainId: chainIdSchema,
  force: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "1"),
});

export const gcSchema = z.object({
  dryRun: z.boolean().optional().default(true),
  maxUnpin: z.number().int().positive().optional(),
  chainId: chainIdSchema.optional(),
});

// ─── Manifest Shape Schemas ─────────────────────────────────────────────────

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

const historyEntrySchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  node_id: z.string().optional(),
  operation: z.string(),
  params: z.record(z.unknown()).optional(),
  // Per-version source snapshot (see manifest-chain-walker.js): the glTF CID
  // is required, the UnixFS bundle directory CID is optional metadata.
  src: z
    .object({
      cid: z.string().min(1),
      bundleCid: z.string().min(1).optional(),
    })
    .optional(),
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
  child_ref: childRefSchema.optional(),
  history: z.array(historyEntrySchema).optional(),
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
});

/**
 * Validate a manifest object. Returns { valid: true, data } or
 * { valid: false, errors }.
 *
 * @param {unknown} manifest
 * @returns {{ valid: true; data: import('zod').infer<typeof manifestSchema> } | { valid: false; errors: string[] }}
 */
export function validateManifest(manifest) {
  const result = manifestSchema.safeParse(manifest);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
      ),
    };
  }
  return { valid: true, data: result.data };
}
