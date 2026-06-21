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
import {
  payForGenerationWithUSDC,
  recordGeneration,
  isFreeTierContract,
} from "../blockchain/wallet.js";
import { showToast } from "./toasts.js";
import {
  generateAsset,
  ApiError,
  getOrCreateSession,
} from "../services/api.js";
import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";

// ─── DOM References ───
const chatHistory = document.getElementById("chatHistory");
const chatHistoryList = document.getElementById("chatHistoryList");
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const generateHint = document.getElementById("generateHint");

// Settings
const assetNameDisplay = document.getElementById("assetNameDisplay");
const providerSelect = document.getElementById("providerSelect");
const tierSelect = document.getElementById("tierSelect");
const collectionSelect = document.getElementById("collectionSelect");

// ─── Collection Selector ───

/**
 * Derive the default collection ID from the connected wallet address.
 * Uses keccak256(soliditySha3(address)) — same as asset-save.js.
 */
function deriveDefaultCollectionId(walletAddr) {
  if (!walletAddr || !window.Web3?.utils?.soliditySha3) return null;
  return window.Web3.utils.soliditySha3({
    type: "address",
    value: walletAddr,
  });
}

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

function getSelectedCollectionId() {
  return assetState.get().selectedCollectionId || null;
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
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

// ─── Generation Flow ───

async function onGenerate() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  if (!walletState.get().walletAddress) {
    alert("Please connect your wallet first.");
    return;
  }

  // Ensure authenticated before payment so sign popup comes first
  try {
    await getOrCreateSession();
  } catch (err) {
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

    // Free tier uses on-chain quota; paid tier uses USDC payment.
    let txHash;
    if (isFreeTierContract()) {
      txHash = await recordGeneration(nodeId, prompt);
    } else {
      txHash = await payForGenerationWithUSDC(nodeId, prompt, tier);
    }

    if (!txHash) {
      throw new Error("Payment was cancelled or failed.");
    }

    const result = await generateAsset({
      prompt,
      nodeId,
      txHash,
      provider: getProvider(),
      prevAssetManifestCid,
      transformMatrix,
      tier,
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
      if (err.status === 409) {
        userMsg = "This payment was already used. A new payment is required.";
      } else if (err.status === 429) {
        userMsg = "Rate limit reached. Please wait before generating again.";
      } else if (err.status === 403) {
        userMsg =
          "Payment validation failed. Ensure the transaction succeeded.";
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
