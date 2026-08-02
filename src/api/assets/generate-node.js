import express from "express";
import { mockGenerate } from "../adapters/mock-adapter.js";
import {
  createTask,
  createImageTask,
  createRefineTask,
  uploadImage,
  getBalance,
  rigCheckTask,
  rigModelTask,
  retargetTask,
  pollTask,
  downloadModel,
  TripoApiError,
} from "../adapters/tripo3d-adapter.js";
import {
  registerTask,
  getTask,
  getCompletedTask,
  markTaskComplete,
  updateTaskEntry,
  evictTask,
} from "../generation-tasks.js";
import authenticate from "../authentication.js";
import { generationRateLimit } from "../rate-limiter.js";
import { validateBody } from "../validation.js";
import { generateAssetSchema, providerBalanceSchema } from "../schemas.js";

const Router = express.Router;

/**
 * Map a Tripo adapter error status to the documented API error code.
 * @param {number} status
 * @returns {string}
 */
function providerErrorCode(status) {
  if (status === 401) return "PROVIDER_AUTH_FAILED";
  if (status === 402) return "PROVIDER_CREDITS_EXHAUSTED";
  return "PROVIDER_ERROR";
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
    async (req, res) => {
      try {
        const { prompt, nodeId, provider, providerKey, refineTaskId, imageData, imageMime, animateTaskId, animations, rigOnly } = req.body;

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
            /** @type {{ path?: string }} */ (result).path ||
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

          // Rig & animate: chain rig-check → rig → retarget off a completed
          // generation. The chain advances in the GET poll handler.
          if (animateTaskId) {
            const animateSource = getCompletedTask(
              animateTaskId,
              res.locals.userAddress,
            );
            if (!animateSource) {
              console.log(
                `[GEN] animate source not found taskId=${animateTaskId}`,
              );
              return res.status(404).json({
                error: {
                  code: "ANIMATE_SOURCE_NOT_FOUND",
                  message: "Animate source task not found or not completed",
                },
              });
            }
            console.log(
              `[GEN] starting animate chain source=${animateSource.tripoTaskId} animations=${(animations || []).join(",")} rigOnly=${Boolean(rigOnly)}`,
            );
            const rigCheckId = await rigCheckTask(
              animateSource.tripoTaskId,
              key,
            );
            const taskId = registerTask({
              tripoTaskId: rigCheckId,
              providerKey: key,
              userAddress: res.locals.userAddress,
              kind: "animate",
              phase: "rig-check",
              animations,
              rigOnly: Boolean(rigOnly),
              sourceTripoTaskId: animateSource.tripoTaskId,
            });
            return res.status(202).json({
              taskId,
              provider: "tripo3d",
              status: "running",
              animating: true,
            });
          }

          let refineSource = null;
          // Image-to-3D always starts a fresh model — the refine chain
          // (texture-only) does not apply.
          if (refineTaskId && !imageData) {
            refineSource = getCompletedTask(
              refineTaskId,
              res.locals.userAddress,
            );
            if (!refineSource) {
              console.log(`[GEN] refine source not found taskId=${refineTaskId}`);
              return res.status(404).json({
                error: {
                  code: "REFINE_SOURCE_NOT_FOUND",
                  message: "Refine source task not found or not completed",
                },
              });
            }
          }
          console.log(
            `[GEN] using Tripo3D adapter for "${prompt || "(image)"}" refine=${Boolean(refineSource)} image=${Boolean(imageData)}`,
          );
          const tripoTaskId = imageData
            ? await createImageTask(
                await uploadImage(
                  Buffer.from(imageData, "base64"),
                  imageMime,
                  key,
                ),
                key,
              )
            : refineSource
              ? await createRefineTask(prompt, refineSource.tripoTaskId, key)
              : await createTask(prompt, key);
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
            ...(refineSource && { refined: true }),
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
        const err = /** @type {Error} */ (error);
        console.error("[GEN] error:", err.message);
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
    async (req, res) => {
      try {
        const key = req.body.providerKey.trim();
        const result = await getBalance(key);
        console.log("[GEN] balance fetched for BYOK key=***");
        return res.json(result);
      } catch (error) {
        const err = /** @type {Error} */ (error);
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
   * GET /api/v1/generations/:taskId
   *
   * Polls an in-flight Tripo3D generation task. Requires a valid session;
   * the task must belong to the authenticated wallet. On success the GLB is
   * downloaded, the task entry is evicted, and the model bytes are returned
   * to the browser for client-side IPFS upload.
   */
  router.get("/:taskId", authenticate, async (req, res) => {
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
          const rigOutput = /** @type {{riggable?: boolean, rig_type?: string}|undefined} */ (
            poll.output
          );
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
          const rigTaskId = await rigModelTask(
            entry.sourceTripoTaskId || "",
            rigOutput.rig_type || "biped",
            entry.providerKey,
          );
          updateTaskEntry(taskId, res.locals.userAddress, {
            tripoTaskId: rigTaskId,
            phase: "rig",
          });
          console.log(
            `[GEN] animate chain: rig started taskId=${taskId} tripo=${rigTaskId} rig_type=${rigOutput.rig_type}`,
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

      // failed or cancelled
      evictTask(taskId);
      console.log(`[GEN] task failed taskId=${taskId} error=${poll.error}`);
      return res.json({
        status: "failed",
        error: {
          code: "PROVIDER_TASK_FAILED",
          message: poll.error || "Task failed",
        },
      });
    } catch (error) {
      const err = /** @type {Error} */ (error);
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
