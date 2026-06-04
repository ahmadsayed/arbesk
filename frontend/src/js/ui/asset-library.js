/**
 * Arbesk Asset Library — token-centric browser for owned and shared assets.
 * Phase C: Library is now a sidebar view navigated by the View Switcher.
 */

import {
  loadAssetManifest,
  clearScene,
  hideWelcomeOverlay,
} from "../engine/scene-graph.js";
import { contract as walletContract } from "../blockchain/wallet.js";
import {
  getBlobFromRemoteIPFS,
  getFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { updateUrlAsset } from "../services/url-utils.js";
import { switchView } from "./sidebar.js";

let assetLibraryBody = null;

function getContract() {
  return walletContract || window.contract || null;
}

async function fetchAssetLibrary(address) {
  const contract = getContract();
  if (!contract || !address) return { owned: [], shared: [] };

  const owned = [];
  const shared = [];

  try {
    const balance = await contract.methods.balanceOf(address).call();
    for (let i = 0; i < Number(balance); i++) {
      const tokenId = await contract.methods
        .tokenOfOwnerByIndex(address, i)
        .call();
      owned.push(String(tokenId));
    }

    const memberTokens = await contract.methods.listTokens(address).call();
    for (const tokenId of memberTokens) {
      const id = String(tokenId);
      if (!owned.includes(id)) shared.push(id);
    }
  } catch (err) {
    console.error("Asset library fetch failed:", err);
  }

  return { owned, shared };
}

async function openAssetByTokenId(tokenId) {
  const contract = getContract();
  if (!contract) {
    const overlay = document.getElementById("welcomeOverlay");
    if (overlay) overlay.hidden = false;
    return;
  }

  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) {
      alert(`Asset not found for Token ID: ${tokenId}`);
      return;
    }

    clearScene();
    window.activeAssetTokenId = String(tokenId);
    window.activeAssetManifestCid = cid;
    window.latestAssetManifestCid = cid;

    hideWelcomeOverlay();
    updateUrlAsset(tokenId);
    await loadAssetManifest(cid);

    const { showAssetEditors } = await import("./asset-editors.js");
    showAssetEditors(tokenId);

    if (window.innerWidth <= 900) {
      switchView("library");
    }
  } catch (err) {
    console.error("Failed to open asset by Token ID:", err);
    alert(`Failed to open asset #${tokenId}`);
  }
}

function renderAssetLibrary(owned, shared) {
  if (!assetLibraryBody) return;
  assetLibraryBody.innerHTML = "";

  assetLibraryBody.appendChild(createSection("My Assets", owned, "owner"));
  if (shared.length > 0) {
    assetLibraryBody.appendChild(
      createSection("Shared Assets", shared, "editor")
    );
  }
}

function createSection(title, tokenIds, role) {
  const section = document.createElement("div");
  section.className = "asset-library-section";

  const heading = document.createElement("h4");
  heading.className = "asset-library-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  if (tokenIds.length === 0) {
    const empty = document.createElement("p");
    empty.className = "asset-library-empty";
    empty.textContent =
      title === "My Assets"
        ? "No assets yet. Create one!"
        : "No shared assets yet.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("div");
  list.className = "asset-library-list";
  for (const tokenId of tokenIds)
    list.appendChild(createAssetCard(tokenId, role));
  section.appendChild(list);
  return section;
}

