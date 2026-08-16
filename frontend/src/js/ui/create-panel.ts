/**
 * Arbesk AI Generation UI Controller
 *
 * Generation flow: session auth → backend generation → asset chat bubble
 * with a live 3D preview → explicit "Show in Studio" (manifest load →
 * scene graph registration). Owns the AI Generation sidebar pane: chat
 * history, prompt input, provider selection, and the BYOK key dialog.
 */

import {
  loadAssetManifest,
  clearScene,
  dismissCreatePulse,
} from "../engine/scene-graph.ts";
import { showToast } from "./toasts.ts";
import { showCustomDialog, showCheckboxDialog } from "./dialog.ts";
import { addChatMessage, addAssetMessage, addWorkingMessage, addImageMessage, clearChatMessages, addAssetActionRow, addChoiceMessage } from "./chat-messages.ts";
import type { AssetMessageHandle, WorkingMessageHandle } from "./chat-messages.ts";
import { followupActionsFor } from "../domain/generation-actions.ts";
import type { FollowupAction } from "../domain/generation-actions.ts";
import {
  VIEW_LABELS,
  MAX_ATTACH_IMAGES,
  addAttachedImage,
  setAttachedImageView,
  removeAttachedImage,
} from "./attach-views.ts";
import type { AttachedImage } from "./attach-views.ts";
import { renderChatProvenance, clearHistoryBubbles } from "./chat-history.ts";
import {
  generateAsset,
  cancelGenerationTask,
  ApiError,
  getOrCreateSession,
  getProviderBalance,
} from "../services/api.ts";
import {
  createChatPreview,
  disposeChatPreview,
  disposeAllChatPreviews,
} from "../services/chat-preview.ts";
import { on, EVENTS } from "../events/bus.ts";
import { walletState } from "../state/wallet-state.ts";
import {
  addPendingGeneration,
  getPendingGeneration,
  updatePendingGeneration,
  _resetPendingGenerations,
} from "../state/pending-generations.ts";
import { deriveDefaultCollectionId, identityMatrix } from "../utils/collections.ts";
import { onSaveAssetDraft } from "./asset-save.ts";
import {
  adoptManifestName,
  adoptOpenedAsset,
  setActiveManifestCid,
  setLatestManifestCid,
  getActiveAssetManifestCid,
  getLatestAssetManifestCid,
  getActiveAssetTokenId,
  getActiveAssetName,
} from "../domain/asset.ts";
import { selectCollection } from "../domain/collection.ts";

// ─── DOM References ───
// The SPA shell (app.pug) always renders these elements, so non-null casts.
const promptInput = document.getElementById("promptInput") as HTMLTextAreaElement;
const generateBtn = document.getElementById("generateBtn") as HTMLButtonElement;
const generateHint = document.getElementById("generateHint");
const clearChatBtn = document.getElementById("clearChatBtn");

// Image-to-3D attach (Tripo3D only) — up to 4 reference views
const imageAttachBtn = document.getElementById(
  "imageAttachBtn"
) as HTMLButtonElement | null;
const imageAttachInput = document.getElementById(
  "imageAttachInput"
) as HTMLInputElement | null;
const imageAttachChips = document.getElementById("imageAttachChips");
const multiviewHint = document.getElementById("multiviewHint");

// Settings
const assetNameDisplay = document.getElementById("assetNameDisplay");
const providerSelect = document.getElementById("providerSelect") as HTMLSelectElement | null;
const tierSelect = document.getElementById("tierSelect") as HTMLSelectElement | null;
const collectionSelect = document.getElementById("collectionSelect") as HTMLSelectElement | null;
const providerKeyBtn = document.getElementById("providerKeyBtn");
const providerKeyHint = document.getElementById("providerKeyHint");
const bottomBarProvider = document.getElementById("bottomBarProvider");

// BYOK (Bring Your Own Key): a user-supplied generation provider key. Real
// providers require a key - the user pays the provider directly, bypassing the
// on-chain quota/payment gate. The mock provider needs no key. The key lives in
// localStorage and is sent per-request to the backend; it is never persisted
// server-side.
const BYOK_KEY_STORAGE = "arbesk-byok-key";

/**
 * Read the BYOK provider key (trimmed). Empty string when not set.
 */
function getByokKey(): string {
  return (localStorage.getItem(BYOK_KEY_STORAGE) || "").trim();
}

/**
 * True when the selected provider is a real (non-mock) provider.
 * Real providers require a BYOK key; the mock provider does not.
 */
function isRealProvider(): boolean {
  return getProvider() !== "mock";
}

// ─── Provider Balance (BYOK) ───

const providerBalance = document.getElementById("providerBalance");
const textureQualityRow = document.getElementById("textureQualityRow");
const textureQualitySelect = document.getElementById(
  "textureQualitySelect"
) as HTMLSelectElement | null;
const TEXTURE_QUALITY_STORAGE = "arbesk-texture-quality";

/**
 * Current panel texture quality for Tripo3D calls.
 */
function getTextureQuality(): "standard" | "detailed" | "extreme" {
  const v = textureQualitySelect?.value;
  return v === "detailed" || v === "extreme" ? v : "standard";
}

/** key the latest balance fetch was issued for */
let balanceFetchKey: string | null = null;
let balanceFetchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Update the balance line inside the BYOK key dialog (when open).
 */
function updateDialogBalance(text: string | null) {
  const el = document.getElementById("providerKeyBalance");
  if (el) el.textContent = text || "";
}

/**
 * Fetch the Tripo3D credit balance and update the caption(s). Stale
 * responses (key changed mid-flight) are dropped.
 */
async function fetchProviderBalance(key: string) {
  if (providerBalance) {
    providerBalance.hidden = false;
    providerBalance.textContent = "Tripo 3D credits: …";
  }
  try {
    const { balance } = await getProviderBalance(key);
    if (balanceFetchKey !== key) return;
    const text = `Tripo 3D credits: ${balance}`;
    if (providerBalance) providerBalance.textContent = text;
    updateDialogBalance(text);
  } catch (err) {
    if (balanceFetchKey !== key) return;
    balanceFetchKey = null; // allow a retry on the next sync
    const text =
      err instanceof ApiError && err.status === 401
        ? "Tripo 3D credits: invalid key"
        : "Tripo 3D credits: unavailable";
    if (providerBalance) providerBalance.textContent = text;
    updateDialogBalance(text);
  }
}

/**
 * Refresh the Tripo3D credit-balance caption for the registered BYOK key.
 * Debounced (the key dialog persists on every keystroke) and cached per key
 * value. Hidden for the mock provider, when no key is set, or when no wallet
 * is connected (fetching would trigger a sign-in prompt).
 */
function refreshProviderBalance({ force = false }: { force?: boolean } = {}) {
  const key = getByokKey();
  const show =
    getProvider() === "tripo3d" &&
    key.length > 0 &&
    !!walletState.get().walletAddress;
  if (!show) {
    balanceFetchKey = null;
    if (balanceFetchTimer) {
      clearTimeout(balanceFetchTimer);
      balanceFetchTimer = null;
    }
    if (providerBalance) providerBalance.hidden = true;
    updateDialogBalance(null);
    return;
  }
  if (!force && balanceFetchKey === key) return;
  balanceFetchKey = key;
  if (balanceFetchTimer) clearTimeout(balanceFetchTimer);
  balanceFetchTimer = setTimeout(
    () => {
      balanceFetchTimer = null;
      void fetchProviderBalance(key);
    },
    force ? 0 : 600,
  );
}

// ─── Image-to-3D Attach (Tripo3D only) ───

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Attached reference images in canonical view order (front, left, back,
 * right) — the attach-views helpers keep views unique and the array sorted.
 */
let attachedImages: AttachedImage[] = [];

/**
 * Drop all attached images and hide the chips.
 */
function clearAttachedImage() {
  attachedImages = [];
  if (imageAttachInput) imageAttachInput.value = "";
  renderAttachChips();
}

/**
 * The attach button only applies to Tripo3D (image-to-3D). Switching back to
 * the mock provider hides it and discards any attached images.
 */
function syncImageAttachUI() {
  const enabled = getProvider() === "tripo3d";
  if (imageAttachBtn) imageAttachBtn.hidden = !enabled;
  if (!enabled) clearAttachedImage();
}

/**
 * Re-render the chip row from attachedImages (canonical view order). A lone
 * image renders exactly like the legacy single chip — no view selector. With
 * 2+ images each chip gets a Front/Left/Back/Right selector and the multiview
 * hint line appears below the chips.
 */
