// @ts-nocheck — TODO: type the fflate wrappers and drop this header
/**
 * Thin wrappers around fflate so the rest of the 3MF module never imports
 * fflate directly. Works in the browser (importmap), workers, and Node/Jest.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

export { strToU8, strFromU8 };

/**
 * True when the bytes start with a ZIP signature ("PK\x03\x04" family:
 * local file header, empty archive, or spanned marker).
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function isZipBytes(bytes) {
  return (
    !!bytes &&
    bytes.length >= 4 &&
    bytes[0] === 0x50 && // 'P'
    bytes[1] === 0x4b && // 'K'
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    bytes[3] === bytes[2] + 1
  );
}

/**
 * Unzip a package into a map of entry path → bytes.
 *
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {Object<string, Uint8Array>}
 */
export function unzipBytes(bytes) {
  return unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/**
 * Zip a map of entry path → bytes into a new package.
 *
 * @param {Object<string, Uint8Array>} files
 * @returns {Uint8Array}
 */
export function zipBytes(files) {
  return zipSync(files);
}
