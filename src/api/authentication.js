/**
 * Arbesk API Authentication Middleware
 *
 * Accepts two authorization schemes:
 *
 * 1. Bearer <base64message>.<base64signature>
 *    Per-generation auth: signs the txHash to prove wallet ownership.
 *    Used as a fallback when no session token is available.
 *
 * 2. Session <token>
 *    Session-based auth: the user signs once to create a session (POST /sessions),
 *    then reuses the opaque token for subsequent requests within 24 hours.
 *    Eliminates the per-generation MetaMask pop-up.
 */

import { web3, getWeb3 } from "../config.js";
import { validateSession } from "./sessions.js";

export default async function authorize(request, response, next) {
  try {
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
      console.log(`[AUTH] rejected — missing Authorization header`);
      return response.status(401).json({
        error: {
          code: "MISSING_AUTH",
          message: "Missing Authorization header",
        },
      });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2) {
      console.log(`[AUTH] rejected — invalid format`);
      return response.status(401).json({
        error: {
          code: "INVALID_AUTH_FORMAT",
          message:
            "Invalid Authorization format. Expected: Bearer <token> or Session <token>",
        },
      });
    }

    const scheme = parts[0].toLowerCase();

    // ─── Session-Based Auth ──────────────────────────────────────────────

    if (scheme === "session") {
      const token = parts[1];
      const address = validateSession(token);

      if (!address) {
        console.log(`[AUTH] rejected — invalid or expired session token`);
        return response.status(401).json({
          error: {
            code: "INVALID_SESSION",
            message:
              "Session token is invalid or expired. Create a new session by signing again.",
          },
        });
      }

      response.locals.userAddress = address;
      // No txHash for session auth — the caller is already authenticated
      response.locals.txHash = null;
      console.log(`[AUTH] session valid — address=${address}`);
      return next();
    }

    // ─── Bearer (txHash Signature) Auth ──────────────────────────────────

    if (scheme !== "bearer") {
      console.log(`[AUTH] rejected — unknown scheme: ${scheme}`);
      return response.status(401).json({
        error: {
          code: "UNKNOWN_AUTH_SCHEME",
          message: `Unknown auth scheme "${scheme}". Expected: Bearer or Session`,
        },
      });
    }

    const apiToken = parts[1].split(".");
    if (apiToken.length !== 2) {
      console.log(`[AUTH] rejected — invalid token format`);
      return response.status(401).json({
        error: {
          code: "INVALID_TOKEN_FORMAT",
          message:
            "Invalid token format. Expected: base64message.base64signature",
        },
      });
    }

    const message = Buffer.from(apiToken[0], "base64").toString();
    const signature = Buffer.from(apiToken[1], "base64").toString();
    const txHash = message.replace("txHash:", "");

    const address = await web3.eth.accounts.recover(message, signature);
    response.locals.userAddress = address;
    response.locals.txHash = txHash;
    console.log(`[AUTH] recovered address=${address} tx=${txHash}`);

    // Validate txHash on-chain (chain-aware)
    const chainId = request.headers["x-chain-id"];
    const txWeb3 = chainId ? getWeb3(chainId) : web3;
    const receipt = await txWeb3.eth.getTransactionReceipt(txHash);
    if (!receipt || Number(receipt.status) !== 1) {
      console.log(
        `[AUTH] tx ${txHash} not found or failed on chain ${chainId || "default"}`,
      );
      return response.status(403).json({
        error: {
          code: "INVALID_TRANSACTION",
          message: `Transaction ${txHash} not found or failed`,
        },
      });
    }
    console.log(
      `[AUTH] tx ${txHash} verified on chain ${chainId || "default"} (block ${receipt.blockNumber})`,
    );

    next();
  } catch (error) {
    console.error("[AUTH] error:", error.message);
    return response.status(403).json({
      error: {
        code: "AUTH_FAILED",
        message: "Authentication failed: " + error.message,
      },
    });
  }
}