function renderAttachChips() {
  if (!imageAttachChips) return;
  imageAttachChips.replaceChildren();
  const multiview = attachedImages.length > 1;
  attachedImages.forEach((image, index) => {
    const chip = document.createElement("div");
    chip.className = "image-attach-chip";

    const thumb = document.createElement("img");
    thumb.className = "image-attach-thumb";
    // Chips are only created from fully-populated entries (attachImageFiles).
    thumb.src = image.dataUrl as string;
    thumb.alt = `Attached source image (${VIEW_LABELS[image.view] || image.view})`;
    chip.appendChild(thumb);

    const name = document.createElement("span");
    name.className = "image-attach-name";
    name.textContent = image.name ?? null;
    chip.appendChild(name);

    if (multiview) {
      const viewSelect = document.createElement("select");
      viewSelect.className = "image-attach-view";
      viewSelect.setAttribute(
        "aria-label",
        `Reference view for ${image.name}`
      );
      for (const [value, label] of Object.entries(VIEW_LABELS)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        viewSelect.appendChild(option);
      }
      viewSelect.value = image.view;
      viewSelect.addEventListener("change", () => {
        attachedImages = setAttachedImageView(
          attachedImages,
          index,
          viewSelect.value
        );
        renderAttachChips();
      });
      chip.appendChild(viewSelect);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "image-attach-remove";
    remove.setAttribute("aria-label", `Remove attached image ${image.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      attachedImages = removeAttachedImage(attachedImages, index);
      renderAttachChips();
    });
    chip.appendChild(remove);

    imageAttachChips.appendChild(chip);
  });
  imageAttachChips.hidden = attachedImages.length === 0;
  if (multiviewHint) {
    multiviewHint.hidden = !multiview;
    if (multiview) {
      const extra = attachedImages.length - 1;
      multiviewHint.textContent = `Multiview: Front + ${extra} view${extra === 1 ? "" : "s"} — the model is built from all angles`;
    }
  }
}

/**
 * Read and validate image files selected via the attach input, then add them
 * to the set (up to 4, views auto-assigned in attach order). Invalid files
 * are rejected with a toast; a selection that would exceed 4 views is
 * rejected wholesale.
 */
function attachImageFiles(files: File[]) {
  if (files.length === 0) return;
  if (attachedImages.length + files.length > MAX_ATTACH_IMAGES) {
    showToast({
      type: "warning",
      title: "Too Many Images",
      message: "Up to 4 reference views are supported.",
    });
    if (imageAttachInput) imageAttachInput.value = "";
    return;
  }
  for (const file of files) {
    if (!IMAGE_MIMES.has(file.type)) {
      showToast({
        type: "warning",
        title: "Unsupported Image",
        message: "Attach a JPEG, PNG, or WebP image.",
      });
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showToast({
        type: "warning",
        title: "Image Too Large",
        message: "Images are limited to 10 MB.",
      });
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      if (!base64) return;
      attachedImages = addAttachedImage(attachedImages, {
        base64,
        mime: file.type,
        name: file.name,
        dataUrl,
      });
      renderAttachChips();
    };
    reader.readAsDataURL(file);
  }
  // Reset so picking the same file again still fires "change".
  if (imageAttachInput) imageAttachInput.value = "";
}

if (imageAttachBtn && imageAttachInput) {
  imageAttachBtn.addEventListener("click", () => imageAttachInput.click());
  imageAttachInput.addEventListener("change", () => {
    attachImageFiles(Array.from(imageAttachInput.files || []));
  });
}

// ─── BYOK Key Dialog ───

// Persist + hydrate the generation provider. A stored value that no longer
// exists among the select options (e.g. a removed provider) is ignored, so
// the markup default (mock) wins.
const PROVIDER_STORAGE = "arbesk-provider";

/**
 * Sync provider-dependent UI for the current selection: the key configure
 * button only applies to real providers, the hint + attention state flag a
 * missing key, and the bottom bar mirrors the active selection.
 */
function syncProviderUI() {
  const real = isRealProvider();
  const missingKey = real && getByokKey().length === 0;
  if (providerKeyBtn) {
    providerKeyBtn.hidden = !real;
    providerKeyBtn.classList.toggle("attention", missingKey);
  }
  if (providerKeyHint) providerKeyHint.hidden = !missingKey;
  if (bottomBarProvider && providerSelect) {
    const label = providerSelect.selectedOptions[0]?.textContent || "Mock";
    bottomBarProvider.textContent = `Provider: ${label}`;
  }
  // Texture quality selector applies to Tripo3D only.
  if (textureQualityRow) textureQualityRow.hidden = getProvider() !== "tripo3d";
  refreshProviderBalance();
}

if (providerSelect) {
  const storedProvider = localStorage.getItem(PROVIDER_STORAGE);
  const knownProvider = Array.from(providerSelect.options).some(
    (o) => o.value === storedProvider
  );
  if (storedProvider && knownProvider) {
    providerSelect.value = storedProvider;
  }
  providerSelect.addEventListener("change", () => {
    localStorage.setItem(PROVIDER_STORAGE, providerSelect.value);
    syncProviderUI();
    syncImageAttachUI();
  });
}

if (textureQualitySelect) {
  const stored = localStorage.getItem(TEXTURE_QUALITY_STORAGE);
  if (stored && ["standard", "detailed", "extreme"].includes(stored)) {
    textureQualitySelect.value = stored;
  }
  textureQualitySelect.addEventListener("change", () => {
    localStorage.setItem(TEXTURE_QUALITY_STORAGE, textureQualitySelect.value);
  });
}

// Collapsible provider/quality section — open by default, persisted so the
// user's preference survives reloads.
const composerSettings = document.getElementById(
  "composerSettings"
) as HTMLDetailsElement | null;
const COMPOSER_SETTINGS_STORAGE = "arbesk-composer-settings-open";
if (composerSettings) {
  composerSettings.open =
    localStorage.getItem(COMPOSER_SETTINGS_STORAGE) !== "0";
  composerSettings.addEventListener("toggle", () => {
    localStorage.setItem(
      COMPOSER_SETTINGS_STORAGE,
      composerSettings.open ? "1" : "0"
    );
  });
}

/**
 * Build the key dialog body: a password input (prefilled from localStorage,
 * persisted on input), a show/hide toggle, and a Clear Key action. The input
 * only exists while the dialog is open; the stored key lives in localStorage.
 * All markup is static — no user content is injected.
 */
function buildProviderKeyBody(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <p style="margin:0 0 var(--size-2)">Bring your own Tripo 3D key to generate without the free-tier on-chain quota. The key is stored only in this browser and sent with each generation request.</p>
    <div class="form-group">
      <label class="form-label" for="providerKeyInput">Tripo 3D API Key</label>
      <div class="byok-field">
        <input id="providerKeyInput" class="form-control" type="password" placeholder="sk-…" autocomplete="off">
        <button id="providerKeyToggle" class="byok-toggle" type="button" aria-label="Show API key">Show</button>
      </div>
    </div>
    <button id="providerKeyClear" class="btn btn-secondary" type="button" style="margin-top:var(--size-2)">Clear Key</button>
    <p id="providerKeyBalance" class="provider-balance" style="margin-top:var(--size-2)"></p>`;

  const input = wrap.querySelector("#providerKeyInput") as HTMLInputElement;
  const toggle = wrap.querySelector("#providerKeyToggle") as HTMLButtonElement;
  const clear = wrap.querySelector("#providerKeyClear") as HTMLButtonElement;

  // Prefill the balance line from the provider-row caption (when a fresh
  // fetch is already cached there).
  const dialogBalance = wrap.querySelector("#providerKeyBalance");
  if (dialogBalance && providerBalance && !providerBalance.hidden) {
    dialogBalance.textContent = providerBalance.textContent;
  }

  input.value = localStorage.getItem(BYOK_KEY_STORAGE) || "";
  input.addEventListener("input", () => {
    localStorage.setItem(BYOK_KEY_STORAGE, input.value);
    syncProviderUI();
  });

  toggle.addEventListener("click", () => {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    toggle.setAttribute("aria-label", hidden ? "Hide API key" : "Show API key");
    toggle.textContent = hidden ? "Hide" : "Show";
  });

  clear.addEventListener("click", () => {
    input.value = "";
    localStorage.removeItem(BYOK_KEY_STORAGE);
    syncProviderUI();
  });

  return wrap;
}

function showProviderKeyDialog() {
  refreshProviderBalance({ force: true });
  return showCustomDialog("Tripo 3D API Key", buildProviderKeyBody());
}

if (providerKeyBtn) {
  providerKeyBtn.addEventListener("click", () => {
    showProviderKeyDialog();
  });
}

// ─── Collection Selector ───

/**
 * Populate the collection dropdown with available collections.
 * Currently shows only the wallet-derived "Default" collection.
 * Named collections will be added here in the future.
 */
function syncCollectionSelect() {
  if (!collectionSelect) return;
  const walletAddr = walletState.get().walletAddress;
  const defaultId = walletAddr ? deriveDefaultCollectionId(walletAddr) : null;

  // Preserve the currently selected value if still valid
  const currentValue = collectionSelect.value;

  collectionSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = defaultId || "";
  defaultOption.textContent = "Default";
  collectionSelect.appendChild(defaultOption);

  // Restore previous selection or default
  if (
    currentValue &&
    collectionSelect.querySelector(`option[value="${currentValue}"]`)
  ) {
    collectionSelect.value = currentValue;
  } else if (defaultId) {
    collectionSelect.value = defaultId;
    selectCollection(defaultId);
  }

  collectionSelect.addEventListener("change", () => {
    selectCollection(collectionSelect.value || defaultId);
  });
}

// ─── Chat Messages ───

// addChatMessage / addAssetMessage live in ./chat-messages.ts and are
// imported above; addChatMessage is re-exported at the bottom of this file.

/** Live asset-message handles keyed by pending-generation id. */
const assetMessages = new Map<string, AssetMessageHandle>();

/**
 * Active version for typed-prompt retexture. Set on generation result,
 * Show-in-Studio, and bubble/history restore; cleared by detach, Clear
 * Chat, and asset switch. The GLB CID is the durable reference — no expiry.
 */
interface ActiveVersion {
  sourceAssetCid: string;
  manifestCid: string | null;
  name: string;
}
let activeVersion: ActiveVersion | null = null;

const refineIndicator = document.getElementById("refineIndicator");
const refineIndicatorText = document.getElementById("refineIndicatorText");
const refineIndicatorDetach = document.getElementById("refineIndicatorDetach");

function setActiveVersion(version: ActiveVersion | null) {
  activeVersion = version;
  if (!refineIndicator || !refineIndicatorText) return;
  refineIndicator.hidden = !version;
  if (version) refineIndicatorText.textContent = `Refining: ${version.name}`;
}

refineIndicatorDetach?.addEventListener("click", () => setActiveVersion(null));

/**
 * Clear the chat: dispose all live previews, reset the pending-generation
 * store and bubble handles, restore the welcome placeholder, and break the
 * refine chain so the next generation starts a brand-new model.
 */
function clearChat() {
  disposeAllChatPreviews();
  _resetPendingGenerations();
  assetMessages.clear();
  setActiveVersion(null);
  clearAttachedImage();
  clearChatMessages();
  clearHistoryBubbles();
  addChatMessage("system", "Chat cleared. Start a new model.");
}

/**
 * Attach a live 3D preview to an asset bubble. Falls back to a static
 * format badge when the preview cannot be created.
 */
async function attachChatPreview(
  generationId: string,
  assetMessage: AssetMessageHandle
) {
  const record = getPendingGeneration(generationId);
  if (!record) {
    assetMessage.markFallback();
    return;
  }
  const handle = await createChatPreview(
    generationId,
    assetMessage.canvas,
    { cid: record.sourceAssetCid, path: record.path, format: record.format },
    {
      onAutoCollapse: (collapsedId: string, snapshot: Blob | null) => {
        assetMessages.get(collapsedId)?.collapsePreview(snapshot);
      },
    }
  );
  if (!handle) assetMessage.markFallback();
}

/**
 * Send a pending generation to the Studio viewport: runs the same
 * clear → state → URL → load tail that generation used to run inline,
 * then disposes the preview and collapses the bubble.
 * @param options - restore=true preserves the
 *   manifest-chain tip across the load so the auto-save chains onto the
 *   prior tip instead of forking at the restored (older) version.
 */
async function sendGenerationToStudio(
  generationId: string,
  assetMessage: AssetMessageHandle,
  { restore = false }: { restore?: boolean } = {}
) {
  const record = getPendingGeneration(generationId);
  if (!record || record.status !== "pending") return;

  updatePendingGeneration(generationId, { status: "sent" });
  assetMessage.sendButton.disabled = true;

  // Capture the chain tip before the state set re-roots it at the record's
  // manifest — restoring an older bubble must not fork the chain.
  const previousLatestCid = getLatestAssetManifestCid();

  try {
    if (record.prevAssetManifestCid) {
      clearScene();
    }

    // The Send path only runs for records with a manifest CID (drop bubbles
    // have their Send button disabled).
    const recordCid = record.assetManifestCid as string;
    adoptOpenedAsset(recordCid);

    const url = new URL(window.location.href);
    const activeTokenId = getActiveAssetTokenId();
    if (activeTokenId) {
      url.searchParams.set("asset", activeTokenId);
      url.searchParams.delete("manifest");
    } else {
      url.searchParams.set("manifest", recordCid);
    }
    window.history.pushState({}, "", url);

    await loadAssetManifest(recordCid);

    // Restore of an OLDER version: put the chain tip back (SCENE_READY
    // listeners re-asserted it from the loaded manifest during the await)
    // so the auto-save below chains onto the prior tip, not the old version.
    if (
      restore &&
      previousLatestCid &&
      previousLatestCid !== record.assetManifestCid
    ) {
      setLatestManifestCid(previousLatestCid);
      await renderChatProvenance(previousLatestCid);
    }

    // The restored/sent version becomes the active version for typed
    // retexture follow-ups (Tripo3D generations and uploaded models).
    if (record.provider === "tripo3d" || record.provider === "upload") {
      setActiveVersion({
        sourceAssetCid: record.sourceAssetCid,
        manifestCid: record.assetManifestCid,
        name: record.prompt,
      });
    }

    const snapshot = await disposeChatPreview(generationId, {
      captureSnapshot: true,
    });
    assetMessage.markSent(snapshot);

    // Show in Studio is an explicit "keep this version" — save a draft so the
    // bubble stays restorable. Publish remains a separate, manual action.
    try {
      const saveResult = await onSaveAssetDraft();
      // "no-changes" means this version is already durably saved — the pill
      // is honest in both cases. Any other outcome already surfaced a toast.
      if (saveResult && (saveResult.ok || saveResult.reason === "no-changes")) {
        assetMessage.markSaved();
      } else {
        addChatMessage(
          "system",
          "Auto-save failed — use the Save button to retry."
        );
      }
    } catch (err) {
      console.error("Auto-save after Show in Studio failed:", err);
      addChatMessage("system", "Auto-save failed — use the Save button to retry.");
    }

    addChatMessage("system", `Model carved via ${getProvider()}.`);
  } catch (err) {
    console.error("Show in Studio failed:", err);
    updatePendingGeneration(generationId, { status: "pending" });
    assetMessage.sendButton.disabled = false;
    addChatMessage(
      "system",
      (err as Error).message || "Failed to load the model in the Studio."
    );
  }
}

/**
 * Re-send an already-sent generation to the Studio — the path taken when the
 * user re-clicks Show in Studio on a sent bubble. Resets the record to
 * pending so the send path accepts it again, then runs the normal
 * Show-in-Studio tail (which also makes the restored version the active
 * version).
 */
async function restoreGeneration(generationId: string) {
  const assetMessage = assetMessages.get(generationId);
  const record = getPendingGeneration(generationId);
  if (!assetMessage || !record) {
    addChatMessage(
      "system",
      "That model is no longer available in this chat.",
    );
    return;
  }
  updatePendingGeneration(generationId, { status: "pending" });
  await sendGenerationToStudio(generationId, assetMessage, { restore: true });
}

// ─── Generate Button State ───

function setGenerating(active: boolean) {
  if (!generateBtn) return;
  if (active) {
    generateBtn.classList.add("generating");
    generateBtn.disabled = true;
  } else {
    generateBtn.classList.remove("generating");
    generateBtn.disabled = false;
  }
  if (imageAttachBtn) imageAttachBtn.disabled = active;
}

function updateGenerateHint() {
  const connected = !!walletState.get().walletAddress;
  if (generateHint) generateHint.hidden = connected;
  if (generateBtn && !generateBtn.classList.contains("generating")) {
    generateBtn.disabled = !connected;
  }
}

// ─── Asset Definition Helpers ───

function getAssetName() {
  return (
    getActiveAssetName() ||
    assetNameDisplay?.textContent ||
    "Untitled Asset"
  ).trim();
}

function syncAssetNameDisplay(name: string | null = null) {
  if (!assetNameDisplay) return;
  assetNameDisplay.textContent =
    name || getActiveAssetName() || "Untitled Asset";
}

function getProvider() {
  return providerSelect?.value || "mock";
}

function getTier() {
  const val = tierSelect?.value;
  if (val === undefined || val === null || val === "") return 0;
  return Number(val);
}

function buildTransformMatrix() {
  return identityMatrix();
}

// ─── Stoppable Generation Tasks ───

/**
 * True for a user-initiated cancel — call sites surface a neutral message
 * instead of the error mapping.
 */
function isGenerationCancelled(err: unknown): boolean {
  return err instanceof ApiError && err.code === "GENERATION_CANCELLED";
}

/**
 * Stop confirmation dialog: resolves true only via the Stop button.
 * Credits spent with the provider are not refunded — the warning is the
 * point of the dialog.
 */
function showStopTaskDialog(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p style="margin:0 0 var(--size-2)">Stop this task? Credits already spent with Tripo 3D are <strong>not</strong> refunded — you will lose them, and the partial result is discarded.</p>
      <button id="stopTaskConfirm" class="btn btn-danger" type="button">Stop task — lose the credits</button>`;
    (wrap.querySelector("#stopTaskConfirm") as HTMLElement).addEventListener("click", () => {
      const w = wrap as any;
      if (typeof w.closeDialog === "function") w.closeDialog(true);
    });
    showCustomDialog("Stop generation?", wrap).then((v: any) => resolve(v === true));
  });
}

/**
 * Confirm stopping an in-flight generation, then abort polling and evict
 * the backend task (best-effort upstream cancel; the registry TTL sweeps
 * the entry regardless).
 */
async function confirmStopTask(
  controller: AbortController,
  getTaskId: () => string | null
) {
  const stop = await showStopTaskDialog();
  if (!stop) return;
  controller.abort();
  const taskId = getTaskId();
  if (taskId) {
    try {
      await cancelGenerationTask(taskId);
    } catch {
      // Best effort — the backend entry expires on its own.
    }
  }
}

/**
 * A working message with a Stop button, plus the AbortSignal / onTaskId
 * wiring generateAsset needs to make the task stoppable.
 */
function addStoppableWorkingMessage(workingText: string): {
  working: WorkingMessageHandle | null;
  signal: AbortSignal;
  onTaskId: (id: string) => void;
  onProgress: (update: { stage: string | null; progress: number }) => void;
} {
  const controller = new AbortController();
  let taskId: string | null = null;
  const working = addWorkingMessage(workingText, {
    onCancel: () => void confirmStopTask(controller, () => taskId),
  });
  return {
    working,
    signal: controller.signal,
    onTaskId: (id) => {
      taskId = id;
    },
    onProgress: ({ stage, progress }) => {
      // Stage labels ("Rigging skeleton", …) reflect the current chain phase
      // more accurately than the initial text; fall back to it otherwise.
      working?.setProgress(progress / 100, stage || undefined);
    },
  };
}

// ─── Rig & Animate (Tripo3D) ───

// Animation presets offered by the Animate follow-up's checkbox picker.
// Pseudo-option value for the Animate dialog's in-place toggle — filtered
// out before presets go to the backend, and doesn't count toward Tripo's
// 5-animation cap (see showCheckboxDialog's countsTowardMax).
const IN_PLACE_OPTION = "option:in-place";
const IN_PLACE_PRESET = {
  value: IN_PLACE_OPTION,
  label: "In place (no root motion)",
  checked: true,
  countsTowardMax: false,
};

// Curated animate presets, categorized for the dialog. Short-form IDs exist
// on both rig lines; preset:biped:* IDs are v1.0 biped rig only (Tripo's 90+
// library) and get a clear error on the generic v2.5 rig (adapter guard).
const ANIMATE_PRESET_GROUPS = [
  {
    category: "Basics",
    presets: [
      { value: "preset:idle", label: "Idle", checked: true },
      { value: "preset:walk", label: "Walk", checked: true },
      { value: "preset:run", label: "Run" },
      { value: "preset:jump", label: "Jump" },
      { value: "preset:climb", label: "Climb" },
      { value: "preset:turn", label: "Turn" },
    ],
  },
  {
    category: "Combat",
    presets: [
      { value: "preset:slash", label: "Slash" },
      { value: "preset:shoot", label: "Shoot" },
      { value: "preset:biped:front_kick_01", label: "Front Kick" },
      { value: "preset:biped:box_01", label: "Box" },
      { value: "preset:biped:cast_a_spell", label: "Cast a Spell" },
    ],
  },
  {
    category: "Reactions",
    presets: [
      { value: "preset:hurt", label: "Hurt" },
      { value: "preset:fall", label: "Fall" },
      { value: "preset:dive", label: "Dive" },
      { value: "preset:biped:defeat_02", label: "Defeat" },
      { value: "preset:biped:scared_01", label: "Scared" },
    ],
  },
  {
    category: "Emotes",
    presets: [
      { value: "preset:biped:dance_01", label: "Dance 1" },
      { value: "preset:biped:dance_02", label: "Dance 2" },
      { value: "preset:biped:cheer", label: "Cheer" },
      { value: "preset:biped:victory_celebration", label: "Victory" },
      { value: "preset:biped:wave_goodbye_01", label: "Wave Goodbye" },
      { value: "preset:biped:clap", label: "Clap" },
      { value: "preset:biped:bow", label: "Bow" },
    ],
  },
  {
    category: "Daily Life",
    presets: [
      { value: "preset:biped:sit", label: "Sit" },
      { value: "preset:biped:look_around", label: "Look Around" },
      { value: "preset:biped:standing_relax", label: "Relax" },
      { value: "preset:biped:swim", label: "Swim" },
    ],
  },
];

// Flat view (groups in order + the in-place toggle) for the retry picker's
// flat checkbox dialog.
const ANIMATE_PRESETS = [
  ...ANIMATE_PRESET_GROUPS.flatMap((g) => g.presets),
  IN_PLACE_PRESET,
];

/** Chat-prompt label for a preset ID: "preset:biped:dance_01" → "dance 01". */
function animatePresetLabel(preset: string): string {
  return preset.replace(/^preset:(biped:)?/, "").replace(/_/g, " ");
}

/**
 * Register a finished generation as a pending record and present it as an
 * asset chat bubble with live preview, Show-in-Studio, and (per
 * followupActionsFor) a follow-up action row.
 * @returns the pending generation id
 */
/**
 * Wire a bubble's Show in Studio button — the ONLY way a bubble's model
 * enters the Studio (the preview is orbit-only). The button stays live
 * after sending: re-clicking a sent bubble restores that version.
 */
function wireSendButton(generationId: string, assetMessage: AssetMessageHandle) {
  assetMessage.sendButton.addEventListener("click", () => {
    const record = getPendingGeneration(generationId);
    if (record?.status === "sent") void restoreGeneration(generationId);
    else void sendGenerationToStudio(generationId, assetMessage);
  });
}

/**
 * @param result - generation result from the backend/provider
 */
function presentGenerationResult(
  result: any,
  {
    prompt,
    provider,
    task,
    prevAssetManifestCid,
    transformMatrix,
    rigModel,
  }: {
    prompt: string;
    provider: string;
    task: string;
    prevAssetManifestCid?: string | null;
    transformMatrix?: number[];
    rigModel?: string;
  },
): string {
  const generationId = addPendingGeneration({
    assetManifestCid: result.assetManifestCid,
    sourceAssetCid: result.sourceAssetCid,
    prompt,
    format: result.format,
    path: result.path,
    prevAssetManifestCid: prevAssetManifestCid || null,
    transformMatrix,
    provider,
    task,
    ...(result.taskId && { backendTaskId: result.taskId }),
    ...(result.providerTaskId && { taskId: result.providerTaskId }),
    ...(result.tier !== undefined && { tier: result.tier }),
    ...(rigModel && { rigModel }),
  });

  // A fresh Tripo3D result is the active version for typed retexture
  // follow-ups until detached, cleared, or replaced.
  if (provider === "tripo3d") {
    setActiveVersion({
      sourceAssetCid: result.sourceAssetCid,
      manifestCid: result.assetManifestCid,
      name: prompt,
    });
  }

  const assetMessage = addAssetMessage({ prompt, format: result.format });
  if (assetMessage) {
    assetMessages.set(generationId, assetMessage);
    wireSendButton(generationId, assetMessage);
    void attachChatPreview(generationId, assetMessage);
    // The helper gates by provider/task: animated results are terminal,
    // rig-only results keep only Animate, mock gets nothing.
    addFollowupActions(generationId);
  }
  return generationId;
}

/**
 * Attach the version-card action row to a generation bubble. Availability
 * comes from followupActionsFor; each action runs against the bubble's own
 * GLB (sourceAssetCid), so any bubble stays actionable indefinitely.
 */
function addFollowupActions(generationId: string, bubbleEl: HTMLElement | null = null) {
  const record = getPendingGeneration(generationId);
  const assetMessage = assetMessages.get(generationId);
  const bubble = bubbleEl || assetMessage?.bubble || null;
  if (!record || !bubble) return;
  const ACTION_DEFS: Record<FollowupAction, { label: string; run: () => void }> = {
    retexture: { label: "Retexture", run: () => void onRetexture(generationId) },
    retopo: { label: "Retopo", run: () => void onRetopo(generationId) },
    "auto-rig": { label: "Auto-rig", run: () => void onAutoRig(generationId) },
    animate: { label: "Animate…", run: () => void onAnimate(generationId) },
  };
  const actions = followupActionsFor(record as any).map((id) => ({
    id,
    label: ACTION_DEFS[id].label,
    onPick: ACTION_DEFS[id].run,
  }));
  addAssetActionRow(assetMessage || { bubble }, actions);
}

/**
 * Present a staged model (uploaded, dropped, or already open) as a chat
 * bubble with live preview and the follow-up action row (Retexture · Retopo ·
 * Auto-rig · Animate…) — the actions run off the staged sourceAssetCid, so
 * any glTF/GLB with a CID is immediately retopo-able.
 *
 * `assetManifestCid` is null for viewport drops (the model is already in the
 * Studio as an unsaved change) — the bubble's Send button is disabled there.
 * Otherwise the bubble keeps the usual Show-in-Studio behavior against that
 * manifest (re-clicking the button restores the version).
 * @returns the pending generation id
 */
function presentStagedModel({
  name,
  label,
  source,
  assetManifestCid = null,
  recorded = false,
}: {
  name: string;
  label?: string;
  source: { cid: string; path: string; format: string };
  assetManifestCid?: string | null;
  recorded?: boolean;
}): string {
  const prompt = label || `Uploaded: ${name}`;
  const generationId = addPendingGeneration({
    assetManifestCid,
    sourceAssetCid: source.cid,
    prompt,
    format: source.format,
    path: source.path,
    prevAssetManifestCid: null,
    provider: "upload",
    task: "upload",
  });
  // Opening an existing asset is not chat activity — never let the save-time
  // provenance collector write it into a later version's metadata.chat.
  if (recorded) updatePendingGeneration(generationId, { recorded: true });

  // The staged model becomes the active version for typed retexture
  // follow-ups until detached, cleared, or replaced.
  setActiveVersion({
    sourceAssetCid: source.cid,
    manifestCid: assetManifestCid,
    name,
  });

  const assetMessage = addAssetMessage({ prompt, format: source.format });
  if (assetMessage) {
    assetMessages.set(generationId, assetMessage);
    if (assetManifestCid) {
      wireSendButton(generationId, assetMessage);
    } else {
      // Drop path: the model is already in the viewport — nothing to send.
      assetMessage.sendButton.disabled = true;
      assetMessage.sendButton.textContent = "In Studio";
    }
    void attachChatPreview(generationId, assetMessage);
    addFollowupActions(generationId);
  }
  return generationId;
}

/**
 * ASSET_FILE_STAGED entry point (viewport drop, Library upload): present the
 * freshly staged model as an actionable bubble. `assetManifestCid` is null
 * for viewport drops (the model is already in the Studio as an unsaved
 * change) — the bubble's Send button is disabled there.
 * @returns the pending generation id
 */
function presentUploadedModel({
  name,
  source,
  assetManifestCid = null,
}: {
  name: string;
  source: { cid: string; path: string; format: string };
  assetManifestCid?: string | null;
}): string {
  return presentStagedModel({ name, source, assetManifestCid });
}

/**
 * Present an already-open asset's root model as an actionable bubble, so
 * assets that predate chat provenance (or were never generated in-app) still
 * offer Retopo/Retexture/Auto-rig/Animate against the open model. Skipped
 * when the chat already has live bubbles (a fresh generation session) or the
 * tip manifest carries provenance (its history bubbles are actionable).
 */
function presentOpenedAssetModel(manifest: any, manifestCid: string) {
  if (assetMessages.size > 0) return; // live session bubbles already present
  if (manifest?.metadata?.chat?.length) return; // history covers this asset
  const rootNode = (manifest?.scene?.nodes || []).find(
    (n: any) => n.source?.cid && !n.child_ref
  );
  if (!rootNode) return; // composition-only asset — no model to act on
  presentStagedModel({
    name: manifest.name || "Asset",
    label: manifest.name || "Asset",
    source: rootNode.source,
    assetManifestCid: manifestCid,
    recorded: true,
  });
}

// ─── Rig model selector ───

const RIG_MODEL_OPTIONS = [
  { value: "", label: "Auto (recommended)", description: "Humanoid mesh → v1.0 biped rig with 90+ presets. Falls back to v2.5 generic if v1.0 is rejected." },
  { value: "v1.0-20240301", label: "v1.0 Humanoid", description: "Humanoid skeleton, ~65 bones, best quality for bipeds. May be rejected (error 1004) — try v2.5 if so." },
  { value: "v2.5-20260210", label: "v2.5 Generic", description: "Universal skeleton — bipeds, creatures, all body plans. Fewer bones, simpler animations." },
];

/**
 * Build a rig model radio group as a DOM fragment. When `selectedValue`
 * is provided that radio is pre-checked; the caller reads `wrap.dataset.value`.
 */
function buildRigModelSelector(selectedValue = ""): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "rig-model-selector";
  wrap.dataset.value = selectedValue;

  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = "Rig Model";
  label.style.display = "block";
  label.style.marginBottom = "var(--size-1)";
  wrap.appendChild(label);

  for (const opt of RIG_MODEL_OPTIONS) {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.alignItems = "flex-start";
    row.style.gap = "var(--size-2)";
    row.style.padding = "var(--size-1) 0";
    row.style.cursor = "pointer";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "rigModel";
    radio.value = opt.value;
    radio.checked = opt.value === selectedValue;
    radio.addEventListener("change", () => {
      if (radio.checked) wrap.dataset.value = opt.value;
    });

    const text = document.createElement("div");
    const title = document.createElement("span");
    title.style.display = "block";
    title.style.fontWeight = "600";
    title.textContent = opt.label;
    const desc = document.createElement("span");
    desc.style.display = "block";
    desc.style.fontSize = "0.85em";
    desc.style.color = "var(--color-text-secondary, #888)";
    desc.style.marginTop = "2px";
    desc.textContent = opt.description;
    text.appendChild(title);
    text.appendChild(desc);

    row.appendChild(radio);
    row.appendChild(text);
    wrap.appendChild(row);
  }
  return wrap;
}

/**
 * Rig model selector dialog — standalone, used by Auto-rig and retry chips.
 * @param title - dialog title
 * @returns rig model value (empty = auto), or null
 */
function showRigModelDialog(title = "Rig Model"): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const wrap = document.createElement("div");
    const selector = buildRigModelSelector("");
    wrap.appendChild(selector);
    const goBtn = document.createElement("button");
    goBtn.className = "btn btn-primary";
    goBtn.type = "button";
    goBtn.style.marginTop = "var(--size-2)";
    goBtn.textContent = "Continue";
    wrap.appendChild(goBtn);

    // showCustomDialog overwrites wrap.closeDialog with its own —
    // wire the button after the dialog is built.
    showCustomDialog(title, wrap).then((v: any) => {
      resolve(v);
    });

    goBtn.addEventListener("click", () => {
      const val = selector.dataset.value !== undefined ? selector.dataset.value : "";
      // closeDialog was attached by showCustomDialog; calling it
      // resolves the showCustomDialog promise with val and tears down
      // the modal.
      const w = wrap as any;
      if (typeof w.closeDialog === "function") {
        w.closeDialog(val);
      } else {
        resolve(val);
      }
    });
  });
}

/**
 * After a rig-only or animate result where the user did NOT explicitly pick
 * a rig model, offer retry chips with the other model(s). When the user picks
 * one the same operation is re-run with `rigModel` forced.
 */
function maybeAddRigRetryChips(generationId: string, task: "rig" | "animate") {
  const record = getPendingGeneration(generationId);
  if (!record || record.rigModel) return; // user already chose explicitly

  const otherModels = RIG_MODEL_OPTIONS.filter((o) => o.value !== "");
  if (otherModels.length === 0) return;

  const choices = otherModels.map((opt) => ({
    label: `Retry with ${opt.label}`,
    value: opt.value,
  }));

  addChoiceMessage(
    task === "rig"
      ? "Rig didn't come out as expected? Try a different skeleton:"
      : "Animation deformed? Try the other rig model:",
    choices,
    (rigModel) => {
      if (task === "rig") {
        void retryRig(generationId, rigModel as string);
      } else {
        void retryAnimate(generationId, rigModel as string);
      }
    },
  );
}

/**
 * Re-run the auto-rig operation with an explicit rig model.
 */
async function retryRig(generationId: string, rigModel: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;
  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return;
  }
  try { await getOrCreateSession(); } catch {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to rig assets." });
    return;
  }
  const prompt = `Auto-rig (${rigModel === "v1.0-20240301" ? "v1.0 Humanoid" : "v2.5 Generic"})`;
  addChatMessage("user", prompt);
  const { working, signal, onTaskId, onProgress } = addStoppableWorkingMessage("Rigging — checking compatibility, then building the skeleton…");
  const assetName = getAssetName();
  const nodeId = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_rig_${Date.now()}`;
  const prevAssetManifestCid = getActiveAssetManifestCid() || undefined;
  const transformMatrix = buildTransformMatrix();
  try {
    const result = await generateAsset({
      prompt: "Auto-rig",
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      animate: true,
      rigOnly: true,
      rigModel,
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
      signal,
      onTaskId,
      onProgress,
    });
    presentGenerationResult(result, { prompt, provider: "tripo3d", task: "rig", prevAssetManifestCid, transformMatrix, rigModel });
    dismissCreatePulse();
    refreshProviderBalance({ force: true });
  } catch (err) {
    if (isGenerationCancelled(err)) { addChatMessage("system", "Auto-rig stopped."); return; }
    console.error("Retry auto-rig failed:", err);
    let userMsg = "Rigging failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.code === "MODEL_NOT_RIGGABLE") userMsg = "This model isn't riggable.";
      else if (err.message) userMsg = err.message;
    }
    addChatMessage("system", userMsg);
  } finally { working?.remove(); }
}

/**
 * Re-run the animate operation with an explicit rig model. Prompts the
 * user for presets again (may differ per skeleton).
 */
async function retryAnimate(generationId: string, rigModel: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;
  // Reuse onAnimate with the rig model pre-selected but still let the user
  // pick presets via the dialog — we pass rigModel to force it.
  // For simplicity, re-trigger onAnimate with rigModel forced.
  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return;
  }
  try { await getOrCreateSession(); } catch {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to animate assets." });
    return;
  }
  // Show just the preset picker (no rig model selector — we already know it)
  const picked = await showCheckboxDialog(
    "Retry Animate",
    `Using ${rigModel === "v1.0-20240301" ? "v1.0 Humanoid" : "v2.5 Generic"} rig. Pick up to 5 animations:`,
    ANIMATE_PRESETS,
    { max: 5 },
  );
  if (!picked) return;
  const animateInPlace = picked.includes(IN_PLACE_OPTION);
  const animations = picked.filter((p: string) => p !== IN_PLACE_OPTION);
  if (animations.length === 0) return;

  const labels = animations.map((p: string) => animatePresetLabel(p)).join(", ");
  const prompt = `Animate: ${labels} (${rigModel === "v1.0-20240301" ? "v1.0" : "v2.5"})`;
  addChatMessage("user", prompt);
  const { working, signal, onTaskId, onProgress } = addStoppableWorkingMessage("Rigging and animating — this chains three Tripo tasks and takes a few minutes…");
  const assetName = getAssetName();
  const nodeId = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_anim_${Date.now()}`;
  const prevAssetManifestCid = getActiveAssetManifestCid() || undefined;
  const transformMatrix = buildTransformMatrix();
  try {
    const result = await generateAsset({
      prompt: `Animate: ${labels}`,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      sourceTaskId: record.backendTaskId,
      animate: true,
      animations,
      rigModel,
      ...(animateInPlace && { animateInPlace: true }),
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
      signal,
      onTaskId,
      onProgress,
    });
    presentGenerationResult(result, { prompt, provider: "tripo3d", task: "animate", prevAssetManifestCid, transformMatrix, rigModel });
    dismissCreatePulse();
    refreshProviderBalance({ force: true });
  } catch (err) {
    if (isGenerationCancelled(err)) { addChatMessage("system", "Animation stopped."); return; }
    console.error("Retry animate failed:", err);
    let userMsg = "Animation failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.code === "MODEL_NOT_RIGGABLE") userMsg = "This model isn't riggable with the chosen skeleton.";
      else if (err.message) userMsg = err.message;
    }
    addChatMessage("system", userMsg);
  } finally { working?.remove(); }
}

/**
 * Polygon-budget dialog for retopo. Returns the face limit, undefined for
 * adaptive, or null when cancelled.
 */
function showFaceLimitDialog(): Promise<number | undefined | null> {
  return new Promise<number | undefined | null>((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p style="margin:0 0 var(--size-2)">Target polygon count (500–20,000 triangles). Leave empty for adaptive — adaptive is aggressive and can melt faces.</p>
      <div class="form-group">
        <label class="form-label" for="faceLimitInput">Polygon budget</label>
        <input id="faceLimitInput" class="form-control" type="number" min="500" max="20000" step="100" value="20000">
      </div>
      <button id="faceLimitGo" class="btn btn-primary" type="button" style="margin-top:var(--size-2)">Retopo</button>`;
    const input = wrap.querySelector("#faceLimitInput") as HTMLInputElement;
    (wrap.querySelector("#faceLimitGo") as HTMLElement).addEventListener("click", () => {
      const w = wrap as any;
      const raw = input.value.trim();
      if (raw === "") { w.closeDialog(undefined); return; } // adaptive
      const n = Number(raw);
      w.closeDialog(Number.isInteger(n) && n >= 500 && n <= 20000 ? n : 20000);
    });
    showCustomDialog("Retopo — polygon budget", wrap).then(resolve);
  });
}

