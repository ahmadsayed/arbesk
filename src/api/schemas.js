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

// ~10 MB raw image → ~14 MB base64. Keeps generation requests well under the
// 50 MB JSON body limit while accepting any reasonable source photo.
const MAX_IMAGE_BASE64_LENGTH = 14 * 1024 * 1024;

// Biped retarget presets accepted by Tripo POST /animations/retarget.
export const ANIMATION_PRESETS = /** @type {[string, ...string[]]} */ ([
  "preset:idle",
  "preset:walk",
  "preset:run",
  "preset:dive",
  "preset:climb",
  "preset:jump",
  "preset:slash",
  "preset:shoot",
  "preset:hurt",
  "preset:fall",
  "preset:turn",
]);

export const generateAssetSchema = z
  .object({
    prompt: z.string().min(1, "prompt is required").optional(),
    nodeId: z.string().min(1, "nodeId is required"),
    provider: z.string().optional(),
    providerKey: z.string().max(200).optional(),
    refineTaskId: z.string().max(64).optional(),
    // Image-to-3D (tripo3d only): base64 image bytes + MIME type.
    imageData: z
      .string()
      .max(MAX_IMAGE_BASE64_LENGTH, "imageData exceeds the 10 MB image limit")
      .regex(/^[A-Za-z0-9+/=\r\n]+$/, "imageData must be base64")
      .optional(),
    imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    // Rig & animate (tripo3d only): taskId of a completed generation +
    // retarget presets (max 5 per Tripo call), or rigOnly to stop after
    // the rig step (Mixamo-ready model, no baked animation).
    animateTaskId: z.string().max(64).optional(),
    rigOnly: z.boolean().optional(),
    animations: z.array(z.enum(ANIMATION_PRESETS)).min(1).max(5).optional(),
  })
  .refine((v) => v.prompt || v.imageData || v.animateTaskId, {
    message: "prompt, imageData, or animateTaskId is required",
    path: ["prompt"],
  })
  .refine((v) => !v.imageData || v.imageMime, {
    message: "imageMime is required when imageData is present",
    path: ["imageMime"],
  })
  .refine(
    (v) => !v.animateTaskId || v.rigOnly || (v.animations?.length ?? 0) > 0,
    {
      message: "animations is required when animateTaskId is present",
      path: ["animations"],
    },
  );

export const providerBalanceSchema = z.object({
  providerKey: z.string().min(1, "providerKey is required").max(200),
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
