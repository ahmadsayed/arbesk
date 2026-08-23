import express from "express";
import type { Request, Response } from "express";
import { mockGenerate } from "../adapters/mock-adapter.ts";
import {
  composeGltfJson,
  serializeGLB,
} from "../../../frontend/src/js/asset-core/gltf/gltf-core.ts";
import {
  isGzipped,
  decompress,
} from "../../../frontend/src/js/asset-core/utils/compression.ts";
import {
  createTask,
  createImageTask,
  createMultiviewTask,
  createRefineTask,
  uploadImage,
  uploadModel,
  getBalance,
  decimateTask,
  rigCheckTask,
  rigModelTask,
  retargetTask,
  pollTask,
  downloadModel,
  cancelTask,
  TripoApiError,
} from "../adapters/tripo3d-adapter.ts";
import type { MultiviewViewTokens } from "../adapters/tripo3d-adapter.ts";
import {
  registerTask,
  getTask,
  getCompletedTask,
  markTaskComplete,
  updateTaskEntry,
  evictTask,
} from "../generation-tasks.ts";
import { getStorage } from "../storage/index.ts";
import authenticate from "../authentication.ts";
import { generationRateLimit } from "../rate-limiter.ts";
import { validateBody } from "../validation.ts";
import { generateAssetSchema, providerBalanceSchema } from "../schemas.ts";

const Router = express.Router;

/** Tripo's file upload limit for source GLBs (file_token flow). */
const TRIPO_SOURCE_GLB_LIMIT_BYTES = 150 * 1024 * 1024;

/** glTF 2.0 GLB magic number. */
const GLB_MAGIC = 0x46546C67;

/** 400 message for sources Tripo follow-ups cannot consume (→ SOURCE_ASSET_UNSUPPORTED_FORMAT). */
const MSG_SOURCE_UNSUPPORTED =
  "Source asset is not glTF/GLB — Tripo follow-ups (retexture, retopo, auto-rig, animate) require a glTF or GLB model";

/** 400 message prefix for glTF JSON with references we cannot inline (→ SOURCE_ASSET_UNSUPPORTED_FORMAT). */
const MSG_SOURCE_UNRESOLVABLE_PREFIX = "Source glTF has external references that cannot be resolved";

/**
 * Check whether a buffer is a binary GLB (magic "glTF", 0x46546C67).
 */
function isGlb(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === GLB_MAGIC;
}

/**
 * Check whether a buffer looks like glTF JSON (starts with `{`). Any glTF
 * JSON — composite with `ipfs://` refs or self-contained with data URIs —
 * is composed to GLB before upload. Only the first byte is checked: a
 * fixed head window misses composites whose `ipfs://` refs sit deeper in
 * the document, and those then fail Tripo-side with code 1004.
 */
function looksLikeGltfJson(buf: Buffer): boolean {
  return buf.length >= 1 && buf[0] === 0x7B; // '{'
}

/**
 * Injected fetcher for the shared compose pipeline (gltf-core.js): fetch a
 * CID's payload from IPFS and return it base64-encoded. Honors the
 * composite entry's `_arbesk.compressed` storage flag, with a gzip-magic
 * sniff as fallback — decomposed components are stored gzipped
 * (`compress: true` in decomposer.js / async-gltf.js) and `catBytes`
 * returns the raw stored bytes.
 * @param arbeskMeta - `_arbesk` dedup metadata from the composite entry
 * @returns base64-encoded (decompressed) payload
 */
async function fetchCidAsBase64(cid: string, arbeskMeta?: any): Promise<string> {
  console.log(`[GEN] composite compose fetch ipfs://${cid}`);
  const raw = await getStorage().catBytes(cid);
  const bytes = arbeskMeta?.compressed || isGzipped(raw) ? decompress(raw) : raw;
  return Buffer.from(bytes).toString("base64");
}

