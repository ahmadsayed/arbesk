/**
 * AI Generation sidebar controller.
 * @remarks Generation runs session auth → backend generation → chat bubble
 *   with a live preview → explicit "Show in Studio".
 */

import {
  loadAssetManifest,
  clearScene,
  dismissCreatePulse,
} from "../engine/scene-graph.ts";
import { showToast } from "./toasts.ts";
import { showCustomDialog, showCheckboxDialog } from "./dialog.ts";
import { addChatMessage, addAssetMessage, addWorkingMessage, addImageMessage, clearChatMessages, addAssetActionRow, addChoiceMessage, registerAssetSendHandler } from "./chat-messages.ts";
import type { AssetMessageHandle, WorkingMessageHandle } from "./chat-messages.ts";
import { Alpine } from "./alpine.ts";
import { followupActionsFor } from "@arbesk/asset-core/domain/generation-actions.js";
import type { FollowupAction } from "@arbesk/asset-core/domain/generation-actions.js";
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
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import {
  addPendingGeneration,
  getPendingGeneration,
  updatePendingGeneration,
  _resetPendingGenerations,
} from "../state/pending-generations.ts";
import { deriveDefaultCollectionId, identityMatrix } from "@arbesk/asset-core/utils/collections.js";
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
} from "@arbesk/asset-core/domain/asset.js";
import { selectCollection } from "@arbesk/asset-core/domain/collection.js";

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
 * Returns true when the selected provider is real (non-mock).
 * @remarks Real providers require a BYOK key; the mock provider does not.
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
 * Fetches the Tripo3D credit balance and updates the caption(s).
 * @remarks Stale responses (key changed mid-flight) are dropped.
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
 * Refreshes the Tripo3D credit-balance caption.
 * @remarks Debounced and cached per key. Hidden for the mock provider, with
 *   no key set, or with no wallet connected (fetching would trigger a
 *   sign-in prompt).
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
 * Syncs the attach button; it only applies to Tripo3D (image-to-3D).
 * @remarks Switching back to the mock provider hides it and discards attached
 *   images.
 */
function syncImageAttachUI() {
  const enabled = getProvider() === "tripo3d";
  if (imageAttachBtn) imageAttachBtn.hidden = !enabled;
  if (!enabled) clearAttachedImage();
}

/**
 * Re-renders the chip row from attachedImages in canonical view order.
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
 * Reads, validates, and adds image files to the set (up to 4).
 * @remarks Invalid files are rejected with a toast; a selection that would
 *   exceed 4 views is rejected wholesale.
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
 * Builds the key dialog body (password input, show/hide toggle, Clear Key).
 * @remarks All markup is static — no user content is injected.
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
 * Populates the collection dropdown.
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
 * Active version for typed-prompt retexture.
 * @remarks Set on generation result, Show-in-Studio, and bubble/history
 *   restore; cleared by detach, Clear Chat, and asset switch. The GLB CID is
 *   the durable reference — no expiry.
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
 * Clears the chat: disposes live previews, resets pending generations and
 * bubble handles, and breaks the refine chain so the next generation starts
 * fresh.
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
  // The asset bubble is rendered by Alpine's x-for on the next tick; wait for
  // the <canvas> to exist before mounting the Babylon preview onto it.
  await Alpine.nextTick();
  const canvas = assetMessage.canvas;
  if (!canvas) {
    assetMessage.markFallback();
    return;
  }
  const handle = await createChatPreview(
    generationId,
    canvas,
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
 * Sends a pending generation to the Studio viewport.
 * @remarks `restore=true` preserves the manifest-chain tip across the load so
 *   auto-save chains onto the prior tip instead of forking at the older
 *   version.
 */
async function sendGenerationToStudio(
  generationId: string,
  assetMessage: AssetMessageHandle,
  { restore = false }: { restore?: boolean } = {}
) {
  const record = getPendingGeneration(generationId);
  if (!record || record.status !== "pending") return;

  updatePendingGeneration(generationId, { status: "sent" });
  assetMessage.setSendDisabled(true);

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
    assetMessage.setSendDisabled(false);
    addChatMessage(
      "system",
      (err as Error).message || "Failed to load the model in the Studio."
    );
  }
}

/**
 * Re-sends an already-sent generation to the Studio when Show in Studio is
 * re-clicked.
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
 * Returns true for a user-initiated cancel.
 * @remarks Call sites surface a neutral message instead of the error mapping.
 */
function isGenerationCancelled(err: unknown): boolean {
  return err instanceof ApiError && err.code === "GENERATION_CANCELLED";
}

