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

const tokenIdSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform((v) => String(v));

const chainIdSchema = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform((v) => (typeof v === "string" ? Number(v) : v))
  .refine((v) => Number.isFinite(v) && v > 0, {
    message: "chainId must be a positive number",
  });

// ─── Route Body Schemas ─────────────────────────────────────────────────────

const siweProofSchema = z.object({
  kind: z.literal("siwe"),
  message: z.string().min(1, "message is required"),
  signature: z.string().min(1, "signature is required"),
  eoaAddress: ethereumAddressSchema.optional(),
});

// Design seam for future OAuth/OIDC sign-in — accepted by the schema so the
// client can target the proof envelope, but not yet verified (see
// proof-verify.ts#verifyOidc).
const oidcProofSchema = z.object({
  kind: z.literal("oidc"),
  provider: z.string().min(1, "provider is required"),
  idToken: z.string().min(1, "idToken is required"),
  nonce: z.string().optional(),
});

export const createSessionSchema = z.object({
  proof: z.discriminatedUnion("kind", [siweProofSchema, oidcProofSchema]),
});

// ~10 MB raw image → ~14 MB base64. Keeps generation requests well under the
// 50 MB JSON body limit while accepting any reasonable source photo.
const MAX_IMAGE_BASE64_LENGTH = 14 * 1024 * 1024;

// Biped retarget presets accepted by Tripo POST /animations/retarget.
const ANIMATION_PRESETS = [
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
  // Curated v1.0 biped-rig presets (Tripo's 90+ library). The adapter maps
  // short-form IDs to this namespace for v1.0 rigs; these pass through as-is.
  "preset:biped:front_kick_01",
  "preset:biped:box_01",
  "preset:biped:cast_a_spell",
  "preset:biped:defeat_02",
  "preset:biped:scared_01",
  "preset:biped:dance_01",
  "preset:biped:dance_02",
  "preset:biped:cheer",
  "preset:biped:victory_celebration",
  "preset:biped:wave_goodbye_01",
  "preset:biped:clap",
  "preset:biped:bow",
  "preset:biped:sit",
  "preset:biped:look_around",
  "preset:biped:standing_relax",
  "preset:biped:swim",
] as [string, ...string[]];

