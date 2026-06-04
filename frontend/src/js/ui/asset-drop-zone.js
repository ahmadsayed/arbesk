/**
 * Viewport drop zone for linked asset composition.
 * The full persistence/rendering path is handled by the linked asset feature;
 * this module provides the clean scene-level UX event surface.
 */

const MIME = "application/x-arbesk-linked-asset";
const viewport = document.getElementById("viewport");
const overlay = document.getElementById("assetDropOverlay");

function hasLinkedAssetPayload(event) {
  return Array.from(event.dataTransfer?.types || []).includes(MIME);
}

function showOverlay() {
  overlay?.classList.add("active");
}

function hideOverlay() {
  overlay?.classList.remove("active");
}

function parsePayload(event) {
  const raw = event.dataTransfer?.getData(MIME);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    return payload?.type === "linked_asset" && payload.token_id
      ? payload
      : null;
  } catch {
    return null;
  }
}

if (viewport) {
  viewport.addEventListener("dragenter", (event) => {
    if (!hasLinkedAssetPayload(event)) return;
    event.preventDefault();
    showOverlay();
  });

  viewport.addEventListener("dragover", (event) => {
    if (!hasLinkedAssetPayload(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    showOverlay();
  });

  viewport.addEventListener("dragleave", (event) => {
    if (!viewport.contains(event.relatedTarget)) hideOverlay();
  });

  viewport.addEventListener("drop", (event) => {
    const payload = parsePayload(event);
    hideOverlay();
    if (!payload) return;

    event.preventDefault();
    document.dispatchEvent(
      new CustomEvent("asset:linkedDropped", {
        detail: {
          ...payload,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      })
    );
  });
}

document.addEventListener("asset:addLinkedRequested", (event) => {
  document.dispatchEvent(
    new CustomEvent("asset:linkedDropped", {
      detail: event.detail,
    })
  );
});
