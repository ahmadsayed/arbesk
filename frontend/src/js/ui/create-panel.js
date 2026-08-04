// @ts-nocheck
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
} from "../engine/scene-graph.js";
import { showToast } from "./toasts.js";
import { showCustomDialog, showCheckboxDialog } from "./dialog.js";
import { addChatMessage, addAssetMessage, addWorkingMessage, addChoiceMessage, addImageMessage, clearChatMessages } from "./chat-messages.js";
import { renderChatProvenance, clearHistoryBubbles } from "./chat-history.js";
import {
  generateAsset,
  ApiError,
  getOrCreateSession,
  getProviderBalance,
} from "../services/api.js";
import {
  createChatPreview,
  disposeChatPreview,
  disposeAllChatPreviews,
} from "../services/chat-preview.js";
import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import {
  addPendingGeneration,
  getPendingGeneration,
  updatePendingGeneration,
  _resetPendingGenerations,
} from "../state/pending-generations.js";
import { deriveDefaultCollectionId, identityMatrix } from "../utils/collections.js";

// ─── DOM References ───
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const generateHint = document.getElementById("generateHint");
const clearChatBtn = document.getElementById("clearChatBtn");

// Image-to-3D attach (Tripo3D only)
const imageAttachBtn = /** @type {HTMLButtonElement|null} */ (
  document.getElementById("imageAttachBtn")
);
const imageAttachInput = /** @type {HTMLInputElement|null} */ (
  document.getElementById("imageAttachInput")
);
const imageAttachChip = document.getElementById("imageAttachChip");
const imageAttachThumb = /** @type {HTMLImageElement|null} */ (
  document.getElementById("imageAttachThumb")
);
const imageAttachName = document.getElementById("imageAttachName");
const imageAttachRemove = document.getElementById("imageAttachRemove");

// Settings
const assetNameDisplay = document.getElementById("assetNameDisplay");
const providerSelect = document.getElementById("providerSelect");
const tierSelect = document.getElementById("tierSelect");
const collectionSelect = document.getElementById("collectionSelect");
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
 * @returns {string}
 */
function getByokKey() {
  return (localStorage.getItem(BYOK_KEY_STORAGE) || "").trim();
}

/**
 * True when the selected provider is a real (non-mock) provider.
 * Real providers require a BYOK key; the mock provider does not.
 * @returns {boolean}
 */
function isRealProvider() {
  return getProvider() !== "mock";
}

// ─── Provider Balance (BYOK) ───

const providerBalance = document.getElementById("providerBalance");
const textureQualityRow = document.getElementById("textureQualityRow");
const textureQualitySelect = /** @type {HTMLSelectElement|null} */ (
  document.getElementById("textureQualitySelect")
);
const TEXTURE_QUALITY_STORAGE = "arbesk-texture-quality";

/**
 * Current panel texture quality for Tripo3D calls.
 * @returns {"standard"|"detailed"|"extreme"}
 */
function getTextureQuality() {
  const v = textureQualitySelect?.value;
  return v === "detailed" || v === "extreme" ? v : "standard";
}

/** @type {string|null} key the latest balance fetch was issued for */
let balanceFetchKey = null;
/** @type {ReturnType<typeof setTimeout>|null} */
let balanceFetchTimer = null;

/**
 * Update the balance line inside the BYOK key dialog (when open).
 * @param {string|null} text
 */
function updateDialogBalance(text) {
  const el = document.getElementById("providerKeyBalance");
  if (el) el.textContent = text || "";
}

/**
 * Fetch the Tripo3D credit balance and update the caption(s). Stale
 * responses (key changed mid-flight) are dropped.
 * @param {string} key
 */
