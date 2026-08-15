/**
 * Pure view-assignment logic for multiview image-to-3D attach chips.
 *
 * Each attached image carries a `view` ("front" | "left" | "back" | "right").
 * Views are unique across the set, chips always render in canonical order,
 * changing a view swaps with the current holder, and removing the front chip
 * promotes the earliest remaining canonical view to front. Every operation
 * returns a NEW canonical-sorted array — nothing mutates in place.
 */

export const VIEW_ORDER = ["front", "left", "back", "right"];

/** @type {Record<string, string>} */
export const VIEW_LABELS = {
  front: "Front",
  left: "Left",
  back: "Back",
  right: "Right",
};

export const MAX_ATTACH_IMAGES = VIEW_ORDER.length;

/**
 * An attached reference image. `view` is managed here; the remaining fields
 * (base64, mime, name, dataUrl, …) are owned by the caller and carried through.
 * @typedef {Object} AttachedImage
 * @property {string} view
 * @property {string} [base64]
 * @property {string} [mime]
 * @property {string} [name]
 * @property {string} [dataUrl]
 */

/**
 * Sort a copy of the images into canonical view order.
 * @param {AttachedImage[]} images
 * @returns {AttachedImage[]}
 */
export function sortByCanonicalView(images) {
  return [...images].sort(
    (a, b) => VIEW_ORDER.indexOf(a.view) - VIEW_ORDER.indexOf(b.view)
  );
}

/**
 * Earliest canonical view not currently in use ("front" on an empty set).
 * @param {AttachedImage[]} images
 * @returns {string}
 */
export function nextAvailableView(images) {
  const used = new Set(images.map((img) => img.view));
  return VIEW_ORDER.find((view) => !used.has(view)) || "front";
}

/**
 * Append an image, auto-assigning the earliest free canonical view.
 * @param {AttachedImage[]} images
 * @param {Object} entry - image fields (base64, mime, name, dataUrl); `view` is set here
 * @returns {AttachedImage[]} new canonical-sorted array
 */
export function addAttachedImage(images, entry) {
  return sortByCanonicalView([
    ...images,
    /** @type {AttachedImage} */ ({ ...entry, view: nextAvailableView(images) }),
  ]);
}

/**
 * Change one chip's view. When the target view is already held by another
 * chip, the two chips SWAP views so uniqueness is preserved.
 * @param {AttachedImage[]} images
 * @param {number} index - index into `images`
 * @param {string} view - target view
 * @returns {AttachedImage[]} new canonical-sorted array
 */
export function setAttachedImageView(images, index, view) {
  const target = images[index];
  if (!target || target.view === view) return sortByCanonicalView(images);
  const holderIndex = images.findIndex((img) => img.view === view);
  const next = images.map((img, i) => {
    if (i === index) return { ...img, view };
    if (i === holderIndex) return { ...img, view: target.view };
    return img;
  });
  return sortByCanonicalView(next);
}

/**
 * Remove a chip. When the removed chip held "front", the remaining chip with
 * the earliest canonical view (left → back → right) is promoted to front.
 * @param {AttachedImage[]} images
 * @param {number} index - index into `images`
 * @returns {AttachedImage[]} new canonical-sorted array
 */
export function removeAttachedImage(images, index) {
  const removed = images[index];
  let rest = images.filter((_, i) => i !== index);
  if (removed?.view === "front" && rest.length > 0) {
    const earliest = rest.reduce((a, b) =>
      VIEW_ORDER.indexOf(a.view) <= VIEW_ORDER.indexOf(b.view) ? a : b
    );
    rest = rest.map((img) =>
      img === earliest ? { ...img, view: "front" } : img
    );
  }
  return sortByCanonicalView(rest);
}
