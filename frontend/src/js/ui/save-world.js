/**
 * Arbesk Save World — Save (IPFS) + Publish (Blockchain) Controller
 *
 * Two distinct actions:
 *   • Save    → 💾  Push manifest to IPFS (versioned, local only)
 *   • Publish → 🌐  Mint or update token URI on-chain
 */

import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { mintWorld, updateTokenURI } from "../blockchain/wallet.js";
import {
  clearScene,
  captureWorldThumbnail,
  showWelcomeOverlay,
} from "../engine/scene-graph.js";

// ─── DOM References ───
const saveSection = document.getElementById("saveWorldSection");
const saveBtn = document.getElementById("saveWorldBtn");
const saveBtnText = document.getElementById("saveWorldBtnText");
const publishBtn = document.getElementById("publishWorldBtn");
const publishBtnText = document.getElementById("publishWorldBtnText");
const newWorldTopBtn = document.getElementById("newWorldTopBtn");

// ─── State ───
let isSaving = false;
let isPublishing = false;
let isCreatingNew = false;

// ─── Helpers ───

function _updateButtonState() {
  if (!saveSection) return;

  const hasWorld = !!window.activeManifestId;
  const hasWallet = !!window.walletAddress;

  if (!hasWorld || !hasWallet) {
    saveSection.hidden = true;
    return;
  }

  saveSection.hidden = false;

  // Save button: always available when a world is loaded
  if (saveBtnText) saveBtnText.textContent = "Save";

  // Publish button: always "Publish"
  if (publishBtnText) publishBtnText.textContent = "Publish";
  if (publishBtn) {
    publishBtn.title = window.activeTokenId
      ? "Update on-chain manifest CID"
      : "Mint this world as an NFT";
  }
}

function _updateUrlWorld(tokenId) {
  const url = new URL(window.location);
  url.searchParams.delete("manifest");
  url.searchParams.set("world", String(tokenId));
  window.history.pushState({}, "", url);
}

/**
 * Fetch the world name from an existing token's manifest.
 */
async function _fetchWorldName(tokenId) {
  try {
    const { contract } = await import("../blockchain/wallet.js");
    const c = contract || window.contract;
    if (!c) return null;
    const cid = await c.methods.tokenURI(tokenId).call();
    if (!cid) return null;
    const manifest = await getFromRemoteIPFS(cid);
    return manifest.name || null;
  } catch {
    return null;
  }
}

// ─── SAVE (IPFS only) ───

async function onSaveWorld() {
  if (isSaving) return;
  if (!window.walletAddress) {
    alert("Please connect your wallet first.");
    return;
  }
  if (!window.activeManifestId) {
    alert("No world loaded to save.");
    return;
  }

  isSaving = true;
  if (saveBtn) saveBtn.disabled = true;
  const originalText = saveBtnText ? saveBtnText.textContent : "Save";
  if (saveBtnText) saveBtnText.textContent = "Saving…";

  try {
    // 1. Resolve world name
    let worldName;
    if (window.activeTokenId) {
      worldName = await _fetchWorldName(window.activeTokenId);
      if (!worldName) worldName = "My World";
    } else {
      worldName = window.activeWorldName || "My World";
    }

    // 2. Fetch manifest content (may be an older version from history)
    const manifest = await getFromRemoteIPFS(window.activeManifestId);
    manifest.name = worldName;

    // 3. Handle reversion: if we loaded an older version, continue chain from latest
    const latestCid = window.latestManifestId || window.activeManifestId;
    if (latestCid && latestCid !== window.activeManifestId) {
      try {
        const latestManifest = await getFromRemoteIPFS(latestCid);
        manifest.version = (latestManifest.version || 0) + 1;
        manifest.prev_manifest_cid = latestCid;
      } catch {
        manifest.version = (manifest.version || 0) + 1;
        manifest.prev_manifest_cid = window.activeManifestId;
      }
    }
    // When already at latest, do not create redundant versions

    // 4. Save manifest to IPFS (no blockchain)
    const saveRes = await fetch("/api/save-manifest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    if (!saveRes.ok) {
      const err = await saveRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save manifest to IPFS");
    }
    const { cid } = await saveRes.json();

    window.activeManifestId = cid;
    window.latestManifestId = cid;
    console.log(`World "${worldName.trim()}" saved! CID: ${cid}`);

    // Notify history browser to refresh
    document.dispatchEvent(
      new CustomEvent("manifest:saved", { detail: { cid } })
    );

    // Update URL to reflect saved draft
    if (!window.activeTokenId) {
      const url = new URL(window.location);
      url.searchParams.set("manifest", cid);
      window.history.pushState({}, "", url);
    }
  } catch (err) {
    console.error("Save world failed:", err);
    alert("Save failed: " + err.message);
  } finally {
    isSaving = false;
    if (saveBtn) saveBtn.disabled = false;
    _updateButtonState();
  }
}

// ─── PUBLISH (Blockchain) ───