async function fetchProviderBalance(key) {
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
 * @param {{force?: boolean}} [opts]
 */
function refreshProviderBalance({ force = false } = {}) {
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

/** @type {{base64: string, mime: string, name: string} | null} */
let attachedImage = null;

/**
 * Drop the attached image and hide the preview chip.
 */
function clearAttachedImage() {
  attachedImage = null;
  if (imageAttachInput) imageAttachInput.value = "";
  if (imageAttachChip) imageAttachChip.hidden = true;
}

/**
 * The attach button only applies to Tripo3D (image-to-3D). Switching back to
 * the mock provider hides it and discards any attached image.
 */
function syncImageAttachUI() {
  const enabled = getProvider() === "tripo3d";
  if (imageAttachBtn) imageAttachBtn.hidden = !enabled;
  if (!enabled) clearAttachedImage();
}

/**
 * Read and validate an image file selected via the attach input, then show
 * the preview chip. Invalid files are rejected with a toast and cleared.
 * @param {File} file
 */
function attachImageFile(file) {
  if (!IMAGE_MIMES.has(file.type)) {
    showToast({
      type: "warning",
      title: "Unsupported Image",
      message: "Attach a JPEG, PNG, or WebP image.",
    });
    clearAttachedImage();
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showToast({
      type: "warning",
      title: "Image Too Large",
      message: "Images are limited to 10 MB.",
    });
    clearAttachedImage();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result || "");
    const base64 = dataUrl.split(",")[1] || "";
    if (!base64) {
      clearAttachedImage();
      return;
    }
    attachedImage = { base64, mime: file.type, name: file.name };
    if (imageAttachThumb) imageAttachThumb.src = dataUrl;
    if (imageAttachName) imageAttachName.textContent = file.name;
    if (imageAttachChip) imageAttachChip.hidden = false;
  };
  reader.readAsDataURL(file);
}

if (imageAttachBtn && imageAttachInput) {
  imageAttachBtn.addEventListener("click", () => imageAttachInput.click());
  imageAttachInput.addEventListener("change", () => {
    const file = imageAttachInput.files?.[0];
    if (file) attachImageFile(file);
  });
}
imageAttachRemove?.addEventListener("click", clearAttachedImage);

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

/**
 * Build the key dialog body: a password input (prefilled from localStorage,
 * persisted on input), a show/hide toggle, and a Clear Key action. The input
 * only exists while the dialog is open; the stored key lives in localStorage.
 * All markup is static — no user content is injected.
 * @returns {HTMLElement}
 */
function buildProviderKeyBody() {
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

  const input = /** @type {HTMLInputElement} */ (
    wrap.querySelector("#providerKeyInput")
  );
  const toggle = /** @type {HTMLButtonElement} */ (
    wrap.querySelector("#providerKeyToggle")
  );
  const clear = /** @type {HTMLButtonElement} */ (
    wrap.querySelector("#providerKeyClear")
  );

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
    assetState.set({ selectedCollectionId: defaultId });
  }

  collectionSelect.addEventListener("change", () => {
    assetState.set({
      selectedCollectionId: collectionSelect.value || defaultId,
    });
  });
}

// ─── Chat Messages ───

// addChatMessage / addAssetMessage live in ./chat-messages.js and are
// imported above; addChatMessage is re-exported at the bottom of this file.

/** Live asset-message handles keyed by pending-generation id. */
const assetMessages = new Map();

/**
 * Public taskId of the most recent completed Tripo3D generation in this
 * chat. When set, the next Generate refines that model (texture/material
 * only — Tripo's refine_model endpoint is dead upstream, so refinement is
 * texture_model via the backend). Reset by Clear Chat.
 * @type {string | null}
 */
let lastTripoTaskId = null;

/**
 * Clear the chat: dispose all live previews, reset the pending-generation
 * store and bubble handles, restore the welcome placeholder, and break the
 * refine chain so the next generation starts a brand-new model.
 */
function clearChat() {
  disposeAllChatPreviews();
  _resetPendingGenerations();
  assetMessages.clear();
  lastTripoTaskId = null;
  clearAttachedImage();
  clearChatMessages();
  clearHistoryBubbles();
  addChatMessage("system", "Chat cleared. Start a new model.");
}

/**
 * Attach a live 3D preview to an asset bubble. Falls back to a static
 * format badge when the preview cannot be created.
 * @param {string} generationId
 * @param {import("./chat-messages.js").AssetMessageHandle} assetMessage
 */
