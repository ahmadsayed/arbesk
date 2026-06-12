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
import { generateAsset, ApiError, getOrCreateSession } from "../services/api.js";

// ─── DOM References ───
const chatHistory = document.getElementById("chatHistory");
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const generateHint = document.getElementById("generateHint");

// Settings
const assetNameDisplay = document.getElementById("assetNameDisplay");
const providerSelect = document.getElementById("providerSelect");
const tierSelect = document.getElementById("tierSelect");

// ─── Chat Messages ───

function addChatMessage(role, text) {
  // Hide welcome text on first real message
  const welcome = chatHistory?.querySelector(".chat-welcome");
  if (welcome) welcome.hidden = true;

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role}`;
  bubble.textContent = text;
  chatHistory.appendChild(bubble);
  chatHistory.scrollTop = chatHistory.scrollHeight;
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
  if (!generateHint) return;
  generateHint.hidden = !!window.walletAddress;
}

// ─── Asset Definition Helpers ───

function getAssetName() {
  return (
    window.activeAssetName ||
    assetNameDisplay?.textContent ||
    "Untitled Asset"
  ).trim();
}

function syncAssetNameDisplay(name = null) {
  if (!assetNameDisplay) return;
  assetNameDisplay.textContent =
    name || window.activeAssetName || "Untitled Asset";
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

  if (!window.walletAddress) {
    alert("Please connect your wallet first.");
    return;
  }

  // Ensure authenticated before payment so sign popup comes first
  try {
    await getOrCreateSession();
  } catch (err) {
    showToast("Sign in to generate assets");
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
  const prevAssetManifestCid = window.activeAssetManifestCid || undefined;
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

    window.activeAssetManifestCid = result.assetManifestCid;
    window.latestAssetManifestCid = result.assetManifestCid;

    const url = new URL(window.location);
    if (window.activeAssetTokenId) {
      url.searchParams.set("asset", window.activeAssetTokenId);
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

// ─── Asset Definition Toggle ───

const toggleAssetDef = document.getElementById("toggleAssetDef");
const assetDefBody = document.querySelector(".asset-def-body");

if (toggleAssetDef && assetDefBody) {
  toggleAssetDef.addEventListener("click", () => {
    const hidden = assetDefBody.hidden;
    assetDefBody.hidden = !hidden;
    toggleAssetDef.classList.toggle("open", hidden);
  });
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

document.addEventListener("scene:ready", (event) => {
  const name = event.detail?.manifest?.name || window.activeAssetName;
  if (name) syncAssetNameDisplay(name);
});

document.addEventListener("scene:empty", () => {
  syncAssetNameDisplay();
});

// Reflect renames made via the editable header title.
document.addEventListener("asset:renamed", (event) => {
  const name = event.detail?.name;
  if (name) syncAssetNameDisplay(name);
});

document.addEventListener("wallet:connected", () => {
  updateGenerateHint();
});

document.addEventListener("wallet:disconnected", () => {
  updateGenerateHint();
});

syncAssetNameDisplay();
updateGenerateHint();

// ─── Exports ───
export { addChatMessage };
