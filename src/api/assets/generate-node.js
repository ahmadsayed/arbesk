import express from "express";
import { mockGenerate } from "../adapters/mock-adapter.js";
import authenticate from "../authentication.js";
import rateLimit from "../rate-limiter.js";

const Router = express.Router;

export default function generateAssetNode(_storage) {
  const router = Router();

  /**
   * POST /api/v1/generations
   *
   * Validates the session, checks the rate limit, calls the generation
   * adapter (mock or cloud), and returns the raw asset bytes to the
   * browser. The browser uploads the asset to IPFS, constructs the
   * manifest, and writes it to IPFS directly — no server-side IPFS
   * writes. The only server-side concerns are auth, rate limiting,
   * and the adapter call (which may need filesystem or API key access).
   */
  router.post(
    "/",
    authenticate,
    rateLimit({
      max: Number(
        process.env.GENERATION_RATE_LIMIT_MAX ||
          (process.env.MOCK_3D_GENERATION === "true" ? 1000 : 10),
      ),
      windowMs: 60 * 60 * 1000,
    }),
    async (req, res) => {
      try {
        const { prompt, nodeId, provider, providerKey } = req.body;

        const effectiveProvider = provider || "mock";
        const useMockAdapter =
          process.env.MOCK_3D_GENERATION === "true" ||
          effectiveProvider === "mock";

        console.log(
          `[GEN] prompt="${prompt}" nodeId=${nodeId} provider=${effectiveProvider} mock=${useMockAdapter}`,
        );
        if (!prompt || !nodeId) {
          console.log("[GEN] rejected — prompt and nodeId required");
          return res.status(400).json({
            error: {
              code: "MISSING_PARAMS",
              message: "prompt and nodeId are required",
            },
          });
        }

        // BYOK (Bring Your Own Key): real providers require a user-supplied API
        // key. The user pays the provider directly, so the on-chain quota/payment
        // gate is bypassed entirely. The key is used transiently and is never
        // logged or persisted. The mock provider needs no key.
        if (effectiveProvider !== "mock") {
          if (
            typeof providerKey !== "string" ||
            providerKey.trim().length === 0 ||
            providerKey.length > 200
          ) {
            console.log(
              "[GEN] rejected — providerKey required for real provider",
            );
            return res.status(400).json({
              error: {
                code: "MISSING_PROVIDER_KEY",
                message: "providerKey is required for the selected provider",
              },
            });
          }
          console.log(
            `[GEN] byok provider=${effectiveProvider} key=*** (len=${providerKey.trim().length}) — on-chain gate bypassed`,
          );
        }

        let result;
        if (useMockAdapter) {
          console.log(`[GEN] using MOCK adapter for "${prompt}"`);
          result = await mockGenerate(prompt, {
            provider: effectiveProvider,
            providerKey,
          });
          console.log(
            `[GEN] mock returned provider=${result.provider || "mock"} size=${result.data?.length || result.buffer?.length || "?"} bytes`,
          );
        } else {
          console.log("[GEN] cloud adapter not implemented — rejecting");
          return res.status(501).json({
            error: {
              code: "NOT_IMPLEMENTED",
              message: "Cloud adapters not yet implemented",
            },
          });
        }

        const assetPayload = result.data || result.buffer;
        const assetFormat = result.format || "gltf";
        const assetPath = result.path || `asset.${assetFormat}`;

        // Always base64-encode so the client gets a consistent wire format
        // regardless of whether the adapter returned a Buffer (.glb) or a
        // UTF-8 string (.gltf).
        const assetBase64 = Buffer.isBuffer(assetPayload)
          ? assetPayload.toString("base64")
          : Buffer.from(assetPayload, "utf-8").toString("base64");

        console.log(
          `[GEN] success — returning ${assetPayload.length} bytes of ${assetFormat} (base64: ${assetBase64.length} chars) to browser for client-side IPFS upload`,
        );

        // Return raw asset bytes to the browser. The browser uploads the
        // asset to IPFS, constructs the manifest, and writes the manifest
        // to IPFS directly — no server-side IPFS writes.
        res.json({
          assetData: assetBase64,
          format: assetFormat,
          path: assetPath,
          provider: result.provider || effectiveProvider,
        });
      } catch (error) {
        console.error("[GEN] error:", error.message);
        res.status(500).json({
          error: {
            code: "GENERATION_FAILED",
            message: error.message,
          },
        });
      }
    },
  );

  return router;
}
