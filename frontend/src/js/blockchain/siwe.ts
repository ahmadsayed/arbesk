/**
 * Sign-In with Ethereum (EIP-4361) message builder.
 *
 * Thin wrapper over the official `siwe` package — the same library the
 * backend verifies with (`src/api/siwe-verify.ts`) — so the emitted message
 * round-trips through `new SiweMessage(...)` by construction. The address is
 * EIP-55 checksummed with viem's `getAddress` because siwe's ABNF parser
 * rejects non-checksummed addresses (previously this piggybacked on the
 * Web3 CDN global, which is not guaranteed to be loaded at sign-in time).
 *
 * Both packages are loaded via the importmap in `pug/includes/head.pug`.
 *
 * Usage:
 *   import { buildSiweMessage, generateNonce } from './siwe.ts';
 *   const message = buildSiweMessage(domain, address, nonce, chainId);
 */

import { SiweMessage, generateNonce } from "siwe";
import { getAddress } from "viem/utils";

export { generateNonce };

/**
 * Build a standard EIP-4361 SIWE message.
 *
 * @param domain - The domain requesting the signature (callers pass the full
 *   origin, e.g. "http://localhost:9090"; the backend strips the scheme when
 *   comparing against the request host)
 * @param address - The Ethereum address (0x-prefixed; checksummed here)
 * @param nonce - A random nonce for replay protection
 * @param chainId - The Ethereum chain ID
 * @param statement - Human-readable statement
 * @returns The SIWE message
 */
export function buildSiweMessage(
  domain: string,
  address: string,
  nonce: string,
  chainId: number,
  statement = "Sign in to Arbesk Studio",
): string {
  return new SiweMessage({
    domain,
    address: getAddress(address as `0x${string}`),
    statement,
    // Full origin (scheme + host) as the URI so strict parsers accept it
    // even when the host is an IP address like 127.0.0.1:9090.
    uri: typeof window !== "undefined" ? window.location.origin : "",
    version: "1",
    chainId,
    nonce,
    issuedAt: new Date().toISOString(),
  }).toMessage();
}
