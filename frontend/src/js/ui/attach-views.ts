/**
 * View-assignment logic for multiview image-to-3D attach chips.
 * @remarks Views are unique and always render in canonical order; changing a
 *   view swaps with the holder, removing the front chip promotes the earliest
 *   remaining view, and every operation returns a new array (nothing mutates
 *   in place).
 */

export const VIEW_ORDER = ["front", "left", "back", "right"];

export const VIEW_LABELS: Record<string, string> = {
  front: "Front",
  left: "Left",
  back: "Back",
  right: "Right",
};

export const MAX_ATTACH_IMAGES = VIEW_ORDER.length;

/**
 * An attached reference image.
 * @remarks `view` is managed here; the remaining fields are owned by the
 *   caller and carried through.
 */
export interface AttachedImage {
  view: string;
  base64?: string;
  mime?: string;
  name?: string;
  dataUrl?: string;
}

/**
 * Sort a copy of the images into canonical view order.
 */
function sortByCanonicalView(images: AttachedImage[]): AttachedImage[] {
  return [...images].sort(
    (a, b) => VIEW_ORDER.indexOf(a.view) - VIEW_ORDER.indexOf(b.view)
  );
}

/**
 * Earliest canonical view not currently in use ("front" on an empty set).
 */
export function nextAvailableView(images: AttachedImage[]): string {
  const used = new Set(images.map((img) => img.view));
  return VIEW_ORDER.find((view) => !used.has(view)) || "front";
}

/**
 * Appends an image, auto-assigning the earliest free canonical view.
 */
export function addAttachedImage(
  images: AttachedImage[],
  entry: Omit<AttachedImage, "view">
): AttachedImage[] {
  return sortByCanonicalView([
    ...images,
    { ...entry, view: nextAvailableView(images) },
  ]);
}

/**
 * Changes one chip's view, swapping with the holder when the target view is
 * already taken.
 */
export function setAttachedImageView(
  images: AttachedImage[],
  index: number,
  view: string
): AttachedImage[] {
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
 * Removes a chip, promoting the earliest remaining view to front when the
 * removed chip held "front".
 */
export function removeAttachedImage(
  images: AttachedImage[],
  index: number
): AttachedImage[] {
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