/**
 * Texture prompt dialog for retexture. Returns the trimmed prompt, or null
 * when cancelled or left empty.
 */
function showTexturePromptDialog(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <p style="margin:0 0 var(--size-2)">Describe the new texture/material. Geometry stays unchanged.</p>
      <div class="form-group">
        <label class="form-label" for="texturePromptInput">Texture prompt</label>
        <textarea id="texturePromptInput" class="form-control" rows="3" placeholder="weathered bronze with a verdigris patina"></textarea>
      </div>
      <button id="texturePromptGo" class="btn btn-primary" type="button" style="margin-top:var(--size-2)">Retexture</button>`;
    const input = wrap.querySelector("#texturePromptInput") as HTMLTextAreaElement;
    (wrap.querySelector("#texturePromptGo") as HTMLElement).addEventListener("click", () => {
      (wrap as any).closeDialog(input.value.trim() || null);
    });
    showCustomDialog("Retexture — texture prompt", wrap).then(resolve);
  });
}

/**
 * Retexture a generation bubble: texture prompt dialog → texture-only
 * refine of the bubble's GLB → new chat bubble.
 */
async function onRetexture(generationId: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;
  const texturePrompt = await showTexturePromptDialog();
  if (!texturePrompt) return;
  if (!walletState.get().walletAddress) { alert("Please log in or sign up first."); return; }
  try { await getOrCreateSession(); } catch {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to retexture assets." });
    return;
  }
  addChatMessage("user", `Retexture: ${texturePrompt}`);
  const { working, signal, onTaskId, onProgress } = addStoppableWorkingMessage("Retexturing — this takes a minute or two…");
  const assetName = getAssetName();
  const nodeId = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_retex_${Date.now()}`;
  const prevAssetManifestCid = getActiveAssetManifestCid() || undefined;
  const transformMatrix = buildTransformMatrix();
  try {
    const result = await generateAsset({
      prompt: texturePrompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      retexture: true,
      textureQuality: getTextureQuality(),
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
      signal,
      onTaskId,
      onProgress,
    });
    presentGenerationResult(result, { prompt: `Retexture: ${texturePrompt}`, provider: "tripo3d", task: "texture", prevAssetManifestCid, transformMatrix });
    dismissCreatePulse();
    refreshProviderBalance({ force: true });
  } catch (err) {
    if (isGenerationCancelled(err)) {
      addChatMessage("system", "Retexture stopped.");
    } else {
      console.error("Retexture failed:", err);
      addChatMessage("system", err instanceof ApiError && err.message ? err.message : "Retexture failed. Please try again.");
    }
  } finally {
    working?.remove();
  }
}

