import express from "express";
import { mockGenerate } from "../adapters/mock-adapter.js";
import {
  createTask,
  createRefineTask,
  pollTask,
  downloadModel,
  TripoApiError,
} from "../adapters/tripo3d-adapter.js";
import {
  registerTask,
  getTask,
  getCompletedTask,
  markTaskComplete,
  evictTask,
} from "../generation-tasks.js";
import authenticate from "../authentication.js";
import { generationRateLimit } from "../rate-limiter.js";
import { validateBody } from "../validation.js";
import { generateAssetSchema } from "../schemas.js";

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
        const { prompt, nodeId, provider, providerKey, refineTaskId } = req.body;

        const effectiveProvider = provider || "mock";
        const useMockAdapter =
          effectiveProvider === "mock" ||
          (!provider && process.env.MOCK_3D_GENERATION === "true");

        console.log(
          `[GEN] prompt="${prompt}" nodeId=${nodeId} provider=${effectiveProvider} mock=${useMockAdapter}`,
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
          console.log(`[GEN] using MOCK adapter for "${prompt}"`);
          const result = await mockGenerate(prompt, {
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
          let refineSource = null;
          if (refineTaskId) {
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
            `[GEN] using Tripo3D adapter for "${prompt}" refine=${Boolean(refineSource)}`,
          );
          const tripoTaskId = refineSource
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
        return res.json({
          status: poll.status,
          progress: poll.progress ?? 0,
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