async function attachChatPreview(generationId, assetMessage) {
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
      onAutoCollapse: (collapsedId, snapshot) => {
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
 * @param {string} generationId
 * @param {import("./chat-messages.js").AssetMessageHandle} assetMessage
 */
async function sendGenerationToStudio(generationId, assetMessage) {
  const record = getPendingGeneration(generationId);
  if (!record || record.status !== "pending") return;

  updatePendingGeneration(generationId, { status: "sent" });
  assetMessage.sendButton.disabled = true;

  try {
    if (record.prevAssetManifestCid) {
      clearScene();
    }

    assetState.set({
      activeAssetManifestCid: record.assetManifestCid,
      latestAssetManifestCid: record.assetManifestCid,
    });

    const url = new URL(window.location);
    const activeTokenId = assetState.get().activeAssetTokenId;
    if (activeTokenId) {
      url.searchParams.set("asset", activeTokenId);
      url.searchParams.delete("manifest");
    } else {
      url.searchParams.set("manifest", record.assetManifestCid);
    }
    window.history.pushState({}, "", url);

    await loadAssetManifest(record.assetManifestCid);

    const snapshot = await disposeChatPreview(generationId, {
      captureSnapshot: true,
    });
    assetMessage.markSent(snapshot);

    addChatMessage("system", `Model carved via ${getProvider()}.`);
  } catch (err) {
    console.error("Show in Studio failed:", err);
    updatePendingGeneration(generationId, { status: "pending" });
    assetMessage.sendButton.disabled = false;
    addChatMessage(
      "system",
      err.message || "Failed to load the model in the Studio."
    );
  }
}

// ─── Generate Button State ───

function setGenerating(active) {
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
    assetState.get().activeAssetName ||
    assetNameDisplay?.textContent ||
    "Untitled Asset"
  ).trim();
}

function syncAssetNameDisplay(name = null) {
  if (!assetNameDisplay) return;
  assetNameDisplay.textContent =
    name || assetState.get().activeAssetName || "Untitled Asset";
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

// ─── Rig & Animate (Tripo3D) ───

// Quick-pick combos shown as in-chat choices after a Tripo3D generation.
// "rig-only" stops after the rig step; "custom" opens the full preset dialog.
const ANIMATE_CHOICES = [
  { label: "Idle + Walk", value: ["preset:idle", "preset:walk"] },
  { label: "Idle", value: ["preset:idle"] },
  { label: "Walk + Run", value: ["preset:walk", "preset:run"] },
  { label: "Jump", value: ["preset:jump"] },
  { label: "Retopo for animation", value: "retopo" },
  { label: "Rig only (no animation)", value: "rig-only" },
  { label: "More…", value: "custom" },
];

const ANIMATE_PRESETS = [
  { value: "preset:idle", label: "Idle", checked: true },
  { value: "preset:walk", label: "Walk", checked: true },
  { value: "preset:run", label: "Run" },
  { value: "preset:jump", label: "Jump" },
  { value: "preset:slash", label: "Slash" },
];

/**
 * Register a finished generation as a pending record and present it as an
 * asset chat bubble with live preview, Show-in-Studio, and (for riggable
 * Tripo3D models) an Animate action.
 * @returns {string} the pending generation id
 */
function presentGenerationResult(
  result,
  { prompt, provider, task, prevAssetManifestCid, transformMatrix },
) {
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
  });

  const assetMessage = addAssetMessage({ prompt, format: result.format });
  if (assetMessage) {
    assetMessages.set(generationId, assetMessage);
    assetMessage.sendButton.addEventListener("click", () => {
      void sendGenerationToStudio(generationId, assetMessage);
    });
    void attachChatPreview(generationId, assetMessage);
    // Animated GLBs can't be re-rigged — offer animate choices only on
    // model/texture results and on rig-only results (which just need the
    // retarget step to become animated).
    if (provider === "tripo3d" && task !== "animate") {
      addAnimateChoices(generationId);
    }
  }
  return generationId;
}

/**
 * Offer rig & animate follow-ups as in-chat choice chips after a Tripo3D
 * generation. T-pose models rig best — the hint rides along in the prompt.
 */
function addAnimateChoices(generationId) {
  // On an already-rigged (rig-only) bubble: re-rigging is pointless (the
  // backend retargets directly) and retopo would strip the skeleton — hide
  // both chips there.
  const record = getPendingGeneration(generationId);
  const choices =
    record?.task === "rig"
      ? ANIMATE_CHOICES.filter(
          (c) => c.value !== "rig-only" && c.value !== "retopo",
        )
      : ANIMATE_CHOICES;
  addChoiceMessage(
    "Rig & animate this model? (full-body T-pose rigs best)",
    choices,
    (value) => {
      if (value === "retopo") {
        void onRetopo(generationId);
        return;
      }
      void onAnimate(generationId, value === "custom" ? null : value);
    },
  );
}

/**
 * Smart retopology: rebuild a completed Tripo3D generation with clean
 * topology and baked textures (Tripo mesh/decimate v2.0). The retopo'd model
 * lands as a new chat bubble and can itself be rigged & animated — clean
 * topology deforms far better than raw generation output.
 * @param {string} generationId
 */