/**
 * Resolve a glTF JSON document into a self-contained GLB binary buffer
 * suitable for Tripo upload, via the shared pipeline in gltf-core.js:
 * `composeGltfJson` inlines `ipfs://<CID>` refs as base64 data URIs and
 * strips dedup metadata; `serializeGLB` packs the result. Data URIs pass
 * through; any other external URI (relative path, http(s)) cannot be
 * inlined here and fails fast with a 400 TripoApiError instead of
 * producing a corrupt GLB.
 *
 * We only run this for the Tripo file_token path — browser rendering uses
 * the frontend compose (composer.js).
 *
 * @param compositeBuf - raw bytes of the glTF JSON
 * @returns self-contained GLB binary
 */
async function resolveCompositeToGlb(compositeBuf: Buffer): Promise<Buffer> {
  let gltf: any;
  try {
    gltf = JSON.parse(compositeBuf.toString("utf-8"));
  } catch {
    console.log("[GEN] source asset starts with '{' but is not valid JSON");
    throw new TripoApiError(MSG_SOURCE_UNSUPPORTED, 0, 400);
  }

  const composed = (await composeGltfJson(gltf, fetchCidAsBase64)) as any;

  // Fail fast on references that are neither ipfs:// (resolved above) nor
  // data: (inlined below) — a relative or http(s) URI would otherwise be
  // silently zero-filled into a corrupt GLB.
  for (const buf of composed.buffers || []) {
    if (buf.uri && !buf.uri.startsWith("data:")) {
      console.log(`[GEN] source glTF has unresolvable buffer uri=${buf.uri}`);
      throw new TripoApiError(`${MSG_SOURCE_UNRESOLVABLE_PREFIX} (buffer uri: ${buf.uri})`, 0, 400);
    }
  }
  for (const img of composed.images || []) {
    if (img.uri && !img.uri.startsWith("data:")) {
      console.log(`[GEN] source glTF has unresolvable image uri=${img.uri}`);
      throw new TripoApiError(`${MSG_SOURCE_UNRESOLVABLE_PREFIX} (image uri: ${img.uri})`, 0, 400);
    }
  }

  // Pack data-URI buffers into a single BIN chunk. The buffers are
  // concatenated in order; bufferViews that reference buffer > 0 need their
  // byteOffset adjusted by the cumulative size of previous buffers.
  const binParts: Buffer[] = [];
  const bufOffsets: number[] = [];
  let cumulative = 0;
  for (const buf of composed.buffers || []) {
    bufOffsets.push(cumulative);
    if (buf.uri && buf.uri.startsWith("data:")) {
      const b64 = buf.uri.split(",")[1];
      const bytes = Buffer.from(b64, "base64");
      binParts.push(bytes);
      cumulative += bytes.length;
    } else {
      const len = buf.byteLength || 0;
      binParts.push(Buffer.alloc(len));
      cumulative += len;
    }
  }

  // Rewrite buffer definitions: no URIs (they reference the BIN chunk).
  for (let i = 0; i < (composed.buffers || []).length; i++) {
    composed.buffers[i] = { byteLength: binParts[i].length };
  }

  // Adjust bufferView byteOffsets for buffer > 0.
  if (composed.bufferViews) {
    for (const bv of composed.bufferViews) {
      if (bv.buffer > 0 && bv.buffer < bufOffsets.length) {
        bv.byteOffset = (bv.byteOffset || 0) + bufOffsets[bv.buffer];
        bv.buffer = 0;
      }
    }
  }

  const bin = Buffer.concat(binParts);
  const glb = Buffer.from(serializeGLB(composed, bin));

  console.log(
    `[GEN] composite composed → GLB buffers=${binParts.length} bin=${bin.length}B total=${glb.length}B`,
  );
  return glb;
}

/**
 * Map a Tripo adapter error status to the documented API error code.
 */
function providerErrorCode(status: number): string {
  if (status === 401) return "PROVIDER_AUTH_FAILED";
  if (status === 402) return "PROVIDER_CREDITS_EXHAUSTED";
  return "PROVIDER_ERROR";
}

