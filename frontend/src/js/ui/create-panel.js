// @ts-nocheck
/**
 * Arbesk Chat Studio UI Controller
 *
 * Real PayGo generation flow: wallet payment → backend generation →
 * manifest load → scene graph registration.
 */

import {
  loadAssetManifest,
  clearScene,
  dismissCreatePulse,
} from "../engine/scene-graph.js";
import { showToast } from "./toasts.js";
import {
  generateAsset,
  ApiError,
  getOrCreateSession,
} from "../services/api.js";
import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { deriveDefaultCollectionId, identityMatrix } from "../utils/collections.js";

// ─── DOM References ───
const chatHistoryList = document.getElementById("chatHistoryList");
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const generateHint = document.getElementById("generateHint");

// Settings
const assetNameDisplay = document.getElementById("assetNameDisplay");
const providerSelect = document.getElementById("providerSelect");
const tierSelect = document.getElementById("tierSelect");
const collectionSelect = document.getElementById("collectionSelect");
const providerKeyInput = document.getElementById("providerKeyInput");
const providerKeyToggle = document.getElementById("providerKeyToggle");

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
  return (providerKeyInput?.value || "").trim();
}

/**
 * True when the selected provider is a real (non-mock) provider.
 * Real providers require a BYOK key; the mock provider does not.
 * @returns {boolean}
 */
function isRealProvider() {
  return getProvider() !== "mock";
}

// Persist + hydrate the BYOK key. Saved on input so it survives reloads; loaded
// on init so a returning user doesn't have to re-enter it.
if (providerKeyInput) {
  providerKeyInput.value = localStorage.getItem(BYOK_KEY_STORAGE) || "";
  providerKeyInput.addEventListener("input", () => {
    localStorage.setItem(BYOK_KEY_STORAGE, providerKeyInput.value);
  });
}

// Show/hide toggle for the key field (type password ⇄ text).
if (providerKeyToggle && providerKeyInput) {
  providerKeyToggle.addEventListener("click", () => {
    const hidden = providerKeyInput.type === "password";
    providerKeyInput.type = hidden ? "text" : "password";
    providerKeyToggle.setAttribute(
      "aria-label",
      hidden ? "Hide API key" : "Show API key"
    );
    providerKeyToggle.textContent = hidden ? "Hide" : "Show";
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

function addChatMessage(role, text) {
  // Hide welcome text on first real message
  const welcome = chatHistoryList?.querySelector(".chat-welcome");
  if (welcome) welcome.hidden = true;

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role}`;

  const content = document.createElement("span");
  content.className = "chat-bubble-content";
  content.textContent = text;
  bubble.appendChild(content);

  const now = new Date();
  const time = document.createElement("time");
  time.className = "chat-bubble-time";
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  bubble.appendChild(time);

  chatHistoryList.appendChild(bubble);
  chatHistoryList.scrollTop = chatHistoryList.scrollHeight;
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

    // Real providers require a BYOK key; mock does not. The on-chain
    // quota/payment gate is never used by the generation route.
    if (isRealProvider() && providerKey.length === 0) {
      showToast({
        type: "warning",
        title: "Provider Key Required",
        message: `Add your ${provider} API key in Settings to generate.`,
      });
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

    if (prevAssetManifestCid) {
      clearScene();
    }

    assetState.set({
      activeAssetManifestCid: result.assetManifestCid,
      latestAssetManifestCid: result.assetManifestCid,
    });

    const url = new URL(window.location);
    const activeTokenId = assetState.get().activeAssetTokenId;
    if (activeTokenId) {
      url.searchParams.set("asset", activeTokenId);
      url.searchParams.delete("manifest");
    } else {
      url.searchParams.set("manifest", result.assetManifestCid);
    }
    window.history.pushState({}, "", url);

    await loadAssetManifest(result.assetManifestCid);
    dismissCreatePulse();

    addChatMessage("system", `Model carved via ${getProvider()}.`);
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

// Initialize collection select on load if wallet is already connected
if (walletState.get().walletAddress) {
  syncCollectionSelect();
}

// ─── Exports ───
export { addChatMessage };
