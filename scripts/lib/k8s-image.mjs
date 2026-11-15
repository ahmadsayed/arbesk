// @ts-nocheck — TODO: type properly (implicit any in helpers); scripts/ pattern
// Image-tag stamping for scripts/deploy-k3s.mjs.
//
// The manifests in deploy/k8s/ carry a placeholder tag. A deploy stamps a copy
// in memory and applies that, so it changes no tracked file and needs no
// commit afterwards.

/** The tag the tracked manifests carry; never a real image tag. */
export const IMAGE_PLACEHOLDER_TAG = "REPLACE_TAG";

/**
 * A manifest with every use of `image` set to `tag`.
 * @param {string} yaml manifest text
 * @param {string} image image name without a tag, e.g. `ahmadsayed/arbesk`
 * @param {string} tag
 * @returns {string}
 * @throws when the manifest does not use the image
 */
export function stampImage(yaml, image, tag) {
  const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uses = new RegExp(`(image:\\s*)${escaped}:\\S+`, "g");
  if (!uses.test(yaml)) throw new Error(`image ${image} not found in the manifest`);
  return yaml.replace(uses, `$1${image}:${tag}`);
}