/**
 * Shows the stop confirmation dialog; resolves true only via the Stop button.
 * @remarks Spent credits are not refunded — the warning is the point.
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
 * Confirms stopping an in-flight generation, then aborts polling and evicts
 * the backend task.
 * @remarks The upstream cancel is best-effort; the registry TTL sweeps the
 *   entry regardless.
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

/**
 * Shared pre-flight for the follow-up actions: wallet connected (else alert)
 * and session established (else a sign-in toast naming the action).
 */
async function ensureFollowupGates(action: string): Promise<boolean> {
  if (!walletState.get().walletAddress) {
    alert("Please log in or sign up first.");
    return false;
  }
  try {
    await getOrCreateSession();
  } catch {
    showToast({
      type: "warning",
      title: "Sign In Required",
      message: `Sign in to ${action} assets.`,
    });
    return false;
  }
  return true;
}

/**
 * nodeId for a follow-up generation: asset-name slug + action suffix + ts.
 */
function followupNodeId(suffix: string): string {
  const assetName = getAssetName();
  return `${assetName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${suffix}_${Date.now()}`;
}

/**
 * Shared follow-up prologue: post the user prompt, open a stoppable working
 * bubble, and gather the save-context fields every follow-up generateAsset
 * call needs.
 */
function beginFollowup(prompt: string, workingText: string, kind: string) {
  addChatMessage("user", prompt);
  const { working, signal, onTaskId, onProgress } =
    addStoppableWorkingMessage(workingText);
  return {
    working,
    signal,
    onTaskId,
    onProgress,
    nodeId: followupNodeId(kind),
    prevAssetManifestCid: getActiveAssetManifestCid() || undefined,
    transformMatrix: buildTransformMatrix(),
  };
}

/**
 * Maps a follow-up error to user-facing copy.
 * @remarks The option flags select which canned messages apply
 *   (notRiggable, timeout, auth, passThroughMessage).
 */
function followupErrorMessage(
  err: unknown,
  fallback: string,
  {
    notRiggable,
    timeout,
    auth = false,
    passThroughMessage = false,
  }: {
    notRiggable?: string;
    timeout?: string;
    auth?: boolean;
    passThroughMessage?: boolean;
  } = {}
): string {
  if (err instanceof ApiError) {
    if (notRiggable && err.code === "MODEL_NOT_RIGGABLE") return notRiggable;
    if (auth) {
      if (err.status === 401) {
        return "Invalid Tripo3D API key. Check your key in the provider settings.";
      }
      if (err.status === 402) {
        return "Tripo3D account has insufficient credits.";
      }
    }
    if (timeout && err.code === "GENERATION_TIMEOUT") return timeout;
    if (err.message) return err.message;
    return fallback;
  }
  if (passThroughMessage && (err as any).message) return (err as any).message;
  return fallback;
}

/** Guidance shown when Tripo rejects a model as not riggable. */
const NOT_RIGGABLE_GUIDANCE =
  "This model isn't riggable. Generate a full-body humanoid or creature (T-pose works best) and try again.";

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
 * Wires a bubble's Show in Studio button.
 * @remarks The only way a bubble's model enters the Studio (the preview is
 *   orbit-only); re-clicking a sent bubble restores that version.
 */