/**
 * Smart retopology: rebuild a completed Tripo3D generation with clean
 * topology and baked textures (Tripo mesh/decimate v2.0). The retopo'd model
 * lands as a new chat bubble and can itself be rigged & animated — clean
 * topology deforms far better than raw generation output.
 */
async function onRetopo(generationId: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;

  const faceLimit = await showFaceLimitDialog();
  if (faceLimit === null) return; // cancelled

  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return;
  }
  try {
    await getOrCreateSession();
  } catch {
    showToast({
      type: "warning",
      title: "Sign In Required",
      message: "Sign in to retopo assets.",
    });
    return;
  }

  const prompt = "Retopo for animation";
  addChatMessage("user", prompt);
  const { working, signal, onTaskId, onProgress } = addStoppableWorkingMessage(
    "Rebuilding topology — this takes a minute or two…",
  );

  const assetName = getAssetName();
  const nodeId = `${assetName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_retopo_${Date.now()}`;
  const prevAssetManifestCid =
    getActiveAssetManifestCid() || undefined;
  const transformMatrix = buildTransformMatrix();

  try {
    const result = await generateAsset({
      prompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      retopo: true,
      ...(faceLimit && { faceLimit }),
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
      signal,
      onTaskId,
      onProgress,
    });

    presentGenerationResult(result, {
      prompt,
      provider: "tripo3d",
      task: "retopo",
      prevAssetManifestCid,
      transformMatrix,
    });
    dismissCreatePulse();
    // Retopo consumed credits — refresh the caption.
    refreshProviderBalance({ force: true });
  } catch (err) {
    if (isGenerationCancelled(err)) {
      addChatMessage("system", "Retopo stopped.");
      return;
    }
    console.error("Retopo failed:", err);
    let userMsg = "Retopo failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.status === 401) {
        userMsg = "Invalid Tripo3D API key. Check your key in the provider settings.";
      } else if (err.status === 402) {
        userMsg = "Tripo3D account has insufficient credits.";
      } else if (err.code === "GENERATION_TIMEOUT") {
        userMsg = "Retopo timed out. Try again later.";
      } else if (err.message) {
        userMsg = err.message;
      }
    } else if ((err as any).message) {
      userMsg = (err as any).message;
    }
    addChatMessage("system", userMsg);
  } finally {
    working?.remove();
  }
}