/**
 * Fetch a source GLB from IPFS and upload it to Tripo, returning the
 * file_token. Throws TripoApiError(400, SOURCE_ASSET_UNAVAILABLE-shaped)
 * when the CID cannot be read or yields an empty buffer,
 * TripoApiError(400, SOURCE_ASSET_UNSUPPORTED_FORMAT-shaped) when the
 * content is neither glTF JSON nor GLB (or has unresolvable external
 * references), and TripoApiError(400, SOURCE_ASSET_TOO_LARGE-shaped)
 * when the GLB exceeds Tripo's 150 MB file limit.
 * @returns file_token
 */
async function uploadSourceGlb(cid: string, apiKey: string): Promise<string> {
  let glb: Buffer;
  try {
    glb = await getStorage().catBytes(cid);
  } catch (e) {
    const err = e as Error;
    console.log(`[GEN] source GLB fetch failed cid=${cid}: ${err.message}`);
    throw new TripoApiError("Source asset unavailable in IPFS", 0, 400);
  }
  if (!glb || glb.length === 0) {
    console.log(`[GEN] source GLB empty cid=${cid}`);
    throw new TripoApiError("Source asset unavailable in IPFS", 0, 400);
  }
  // Decomposed assets are stored gzipped — decompress before any
  // format detection (gzip magic would otherwise read as "not glTF").
  if (isGzipped(glb)) {
    console.log(`[GEN] source asset is gzipped — decompressing cid=${cid}`);
    glb = Buffer.from(decompress(glb));
  }
  // Raw size gate first: an oversized source is too large regardless of
  // format (and composing would only make it bigger).
  if (glb.length > TRIPO_SOURCE_GLB_LIMIT_BYTES) {
    console.log(`[GEN] source GLB too large cid=${cid} bytes=${glb.length}`);
    throw new TripoApiError("Source asset exceeds the 150 MB upload limit", 0, 400);
  }
  // Saved assets store glTF JSON (composite with ipfs:// buffer URIs, or
  // self-contained with data URIs) — compose it into a binary GLB before
  // uploading. Anything else (3MF, FBX, ...) is rejected up front: Tripo's
  // rig-check accepts GLB only and fails other formats with code 1004.
  if (!isGlb(glb)) {
    if (!looksLikeGltfJson(glb)) {
      console.log(`[GEN] source asset is not glTF/GLB cid=${cid}`);
      throw new TripoApiError(MSG_SOURCE_UNSUPPORTED, 0, 400);
    }
    console.log(`[GEN] source asset is glTF JSON — composing to GLB cid=${cid}`);
    glb = await resolveCompositeToGlb(glb);
  }
  if (glb.length > TRIPO_SOURCE_GLB_LIMIT_BYTES) {
    console.log(`[GEN] source GLB too large cid=${cid} bytes=${glb.length}`);
    throw new TripoApiError("Source asset exceeds the 150 MB upload limit", 0, 400);
  }
  return uploadModel(glb, apiKey);
}

/**
 * Generation route factory. No dependencies — the storage adapter is not
 * needed here because the browser performs all IPFS writes itself.
 */
