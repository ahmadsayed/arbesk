// @ts-nocheck
/**
 * Viewport drop zone for linked asset composition and OS file drops.
 * The full persistence/rendering path is handled by the linked asset feature
 * and services/asset-file-drop.js; this module provides the clean scene-level
 * UX event surface.
 */

import { emit, on, EVENTS } from "../events/bus.js";

const MIME = "application/x-arbesk-linked-asset";
const viewport = document.getElementById("viewport");
const overlay = document.getElementById("assetDropOverlay");

function hasLinkedAssetPayload(event) {
  return Array.from(event.dataTransfer?.types || []).includes(MIME);
}

function hasFilePayload(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
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
    if (!hasLinkedAssetPayload(event) && !hasFilePayload(event)) return;
    event.preventDefault();
    showOverlay();
  });

  viewport.addEventListener("dragover", (event) => {
    if (!hasLinkedAssetPayload(event) && !hasFilePayload(event)) return;
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
    if (payload) {
      event.preventDefault();
      emit(EVENTS.ASSET_LINKED_DROPPED, {
        ...payload,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    event.preventDefault();
    emit(EVENTS.ASSET_FILE_DROPPED, { file });
  });
}

on(EVENTS.ASSET_ADD_LINKED_REQUESTED, (payload) => {
  emit(EVENTS.ASSET_LINKED_DROPPED, payload);
});
