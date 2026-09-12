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

// ─── CAD generation ────────────────────────────────────────────────────────

/**
 * Largest script body accepted from a client.
 * @remarks Matches the cap parseDesign enforces on a model reply (64 KiB), so
 *   a document the server produced can always be echoed back to it. Smaller
 *   and the iteration loop would reject its own output.
 */
const CAD_MAX_CODE_CHARS = 64 * 1024;

/** Most parameters a design may declare - parseDesign's own ceiling. */
const CAD_MAX_PARAMETERS = 40;

/**
 * Absolute ceiling on one image's base64 payload.
 * @remarks This is a MEMORY bound, not a policy one: express.json parses the
 *   whole body into strings before any route runs, so an unbounded field is a
 *   hole an anonymous-in-effect request can push a heap through. The policy cap
 *   is CAD_MAX_IMAGE_BYTES, checked in the route where it can answer 413.
 *   12 MiB of base64 is about 9 MiB of image, comfortably above the 8 MiB
 *   default the spec documents.
 */
const CAD_MAX_IMAGE_BASE64 = 12 * 1024 * 1024;

/** Character ceiling on a human-readable change note. */
const CAD_MAX_SUMMARY_CHARS = 2000;

/**
 * One millimetre dimension.
 * @remarks Mirrors CadParameter, and deliberately as strict: unit is mm,
 *   values are finite, and min/max are advisory bounds a UI may clamp to. The
 *   VALUE is the only thing the kernel reads, so it is the only field that
 *   must be a finite number - a JSON null there reaches PARAMETERS as NaN and
 *   fails a static gate with a message about the script, not the request.
 */
const cadParameterSchema = z.object({
  value: z.number().finite(),
  unit: z.literal("mm").optional().default("mm"),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  label: z.string().max(200).optional(),
});

/**
 * A design document as the client echoes it back.
 * @remarks This is the stateless-continuity payload: priorDesign carries the
 *   prior parameter VALUES, which live outside the script. Validated here so a
 *   malformed echo is a 400 naming the field rather than a crash inside prompt
 *   assembly.
 */
const cadDesignSchema = z.object({
  code: z.string().min(1).max(CAD_MAX_CODE_CHARS),
  parameters: z
    .record(cadParameterSchema)
    .refine((p) => Object.keys(p).length > 0, "a design needs at least one parameter")
    .refine(
      (p) => Object.keys(p).length <= CAD_MAX_PARAMETERS,
      "a design may declare at most " + CAD_MAX_PARAMETERS + " parameters",
    ),
  summary: z.string().max(CAD_MAX_SUMMARY_CHARS).optional().default(""),
  turn: z.number().int().positive().optional(),
});

/** One attached view: base64 payload plus its mime type. */
const cadImageSchema = z.object({
  data: z.string().min(1).max(CAD_MAX_IMAGE_BASE64),
  mime: z
    .string()
    .regex(/^image\/(png|jpeg|webp)$/, "mime must be image/png, image/jpeg or image/webp"),
});

/** One geometric-gate failure a client's kernel run reported. */
const cadFailureSchema = z.object({
  gate: z.string().min(1).max(64),
  error: z.string().min(1).max(2000),
});

/**
 * Where a design came from: an IPFS CID or an on-chain asset id.
 * @remarks Accepted by the schema but not yet resolvable - see the route's
 *   not-implemented branch. Kept in the contract so a client can be written
 *   against it before the resolution path lands.
 */
const cadSourceRefSchema = z.union([
  z.object({ cid: z.string().min(1).max(200) }),
  z.object({ assetId: z.string().min(1).max(200) }),
]);

/** Server-capped by CAD_MAX_REPAIR_ATTEMPTS as well; 3 is the shipped bound. */
const cadRepairAttempts = z.number().int().min(0).max(3);

/** Body of POST /api/v1/cad/generations. */
export const cadGenerateSchema = z.object({
  prompt: z.string().min(1).max(4000),
  priorDesign: cadDesignSchema.optional(),
  sourceRef: cadSourceRefSchema.optional(),
  images: z.array(cadImageSchema).max(4).optional(),
  repairAttempts: cadRepairAttempts.optional(),
});

/**
 * Body of POST /api/v1/cad/repairs.
 * @remarks priorDesign is REQUIRED here, unlike on /generations: a repair with
 *   nothing to repair is just a generation, and accepting it would give one
 *   prompt two ways to reach the provider for the same money.
 */
export const cadRepairSchema = z.object({
  prompt: z.string().min(1).max(4000),
  priorDesign: cadDesignSchema,
  failures: z.array(cadFailureSchema).min(1).max(8),
  repairAttempts: cadRepairAttempts.optional(),
});
