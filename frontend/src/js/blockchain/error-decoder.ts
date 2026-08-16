/**
 * Solidity Transaction Revert Reason Decoder
 *
 * Decodes custom error selectors and parameters from failed transaction
 * revert data, producing human-readable error messages.
 *
 * Usage:
 *   import { decodeRevertReason } from './error-decoder.ts';
 *   const msg = await decodeRevertReason(error, contractABI);
 */

/** Selector map entry: custom error name + ABI inputs. */
interface ErrorSelectorMeta {
  name: string;
  inputs: any[];
}

/**
 * Build a map of 4-byte selectors → { name, inputs } from an ABI.
 */
function buildErrorSelectorMap(abi: any[]): Map<string, ErrorSelectorMeta> {
  const map = new Map<string, ErrorSelectorMeta>();
  if (!abi || !Array.isArray(abi)) return map;

  for (const item of abi) {
    if (item.type !== "error") continue;

    // Build signature: ErrorName(param1Type,param2Type,...)
    const paramTypes = (item.inputs || []).map((i: any) => i.type).join(",");
    const signature = `${item.name}(${paramTypes})`;

    // Compute 4-byte selector using Web3.js
    let selector: string | null;
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
 * @param selector - 0x-prefixed 4-byte selector
 * @param data - full revert data (includes selector)
 * @param selectorMap - from buildErrorSelectorMap
 * @returns decoded message or null
 */
function decodeCustomError(
  selector: string,
  data: string,
  selectorMap: Map<string, ErrorSelectorMeta>
): string | null {
  const meta = selectorMap.get(selector);
  if (!meta) return null;

  const { name, inputs } = meta;

  // No params - return simple message
  if (inputs.length === 0) {
    return formatErrorName(name);
  }

  // Decode parameters
  const encodedParams = data.slice(10); // remove 0x + 4 bytes selector
  let decoded: any;
  try {
    const web3 = window.web3 || (window.Web3 ? new window.Web3() : null);
    if (!web3) return `${formatErrorName(name)}`;
    decoded = web3.eth.abi.decodeParameters(inputs, "0x" + encodedParams);
  } catch {
    return `${formatErrorName(name)}`;
  }

  // Format parameters into human-readable string
  const paramStrs = inputs.map((input: any, idx: number) => {
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
 * @param data - revert data
 */
function decodeStringRevert(data: string): string | null {
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
 */
function formatErrorName(name: string): string {
  // Convert CamelCase to sentence case with spaces
  const spaced = name.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Cache selector maps per ABI to avoid recomputing
const abiCache = new WeakMap<any[], Map<string, ErrorSelectorMeta>>();

/**
 * Decode a transaction revert reason from an error object.
 * @param error - The error from a failed transaction
 * @param contractABI - Optional contract ABI for custom error decoding
 * @returns Human-readable error message
 */
export async function decodeRevertReason(
  error: any,
  contractABI: any[] | null = null
): Promise<string> {
  if (!error) return "Transaction failed";

  // If it's already a readable string revert, use that
  const msg = error.message || "";

  // Extract revert data from various Web3.js / provider error formats.
  let revertData: string | null | undefined = null;
  const dataPaths = [
    () => error.data,
    () => error.innerError?.data,
    () => error.originalError?.data,
    () => error.data?.data,
    () => error.data?.originalError?.data,
    () => error.cause?.data,
    () => error.info?.error?.data,
    () => error.payload?.data,
  ];
  for (const getData of dataPaths) {
    try {
      const d = getData();
      if (d && typeof d === "string" && d.startsWith("0x")) {
        revertData = d;
        break;
      }
    } catch {
      // ignore path resolution errors
    }
  }

  // Last resort: the message may contain escaped JSON with the revert data.
  // Prefer the last hex string (revert data is usually at the end) and ignore
  // 20-byte addresses (42 chars).
  if (!revertData && msg.includes("0x")) {
    const hexMatches = msg.match(/0x[0-9a-fA-F]+/g);
    if (hexMatches) {
      revertData = hexMatches
        .slice()
        .reverse()
        .find((h: string) => h.length >= 10 && h.length !== 42);
    }
  }

  console.log("[ERROR-DECODER] extracted revertData:", revertData);

  if (!revertData || typeof revertData !== "string" || !revertData.startsWith("0x")) {
    // No revert data - return the original message or a generic fallback
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
