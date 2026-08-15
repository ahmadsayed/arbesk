/**
 * Arbesk Asset Save/Publish Controller.
 * Phase B: Updated for GNOME headerbar - buttons managed individually, no wrapper div.
 *
 * This module is the UI orchestrator. Manifest construction lives in
 * `services/asset-save/manifest-builder.js`; collection and editor publishing
 * live in `services/asset-save/collection-publish.js` and
 * `services/asset-save/editor-publish.js`.
 *
 * Header chrome (title/meta + save/publish/download visibility) is owned by
 * `ui/asset-chrome.js` — this module never writes it.
 */

import { getContractAddress } from "../blockchain/network-config.js";
import { showDialog } from "./dialog.js";
import { updateUrlAsset, updateUrlManifest } from "../services/url-utils.js";
import { getAssetName } from "../services/token.js";
import { showToast } from "./toasts.js";
import { on, EVENTS } from "../events/bus.js";
import { walletState } from "../state/wallet-state.js";
import {
  renameAsset,
  adoptLoadedManifestName,
  isDefaultAssetName,
  saveDraftAsset,
  publishAsset,
  getActiveAssetName,
  getActiveAssetTokenId,
} from "../domain/asset.js";
import { error } from "../utils/log.js";
import { saveAssetDraftCore } from "../services/asset-save/manifest-builder.js";
import { verifyCanEdit } from "../services/asset-save/editor-publish.js";
import { publishCollectionForAsset } from "../services/asset-save/collection-publish.js";
import { downloadActiveAsset } from "../services/asset-download.js";
import { announceStatus } from "../services/api.js";
import {
  startTaskProgress,
  setTaskProgress,
  finishTaskProgress,
  failTaskProgress,
} from "./task-progress.js";

const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("saveAssetBtn"));
const saveBtnText = document.getElementById("saveAssetBtnText");
const publishBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("publishAssetBtn"));
const publishBtnText = document.getElementById("publishAssetBtnText");
const downloadBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("downloadAssetBtn"));

let isSaving = false;
let isPublishing = false;

function requireWallet() {
  if (walletState.get().walletAddress) return true;
  showToast({
    type: "error",
    title: "Not Signed In",
    message: "Please log in or sign up first.",
  });
  return false;
}

/** @param {any} err */
function isRateLimitError(err) {
  if (!err || typeof err.message !== "string") return false;
  return (
    err.message.includes("HTTP 429") ||
    err.message.includes("Too Many Requests")
  );
}

async function onDownloadAsset() {
  if (downloadBtn?.disabled) return;
  if (downloadBtn) downloadBtn.disabled = true;
  try {
    const filename = await downloadActiveAsset();
    showToast({
      type: "success",
      title: "Download Started",
      message: filename,
    });
  } catch (err) {
    error("Download asset failed:", err);
    showToast({
      type: "error",
      title: "Download Failed",
      message: /** @type {Error} */ (err).message || "Could not download the model.",
    });
  } finally {
    if (downloadBtn) downloadBtn.disabled = false;
  }
}

/**
 * Prompt for a name only if it hasn't been explicitly set.
 * Returns the final name or null if cancelled.
 */
async function ensureExplicitName() {
  const currentName = getActiveAssetName() || "";
  if (!isDefaultAssetName(currentName)) {
    return currentName; // already explicitly named - skip dialog
  }
  const input = await showDialog(
    "Name Your Asset",
    "Give your asset a descriptive name before publishing.",
    ""
  );
  if (input === null) {
    return null;
  }
  const name = input.trim();
  if (name) {
    renameAsset(name);
    return name;
  }
  return "Untitled Asset";
}

/**
 * Save the current draft. Surfaces all failures itself (toast + status); the
 * return value lets callers distinguish outcomes without re-toasting.
 * @returns {Promise<{ok: boolean, cid?: string, reason?: string}|undefined>}
 *   The `saveAssetDraftCore` result when the save ran to completion
 *   (`ok: true`, or `ok: false` with `reason` "no-changes"/"empty");
 *   `undefined` when the save never ran (busy, no wallet) or threw (the
 *   failure toast has already been shown).
 */
