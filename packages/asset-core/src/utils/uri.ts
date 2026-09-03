/**
 * Shared URI and string utilities.
 */

import { base64ToBytes } from "./encoding.ts";

/**
 * Extracts bytes and MIME type from a data URI.
 */
export function extractDataURI(uri: string): { bytes: Uint8Array; mimeType: string } | null {
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
 * Sanitizes a name for use as a filename.
 */
export function sanitizeFileName(name: string): string {
  return String(name || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 40) || "asset";
}
