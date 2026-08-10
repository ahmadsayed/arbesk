// @ts-nocheck
/**
 * Viewport OS file drop — override or create.
 *
 * Handles EVENTS.ASSET_FILE_DROPPED (emitted by ui/asset-drop-zone.js when an
 * OS file lands on the viewport):
 *  - Asset open: replaces the root model node's source in place (linked child
 *    assets, transforms, and version history survive) and stages a pending
 *    source override for the next Save Draft / Publish.
 *  - No asset open: creates a fresh unsaved draft named after the file.
 *
 * The dropped file is uploaded to IPFS and decomposed to its canonical stored
 * form at drop time via the same stageUploadSource helper the Library upload
 * flow uses, so the save pipeline sees an already-stored source.
 */

import { on, emit, EVENTS } from "../events/bus.js";
import {
  getCurrentManifest,
  resetForNewAsset,
  renameAsset,
} from "../domain/asset.js";
import {
  stagePendingSourceOverride,
  clearPendingPostProcessorEdit,
  clearPendingTransformEdit,
} from "../engine/cleanup.js";
import { clearPendingSourceColorEdit } from "../engine/parametric-preview.js";
import { state } from "../engine/state.js";
import { getManifestNodes } from "../engine/transforms.js";
import { showToast } from "../ui/toasts.js";
import { log, warn } from "../utils/log.js";

/**
 * In-flight file-drop operations. The ASSET_FILE_DROPPED event is
 * fire-and-forget, so a Save that happens right after a drop could read the
 * pending source overrides before the drop handler staged its entry.
 * Save/publish awaits waitForPendingFileDrops() to close that race —
 * mirrors the linked-drop pattern in scene-loader.js.
 */
const _inFlightFileDrops = new Set();

/**
 * The root model node is the first manifest node with a source and no
 * child_ref — linked children are never the override target.
 */
function findRootModelNode(manifest) {
  return (
    getManifestNodes(manifest).find((n) => n.source?.cid && !n.child_ref) ||
    null
  );
}

async function _handleAssetFileDropped(detail) {
  const file = detail?.file;
  if (!file) return;

  // Lazy imports: keeps the upload chain (wallet, format handlers) and the
  // scene loader out of this module's static graph so consumers that only
  // need waitForPendingFileDrops() (the save pipeline) stay lightweight.
  const { validateUploadFile, baseNameWithoutExtension, stageUploadSource } =
    await import("./library-ops.js");

  const name = baseNameWithoutExtension(file.name);
  try {
    validateUploadFile(file);
  } catch (err) {
    showToast({ type: "error", title: "Drop Failed", message: err.message });
    return;
  }

  if (!state.scene) {
    showToast({
      type: "error",
      title: "Drop Failed",
      message: "Open the Studio first.",
    });
    return;
  }

  showToast({ type: "pending", title: "Uploading…", message: file.name });
  const source = await stageUploadSource(file, { assetName: name });
  log(`[DROP] staged ${file.name} → ${source.cid} (${source.path})`);

  const { replaceRootModelSource, createRootDraftSource } = await import(
    "../engine/scene-loader.js"
  );

  const manifest = getCurrentManifest();

  if (manifest) {
    const target = findRootModelNode(manifest);
    if (!target) {
      showToast({
        type: "error",
        title: "Drop Failed",
        message: "The open asset has no model node to replace.",
      });
      return;
    }
    const replaced = await replaceRootModelSource(target.node_id, source);
    if (!replaced) {
      showToast({
        type: "error",
        title: "Drop Failed",
        message: "The model node is no longer in the scene.",
      });
      return;
    }
    // Pending edits for this node describe the old geometry — drop them.
    clearPendingPostProcessorEdit(target.node_id);
    clearPendingTransformEdit(target.node_id);
    clearPendingSourceColorEdit(target.node_id);
    stagePendingSourceOverride(target.node_id, { source, name });
    log(`[DROP] overrode root model node ${target.node_id}`);
    emit(EVENTS.ASSET_FILE_STAGED, { name, source, assetManifestCid: null });
    showToast({
      type: "success",
      title: "Model Replaced",
      message: `${name} — unsaved draft. Save or Publish to keep it.`,
    });
    return;
  }

  resetForNewAsset();
  // Stage before renameAsset: staging emits no event, and the rename's
  // ASSET_STATE_CHANGED is what re-renders the chrome — the override must
  // already be staged or the header reads "No asset open" with no Save button.
  stagePendingSourceOverride("node_1", { source, name });
  renameAsset(name);
  await createRootDraftSource("node_1", source);
  log(`[DROP] created draft from ${file.name}`);
  emit(EVENTS.ASSET_FILE_STAGED, { name, source, assetManifestCid: null });
  showToast({
    type: "success",
    title: "Draft Created",
    message: `${name} — unsaved draft. Save or Publish to keep it.`,
  });
}

/**
 * Event-bus entry point for ASSET_FILE_DROPPED. Tracks the async work so
 * save/publish can wait for it via waitForPendingFileDrops().
 */
export function handleAssetFileDropped(event) {
  const p = _handleAssetFileDropped(event)
    .catch((err) => {
      warn("[DROP] file drop failed:", err?.message || err);
      showToast({
        type: "error",
        title: "Drop Failed",
        message: err?.message || "Could not load the dropped file.",
      });
    })
    .finally(() => {
      _inFlightFileDrops.delete(p);
    });
  _inFlightFileDrops.add(p);
  return p;
}

/**
 * Resolve once every file drop started so far has finished (pending source
 * override staged and scene load settled). Awaited by the save/publish
 * manifest builder before it snapshots the pending overrides.
 */
export async function waitForPendingFileDrops() {
  await Promise.all([..._inFlightFileDrops]);
}

on(EVENTS.ASSET_FILE_DROPPED, handleAssetFileDropped);