/**
 * Auto-rig a generation bubble (no animation): backend rig-check → rig →
 * Rigged-GLB chat bubble (Tripo-native skeleton). The rigged result keeps the Animate action,
 * which then takes the retarget-only path.
 */
async function onAutoRig(generationId: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;
  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return;
  }
  try {
    await getOrCreateSession();
  } catch {
    showToast({ type: "warning", title: "Sign In Required", message: "Sign in to rig assets." });
    return;
  }
  const rigModel = await showRigModelDialog("Auto-rig — rig model");
  if (rigModel === null) return; // cancelled
  const prompt = "Auto-rig";
  addChatMessage("user", prompt);
  const { working, signal, onTaskId, onProgress } = addStoppableWorkingMessage("Rigging — checking compatibility, then building the skeleton…");
  const assetName = getAssetName();
  const nodeId = `${assetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_rig_${Date.now()}`;
  const prevAssetManifestCid = getActiveAssetManifestCid() || undefined;
  const transformMatrix = buildTransformMatrix();
  try {
    const result = await generateAsset({
      prompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      animate: true,
      rigOnly: true,
      ...(rigModel && { rigModel }),
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
      signal,
      onTaskId,
      onProgress,
    });
    const rigResultId = presentGenerationResult(result, { prompt, provider: "tripo3d", task: "rig", prevAssetManifestCid, transformMatrix, rigModel: rigModel || undefined });
    dismissCreatePulse();
    refreshProviderBalance({ force: true });
    maybeAddRigRetryChips(rigResultId, "rig");
  } catch (err) {
    if (isGenerationCancelled(err)) {
      addChatMessage("system", "Auto-rig stopped.");
      return;
    }
    console.error("Auto-rig failed:", err);
    let userMsg = "Rigging failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.code === "MODEL_NOT_RIGGABLE") {
        userMsg = "This model isn't riggable. Generate a full-body humanoid or creature (T-pose works best) and try again.";
      } else if (err.status === 401) {
        userMsg = "Invalid Tripo3D API key. Check your key in the provider settings.";
      } else if (err.status === 402) {
        userMsg = "Tripo3D account has insufficient credits.";
      } else if (err.message) {
        userMsg = err.message;
      }
    }
    addChatMessage("system", userMsg);
  } finally {
    working?.remove();
  }
}

