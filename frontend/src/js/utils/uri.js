// @ts-nocheck
/**
 * Shared URI and string utilities.
 * Consolidated from glb-parser.js, decomposer.js, write-to-ipfs.js, and remote-ipfs.js.
 */

import { base64ToBytes } from "./encoding.js";

/**
 * Extract bytes and MIME type from a data URI.
 * @param {string} uri - The data URI to parse (e.g., "data:image/png;base64,...")
 * @returns {{bytes: Uint8Array, mimeType: string}|null} The extracted bytes and MIME type, or null if invalid
 */
export function extractDataURI(uri) {
  if (!uri || !uri.startsWith("data:")) return null;
  const commaIdx = uri.indexOf(",");
  if (commaIdx === -1) return null;

  const header = uri.substring(0, commaIdx);
  const payload = uri.substring(commaIdx + 1);
  const mimeMatch = header.match(/^data:([^;]+)/);
  const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const isBase64 = header.includes(";base64");

  const bytes = isBase64 ? base64ToBytes(payload) : new TextEncoder().encode(payload);
  return { bytes, mimeType };
}

/**
 * Sanitize a name for use as a filename.
 * Converts to lowercase, replaces special characters with underscores, and truncates to 40 chars.
 * @param {string} name - The name to sanitize
 * @returns {string} A safe filename
 */
export function sanitizeFileName(name) {
  return String(name || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 40) || "asset";
}