export const generateAssetSchema = z
  .object({
    prompt: z.string().min(1, "prompt is required").optional(),
    nodeId: z.string().min(1, "nodeId is required"),
    chainId: z.number().int().nonnegative().optional(),
    generationTxHash: z.string().max(66).optional(),
    provider: z.string().optional(),
    providerKey: z.string().max(200).optional(),
    // Follow-up actions (tripo3d only): the source model is referenced by
    // its IPFS GLB CID — the backend fetches the bytes and uploads them to
    // Tripo (POST /files → file_token). Exactly one action flag per request.
    sourceAssetCid: z.string().min(1).max(128).optional(),
    retexture: z.boolean().optional(),
    retopo: z.boolean().optional(),
    animate: z.boolean().optional(),
    // Retarget-only shortcut: backend registry id of a completed rig-only
    // task. Optional — the GLB chain is the canonical path.
    sourceTaskId: z.string().max(64).optional(),
    rigOnly: z.boolean().optional(),
    // Rig model version override (tripo3d only). When omitted the adapter
    // auto-selects: bipeds try v1.0-20240301 first, falling back to
    // v2.5-20260210 on code 1004. Explicit selection skips the fallback —
    // the request fails if the chosen model is rejected.
    rigModel: z.enum(["v1.0-20240301", "v2.5-20260210"]).optional(),
    // Retarget option (tripo3d only): play the animation in place, without
    // root displacement.
    animateInPlace: z.boolean().optional(),
    animations: z.array(z.enum(ANIMATION_PRESETS)).min(1).max(5).optional(),
    // Texture quality (tripo3d only): generation + retexture.
    textureQuality: z.enum(["standard", "detailed", "extreme"]).optional(),
    // Smart retopology polygon budget (tripo3d only): adaptive when omitted.
    faceLimit: z.number().int().min(500).max(20000).optional(),
    // Image-to-3D (tripo3d only): base64 image bytes + MIME type.
    imageData: z
      .string()
      .max(MAX_IMAGE_BASE64_LENGTH, "imageData exceeds the 10 MB image limit")
      .regex(/^[A-Za-z0-9+/=\r\n]+$/, "imageData must be base64")
      .optional(),
    imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
    // Multiview image-to-3D (tripo3d only): 2–4 labeled views of the same
    // subject. Mutually exclusive with the single-image imageData field.
    images: z
      .array(
        z.object({
          imageData: z
            .string()
            .max(
              MAX_IMAGE_BASE64_LENGTH,
              "imageData exceeds the 10 MB image limit",
            )
            .regex(/^[A-Za-z0-9+/=\r\n]+$/, "imageData must be base64"),
          imageMime: z.enum(["image/jpeg", "image/png", "image/webp"]),
          view: z.enum(["front", "left", "back", "right"]),
        }),
      )
      .min(2, "images requires 2-4 views")
      .max(4, "images requires 2-4 views")
      .optional(),
  })
  .refine((v) => v.prompt || v.imageData || v.images?.length || v.sourceAssetCid, {
    message: "prompt, imageData, or sourceAssetCid is required",
    path: ["prompt"],
  })
  .refine((v) => !v.imageData || v.imageMime, {
    message: "imageMime is required when imageData is present",
    path: ["imageMime"],
  })
  .refine((v) => !v.images || !v.imageData, {
    message: "images and imageData are mutually exclusive",
    path: ["images"],
  })
  .refine(
    (v) =>
      !v.images ||
      new Set(v.images.map((img) => img.view)).size === v.images.length,
    {
      message: "images views must be unique",
      path: ["images"],
    },
  )
  .refine(
    (v) =>
      !v.images ||
      v.images.filter((img) => img.view === "front").length === 1,
    {
      message: "images must include exactly one front view",
      path: ["images"],
    },
  )
  .refine(
    (v) =>
      !v.sourceAssetCid ||
      [v.retexture, v.retopo, v.animate].filter(Boolean).length === 1,
    {
      message:
        "sourceAssetCid requires exactly one of retexture, retopo, or animate",
      path: ["sourceAssetCid"],
    },
  )
  .refine((v) => !v.retexture || v.prompt, {
    message: "prompt (texture description) is required when retexture is set",
    path: ["prompt"],
  })
  .refine(
    (v) => !v.animate || v.rigOnly || (v.animations?.length ?? 0) > 0,
    {
      message: "animations is required when animate is set (unless rigOnly)",
      path: ["animations"],
    },
  )
  .refine((v) => !v.rigOnly || v.animate, {
    message: "rigOnly is only valid with animate",
    path: ["rigOnly"],
  })
  .refine((v) => !v.rigModel || v.animate, {
    message: "rigModel is only valid with animate",
    path: ["rigModel"],
  })
  .refine((v) => !v.animateInPlace || (v.animate && !v.rigOnly), {
    message: "animateInPlace is only valid with animate (not rigOnly)",
    path: ["animateInPlace"],
  });

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

export const emailOtpRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("a valid email is required")
    .max(254),
});

export const emailOtpVerifySchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("a valid email is required")
    .max(254),
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
});

export const walletRelaySchema = z.object({
  op: z.enum(["publish", "updateUri", "updateEditors", "burn"]),
  tokenId: z.union([z.string().min(1), z.number().int().nonnegative()]),
  chainId: z.number().int().nonnegative().optional(),
  contractAddress: z.string().optional(),
  proof: z.array(z.string()).optional(),
  requiredRole: z.number().int().min(1).max(2).optional(),
  params: z.record(z.unknown()).optional(),
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