/**
 * Rig & animate a generation bubble: preset picker → backend animate chain
 * (rig-check → rig → retarget, or retarget-only on an already-rigged bubble
 * via sourceTaskId) → animated GLB chat bubble.
 */
async function onAnimate(generationId: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;

  // Combined dialog: rig model selector + preset checkboxes + in-place toggle
  const dialogResult = await new Promise<
    { presets: string[]; rigModel: string | null } | undefined
  >((resolve) => {
    const wrap = document.createElement("div");
    // Single scroll region sized to fit INSIDE the dialog shell (which caps
    // at 100vh − 2×--size-10 and keeps its header/actions pinned). Without
    // this the content overflows the dialog's scroll box and the focus-on-
    // open scroll clips the title off the top. 190px ≈ header + actions +
    // body padding.
    wrap.style.maxHeight = "calc(100vh - var(--size-10) * 2 - 190px)";
    wrap.style.overflowY = "auto";

    // Rig model selector
    const selector = buildRigModelSelector("");
    wrap.appendChild(selector);

    // Separator
    const sep = document.createElement("hr");
    sep.style.margin = "var(--size-2) 0";
    sep.style.border = "none";
    sep.style.borderTop = "1px solid var(--color-border, #444)";
    wrap.appendChild(sep);

    // Preset checkboxes, grouped by category. The wrap above is the single
    // scroll region — the list itself renders fully.
    const presetHint = document.createElement("p");
    presetHint.style.margin = "0 0 var(--size-1)";
    presetHint.textContent = "Pick up to 5 animations:";
    wrap.appendChild(presetHint);

    const groupsWrap = document.createElement("div");
    wrap.appendChild(groupsWrap);

    const boxes: Array<{ input: HTMLInputElement; value: string; counts: boolean }> = [];
    const addPresetRow = (
      opt: { value: string; label: string; checked?: boolean; countsTowardMax?: boolean },
      container: HTMLElement
    ) => {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.alignItems = "center";
      label.style.gap = "var(--size-2)";
      label.style.padding = "var(--size-1) 0";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = opt.value;
      input.checked = !!opt.checked;
      const counts = opt.countsTowardMax !== false;
      input.addEventListener("change", () => {
        const checkedCount = boxes.filter((b) => b.input.checked && b.counts).length;
        if (checkedCount > 5) input.checked = false;
      });
      const text = document.createElement("span");
      text.textContent = opt.label;
      label.appendChild(input);
      label.appendChild(text);
      container.appendChild(label);
      boxes.push({ input, value: opt.value, counts });
    };

    for (const group of ANIMATE_PRESET_GROUPS) {
      const header = document.createElement("div");
      header.textContent = group.category;
      header.style.fontSize = "var(--font-size-0)";
      header.style.fontWeight = "var(--font-weight-7)";
      header.style.color = "var(--dim-fg)";
      header.style.textTransform = "uppercase";
      header.style.letterSpacing = "0.06em";
      header.style.marginTop = "var(--size-2)";
      groupsWrap.appendChild(header);
      for (const opt of group.presets) addPresetRow(opt, groupsWrap);
    }

    // The in-place toggle lives below the scrollable list — always visible.
    addPresetRow(IN_PLACE_PRESET, wrap);

    const goBtn = document.createElement("button");
    goBtn.className = "btn btn-primary";
    goBtn.type = "button";
    goBtn.style.marginTop = "var(--size-2)";
    goBtn.textContent = "Animate";
    wrap.appendChild(goBtn);

    // showCustomDialog overwrites wrap.closeDialog — wire the button
    // after the dialog is built so we call the real closeDialog.
    showCustomDialog("Rig & Animate", wrap).then((v: any) => {
      resolve(v);
    });

    goBtn.addEventListener("click", () => {
      const presets = boxes.filter((b) => b.input.checked).map((b) => b.value);
      const rigModelVal = selector.dataset.value || "";
      const result = { presets, rigModel: rigModelVal || null };
      const w = wrap as any;
      if (typeof w.closeDialog === "function") {
        w.closeDialog(result);
      } else {
        resolve(result);
      }
    });
  }
  );

  if (!dialogResult) return;
  const { presets, rigModel } = dialogResult;
  const animateInPlace = presets.includes(IN_PLACE_OPTION);
  const animations = presets.filter((p) => p !== IN_PLACE_OPTION);
  if (animations.length === 0) return;

  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return;
  }
  try {
    await getOrCreateSession();
  } catch {
    showToast({
      type: "warning",
      title: "Sign In Required",
      message: "Sign in to animate assets.",
    });
    return;
  }

  const labels = animations.map((p) => animatePresetLabel(p)).join(", ");
  const prompt = `Animate: ${labels}`;
  addChatMessage("user", prompt);
  const { working, signal, onTaskId, onProgress } = addStoppableWorkingMessage(
    "Rigging and animating — this chains three Tripo tasks and takes a few minutes…",
  );

  const assetName = getAssetName();
  const nodeId = `${assetName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_anim_${Date.now()}`;
  const prevAssetManifestCid =
    getActiveAssetManifestCid() || undefined;
  const transformMatrix = buildTransformMatrix();

  try {
    const result = await generateAsset({
      prompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      sourceAssetCid: record.sourceAssetCid,
      sourceTaskId: record.backendTaskId,
      animate: true,
      animations: animations,
      ...(animateInPlace && { animateInPlace: true }),
      ...(rigModel && { rigModel }),
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
      signal,
      onTaskId,
      onProgress,
    });

    const animResultId = presentGenerationResult(result, {
      prompt,
      provider: "tripo3d",
      task: "animate",
      prevAssetManifestCid,
      transformMatrix,
      rigModel: rigModel || undefined,
    });
    dismissCreatePulse();
    // Rig + retarget consumed credits — refresh the caption.
    refreshProviderBalance({ force: true });
    maybeAddRigRetryChips(animResultId, "animate");
  } catch (err) {
    if (isGenerationCancelled(err)) {
      addChatMessage("system", "Animation stopped.");
      return;
    }
    console.error("Animate failed:", err);
    let userMsg = "Animation failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.code === "MODEL_NOT_RIGGABLE") {
        userMsg =
          "This model isn't riggable. Generate a full-body humanoid or creature (T-pose works best) and try again.";
      } else if (err.status === 401) {
        userMsg = "Invalid Tripo3D API key. Check your key in the provider settings.";
      } else if (err.status === 402) {
        userMsg = "Tripo3D account has insufficient credits.";
      } else if (err.code === "GENERATION_TIMEOUT") {
        userMsg = "Animation timed out. Try again later.";
      } else if (err.message) {
        userMsg = err.message;
      }
    } else if ((err as any).message) {
      userMsg = (err as any).message;
    }
    addChatMessage("system", userMsg);
  } finally {
    working?.remove();
  }
}

