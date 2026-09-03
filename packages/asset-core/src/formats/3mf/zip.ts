/**
 * Thin wrappers around fflate.
 * @remarks Keeps the rest of the 3MF module free of direct fflate imports;
 *   works in the browser, workers, and Node/Jest.
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

export { strToU8, strFromU8 };

/**
 * True when the bytes start with a ZIP signature ("PK\x03\x04" family:
 * local file header, empty archive, or spanned marker).
 */
export function isZipBytes(bytes: Uint8Array): boolean {
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
 */
export function unzipBytes(
  bytes: Uint8Array | ArrayBuffer
): Record<string, Uint8Array> {
  return unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/**
 * Zip a map of entry path → bytes into a new package.
 */
export function zipBytes(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}
