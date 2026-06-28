/**
 * Thirdweb in-app wallet authentication
 *
 * Thirdweb social/email in-app wallets (Google, email, etc.) authenticate users
 * via an OAuth-style JWT issued by login.thirdweb.com. The wallet exposes this
 * token through wallet.getAuthToken().
 *
 * Unlike standard EOAs, these wallets decouple the wallet address from the
 * signing key, so EIP-191 / SIWE signature recovery does not prove ownership.
 * Instead, the backend verifies the JWT signature against Thirdweb's published
 * JWKS and extracts the wallet address from the token claims.
 *
 * Reference: https://portal.thirdweb.com/connect/in-app-wallet
 */

import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";

const THIRDWEB_JWKS_URL = "https://login.thirdweb.com/api/jwks";

/** Remote JWKS resolver cached at module load. */
const thirdwebJwks = createRemoteJWKSet(new URL(THIRDWEB_JWKS_URL));

/**
 * Extract a wallet address from decoded JWT payload claims.
 * Tries `address`, `walletAddress`, then `sub`.
 *
 * @param {Record<string, unknown>} payload
 * @returns {string|null}
 */
function extractAddressFromPayload(payload) {
  const rawAddress =
    typeof payload.address === "string"
      ? payload.address
      : typeof payload.walletAddress === "string"
        ? payload.walletAddress
        : typeof payload.sub === "string"
          ? payload.sub
          : null;

  if (!rawAddress || !/^0x[a-fA-F0-9]{40}$/i.test(rawAddress)) {
    return null;
  }
  return rawAddress.toLowerCase();
}

/**
 * Verify a Thirdweb auth token and extract the wallet address.
 *
 * In production the signature is verified against Thirdweb's published JWKS.
 * For local/testnet environments where the backend cannot reach
 * login.thirdweb.com (DNS/proxy issues), set `THIRDWB_AUTH_DEV_MODE=true` to
 * decode the JWT without signature verification. NEVER enable this in
 * production.
 *
 * @param {string} token - JWT returned by wallet.getAuthToken()
 * @returns {Promise<{valid: boolean, address: string|null, error: string|null}>}
 */
export async function verifyThirdwebAuthToken(token) {
  if (!token || typeof token !== "string") {
    return {
      valid: false,
      address: null,
      error: "Missing or invalid Thirdweb auth token",
    };
  }

  const devMode = process.env.THIRDWB_AUTH_DEV_MODE === "true";

  if (devMode) {
    console.warn(
      "[THIRDWB-AUTH] DEV MODE enabled - skipping JWT signature verification. " +
        "This is insecure and must never be used in production.",
    );
    try {
      const payload = decodeJwt(token);
      console.log(
        "[THIRDWB-AUTH] decoded JWT claim keys:",
        Object.keys(payload).join(","),
      );
      const address = extractAddressFromPayload(payload);
      if (!address) {
        return {
          valid: false,
          address: null,
          error: "JWT does not contain a valid wallet address",
        };
      }
      return { valid: true, address, error: null };
    } catch (err) {
      const error = /** @type {Error} */ (err);
      return { valid: false, address: null, error: error.message };
    }
  }

  try {
    const { payload } = await jwtVerify(token, thirdwebJwks, {
      // We do not pin issuer/audience yet because Thirdweb's claim values for
      // in-app wallet tokens are not publicly documented. Signature and
      // expiration are still verified by jwtVerify. The full payload is logged
      // once so we can tighten validation once the claim shape is confirmed.
      clockTolerance: 30,
    });

    console.log(
      "[THIRDWB-AUTH] JWT verified; claims keys:",
      Object.keys(payload).join(","),
    );

    const address = extractAddressFromPayload(payload);
    if (!address) {
      return {
        valid: false,
        address: null,
        error: "JWT does not contain a valid wallet address",
      };
    }

    return { valid: true, address, error: null };
  } catch (err) {
    const error = /** @type {Error} */ (err);
    console.log("[THIRDWB-AUTH] JWT verification error:", error.message);
    return { valid: false, address: null, error: error.message };
  }
}