async function onGenerate() {
  const prompt = promptInput.value.trim();
  if (!prompt && attachedImages.length === 0) return;

  // attachedImages is canonical-sorted, so [0] is always the front view.
  const frontImage = attachedImages[0] || null;
  const multiview = attachedImages.length > 1;

  // Image-only generations get a synthesized prompt so chat history,
  // manifest provenance, and display names all carry meaningful text.
  const effectivePrompt =
    prompt ||
    (multiview
      ? `Images: ${frontImage.name} + ${attachedImages.length - 1} views`
      : frontImage
        ? `Image: ${frontImage.name}`
        : "");
  // Wire contract: 1 image → legacy imageData/imageMime; 2+ → images array
  // of {imageData, imageMime, view} in canonical view order (imageName rides
  // along for the manifest but is stripped from the POST body by api.js).
  const imagePayload = multiview
    ? {
        // Entries always carry base64/mime/name/dataUrl (set by attachImageFiles).
        images: attachedImages.map((img) => ({
          imageData: img.base64,
          imageMime: img.mime,
          imageName: img.name,
          view: img.view,
        })),
      }
    : frontImage
      ? {
          imageData: frontImage.base64,
          imageMime: frontImage.mime,
          imageName: frontImage.name,
        }
      : null;

  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return;
  }

  // Ensure authenticated before payment so sign popup comes first
  try {
    await getOrCreateSession();
  } catch {
    showToast({
      type: "warning",
      title: "Sign In Required",
      message: "Sign in to generate assets.",
    });
    return;
  }

  if (imagePayload) {
    // Show the reference image(s) in the chat, not just filenames — a grid
    // bubble with per-view captions for multiview, the single image as today.
    if (multiview) {
      addImageMessage("user", frontImage.dataUrl as string, effectivePrompt, {
        images: attachedImages.map((img) => ({
          src: img.dataUrl || "",
          caption: VIEW_LABELS[img.view] || img.view,
        })),
      });
    } else {
      addImageMessage(
        "user",
        `data:${imagePayload.imageMime};base64,${imagePayload.imageData}`,
        effectivePrompt,
      );
    }
  } else {
    addChatMessage("user", effectivePrompt);
  }
  promptInput.value = "";
  promptInput.style.height = "auto";
  clearAttachedImage();

  setGenerating(true);
  // Stop button only makes sense for async providers — the mock returns
  // synchronously, so there is nothing to cancel.
  const stoppable = isRealProvider()
    ? addStoppableWorkingMessage("Carving your model…")
    : null;
  const working = stoppable?.working ?? addWorkingMessage("Carving your model…");

  const assetName = getAssetName();
  const nodeId = `${assetName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_${Date.now()}`;
  const prevAssetManifestCid =
    getActiveAssetManifestCid() || undefined;
  const transformMatrix = buildTransformMatrix();

  try {
    const tier = getTier();
    const provider = getProvider();
    const providerKey = getByokKey();

    // Real providers require a BYOK key; mock does not. A missing key opens
    // the key dialog directly — a guided flow, not a dead-end toast.
    if (isRealProvider() && providerKey.length === 0) {
      showProviderKeyDialog();
      setGenerating(false);
      return;
    }

    // Typed follow-ups retexture the active version (texture/material only —
    // geometry unchanged). Detach, Clear Chat, or an attached image starts fresh.
    const retextureSource =
      provider === "tripo3d" && activeVersion && !imagePayload
        ? activeVersion
        : null;
    if (retextureSource) {
      addChatMessage("system", `Refining "${retextureSource.name}" (texture/material only — geometry unchanged)…`);
    }

    const result = await generateAsset({
      prompt: effectivePrompt,
      nodeId,
      txHash: null as any,
      provider,
      prevAssetManifestCid,
      transformMatrix,
      tier,
      ...(isRealProvider() && { providerKey }),
      ...(retextureSource && { sourceAssetCid: retextureSource.sourceAssetCid, retexture: true }),
      ...(imagePayload && (imagePayload as any)),
      ...(provider === "tripo3d" && { textureQuality: getTextureQuality() }),
      ...(stoppable && { signal: stoppable.signal, onTaskId: stoppable.onTaskId, onProgress: stoppable.onProgress }),
    });

    // Defer the Studio viewport load: register the result, show an asset
    // bubble with a live preview, and let the user send it explicitly.
    presentGenerationResult(result, {
      prompt: effectivePrompt,
      provider,
      task: retextureSource ? "texture" : "model",
      prevAssetManifestCid,
      transformMatrix,
    });
    dismissCreatePulse();
    // A completed generation consumed credits — refresh the caption.
    refreshProviderBalance({ force: true });
  } catch (err) {
    if (isGenerationCancelled(err)) {
      addChatMessage("system", "Generation stopped.");
      return;
    }
    console.error("Generation failed:", err);
    let userMsg = "Generation failed. Please try again.";

    if (err instanceof ApiError) {
      if (err.status === 400) {
        userMsg = err.message || "Missing required generation parameter.";
      } else if (err.status === 429) {
        userMsg = "Rate limit reached. Please wait before generating again.";
      } else if (err.status === 401) {
        userMsg = "Invalid Tripo3D API key. Check your key in the provider settings.";
      } else if (err.status === 402) {
        userMsg = "Tripo3D account has insufficient credits.";
      } else if (err.status === 504 || err.code === "GENERATION_TIMEOUT") {
        userMsg = "Generation timed out. Try again later.";
      } else if (err.message) {
        userMsg = err.message;
      }
    } else if ((err as any).message) {
      userMsg = (err as any).message;
    }

    addChatMessage("system", userMsg);
  } finally {
    working?.remove();
    setGenerating(false);
  }
}