function wireSendButton(generationId: string, assetMessage: AssetMessageHandle) {
  registerAssetSendHandler(generationId, (id) => {
    const record = getPendingGeneration(id);
    if (record?.status === "sent") void restoreGeneration(id);
    else void sendGenerationToStudio(id, assetMessage);
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

  const assetMessage = addAssetMessage({ prompt, format: result.format, generationId });
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
 * Attaches the version-card action row to a generation bubble.
 * @remarks Each action runs against the bubble's own GLB (sourceAssetCid), so
 *   any bubble stays actionable indefinitely.
 */
function addFollowupActions(generationId: string, _bubbleEl: HTMLElement | null = null) {
  const record = getPendingGeneration(generationId);
  if (!record) return;
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
  addAssetActionRow(generationId, actions);
}

/**
 * Presents a staged model (uploaded, dropped, or already open) as an
 * actionable chat bubble with a live preview.
 * @remarks Actions run off the staged sourceAssetCid. `assetManifestCid` is
 *   null for viewport drops, where the Send button is disabled.
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

  const assetMessage = addAssetMessage({ prompt, format: source.format, generationId });
  if (assetMessage) {
    assetMessages.set(generationId, assetMessage);
    if (assetManifestCid) {
      wireSendButton(generationId, assetMessage);
    } else {
      // Drop path: the model is already in the viewport — nothing to send.
      assetMessage.setSendDisabled(true);
      assetMessage.setSendLabel("In Studio");
    }
    void attachChatPreview(generationId, assetMessage);
    addFollowupActions(generationId);
  }
  return generationId;
}

/**
 * Presents a freshly staged model (viewport drop or Library upload) as an
 * actionable bubble.
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
 * Presents an already-open asset's root model as an actionable bubble so
 * assets that predate chat provenance still offer follow-up actions.
 * @remarks Skipped when the chat already has live bubbles or the tip manifest
 *   carries provenance.
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
 * Builds a rig model radio group as a DOM fragment.
 * @remarks The caller reads the selection back from `wrap.dataset.value`.
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
 * Shows the rig model selector dialog.
 * @returns the rig model value (empty = auto), or null.
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
  if (!(await ensureFollowupGates("rig"))) return;
  const prompt = `Auto-rig (${rigModel === "v1.0-20240301" ? "v1.0 Humanoid" : "v2.5 Generic"})`;
  const { working, signal, onTaskId, onProgress, nodeId, prevAssetManifestCid, transformMatrix } =
    beginFollowup(prompt, "Rigging — checking compatibility, then building the skeleton…", "rig");
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
    addChatMessage("system", followupErrorMessage(err, "Rigging failed. Please try again.", {
      notRiggable: "This model isn't riggable.",
    }));
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
  if (!(await ensureFollowupGates("animate"))) return;
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
  const { working, signal, onTaskId, onProgress, nodeId, prevAssetManifestCid, transformMatrix } =
    beginFollowup(prompt, "Rigging and animating — this chains three Tripo tasks and takes a few minutes…", "anim");
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
    addChatMessage("system", followupErrorMessage(err, "Animation failed. Please try again.", {
      notRiggable: "This model isn't riggable with the chosen skeleton.",
    }));
  } finally { working?.remove(); }
}

/**
 * Shows the polygon-budget dialog for retopo.
 * @returns the face limit, undefined for adaptive, or null when cancelled.
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
 * Shows the texture prompt dialog for retexture.
 * @returns the trimmed prompt, or null when cancelled or empty.
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
  if (!(await ensureFollowupGates("retexture"))) return;
  const { working, signal, onTaskId, onProgress, nodeId, prevAssetManifestCid, transformMatrix } =
    beginFollowup(`Retexture: ${texturePrompt}`, "Retexturing — this takes a minute or two…", "retex");
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
 * Rebuilds a completed generation with clean topology and baked textures.
 * @remarks The retopo'd model lands as a new bubble and can itself be rigged
 *   and animated — clean topology deforms better than raw output.
 */
async function onRetopo(generationId: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;

  const faceLimit = await showFaceLimitDialog();
  if (faceLimit === null) return; // cancelled

  if (!(await ensureFollowupGates("retopo"))) return;

  const prompt = "Retopo for animation";
  const { working, signal, onTaskId, onProgress, nodeId, prevAssetManifestCid, transformMatrix } =
    beginFollowup(prompt, "Rebuilding topology — this takes a minute or two…", "retopo");

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
    addChatMessage("system", followupErrorMessage(err, "Retopo failed. Please try again.", {
      timeout: "Retopo timed out. Try again later.",
      auth: true,
      passThroughMessage: true,
    }));
  } finally {
    working?.remove();
  }
}

/**
 * Auto-rigs a generation bubble (no animation) into a rigged GLB bubble.
 * @remarks The rigged result keeps the Animate action, which then takes the
 *   retarget-only path.
 */
async function onAutoRig(generationId: string) {
  const record = getPendingGeneration(generationId);
  if (!record?.sourceAssetCid) return;
  if (!(await ensureFollowupGates("rig"))) return;
  const rigModel = await showRigModelDialog("Auto-rig — rig model");
  if (rigModel === null) return; // cancelled
  const prompt = "Auto-rig";
  const { working, signal, onTaskId, onProgress, nodeId, prevAssetManifestCid, transformMatrix } =
    beginFollowup(prompt, "Rigging — checking compatibility, then building the skeleton…", "rig");
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
    addChatMessage("system", followupErrorMessage(err, "Rigging failed. Please try again.", {
      notRiggable: NOT_RIGGABLE_GUIDANCE,
      auth: true,
    }));
  } finally {
    working?.remove();
  }
}

/**
 * Rigs and animates a generation bubble into an animated GLB bubble.
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

  if (!(await ensureFollowupGates("animate"))) return;

  const labels = animations.map((p) => animatePresetLabel(p)).join(", ");
  const prompt = `Animate: ${labels}`;
  const { working, signal, onTaskId, onProgress, nodeId, prevAssetManifestCid, transformMatrix } =
    beginFollowup(prompt, "Rigging and animating — this chains three Tripo tasks and takes a few minutes…", "anim");

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
    addChatMessage("system", followupErrorMessage(err, "Animation failed. Please try again.", {
      notRiggable: NOT_RIGGABLE_GUIDANCE,
      timeout: "Animation timed out. Try again later.",
      auth: true,
      passThroughMessage: true,
    }));
  } finally {
    working?.remove();
  }
}

/**
 * Maps a generation failure to user-facing chat copy.
 */
function generationErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) {
      return err.message || "Missing required generation parameter.";
    } else if (err.status === 429) {
      return "Rate limit reached. Please wait before generating again.";
    } else if (err.status === 401) {
      return "Invalid Tripo3D API key. Check your key in the provider settings.";
    } else if (err.status === 402) {
      return "Tripo3D account has insufficient credits.";
    } else if (err.status === 504 || err.code === "GENERATION_TIMEOUT") {
      return "Generation timed out. Try again later.";
    } else if (err.message) {
      return err.message;
    }
  } else if ((err as any).message) {
    return (err as any).message;
  }
  return "Generation failed. Please try again.";
}

