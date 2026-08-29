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

import { decodeErrorResult } from "viem";

/**
 * Format a Solidity error name to a human-readable message.
 */
function formatErrorName(name: string): string {
  // Convert CamelCase to sentence case with spaces
  const spaced = name.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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

  // Extract revert data from various provider error formats.
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

  // Decode with viem: covers Error(string), Panic, and ABI custom errors.
  if (contractABI) {
    try {
      const decoded = decodeErrorResult({
        abi: contractABI,
        data: revertData as `0x${string}`,
      });
      if (decoded.errorName === "Error") {
        return String(decoded.args?.[0] ?? "Transaction reverted");
      }
      const argStr = decoded.args?.length
        ? ": " + decoded.args.map((a) => String(a)).join(", ")
        : "";
      return `${formatErrorName(decoded.errorName)}${argStr}`;
    } catch {
      // Unknown selector — fall through to the generic formatting.
    }
  }

  // Fallback: return raw revert data with a note
  return `Transaction reverted (${revertData.slice(0, 10)})`;
}