export default function generateAssetNode() {
  const router = Router();

  /**
   * POST /api/v1/generations
   *
   * Validates the session, checks the rate limit, calls the generation
   * adapter (mock or cloud), and returns the raw asset bytes to the
   * browser. The browser uploads the asset to IPFS, constructs the
   * manifest, and writes it to IPFS directly - no server-side IPFS
   * writes. The only server-side concerns are auth, rate limiting,
   * and the adapter call (which may need filesystem or API key access).
   */
  router.post(
    "/",
    authenticate,
    generationRateLimit,
    validateBody(generateAssetSchema),
    async (req: Request, res: Response) => {
      try {
        const { prompt, nodeId, provider, providerKey, sourceAssetCid, sourceTaskId, retexture, retopo, animate, rigOnly, rigModel, animateInPlace, animations, faceLimit, textureQuality, imageData, imageMime, images } = req.body;

        const effectiveProvider = provider || "mock";
        const useMockAdapter =
          effectiveProvider === "mock" ||
          (!provider && process.env.MOCK_3D_GENERATION === "true");

        console.log(
          `[GEN] prompt="${prompt || (imageData ? "(image)" : "")}" nodeId=${nodeId} provider=${effectiveProvider} mock=${useMockAdapter}`,
        );

        // BYOK (Bring Your Own Key): real providers require a user-supplied API
        // key. The user pays the provider directly, so the on-chain quota/payment
        // gate is bypassed entirely. The key is used transiently and is never
        // logged or persisted. The mock provider needs no key.
        if (effectiveProvider !== "mock") {
          if (
            typeof providerKey !== "string" ||
            providerKey.trim().length === 0
          ) {
            console.log(
              "[GEN] rejected - providerKey required for real provider",
            );
            return res.status(400).json({
              error: {
                code: "MISSING_PROVIDER_KEY",
                message: "providerKey is required for the selected provider",
              },
            });
          }
          console.log(
            `[GEN] byok provider=${effectiveProvider} key=*** (len=${providerKey.trim().length}) - on-chain gate bypassed`,
          );
        }

        if (useMockAdapter) {
          // The mock adapter always needs a prompt string; image-only
          // requests fall back to a placeholder (image input is a
          // Tripo3D-only feature).
          const mockPrompt = prompt || "image";
          console.log(`[GEN] using MOCK adapter for "${mockPrompt}"`);
          const result = await mockGenerate(mockPrompt, {
            provider: effectiveProvider,
            providerKey,
          });
          console.log(
            `[GEN] mock returned provider=${result.provider || "mock"} size=${result.data?.length || result.buffer?.length || "?"} bytes`,
          );

          const assetPayload = result.data || result.buffer;
          const assetFormat = result.format || "gltf";
          const assetPath =
            (result as { path?: string }).path ||
            `asset.${assetFormat}`;

          if (assetPayload === undefined) {
            throw new Error("Generation adapter returned no payload");
          }

          // Always base64-encode so the client gets a consistent wire format
          // regardless of whether the adapter returned a Buffer (.glb) or a
          // UTF-8 string (.gltf).
          const assetBase64 = Buffer.isBuffer(assetPayload)
            ? assetPayload.toString("base64")
            : Buffer.from(assetPayload, "utf-8").toString("base64");

          console.log(
            `[GEN] success - returning ${assetPayload.length} bytes of ${assetFormat} (base64: ${assetBase64.length} chars) to browser for client-side IPFS upload`,
          );

          // Return raw asset bytes to the browser. The browser uploads the
          // asset to IPFS, constructs the manifest, and writes the manifest
          // to IPFS directly - no server-side IPFS writes.
          return res.json({
            assetData: assetBase64,
            format: assetFormat,
            path: assetPath,
            provider: result.provider || effectiveProvider,
          });
        }

        if (effectiveProvider === "tripo3d") {
          const key = providerKey.trim();

          if (sourceAssetCid) {
            // Retarget-only shortcut: the caller references a completed rig-only
            // registry entry whose skeleton still lives Tripo-side (registry TTL).
            // Skip this shortcut when the caller explicitly picked a different rig
            // model — we need the full chain with the user's chosen model.
            // Everything else goes through the GLB — the canonical, expiry-free path.
            if (animate && sourceTaskId && !rigModel) {
              const rigSource = getCompletedTask(sourceTaskId, res.locals.userAddress);
              if (rigSource && rigSource.kind === "animate" && rigSource.phase === "rig" && !rigOnly) {
                console.log(`[GEN] retarget-only: source rig=${rigSource.tripoTaskId} animations=${(animations || []).join(",")}`);
                const retargetId = await retargetTask(rigSource.tripoTaskId, animations, key, {
                  animateInPlace: Boolean(animateInPlace),
                  rigModel: rigSource.rigModel,
                });
                const taskId = registerTask({ tripoTaskId: retargetId, providerKey: key, userAddress: res.locals.userAddress, kind: "animate", phase: "retarget", animations });
                return res.status(202).json({ taskId, provider: "tripo3d", status: "running", animating: true });
              }
            }

            const fileToken = await uploadSourceGlb(sourceAssetCid, key);

            if (animate) {
              console.log(`[GEN] starting animate chain source=${sourceAssetCid} animations=${(animations || []).join(",")} rigOnly=${Boolean(rigOnly)} inPlace=${Boolean(animateInPlace)}`);
              const rigCheckId = await rigCheckTask(fileToken, key);
              const taskId = registerTask({
                tripoTaskId: rigCheckId, providerKey: key, userAddress: res.locals.userAddress,
                kind: "animate", phase: "rig-check", animations, rigOnly: Boolean(rigOnly), animateInPlace: Boolean(animateInPlace), sourceFileToken: fileToken, rigModel,
              });
              return res.status(202).json({ taskId, provider: "tripo3d", status: "running", animating: true });
            }

            if (retopo) {
              console.log(`[GEN] starting retopo source=${sourceAssetCid} faceLimit=${faceLimit ?? "adaptive"}`);
              const decimateId = await decimateTask(fileToken, key, { faceLimit });
              const taskId = registerTask({ tripoTaskId: decimateId, providerKey: key, userAddress: res.locals.userAddress });
              return res.status(202).json({ taskId, provider: "tripo3d", status: "running", retopo: true });
            }

            // retexture (schema guarantees exactly one action flag)
            if (retexture) {
              console.log(`[GEN] starting retexture source=${sourceAssetCid}`);
              const refineId = await createRefineTask(prompt, fileToken, key, { textureQuality });
              const taskId = registerTask({ tripoTaskId: refineId, providerKey: key, userAddress: res.locals.userAddress });
              return res.status(202).json({ taskId, provider: "tripo3d", status: "running", refined: true });
            }
          }

          // Fresh generation. Action flags without sourceAssetCid are
          // ignored here — the prompt/image starts a new model.
          console.log(
            `[GEN] using Tripo3D adapter for "${prompt || (images ? "(multiview)" : "(image)")}" image=${Boolean(imageData)}${images ? ` views=${images.length}` : ""}`,
          );
          const tripoTaskId = images
            ? await createMultiviewTask(
                // Upload every view first (parallel), then key tokens by view.
                (
                  Object.fromEntries(
                    await Promise.all(
                      images.map(async (img: { imageData: string; imageMime: string; view: string }) => [
                        img.view,
                        await uploadImage(
                          Buffer.from(img.imageData, "base64"),
                          img.imageMime,
                          key,
                        ),
                      ]),
                    ),
                  ) as MultiviewViewTokens
                ),
                key,
                { textureQuality },
              )
            : imageData
              ? await createImageTask(
                  await uploadImage(
                    Buffer.from(imageData, "base64"),
                    imageMime,
                    key,
                  ),
                  key,
                  { textureQuality },
                )
              : await createTask(prompt, key, { textureQuality });
          const taskId = registerTask({
            tripoTaskId,
            providerKey: key,
            userAddress: res.locals.userAddress,
          });
          console.log(
            `[GEN] tripo task registered public=${taskId} tripo=${tripoTaskId}`,
          );
          return res.status(202).json({
            taskId,
            provider: "tripo3d",
            status: "running",
          });
        }

        console.log("[GEN] cloud adapter not implemented - rejecting");
        return res.status(501).json({
          error: {
            code: "NOT_IMPLEMENTED",
            message: "Cloud adapters not yet implemented",
          },
        });
      } catch (error) {
        const err = error as Error;
        console.error("[GEN] error:", err.message);
        if (err instanceof TripoApiError && err.status === 400 && err.message === "Source asset unavailable in IPFS") {
          return res.status(400).json({
            error: {
              code: "SOURCE_ASSET_UNAVAILABLE",
              message: err.message,
            },
          });
        }
        if (err instanceof TripoApiError && err.status === 400 && err.message === "Source asset exceeds the 150 MB upload limit") {
          return res.status(400).json({
            error: {
              code: "SOURCE_ASSET_TOO_LARGE",
              message: err.message,
            },
          });
        }
        if (err instanceof TripoApiError && err.status === 400 &&
            (err.message === MSG_SOURCE_UNSUPPORTED || err.message.startsWith(MSG_SOURCE_UNRESOLVABLE_PREFIX))) {
          return res.status(400).json({
            error: {
              code: "SOURCE_ASSET_UNSUPPORTED_FORMAT",
              message: err.message,
            },
          });
        }
        if (err instanceof TripoApiError) {
          return res.status(err.status).json({
            error: {
              code: providerErrorCode(err.status),
              message: err.message,
            },
          });
        }
        res.status(500).json({
          error: {
            code: "GENERATION_FAILED",
            message: err.message,
          },
        });
      }
    },
  );

  /**
   * POST /api/v1/generations/balance
   *
   * Returns the Tripo3D credit balance for a user-supplied BYOK key. The key
   * is used transiently for this single upstream call — never logged or
   * persisted. Session-gated so the route cannot be used as an anonymous
   * key-probing oracle. No rate limit: balance checks are cheap and do not
   * consume generation quota.
   */
  router.post(
    "/balance",
    authenticate,
    validateBody(providerBalanceSchema),
    async (req: Request, res: Response) => {
      try {
        const key = req.body.providerKey.trim();
        const result = await getBalance(key);
        console.log("[GEN] balance fetched for BYOK key=***");
        return res.json(result);
      } catch (error) {
        const err = error as Error;
        console.error("[GEN] balance error:", err.message);
        if (err instanceof TripoApiError) {
          return res.status(err.status).json({
            error: {
              code: providerErrorCode(err.status),
              message: err.message,
            },
          });
        }
        res.status(500).json({
          error: {
            code: "BALANCE_FAILED",
            message: err.message,
          },
        });
      }
    },
  );

  /**
   * DELETE /api/v1/generations/:taskId
   *
   * Stop an in-flight task: the registry entry is evicted (the GET poll then
   * 404s, so the browser stops waiting) and a best-effort cancel is sent
   * upstream. Provider credits already consumed are not refunded — the
   * frontend warns the user before calling this.
   */
  router.delete("/:taskId", authenticate, async (req: Request, res: Response) => {
    const taskId = String(req.params.taskId);
    const entry = getTask(taskId, res.locals.userAddress);
    if (!entry) {
      return res.status(404).json({
        error: {
          code: "GENERATION_TASK_NOT_FOUND",
          message: "Generation task not found",
        },
      });
    }
    evictTask(taskId);
    console.log(`[GEN] task cancelled taskId=${taskId} tripo=${entry.tripoTaskId}`);
    const upstreamCancelled = await cancelTask(entry.tripoTaskId, entry.providerKey);
    return res.json({ status: "cancelled", upstreamCancelled });
  });

  /**
   * GET /api/v1/generations/:taskId
   *
   * Polls an in-flight Tripo3D generation task. Requires a valid session;
   * the task must belong to the authenticated wallet. On success the GLB is
   * downloaded, the task entry is evicted, and the model bytes are returned
   * to the browser for client-side IPFS upload.
   */
  router.get("/:taskId", authenticate, async (req: Request, res: Response) => {
    try {
      const taskId = String(req.params.taskId);
      const entry = getTask(taskId, res.locals.userAddress);

      if (!entry) {
        console.log(`[GEN] task not found taskId=${taskId}`);
        return res.status(404).json({
          error: {
            code: "GENERATION_TASK_NOT_FOUND",
            message: "Generation task not found",
          },
        });
      }

      console.log(`[GEN] polling taskId=${taskId} tripo=${entry.tripoTaskId}`);
      const poll = await pollTask(entry.tripoTaskId, entry.providerKey);

      if (poll.status === "queued" || poll.status === "running") {
        const stageLabels = {
          "rig-check": "Checking rig compatibility",
          rig: "Rigging skeleton",
          retarget: "Baking animations",
        };
        return res.json({
          status: poll.status,
          progress: poll.progress ?? 0,
          ...(entry.kind === "animate" && {
            stage: stageLabels[entry.phase || "rig-check"],
          }),
        });
      }

      // Animate chain: a succeeded rig-check or rig task starts the next
      // phase instead of finishing. Terminal phases: retarget (animate),
      // or rig when rigOnly was requested (rigged model, no animation).
      const chainTerminal =
        entry.phase === "retarget" || (entry.rigOnly && entry.phase === "rig");
      if (
        entry.kind === "animate" &&
        poll.status === "success" &&
        !chainTerminal
      ) {
        if (entry.phase === "rig-check") {
          const rigOutput = (
            poll.output
          ) as { riggable?: boolean; rig_type?: string } | undefined;
          if (!rigOutput?.riggable) {
            evictTask(taskId);
            console.log(`[GEN] animate chain: model not riggable taskId=${taskId}`);
            return res.json({
              status: "failed",
              error: {
                code: "MODEL_NOT_RIGGABLE",
                message:
                  "Tripo reports this model is not riggable. Generate a full-body humanoid or creature (T-pose works best) and try again.",
              },
            });
          }
          const rig = await rigModelTask(
            entry.sourceFileToken || "",
            rigOutput.rig_type || "biped",
            entry.providerKey,
            { model: entry.rigModel },
          );
          updateTaskEntry(taskId, res.locals.userAddress, {
            tripoTaskId: rig.taskId,
            phase: "rig",
            rigModel: rig.model,
          });
          console.log(
            `[GEN] animate chain: rig started taskId=${taskId} tripo=${rig.taskId} rig_type=${rigOutput.rig_type} model=${rig.model}`,
          );
          return res.json({
            status: "running",
            progress: 40,
            stage: "Rigging skeleton",
          });
        }
        // phase === "rig" → start retarget with the requested presets
        const retargetId = await retargetTask(
          entry.tripoTaskId,
          entry.animations || [],
          entry.providerKey,
          {
            animateInPlace: Boolean(entry.animateInPlace),
            rigModel: entry.rigModel,
          },
        );
        updateTaskEntry(taskId, res.locals.userAddress, {
          tripoTaskId: retargetId,
          phase: "retarget",
        });
        console.log(
          `[GEN] animate chain: retarget started taskId=${taskId} tripo=${retargetId}`,
        );
        return res.json({
          status: "running",
          progress: 75,
          stage: "Baking animations",
        });
      }

      if (poll.status === "success") {
        if (!poll.glbUrl) {
          throw new Error("Tripo success response missing model URL");
        }
        const buffer = await downloadModel(poll.glbUrl);
        markTaskComplete(taskId, res.locals.userAddress);
        console.log(
          `[GEN] task complete taskId=${taskId} size=${buffer.length}`,
        );
        return res.json({
          status: "success",
          assetData: buffer.toString("base64"),
          format: "glb",
          path: "asset.glb",
          provider: "tripo3d",
          providerTaskId: entry.tripoTaskId,
        });
      }

      // failed or cancelled — include the chain stage so the user knows
      // which step died (the upstream message alone says "Task failed").
      evictTask(taskId);
      const failStage =
        entry.kind === "animate"
          ? {
              "rig-check": "Rig compatibility check",
              rig: "Rigging",
              retarget: "Animation bake",
            }[entry.phase || "rig-check"]
          : null;
      const failMessage = poll.error || "Task failed";
      console.log(
        `[GEN] task failed taskId=${taskId} stage=${failStage || "generate"} error=${failMessage}`,
      );
      return res.json({
        status: "failed",
        error: {
          code: "PROVIDER_TASK_FAILED",
          message: failStage ? `${failStage} failed — ${failMessage}` : failMessage,
        },
      });
    } catch (error) {
      const err = error as Error;
      console.error("[GEN] get error:", err.message);
      if (err instanceof TripoApiError) {
        // Auth/credit failures are terminal for the task: evict the entry
        // (and its transient BYOK key) instead of waiting for the TTL.
        if (err.status === 401 || err.status === 402) {
          evictTask(String(req.params.taskId));
        }
        return res.status(err.status).json({
          error: {
            code: providerErrorCode(err.status),
            message: err.message,
          },
        });
      }
      res.status(500).json({
        error: {
          code: "GENERATION_FAILED",
          message: err.message,
        },
      });
    }
  });

  return router;
}