async function onSaveAssetDraft() {
  if (isSaving) return;
  if (!requireWallet()) return;

  isSaving = true;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.title = "Saving…";
  }
  if (saveBtnText) saveBtnText.textContent = "Saving…";
  announceStatus("Saving draft…");
  startTaskProgress(
    "Saving draft — building manifest and uploading to IPFS…",
    0.15
  );

  try {
    const result = await saveDraftAsset({
      saveDraft: saveAssetDraftCore,
      fetchTokenName: getAssetName,
      updateUrlManifest,
    });

    if (!result.ok) {
      if (result.reason === "empty") {
        announceStatus("No asset data to save.");
        finishTaskProgress("Nothing to save.");
        showToast({
          type: "warning",
          title: "Nothing to Save",
          message: "Generate an asset or add linked assets first.",
        });
      } else if (result.reason === "no-changes") {
        finishTaskProgress("No changes to save.");
        showToast({
          type: "info",
          title: "No Changes",
          message: "Nothing new to save.",
        });
      }
      return result;
    }

    announceStatus("Draft saved.");
    finishTaskProgress("Draft saved.");
    return result;
  } catch (err) {
    error("Save asset draft failed:", err);
    const rateLimited = isRateLimitError(err);
    announceStatus(
      rateLimited
        ? "Upload rate limit hit. Save aborted."
        : "Save failed: " + /** @type {Error} */ (err).message
    );
    failTaskProgress(
      rateLimited ? "Save failed — upload rate limit hit." : "Save failed."
    );
    showToast({
      type: "error",
      title: rateLimited ? "Upload Rate Limited" : "Save Failed",
      message: rateLimited
        ? "Too many upload requests. Please wait a moment and try again."
        : /** @type {Error} */ (err).message,
      actions: [{ label: "Retry", onClick: onSaveAssetDraft }],
    });
  } finally {
    isSaving = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.title = "Save Draft (Ctrl+S)";
    }
    if (saveBtnText) saveBtnText.textContent = "Save";
  }
}

async function onPublishAsset() {
  if (isPublishing) return;
  if (!requireWallet()) return;

  isPublishing = true;
  if (publishBtn) {
    publishBtn.disabled = true;
    publishBtn.title = "Besking…";
  }
  if (publishBtnText) publishBtnText.textContent = "Besking…";
  announceStatus(
    getActiveAssetTokenId()
      ? "Republishing asset…"
      : "Publishing asset…"
  );
  startTaskProgress("Besking — preparing asset…", 0.1);

  try {
    const assetName = await ensureExplicitName();
    if (!assetName) {
      isPublishing = false;
      if (publishBtn) publishBtn.disabled = false;
      finishTaskProgress("Besking cancelled.");
      return;
    }

    const chainId = /** @type {number} */ (walletState.get().chainId);
    const outcome = await publishAsset(
      assetName,
      {
        address: /** @type {string} */ (walletState.get().walletAddress),
        chainId,
        contractAddress: /** @type {string} */ (getContractAddress(chainId)),
      },
      {
        verifyCanEdit,
        saveDraft: saveAssetDraftCore,
        publishCollection: publishCollectionForAsset,
        updateUrlAsset,
        onNewCollection: async () => {
          const { refreshTeamPanel } = await import("./collaborators.js");
          refreshTeamPanel();
        },
        onStatus: announceStatus,
        onProgress: setTaskProgress,
      }
    );

    if (outcome.outcome === "empty") {
      announceStatus("No asset data to publish.");
      finishTaskProgress("Nothing to publish.");
      showToast({
        type: "warning",
        title: "Nothing to Publish",
        message: "Generate an asset or add linked assets first.",
      });
      return;
    }
    if (outcome.outcome === "aborted") return;

    announceStatus(
      outcome.isNew
        ? "Default collection published and minted."
        : "Collection republished successfully."
    );
    finishTaskProgress(
      outcome.isNew ? "Published — collection minted on-chain." : "Republished."
    );
  } catch (err) {
    error("Publish asset failed:", err);
    const rateLimited = isRateLimitError(err);
    announceStatus(
      rateLimited
        ? "Upload rate limit hit. Publish aborted."
        : "Publish failed: " + /** @type {Error} */ (err).message
    );
    failTaskProgress(
      rateLimited ? "Publish failed — upload rate limit hit." : "Publish failed."
    );
    showToast({
      type: "error",
      title: rateLimited ? "Upload Rate Limited" : "Publish Failed",
      message: rateLimited
        ? "Too many upload requests. The asset was not anchored on-chain. Please wait a moment and try again."
        : /** @type {Error} */ (err).message,
      actions: [{ label: "Retry", onClick: onPublishAsset }],
    });
  } finally {
    isPublishing = false;
    if (publishBtn) {
      publishBtn.disabled = false;
      publishBtn.title = "Besk it: publish this asset";
    }
    if (publishBtnText) publishBtnText.textContent = "Besk it";
  }
}

export { onSaveAssetDraft, onPublishAsset };

saveBtn?.addEventListener("click", onSaveAssetDraft);
publishBtn?.addEventListener("click", onPublishAsset);
downloadBtn?.addEventListener("click", () => void onDownloadAsset());

document.addEventListener("keydown", (e) => {
  if (!((e.ctrlKey || e.metaKey) && e.key === "s")) return;
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  const tag = active?.tagName?.toLowerCase();
  if (
    active?.isContentEditable ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  )
    return;
  if (saveBtn && !saveBtn.hidden) {
    e.preventDefault();
    onSaveAssetDraft();
  }
});

// Asset name is set at creation time and displayed read-only in the header.

on(EVENTS.SCENE_READY, (e) => {
  adoptLoadedManifestName(e?.manifest);
});
