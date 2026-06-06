/**
 * Solidity Transaction Revert Reason Decoder
 *
 * Decodes custom error selectors and parameters from failed transaction
 * revert data, producing human-readable error messages.
 *
 * Usage:
 *   import { decodeRevertReason } from './error-decoder.js';
 *   const msg = await decodeRevertReason(error, contractABI);
 */

/**
 * Build a map of 4-byte selectors → { name, inputs } from an ABI.
 * @param {Array} abi
 * @returns {Map<string, {name: string, inputs: Array}>}
 */
function buildErrorSelectorMap(abi) {
  const map = new Map();
  if (!abi || !Array.isArray(abi)) return map;

  for (const item of abi) {
    if (item.type !== "error") continue;

    // Build signature: ErrorName(param1Type,param2Type,...)
    const paramTypes = (item.inputs || []).map((i) => i.type).join(",");
    const signature = `${item.name}(${paramTypes})`;

    // Compute 4-byte selector using Web3.js
    let selector;
    try {
      selector = window.Web3
        ? window.Web3.utils.keccak256(signature).slice(0, 10)
        : null;
    } catch {
      selector = null;
    }

    if (selector) {
      map.set(selector, { name: item.name, inputs: item.inputs || [] });
    }
  }

  return map;
}

/**
 * Decode a custom error from its 4-byte selector + encoded data.
 * @param {string} selector - 0x-prefixed 4-byte selector
 * @param {string} data - full revert data (includes selector)
 * @param {Map} selectorMap - from buildErrorSelectorMap
 * @returns {string|null} decoded message or null
 */
function decodeCustomError(selector, data, selectorMap) {
  const meta = selectorMap.get(selector);
  if (!meta) return null;

  const { name, inputs } = meta;

  // No params — return simple message
  if (inputs.length === 0) {
    return formatErrorName(name);
  }

  // Decode parameters
  const encodedParams = data.slice(10); // remove 0x + 4 bytes selector
  let decoded;
  try {
    const web3 = window.web3 || (window.Web3 ? new window.Web3() : null);
    if (!web3) return `${formatErrorName(name)}`;
    decoded = web3.eth.abi.decodeParameters(inputs, "0x" + encodedParams);
  } catch {
    return `${formatErrorName(name)}`;
  }

  // Format parameters into human-readable string
  const paramStrs = inputs.map((input, idx) => {
    const val = decoded[idx];
    if (input.type === "address") {
      return `${val.slice(0, 10)}…${val.slice(-6)}`;
    }
    if (input.type === "uint256" && input.name === "tokenId") {
      return `#${val}`;
    }
    if (input.type === "uint256") {
      return val.toString();
    }
    return String(val);
  });

  return `${formatErrorName(name)}${paramStrs.length ? ": " + paramStrs.join(", ") : ""}`;
}

/**
 * Decode a standard string revert reason (Error(string)).
 * @param {string} data - revert data
 * @returns {string|null}
 */
function decodeStringRevert(data) {
  // Standard string revert: 0x08c379a0 + encoded string
  if (!data || !data.startsWith("0x08c379a0")) return null;

  try {
    const web3 = window.web3 || (window.Web3 ? new window.Web3() : null);
    if (!web3) return null;
    const decoded = web3.eth.abi.decodeParameter("string", data.slice(10));
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Format a Solidity error name to a human-readable message.
 * @param {string} name
 * @returns {string}
 */
function formatErrorName(name) {
  // Convert CamelCase to sentence case with spaces
  const spaced = name.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Cache selector maps per ABI to avoid recomputing
const abiCache = new WeakMap();

/**
 * Decode a transaction revert reason from an error object.
 * @param {Error} error - The error from a failed transaction
 * @param {Array|null} contractABI - Optional contract ABI for custom error decoding
 * @returns {Promise<string>} Human-readable error message
 */
export async function decodeRevertReason(error, contractABI = null) {
  if (!error) return "Transaction failed";

  // If it's already a readable string revert, use that
  const msg = error.message || "";

  // Extract revert data from various Web3.js error formats
  let revertData = error.data;

  // Web3.js v4 wraps revert data differently
  if (!revertData && error.innerError?.data) {
    revertData = error.innerError.data;
  }

  // Some providers nest data deeper
  if (!revertData && error?.data?.data) {
    revertData = error.data.data;
  }

  // MetaMask sometimes puts hex in the message
  if (!revertData && msg.includes("0x")) {
    const hexMatch = msg.match(/0x[0-9a-fA-F]+/);
    if (hexMatch && hexMatch[0].length >= 10) {
      revertData = hexMatch[0];
    }
  }

  if (!revertData || typeof revertData !== "string" || !revertData.startsWith("0x")) {
    // No revert data — return the original message or a generic fallback
    if (msg.includes("insufficient funds")) return "Insufficient funds for transaction.";
    if (msg.includes("User denied") || msg.includes("rejected") || error.code === 4001) {
      return "Transaction rejected by user.";
    }
    return msg || "Transaction failed";
  }

  // Try standard string revert first
  const stringRevert = decodeStringRevert(revertData);
  if (stringRevert) return stringRevert;

  // Try custom error decoding if ABI available
  if (contractABI) {
    let selectorMap = abiCache.get(contractABI);
    if (!selectorMap) {
      selectorMap = buildErrorSelectorMap(contractABI);
      abiCache.set(contractABI, selectorMap);
    }

    const selector = revertData.slice(0, 10);
    const customError = decodeCustomError(selector, revertData, selectorMap);
    if (customError) return customError;
  }

  // Fallback: return raw revert data with a note
  return `Transaction reverted (${revertData.slice(0, 10)})`;
}