// ─── Event Bindings ───

generateBtn.addEventListener("click", onGenerate);

clearChatBtn?.addEventListener("click", clearChat);

promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    onGenerate();
  }
});

promptInput.addEventListener("input", () => {
  promptInput.style.height = "auto";
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + "px";
});

// Asset identity (manifest asset_id) of the currently open scene. The AI
// chat fully resets when the open asset changes — generations, refine
// chains, animate choices, and attached images never leak across assets.
let openAssetIdentity: string | null = null;

on(EVENTS.SCENE_READY, (event: any) => {
  // Opening/restoring an asset never set activeAssetName — adopt the
  // manifest's name so auto-saves and publish keep it instead of
  // "Untitled Asset" (default/absent names are ignored inside).
  adoptManifestName(event?.manifest);
  const name = event?.manifest?.name || getActiveAssetName();
  if (name) syncAssetNameDisplay(name);
  const manifestCid =
    event?.manifestCid || getActiveAssetManifestCid();
  const identity = event?.manifest?.asset_id || manifestCid || null;
  const identityChanged = !!(identity && identity !== openAssetIdentity);
  if (identityChanged && openAssetIdentity) {
    clearChat();
  }
  if (identity) openAssetIdentity = identity;
  if (manifestCid) void renderChatProvenance(manifestCid);
  // An asset that was opened (not generated/uploaded this session) gets an
  // actionable bubble for its root model — otherwise the panel offers no
  // follow-up actions for pre-existing assets.
  if (identityChanged && manifestCid && event?.manifest?.type === "asset") {
    presentOpenedAssetModel(event.manifest, manifestCid);
  }
});

on(EVENTS.ASSET_DRAFT_SAVED, () => {
  const manifestCid = getActiveAssetManifestCid();
  if (manifestCid) void renderChatProvenance(manifestCid);
});

// Viewport file drop / Library upload: present the staged model as an
// actionable chat bubble (Retopo et al. run off its sourceAssetCid).
on(EVENTS.ASSET_FILE_STAGED, (detail: any) => {
  if (detail?.source?.cid) presentUploadedModel(detail);
});

on(EVENTS.ASSET_PUBLISHED, () => {
  const manifestCid = getActiveAssetManifestCid();
  if (manifestCid) void renderChatProvenance(manifestCid);
});

on(EVENTS.SCENE_EMPTY, () => {
  syncAssetNameDisplay();
  openAssetIdentity = null;
  setActiveVersion(null);
  // Full reset on new asset — but stay quiet when there is no live session
  // to clear (e.g. initial page load on an empty scene).
  const hasLiveChat = !!document.querySelector(
    "#chatHistoryList .chat-bubble:not(.chat-bubble-history)",
  );
  if (hasLiveChat) clearChat();
  else clearHistoryBubbles();
});

// History-version bubble clicked: load that version of the current asset
// from the manifest chain and make it the active version for retexture.
on(EVENTS.HISTORY_VERSION_SELECTED, async ({ cid, sourceCid, name }: { cid: string; sourceCid?: string; name?: string }) => {
  // The chat IS the version history: restoring an older version must not
  // truncate it. loadAssetManifest(oldCid) triggers SCENE_READY, whose
  // listeners re-root both the chat provenance (renderChatProvenance) and
  // latestAssetManifestCid (version-history-store) at the OLD cid — hiding
  // every newer prompt and breaking repeated restores. Capture the chain
  // root up front and put both back once the load lands.
  const previousLatestCid = getLatestAssetManifestCid() || cid;
  try {
    setActiveManifestCid(cid);
    await loadAssetManifest(cid);
    setLatestManifestCid(previousLatestCid);
    await renderChatProvenance(previousLatestCid);
    if (sourceCid) setActiveVersion({ sourceAssetCid: sourceCid, manifestCid: cid, name: name || "" });
    else setActiveVersion(null); // chat-less version (e.g. parametric edit) — no retexture target
  } catch (err) {
    console.error("Version restore failed:", err);
    addChatMessage("system", "Could not load that version.");
  }
});

// A history bubble backed by a Tripo3D GLB version gets the same follow-up
// action row as a live generation bubble. chat-history registered the
// pending-generation record and tagged the bubble with data-generation-id.
on(EVENTS.HISTORY_VERSION_ACTIONABLE, ({ generationId }: { generationId: string }) => {
  const bubble = document.querySelector(
    `.chat-bubble-version[data-generation-id="${generationId}"]`,
  );
  if (bubble) addFollowupActions(generationId, bubble as HTMLElement);
});

on(EVENTS.WALLET_CONNECTED, () => {
  updateGenerateHint();
  syncCollectionSelect();
  refreshProviderBalance();
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  updateGenerateHint();
  refreshProviderBalance();
});

syncAssetNameDisplay();
updateGenerateHint();
syncProviderUI();
syncImageAttachUI();

// Initialize collection select on load if wallet is already connected
if (walletState.get().walletAddress) {
  syncCollectionSelect();
}

// ─── Exports ───
export { addChatMessage };
