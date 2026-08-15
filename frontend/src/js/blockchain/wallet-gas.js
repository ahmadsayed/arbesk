/**
 * Arbesk Wallet Gas
 *
 * Shared gas resolution for contract sends. CDP ERC-4337 smart accounts skip
 * estimation entirely (sponsored UserOperations); EOA wallets estimate and
 * pad by 20%.
 *
 * @module wallet-gas
 */

import { getActiveConnectionSource } from "./wallet-core.js";

// Generous gas ceiling for sponsored UserOperations. Supplying an explicit gas
// value lets web3 skip its own eth_estimateGas round trip; the ERC-4337 bundler
// re-estimates during UserOperation construction and the paymaster sponsors the
// cost, so an overestimate is free. Removing the redundant estimate trims a full
// RPC round trip from the social-login publish path.
const SMART_ACCOUNT_GAS_LIMIT = 2_000_000;

/**
 * Resolve the gas option for a contract method send.
 * CDP smart accounts skip estimation entirely; EOA wallets estimate and pad
 * by 20%. For EOA wallets, when estimation fails and `fallbackGas` is given,
 * the padded fallback is used instead of throwing.
 * @param {*} tx web3 contract method
 * @param {string|null} from sender address
 * @param {number} [fallbackGas] gas to use when EOA estimation fails
 * @returns {Promise<number>}
 */
async function resolveGas(tx, from, fallbackGas) {
  if (getActiveConnectionSource() === "cdp") return SMART_ACCOUNT_GAS_LIMIT;
  try {
    const gas = await tx.estimateGas({ from });
    return Math.floor(Number(gas) * 1.2);
  } catch (error) {
    if (fallbackGas === undefined) throw error;
    return Math.floor(fallbackGas * 1.2);
  }
}

export { resolveGas, SMART_ACCOUNT_GAS_LIMIT };
