/**
 * Shared encoding utilities for binary data and base64 conversion.
 * Consolidated from glb-parser.js, decomposer.js, composer.js, and remote-ipfs.js.
 */

/**
 * Convert a base64 string to a Uint8Array.
 * @param {string} base64 - The base64 encoded string
 * @returns {Uint8Array} The decoded bytes
 */
export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert an ArrayBuffer or Uint8Array to a base64 string.
 * Uses chunked processing (32 KiB) to avoid argument list limits
 * with large buffers.
 * @param {ArrayBuffer|Uint8Array} buffer - The buffer to convert
 * @returns {string} The base64 encoded string
 */
export function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KiB
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