async function onRetopo(generationId) {
  const record = getPendingGeneration(generationId);
  if (!record?.backendTaskId) return;

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
  const working = addWorkingMessage(
    "Rebuilding topology — this takes a minute or two…",
  );

  const assetName = getAssetName();
  const nodeId = `${assetName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_retopo_${Date.now()}`;
  const prevAssetManifestCid =
    assetState.get().activeAssetManifestCid || undefined;
  const transformMatrix = buildTransformMatrix();

  try {
    const result = await generateAsset({
      prompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      retopoTaskId: record.backendTaskId,
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
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
    console.error("Retopo failed:", err);
    let userMsg = "Retopo failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.code === "RETOPO_SOURCE_NOT_FOUND") {
        userMsg =
          "The source generation expired — retopo within an hour of generating.";
      } else if (err.status === 401) {
        userMsg = "Invalid Tripo3D API key. Check your key in the provider settings.";
      } else if (err.status === 402) {
        userMsg = "Tripo3D account has insufficient credits.";
      } else if (err.code === "GENERATION_TIMEOUT") {
        userMsg = "Retopo timed out. Try again later.";
      } else if (err.message) {
        userMsg = err.message;
      }
    } else if (err.message) {
      userMsg = err.message;
    }
    addChatMessage("system", userMsg);
  } finally {
    working?.remove();
  }
}

/**
 * Rig & animate a completed Tripo3D generation: presets (from chat choices
 * or the full picker) → backend animate chain (rig-check → rig → retarget)
 * → animated GLB chat bubble.
 * @param {string} generationId
 * @param {string[]|"rig-only"|null} presets - "rig-only" stops after rigging;
 *   null opens the full preset dialog
 */
