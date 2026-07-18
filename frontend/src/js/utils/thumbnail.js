// @ts-nocheck
/**
 * Thumbnail helpers shared by the Studio asset library and the Library grid.
 */

import { getBlobFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

/**
 * Extract the CID from a manifest thumbnail field.
 * Thumbnails may be a bare CID string or an object ({ cid } or { source: { cid } }).
 * @param {any} thumbnail
 * @returns {string|null}
 */
export function extractThumbnailCid(thumbnail) {
  if (!thumbnail) return null;
  if (typeof thumbnail === "string") return thumbnail;
  return thumbnail.cid || thumbnail.source?.cid || null;
}

/**
 * Load a thumbnail blob from IPFS and replace the container's content with
 * an <img>. The object URL is revoked once the image loads or fails.
 *
 * @param {HTMLElement} containerEl - element whose content is replaced by the img
 * @param {string} cid - thumbnail CID
 * @param {string} [name] - asset/item name used for the alt text
 * @returns {Promise<HTMLImageElement|null>} the img element, or null on failure
 */
export async function loadThumbnailInto(containerEl, cid, name) {
  if (!cid || !containerEl) return null;
  try {
    const blob = await getBlobFromRemoteIPFS(cid);
    const objectUrl = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.alt = `${name || "Asset"} thumbnail`;
    img.loading = "lazy";
    img.src = objectUrl;
    img.addEventListener("load", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    img.addEventListener("error", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    containerEl.textContent = "";
    containerEl.appendChild(img);
    return img;
  } catch (err) {
    console.warn("Failed to load thumbnail", cid, err);
    return null;
  }
}
