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
import { showCustomDialog } from "./dialog.js";
import { addChatMessage, addAssetMessage, addWorkingMessage } from "./chat-messages.js";
import {
  generateAsset,
  ApiError,
  getOrCreateSession,
} from "../services/api.js";
import {
  createChatPreview,
  disposeChatPreview,
} from "../services/chat-preview.js";
import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import {
  addPendingGeneration,
  getPendingGeneration,
  updatePendingGeneration,
} from "../state/pending-generations.js";
import { deriveDefaultCollectionId, identityMatrix } from "../utils/collections.js";

// ─── DOM References ───
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const generateHint = document.getElementById("generateHint");

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
    <button id="providerKeyClear" class="btn btn-secondary" type="button" style="margin-top:var(--size-2)">Clear Key</button>`;

  const input = /** @type {HTMLInputElement} */ (
    wrap.querySelector("#providerKeyInput")
  );
  const toggle = /** @type {HTMLButtonElement} */ (
    wrap.querySelector("#providerKeyToggle")
  );
  const clear = /** @type {HTMLButtonElement} */ (
    wrap.querySelector("#providerKeyClear")
  );

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

// ─── Generation Flow ───

async function onGenerate() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

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

  addChatMessage("user", prompt);
  promptInput.value = "";
  promptInput.style.height = "auto";

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

    const result = await generateAsset({
      prompt,
      nodeId,
      txHash: null,
      provider,
      prevAssetManifestCid,
      transformMatrix,
      tier,
      ...(isRealProvider() && { providerKey }),
    });

    // Defer the Studio viewport load: register the result, show an asset
    // bubble with a live preview, and let the user send it explicitly.
    const generationId = addPendingGeneration({
      assetManifestCid: result.assetManifestCid,
      sourceAssetCid: result.sourceAssetCid,
      prompt,
      format: result.format,
      path: result.path,
      prevAssetManifestCid: prevAssetManifestCid || null,
      transformMatrix,
      ...(result.tier !== undefined && { tier: result.tier }),
    });

    const assetMessage = addAssetMessage({
      prompt,
      format: result.format,
    });
    if (assetMessage) {
      assetMessages.set(generationId, assetMessage);
      assetMessage.sendButton.addEventListener("click", () => {
        void sendGenerationToStudio(generationId, assetMessage);
      });
      void attachChatPreview(generationId, assetMessage);
    }
    dismissCreatePulse();
  } catch (err) {
    console.error("Generation failed:", err);
    let userMsg = "Generation failed. Please try again.";

    if (err instanceof ApiError) {
      if (err.status === 400) {
        userMsg = err.message || "Missing required generation parameter.";
      } else if (err.status === 429) {
        userMsg = "Rate limit reached. Please wait before generating again.";
      } else if (err.status === 501) {
        userMsg = "Cloud generation is not yet enabled. Switch to mock mode.";
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

on(EVENTS.SCENE_READY, (event) => {
  const name = event?.manifest?.name || assetState.get().activeAssetName;
  if (name) syncAssetNameDisplay(name);
});

on(EVENTS.SCENE_EMPTY, () => {
  syncAssetNameDisplay();
});

on(EVENTS.WALLET_CONNECTED, () => {
  updateGenerateHint();
  syncCollectionSelect();
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  updateGenerateHint();
});

syncAssetNameDisplay();
updateGenerateHint();
syncProviderUI();

// Initialize collection select on load if wallet is already connected
if (walletState.get().walletAddress) {
  syncCollectionSelect();
}

// ─── Exports ───
export { addChatMessage };
