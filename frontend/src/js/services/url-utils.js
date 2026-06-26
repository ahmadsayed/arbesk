// @ts-nocheck
/**
 * Arbesk URL Utilities
 *
 * Shared browser URL helpers for updating the address bar without reload.
 */

/**
 * Update the browser URL to point to a token ID.
 * Removes ?manifest param, sets ?asset=<tokenId>, optionally preserves ?assetId.
 */
export function updateUrlAsset(tokenId, assetId = null) {
  const url = new URL(window.location);
  url.searchParams.delete("manifest");
  url.searchParams.set("asset", String(tokenId));
  if (assetId) {
    url.searchParams.set("assetId", String(assetId));
  } else {
    url.searchParams.delete("assetId");
  }
  window.history.pushState({}, "", url);
}

/**
 * Update the browser URL to point to a manifest CID.
 * Sets ?manifest=<cid>, optionally preserves ?asset if tokenId provided.
 */
export function updateUrlManifest(cid, tokenId = null) {
  const url = new URL(window.location);
  url.searchParams.set("manifest", cid);
  if (tokenId) {
    url.searchParams.set("asset", String(tokenId));
  } else {
    url.searchParams.delete("asset");
  }
  window.history.pushState({}, "", url);
}

/**
 * Clear ?asset, ?assetId, and ?manifest query params from the URL without reloading.
 */
export function clearUrlAssetParams() {
  const url = new URL(window.location);
  url.searchParams.delete("asset");
  url.searchParams.delete("assetId");
  url.searchParams.delete("manifest");
  window.history.replaceState({}, "", url);
}
