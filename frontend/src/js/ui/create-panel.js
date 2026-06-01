/**
 * Arbesk Chat Studio UI Controller
 *
 * Real PayGo generation flow: wallet payment → backend generation →
 * manifest load → scene graph registration.
 */

import {
  loadAssetManifest,
  clearScene,
  hideWelcomeOverlay,
} from "../engine/scene-graph.js";
import { payForGeneration } from "../blockchain/wallet.js";
import { generateAsset, ApiError } from "../services/api.js";

// ─── DOM References ───
const chatHistory = document.getElementById("chatHistory");
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const waitingOverlay = document.getElementById("waitingOverlay");
const waitingText = document.getElementById("waitingText");
const chatSidebar = document.getElementById("chatSidebar");
const toggleChatBtn = document.getElementById("toggleChatBtn");
const showSidebarBtn = document.getElementById("showSidebarBtn");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const mainStage = document.getElementById("mainStage");

// Settings
const assetNameDisplay = document.getElementById("assetNameDisplay");
const providerSelect = document.getElementById("providerSelect");

// ─── Chat Messages ───

function addChatMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble-${role}`;
  bubble.textContent = text;
  chatHistory.appendChild(bubble);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// ─── Waiting Overlay ───

function setWaitingStep(label) {
  if (waitingText) waitingText.textContent = label;
  waitingOverlay.classList.remove("hidden");
  generateBtn.disabled = true;
}

function hideWaiting() {
  waitingOverlay.classList.add("hidden");
  generateBtn.disabled = false;
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

function buildTransformMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

// ─── Generation Flow ───

async function onGenerate() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  // Wallet check
  if (!window.walletAddress) {
    alert("Please connect your wallet first.");
    return;
  }

  addChatMessage("user", prompt);
  promptInput.value = "";
  promptInput.style.height = "auto";

  setWaitingStep("Confirming payment in wallet…");

  const assetName = getAssetName();
  const nodeId = `${assetName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")}_${Date.now()}`;
  const prevAssetManifestCid = window.activeAssetManifestCid || undefined;
  const transformMatrix = buildTransformMatrix();

  try {
    // 1. On-chain payment
    const txHash = await payForGeneration(nodeId, prompt);
    if (!txHash) {
      throw new Error("Payment was cancelled or failed.");
    }

    setWaitingStep("Carving your asset…");

    // 2. Backend generation
    const result = await generateAsset({
      prompt,
      nodeId,
      txHash,
      provider: getProvider(),
      prevAssetManifestCid,
      transformMatrix,
    });

    // 3. Load new manifest
    if (prevAssetManifestCid) {
      clearScene();
    }

    window.activeAssetManifestCid = result.assetManifestCid;
    window.latestAssetManifestCid = result.assetManifestCid;

    // Update URL — use ?asset if we have a tokenId, otherwise ?manifest for drafts
    const url = new URL(window.location);
    if (window.activeAssetTokenId) {
      url.searchParams.set("asset", window.activeAssetTokenId);
      url.searchParams.delete("manifest");
    } else {
      url.searchParams.set("manifest", result.assetManifestCid);
    }
    window.history.pushState({}, "", url);

    await loadAssetManifest(result.assetManifestCid);
    hideWelcomeOverlay();

    addChatMessage(
      "system",
      `Model carved via ${result.variantEntry.provider}. Version ${result.variantEntry.v}.`
    );
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
    hideWaiting();
  }
}

// ─── Sidebar Toggle ───

function toggleChat() {
  chatSidebar.classList.toggle("collapsed");
}

function toggleMobileMenu() {
  chatSidebar.classList.toggle("open");
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
toggleChatBtn.addEventListener("click", toggleChat);
if (showSidebarBtn) showSidebarBtn.addEventListener("click", toggleChat);
if (mobileMenuBtn) mobileMenuBtn.addEventListener("click", toggleMobileMenu);

// Enter to submit, Shift+Enter for newline
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    onGenerate();
  }
});

// Auto-resize textarea
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

syncAssetNameDisplay();

// Close mobile sidebar when clicking outside
if (mainStage) {
  mainStage.addEventListener("click", () => {
    if (chatSidebar.classList.contains("open")) {
      chatSidebar.classList.remove("open");
    }
  });
}

// ─── Exports ───
export { addChatMessage };