async function onAnimate(generationId, presets) {
  const record = getPendingGeneration(generationId);
  if (!record?.backendTaskId) return;

  const rigOnly = presets === "rig-only";
  if (!presets) {
    presets = await showCheckboxDialog(
      "Rig & Animate",
      "Pick up to 5 animations to bake into the model. Rigging works best on full-body humanoids or creatures (T-pose).",
      ANIMATE_PRESETS,
      { max: 5 },
    );
  }
  if (!rigOnly && (!presets || presets.length === 0)) return;

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

  const labels = rigOnly
    ? "rig only"
    : presets.map((p) => p.replace("preset:", "")).join(", ");
  const prompt = rigOnly ? "Rig only" : `Animate: ${labels}`;
  addChatMessage("user", prompt);
  const working = addWorkingMessage(
    "Rigging and animating — this chains three Tripo tasks and takes a few minutes…",
  );

  const assetName = getAssetName();
  const nodeId = `${assetName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_anim_${Date.now()}`;
  const prevAssetManifestCid =
    assetState.get().activeAssetManifestCid || undefined;
  const transformMatrix = buildTransformMatrix();

  try {
    const result = await generateAsset({
      prompt,
      nodeId,
      provider: "tripo3d",
      providerKey: getByokKey(),
      animateTaskId: record.backendTaskId,
      ...(rigOnly ? { rigOnly: true } : { animations: presets }),
      prevAssetManifestCid,
      transformMatrix,
      tier: getTier(),
    });

    presentGenerationResult(result, {
      prompt,
      provider: "tripo3d",
      // Rig-only results are tagged "rig" so they keep the animate choices
      // (retarget-only) instead of being treated as final animated models.
      task: rigOnly ? "rig" : "animate",
      prevAssetManifestCid,
      transformMatrix,
    });
    dismissCreatePulse();
    // Rig + retarget consumed credits — refresh the caption.
    refreshProviderBalance({ force: true });

    // Recovery path: if the rigging/retargeting wrecked the mesh, the user
    // can re-send the original pre-rig model to the Studio from chat.
    addChoiceMessage(
      "If the result looks off, you can go back:",
      [{ label: "Back to the original model", value: generationId }],
      (sourceGenerationId) => {
        void restoreGeneration(sourceGenerationId);
      },
    );
  } catch (err) {
    console.error("Animate failed:", err);
    let userMsg = "Animation failed. Please try again.";
    if (err instanceof ApiError) {
      if (err.code === "ANIMATE_SOURCE_NOT_FOUND") {
        userMsg =
          "The source generation expired — animate within an hour of generating.";
      } else if (err.code === "MODEL_NOT_RIGGABLE") {
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
    } else if (err.message) {
      userMsg = err.message;
    }
    addChatMessage("system", userMsg);
  } finally {
    working?.remove();
  }
}

/**
 * Re-send an older generation to the Studio — the recovery path when a
 * rig/retarget result wrecked the mesh. Resets the record to pending so the
 * send path accepts it again, then runs the normal Show-in-Studio tail.
 * @param {string} generationId
 */
async function restoreGeneration(generationId) {
  const assetMessage = assetMessages.get(generationId);
  const record = getPendingGeneration(generationId);
  if (!assetMessage || !record) {
    addChatMessage(
      "system",
      "The original model is no longer available in this chat.",
    );
    return;
  }
  updatePendingGeneration(generationId, { status: "pending" });
  await sendGenerationToStudio(generationId, assetMessage);
}

// ─── Generation Flow ───

async function onGenerate() {
  const prompt = promptInput.value.trim();
  if (!prompt && !attachedImage) return;

  // Image-only generations get a synthesized prompt so chat history,
  // manifest provenance, and display names all carry meaningful text.
  const effectivePrompt =
    prompt || (attachedImage ? `Image: ${attachedImage.name}` : "");
  const imagePayload = attachedImage
    ? {
        imageData: attachedImage.base64,
        imageMime: attachedImage.mime,
        imageName: attachedImage.name,
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
    // Show the reference image itself in the chat, not just its filename.
    addImageMessage(
      "user",
      `data:${imagePayload.imageMime};base64,${imagePayload.imageData}`,
      effectivePrompt,
    );
  } else {
    addChatMessage("user", effectivePrompt);
  }
  promptInput.value = "";
  promptInput.style.height = "auto";
  clearAttachedImage();

  setGenerating(true);
  const working = addWorkingMessage("Carving your model…");

  const assetName = getAssetName();
  const nodeId = `${assetName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_${Date.now()}`;
  const prevAssetManifestCid =
    assetState.get().activeAssetManifestCid || undefined;
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

    // Refine chain: when the chat already has a completed Tripo3D model,
    // the next generation refines it (texture/material only — geometry
    // unchanged). Clear Chat resets the chain. An attached image always
    // starts a fresh model (image-to-3D), skipping the chain.
    const refineTaskId =
      provider === "tripo3d" && lastTripoTaskId && !imagePayload
        ? lastTripoTaskId
        : undefined;
    if (refineTaskId) {
      addChatMessage(
        "system",
        "Refining previous model (texture/material only — geometry unchanged)…",
      );
    }

    const result = await generateAsset({
      prompt: effectivePrompt,
      nodeId,
      txHash: null,
      provider,
      prevAssetManifestCid,
      transformMatrix,
      tier,
      ...(isRealProvider() && { providerKey }),
      ...(refineTaskId && { refineTaskId }),
      ...(imagePayload && imagePayload),
      ...(provider === "tripo3d" && { textureQuality: getTextureQuality() }),
    });

    if (provider === "tripo3d" && result.taskId) {
      lastTripoTaskId = result.taskId;
    }

    // Defer the Studio viewport load: register the result, show an asset
    // bubble with a live preview, and let the user send it explicitly.
    presentGenerationResult(result, {
      prompt: effectivePrompt,
      provider,
      task: refineTaskId ? "texture" : "model",
      prevAssetManifestCid,
      transformMatrix,
    });
    dismissCreatePulse();
    // A completed generation consumed credits — refresh the caption.
    refreshProviderBalance({ force: true });
  } catch (err) {
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
    } else if (err.message) {
      userMsg = err.message;
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

promptInput.addEventListener("keydown", (e) => {
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
let openAssetIdentity = null;

on(EVENTS.SCENE_READY, (event) => {
  const name = event?.manifest?.name || assetState.get().activeAssetName;
  if (name) syncAssetNameDisplay(name);
  const manifestCid =
    event?.manifestCid || assetState.get().activeAssetManifestCid;
  const identity = event?.manifest?.asset_id || manifestCid || null;
  if (identity && openAssetIdentity && identity !== openAssetIdentity) {
    clearChat();
  }
  if (identity) openAssetIdentity = identity;
  if (manifestCid) void renderChatProvenance(manifestCid);
});

on(EVENTS.ASSET_DRAFT_SAVED, () => {
  const manifestCid = assetState.get().activeAssetManifestCid;
  if (manifestCid) void renderChatProvenance(manifestCid);
});

on(EVENTS.ASSET_PUBLISHED, () => {
  const manifestCid = assetState.get().activeAssetManifestCid;
  if (manifestCid) void renderChatProvenance(manifestCid);
});

on(EVENTS.SCENE_EMPTY, () => {
  syncAssetNameDisplay();
  openAssetIdentity = null;
  // Full reset on new asset — but stay quiet when there is no live session
  // to clear (e.g. initial page load on an empty scene).
  const hasLiveChat = !!document.querySelector(
    "#chatHistoryList .chat-bubble:not(.chat-bubble-history)",
  );
  if (hasLiveChat) clearChat();
  else clearHistoryBubbles();
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