function createAssetCard(tokenId, role) {
  const item = document.createElement("div");
  item.className = "asset-library-item";
  item.dataset.tokenId = tokenId;
  item.draggable = true;

  item.addEventListener("dragstart", (event) => {
    const chainId = Number(window.chainId || window.walletChainId || 314159);
    const contractAddr =
      window.contractAddress || window._contractAddress || null;
    const payload = {
      type: "linked_asset",
      token_id: String(tokenId),
      standard: "ERC721",
      resolution: "latest",
      chainId,
      contractAddress: contractAddr,
    };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-arbesk-linked-asset",
      JSON.stringify(payload)
    );
    event.dataTransfer.setData("text/plain", `Asset Token #${tokenId}`);
  });

  const thumbnailEl = document.createElement("div");
  thumbnailEl.className =
    "asset-library-item-thumbnail asset-library-item-thumbnail-empty";
  thumbnailEl.textContent = "✦";

  const idEl = document.createElement("div");
  idEl.className = "asset-library-item-id";
  idEl.textContent = `Token #${tokenId}`;

  const nameEl = document.createElement("div");
  nameEl.className = "asset-library-item-name";
  nameEl.textContent = "Loading…";

  const badge = document.createElement("span");
  badge.className = `asset-library-item-badge ${
    role === "owner" ? "badge-owner" : "badge-editor"
  }`;
  badge.textContent = role === "owner" ? "Owner" : "Editor";

  const openBtn = document.createElement("button");
  openBtn.className = "asset-library-item-open btn-outline btn-sm";
  openBtn.textContent = "Open";
  openBtn.addEventListener("click", () => openAssetByTokenId(tokenId));

  const addBtn = document.createElement("button");
  addBtn.className = "asset-library-item-add btn-secondary btn-sm";
  addBtn.textContent = "Add to Scene";
  addBtn.title = "Add this asset as a linked asset in the current scene";
  addBtn.addEventListener("click", () => {
    const chainId = Number(window.chainId || window.walletChainId || 314159);
    const contractAddr =
      window.contractAddress || window._contractAddress || null;
    document.dispatchEvent(
      new CustomEvent("asset:addLinkedRequested", {
        detail: {
          token_id: String(tokenId),
          standard: "ERC721",
          resolution: "latest",
          chainId,
          contractAddress: contractAddr,
        },
      })
    );
  });

  const meta = document.createElement("div");
  meta.className = "asset-library-item-meta";
  meta.appendChild(badge);

  const actions = document.createElement("div");
  actions.className = "asset-library-item-actions";
  actions.appendChild(openBtn);
  actions.appendChild(addBtn);

  item.appendChild(thumbnailEl);
  item.appendChild(idEl);
  item.appendChild(nameEl);
  item.appendChild(meta);
  item.appendChild(actions);

  loadAssetMetadata(tokenId, nameEl, thumbnailEl);
  return item;
}

function extractThumbnailCid(thumbnail) {
  if (!thumbnail) return null;
  if (typeof thumbnail === "string") return thumbnail;
  return thumbnail.cid || thumbnail.source?.cid || null;
}

async function renderAssetThumbnail(thumbnail, thumbnailEl, assetName) {
  const thumbnailCid = extractThumbnailCid(thumbnail);
  if (!thumbnailCid) return;

  try {
    const blob = await getBlobFromRemoteIPFS(thumbnailCid);
    const objectUrl = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.alt = `${assetName || "Asset"} thumbnail`;
    img.loading = "lazy";
    img.src = objectUrl;
    img.addEventListener("load", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    img.addEventListener("error", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    thumbnailEl.textContent = "";
    thumbnailEl.classList.remove("asset-library-item-thumbnail-empty");
    thumbnailEl.appendChild(img);
  } catch (err) {
    console.warn("Failed to load asset thumbnail", thumbnailCid, err);
  }
}

async function loadAssetMetadata(tokenId, nameEl, thumbnailEl) {
  const contract = getContract();
  if (!contract) return;
  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) {
      nameEl.textContent = "Unnamed Asset";
      return;
    }
    const manifest = await getFromRemoteIPFS(cid);
    const assetName = manifest.name || "Unnamed Asset";
    nameEl.textContent = assetName;
    await renderAssetThumbnail(manifest.thumbnail, thumbnailEl, assetName);
  } catch (err) {
    console.warn("Failed to load asset metadata for token", tokenId, err);
    nameEl.textContent = "Unnamed Asset";
  }
}

async function refreshAssetLibrary() {
  if (!window.walletAddress || !assetLibraryBody) return;
  const { owned, shared } = await fetchAssetLibrary(window.walletAddress);
  renderAssetLibrary(owned, shared);
}

function highlightActiveAsset() {
  if (!assetLibraryBody || !window.activeAssetTokenId) return;
  assetLibraryBody.querySelectorAll(".asset-library-item").forEach((el) => {
    el.classList.toggle(
      "active",
      el.dataset.tokenId === String(window.activeAssetTokenId)
    );
  });
}

function initAssetLibrary() {
  assetLibraryBody = document.getElementById("assetLibraryBody");
}

document.addEventListener("scene:ready", highlightActiveAsset);
document.addEventListener("asset:published", async () => {
  await refreshAssetLibrary();
  highlightActiveAsset();
});

document.addEventListener("asset:openByTokenId", (e) => {
  if (e.detail?.tokenId) openAssetByTokenId(e.detail.tokenId);
});

document.addEventListener("wallet:connected", async () => {
  await refreshAssetLibrary();
  switchView("library");

  const assetTokenId = new URLSearchParams(window.location.search).get("asset");
  if (assetTokenId && getContract()) await openAssetByTokenId(assetTokenId);
});

document.addEventListener("wallet:disconnected", () => {
  if (assetLibraryBody) {
    assetLibraryBody.innerHTML =
      '<p class="asset-library-empty">Connect wallet to browse your asset tokens.</p>';
  }
});

export {
  initAssetLibrary,
  openAssetByTokenId,
  fetchAssetLibrary,
  refreshAssetLibrary,
};