async function onPublishWorld() {
  if (isPublishing) return;
  if (!window.walletAddress) {
    alert("Please connect your wallet first.");
    return;
  }
  if (!window.activeManifestId) {
    alert("No world loaded to publish.");
    return;
  }

  isPublishing = true;
  if (publishBtn) publishBtn.disabled = true;
  const originalText = publishBtnText ? publishBtnText.textContent : "Publish";
  if (publishBtnText)
    publishBtnText.textContent = window.activeTokenId
      ? "Updating…"
      : "Publishing…";

  try {
    // 1. Resolve world name
    let worldName;
    if (window.activeTokenId) {
      worldName = await _fetchWorldName(window.activeTokenId);
      if (!worldName) worldName = "My World";
    } else {
      worldName = window.activeWorldName || "My World";
    }

    // 2. Fetch manifest content (may be an older version from history)
    const manifest = await getFromRemoteIPFS(window.activeManifestId);
    manifest.name = worldName;

    // 3. Handle reversion: if we loaded an older version, continue chain from latest
    const latestCid = window.latestManifestId || window.activeManifestId;
    if (latestCid && latestCid !== window.activeManifestId) {
      try {
        const latestManifest = await getFromRemoteIPFS(latestCid);
        manifest.version = (latestManifest.version || 0) + 1;
        manifest.prev_manifest_cid = latestCid;
      } catch {
        manifest.version = (manifest.version || 0) + 1;
        manifest.prev_manifest_cid = window.activeManifestId;
      }
    }
    // When already at latest, do not create redundant versions

    // 4. Attach an optional WebP thumbnail snapshot for published worlds.
    // If capture fails, publishing continues with the manifest unchanged.
    try {
      const thumbnail = await captureWorldThumbnail();
      if (thumbnail) {
        const previousThumbnailCid = manifest.thumbnail?.cid;
        manifest.thumbnail = previousThumbnailCid
          ? { ...thumbnail, cid: previousThumbnailCid }
          : thumbnail;
        console.log(
          `[PUBLISH] thumbnail captured | ${thumbnail.width}x${thumbnail.height} ${thumbnail.bytes} bytes`
        );
      }
    } catch (thumbnailError) {
      console.warn(
        "[PUBLISH] thumbnail capture skipped:",
        thumbnailError.message
      );
    }

    // 5. Push named manifest to IPFS
    const pushRes = await fetch("/api/push-ipfs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    if (!pushRes.ok) {
      throw new Error("Failed to push manifest to IPFS");
    }
    const namedCid = await pushRes.text();

    // 6. Existing token → UPDATE  |  New world → MINT
    if (window.activeTokenId) {
      const txHash = await updateTokenURI(window.activeTokenId, namedCid);
      if (!txHash) throw new Error("Update transaction failed");

      window.activeManifestId = namedCid;
      window.latestManifestId = namedCid;
      console.log(
        `World "${worldName.trim()}" updated on-chain! Token ID: ${
          window.activeTokenId
        }`
      );
    } else {
      const tokenId =
        "0x" +
        Array.from(namedCid)
          .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
          .toString(16)
          .replace(/^-/, "");

      const txHash = await mintWorld(namedCid, tokenId);
      if (!txHash) throw new Error("Mint transaction failed");

      window.activeTokenId = tokenId;
      window.activeManifestId = namedCid;
      window.latestManifestId = namedCid;
      _updateUrlWorld(tokenId);

      const { showTeamPanel } = await import("./team-panel.js");
      showTeamPanel(tokenId);
      console.log(`World "${worldName.trim()}" minted! Token ID: ${tokenId}`);
    }

    // 7. Refresh gallery
    document.dispatchEvent(
      new CustomEvent("wallet:worldMinted", {
        detail: { tokenId: window.activeTokenId },
      })
    );
    _updateButtonState();
  } catch (err) {
    console.error("Publish world failed:", err);
    alert("Publish failed: " + err.message);
  } finally {
    isPublishing = false;
    if (publishBtn) publishBtn.disabled = false;
    _updateButtonState();
  }
}

// ─── Event Bindings ───

if (saveBtn) {
  saveBtn.addEventListener("click", onSaveWorld);
}

if (publishBtn) {
  publishBtn.addEventListener("click", onPublishWorld);
}

document.addEventListener("scenegraph:ready", _updateButtonState);
document.addEventListener("scenegraph:ready", (e) => {
  const name = e.detail?.manifest?.name;
  if (name) {
    window.activeWorldName = name;
  }
});
document.addEventListener("scenegraph:empty", () => {
  if (saveSection) saveSection.hidden = true;
});
document.addEventListener("wallet:connected", _updateButtonState);
document.addEventListener("wallet:disconnected", () => {
  if (saveSection) saveSection.hidden = true;
});

// ─── CREATE NEW WORLD ───

async function onCreateNewWorld() {
  if (isCreatingNew) return;

  // Confirm if there's an active world with potential unsaved changes
  if (window.activeManifestId) {
    const ok = confirm("Start a new world? Any unsaved changes will be lost.");
    if (!ok) return;
  }

  isCreatingNew = true;
  if (newWorldTopBtn) newWorldTopBtn.disabled = true;

  try {
    const nameInput = prompt("Name your new world:", "My World");
    window.activeWorldName = nameInput ? nameInput.trim() : "My World";

    clearScene();
    window.activeTokenId = null;
    window.activeManifestId = null;
    window.latestManifestId = null;

    // Clear URL params
    const url = new URL(window.location);
    url.searchParams.delete("world");
    url.searchParams.delete("manifest");
    window.history.pushState({}, "", url);

    // Show welcome overlay to start fresh
    showWelcomeOverlay();
    document.dispatchEvent(new CustomEvent("scenegraph:empty"));

    // Hide save/publish section until a world is created again
    if (saveSection) saveSection.hidden = true;

    console.log(
      "New world created — start generating assets to build your scene."
    );
  } catch (err) {
    console.error("Create new world failed:", err);
  } finally {
    isCreatingNew = false;
    if (newWorldTopBtn) newWorldTopBtn.disabled = false;
  }
}

// ─── Event Bindings ───

if (newWorldTopBtn) {
  newWorldTopBtn.addEventListener("click", onCreateNewWorld);
}

// ─── Exports ───
export { onSaveWorld, onPublishWorld, onCreateNewWorld };