interface SingleImagePayload {
  imageData?: string;
  imageMime?: string;
  imageName?: string;
}

interface MultiviewImagePayload {
  images: Array<{
    imageData?: string;
    imageMime?: string;
    imageName?: string;
    view: string;
  }>;
}

interface PromptAndImagePayload {
  effectivePrompt: string;
  imagePayload: SingleImagePayload | MultiviewImagePayload | null;
  multiview: boolean;
  frontImage: AttachedImage | null;
}

/**
 * Shapes the prompt and attached images into the wire payload.
 * @remarks Returns null when there is nothing to generate. Image-only
 *   generations get a synthesized prompt so chat history, provenance, and
 *   display names all carry meaningful text.
 */
function buildPromptAndImagePayload(): PromptAndImagePayload | null {
  const prompt = promptInput.value.trim();
  if (!prompt && attachedImages.length === 0) return null;

  // attachedImages is canonical-sorted, so [0] is always the front view.
  const frontImage = attachedImages[0] || null;
  const multiview = attachedImages.length > 1;

  const effectivePrompt =
    prompt ||
    (multiview
      ? `Images: ${frontImage.name} + ${attachedImages.length - 1} views`
      : frontImage
        ? `Image: ${frontImage.name}`
        : "");
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

  return { effectivePrompt, imagePayload, multiview, frontImage };
}

/**
 * Echo the submitted prompt into the chat — a reference-image bubble (grid
 * with per-view captions for multiview) or a plain text bubble — then reset
 * the composer for the next input.
 */
function echoPromptInChat({
  effectivePrompt,
  imagePayload,
  multiview,
  frontImage,
}: PromptAndImagePayload) {
  if (imagePayload) {
    // Show the reference image(s) in the chat, not just filenames — a grid
    // bubble with per-view captions for multiview, the single image as today.
    if (multiview) {
      addImageMessage("user", frontImage!.dataUrl as string, effectivePrompt, {
        images: attachedImages.map((img) => ({
          src: img.dataUrl || "",
          caption: VIEW_LABELS[img.view] || img.view,
        })),
      });
    } else {
      const single = imagePayload as SingleImagePayload;
      addImageMessage(
        "user",
        `data:${single.imageMime};base64,${single.imageData}`,
        effectivePrompt,
      );
    }
  } else {
    addChatMessage("user", effectivePrompt);
  }
  promptInput.value = "";
  promptInput.style.height = "auto";
  clearAttachedImage();
}

/**
 * Assembles the generateAsset request body.
 */
function buildGenerateAssetArgs({
  effectivePrompt,
  nodeId,
  prevAssetManifestCid,
  transformMatrix,
  tier,
  provider,
  providerKey,
  retextureSource,
  imagePayload,
  stoppable,
}: {
  effectivePrompt: string;
  nodeId: string;
  prevAssetManifestCid: string | undefined;
  transformMatrix: number[];
  tier: number;
  provider: string;
  providerKey: string;
  retextureSource: ActiveVersion | null;
  imagePayload: SingleImagePayload | MultiviewImagePayload | null;
  stoppable: ReturnType<typeof addStoppableWorkingMessage> | null;
}) {
  return {
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
  };
}

async function onGenerate() {
  const payload = buildPromptAndImagePayload();
  if (!payload) return;
  const { effectivePrompt, imagePayload } = payload;

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

  echoPromptInChat(payload);

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

    const result = await generateAsset(
      buildGenerateAssetArgs({
        effectivePrompt,
        nodeId,
        prevAssetManifestCid,
        transformMatrix,
        tier,
        provider,
        providerKey,
        retextureSource,
        imagePayload,
        stoppable,
      })
    );

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
    addChatMessage("system", generationErrorMessage(err));
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
  addFollowupActions(generationId);
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
