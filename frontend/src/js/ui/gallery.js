/**
 * Arbesk Gallery Panel — TokenID-centric world browser
 *
 * Right-side expandable panel showing:
 *   • My Worlds (owned tokens)
 *   • Team Worlds (editable tokens)
 *
 * TokenID is the sole user-facing reference. CID lives only in the smart contract.
 */

import { loadManifest, clearScene } from "../engine/scene-graph.js";
import { contract as walletContract } from "../blockchain/wallet.js";
import {
  getBlobFromRemoteIPFS,
  getFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";

/** @returns {object|null} */
function getContract() {
  return walletContract || window.contract || null;
}

// ─── DOM References ───
let galleryPanel = null;
let galleryBody = null;
let galleryToggle = null;
let showGalleryBtn = null;

// ─── Gallery Data Fetching ───

/**
 * Fetch all tokens relevant to a wallet address.
 * @param {string} address
 * @returns {Promise<{owned: string[], team: string[]}>}
 */
async function fetchUserGallery(address) {
  const contract = getContract();
  if (!contract || !address) {
    return { owned: [], team: [] };
  }

  const owned = [];
  const team = [];

  try {
    const balance = await contract.methods.balanceOf(address).call();
    const balanceNum = Number(balance);

    for (let i = 0; i < balanceNum; i++) {
      const tokenId = await contract.methods
        .tokenOfOwnerByIndex(address, i)
        .call();
      owned.push(String(tokenId));
    }

    // listTokens returns all tokens where address is a member (owner + editors)
    const allMemberTokens = await contract.methods.listTokens(address).call();
    for (const tokenId of allMemberTokens) {
      const tokenIdStr = String(tokenId);
      if (!owned.includes(tokenIdStr)) {
        team.push(tokenIdStr);
      }
    }
  } catch (err) {
    console.error("Gallery fetch failed:", err);
  }

  return { owned, team };
}

// ─── World Loading by TokenID ───

/**
 * Load a world into the scene given its TokenID.
 * Queries the contract for the CID, then loads the manifest.
 */
async function loadWorldByTokenId(tokenId) {
  const contract = getContract();
  if (!contract) {
    // Contract not ready yet — show welcome overlay and wait for wallet connection
    const overlay = document.getElementById("welcomeOverlay");
    if (overlay) overlay.hidden = false;
    return;
  }

  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid || cid === "") {
      alert("World not found for Token ID: " + tokenId);
      return;
    }

    clearScene();
    window.activeTokenId = String(tokenId);
    window.activeManifestId = cid;
    window.latestManifestId = cid;

    _hideWelcomeOverlay();
    _updateUrlWorld(tokenId);

    await loadManifest(cid);

    // Reveal team panel for this world
    const { showTeamPanel } = await import("./team-panel.js");
    showTeamPanel(tokenId);

    // On mobile, auto-collapse gallery after selection
    if (window.innerWidth <= 768) {
      collapseGallery();
    }
  } catch (err) {
    console.error("Failed to load world by TokenID:", err);
    alert("Failed to load world #" + tokenId);
  }
}

function _hideWelcomeOverlay() {
  const overlay = document.getElementById("welcomeOverlay");
  if (overlay) overlay.hidden = true;
}

function _updateUrlWorld(tokenId) {
  const url = new URL(window.location);
  url.searchParams.delete("manifest");
  url.searchParams.set("world", String(tokenId));
  window.history.pushState({}, "", url);
}

// ─── Gallery Rendering ───

function renderGallery(owned, team) {
  if (!galleryBody) return;
  galleryBody.innerHTML = "";

  // ─ My Worlds ─
  const ownedSection = document.createElement("div");
  ownedSection.className = "gallery-section";

  const ownedTitle = document.createElement("h4");
  ownedTitle.className = "gallery-section-title";
  ownedTitle.textContent = "My Worlds";
  ownedSection.appendChild(ownedTitle);

  if (owned.length === 0) {
    const empty = document.createElement("p");
    empty.className = "gallery-empty";
    empty.textContent = "No worlds yet. Create one!";
    ownedSection.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "gallery-list";
    for (const tokenId of owned) {
      list.appendChild(_createGalleryItem(tokenId, "owner"));
    }
    ownedSection.appendChild(list);
  }
  galleryBody.appendChild(ownedSection);

  // ─ Team Worlds ─
  if (team.length > 0) {
    const teamSection = document.createElement("div");
    teamSection.className = "gallery-section";

    const teamTitle = document.createElement("h4");
    teamTitle.className = "gallery-section-title";
    teamTitle.textContent = "Team Worlds";
    teamSection.appendChild(teamTitle);

    const list = document.createElement("div");
    list.className = "gallery-list";
    for (const tokenId of team) {
      list.appendChild(_createGalleryItem(tokenId, "editor"));
    }
    teamSection.appendChild(list);
    galleryBody.appendChild(teamSection);
  }
}

function _createGalleryItem(tokenId, role) {
  const item = document.createElement("div");
  item.className = "gallery-item";
  item.dataset.tokenId = tokenId;

  const thumbnailEl = document.createElement("div");
  thumbnailEl.className = "gallery-item-thumbnail gallery-item-thumbnail-empty";
  thumbnailEl.textContent = "✦";

  const idEl = document.createElement("div");
  idEl.className = "gallery-item-id";
  idEl.textContent = "#" + tokenId;

  // Name placeholder — filled asynchronously
  const nameEl = document.createElement("div");
  nameEl.className = "gallery-item-name";
  nameEl.textContent = "Loading…";
  nameEl.dataset.tokenId = tokenId;

  const badge = document.createElement("span");
  badge.className =
    "gallery-item-badge " + (role === "owner" ? "badge-owner" : "badge-editor");
  badge.textContent = role === "owner" ? "Owner" : "Editor";

  const loadBtn = document.createElement("button");
  loadBtn.className = "gallery-item-load btn-arabesque-outline btn-sm";
  loadBtn.textContent = "Load";
  loadBtn.addEventListener("click", () => loadWorldByTokenId(tokenId));

  const meta = document.createElement("div");
  meta.className = "gallery-item-meta";
  meta.appendChild(badge);
  meta.appendChild(loadBtn);

  item.appendChild(thumbnailEl);
  item.appendChild(idEl);
  item.appendChild(nameEl);
  item.appendChild(meta);

  // Lazy-load display metadata from manifest
  _loadWorldMetadata(tokenId, nameEl, thumbnailEl);

  return item;
}

function _extractThumbnailCid(thumbnail) {
  if (!thumbnail) return null;
  if (typeof thumbnail === "string") return thumbnail;
  return thumbnail.cid || thumbnail.source?.cid || null;
}

async function _renderWorldThumbnail(thumbnail, thumbnailEl, worldName) {
  if (!thumbnailEl) return;

  const thumbnailCid = _extractThumbnailCid(thumbnail);
  if (!thumbnailCid) return;

  try {
    const blob = await getBlobFromRemoteIPFS(thumbnailCid);
    const objectUrl = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.alt = `${worldName || "World"} thumbnail`;
    img.loading = "lazy";
    img.src = objectUrl;
    img.addEventListener("load", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    img.addEventListener("error", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });

    thumbnailEl.textContent = "";
    thumbnailEl.classList.remove("gallery-item-thumbnail-empty");
    thumbnailEl.appendChild(img);
  } catch (err) {
    console.warn("Failed to load world thumbnail", thumbnailCid, err);
  }
}

/**
 * Fetch manifest for a token and display its gallery metadata.
 */
async function _loadWorldMetadata(tokenId, nameEl, thumbnailEl) {
  const contract = getContract();
  if (!contract) return;
  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) {
      nameEl.textContent = "Unnamed World";
      return;
    }
    const manifest = await getFromRemoteIPFS(cid);
    const worldName = manifest.name || "Unnamed World";
    nameEl.textContent = worldName;
    await _renderWorldThumbnail(manifest.thumbnail, thumbnailEl, worldName);
  } catch (err) {
    console.warn("Failed to load world metadata for token", tokenId, err);
    nameEl.textContent = "Unnamed World";
  }
}

// ─── Gallery Toggle ───

function expandGallery() {
  if (!galleryPanel) return;
  galleryPanel.classList.remove("collapsed");
  if (showGalleryBtn) {
    showGalleryBtn.style.opacity = "0";
    showGalleryBtn.style.pointerEvents = "none";
  }
}

function collapseGallery() {
  if (!galleryPanel) return;
  galleryPanel.classList.add("collapsed");
  if (showGalleryBtn) {
    showGalleryBtn.style.opacity = "1";
    showGalleryBtn.style.pointerEvents = "auto";
  }
}

function toggleGallery() {
  if (!galleryPanel) return;
  if (galleryPanel.classList.contains("collapsed")) {
    expandGallery();
  } else {
    collapseGallery();
  }
}

// ─── Refresh / Update ───

/**
 * Re-fetch and re-render the gallery for the connected wallet.
 */
async function refreshGallery() {
  if (!window.walletAddress || !galleryBody) return;
  const { owned, team } = await fetchUserGallery(window.walletAddress);
  renderGallery(owned, team);
}

/**
 * Highlight the currently active world in the gallery.
 */
function highlightActiveWorld() {
  if (!galleryBody || !window.activeTokenId) return;
  galleryBody.querySelectorAll(".gallery-item").forEach((el) => {
    el.classList.toggle(
      "active",
      el.dataset.tokenId === String(window.activeTokenId)
    );
  });
}

// ─── Init ───

function initGallery() {
  galleryPanel = document.getElementById("galleryPanel");
  galleryBody = document.getElementById("galleryBody");
  galleryToggle = document.getElementById("galleryToggle");
  showGalleryBtn = document.getElementById("showGalleryBtn");

  if (galleryToggle) {
    galleryToggle.addEventListener("click", toggleGallery);
  }
  if (showGalleryBtn) {
    showGalleryBtn.addEventListener("click", expandGallery);
  }
}

// ─── Event Listeners ───

document.addEventListener("scenegraph:ready", () => {
  highlightActiveWorld();
});

document.addEventListener("wallet:worldMinted", async () => {
  await refreshGallery();
  highlightActiveWorld();
});

// Listen for TokenID-based load requests (e.g. from URL ?world=<tokenId> on page load)
document.addEventListener("world:loadByTokenId", (e) => {
  if (e.detail?.tokenId) {
    loadWorldByTokenId(e.detail.tokenId);
  }
});

// On wallet connect: refresh gallery, expand panel, and retry any pending ?world= load
document.addEventListener("wallet:connected", async (e) => {
  await refreshGallery();
  expandGallery();

  const urlParams = new URLSearchParams(window.location.search);
  const worldTokenId = urlParams.get("world");
  if (worldTokenId && getContract()) {
    await loadWorldByTokenId(worldTokenId);
  }
});

document.addEventListener("wallet:disconnected", () => {
  if (galleryBody) {
    galleryBody.innerHTML =
      '<p class="gallery-empty">Connect wallet to view your worlds.</p>';
  }
  collapseGallery();
});

// Reveal gallery button once wallet is connected
document.addEventListener("wallet:connected", () => {
  if (showGalleryBtn) {
    showGalleryBtn.style.display = "flex";
  }
});

document.addEventListener("wallet:disconnected", () => {
  if (showGalleryBtn) {
    showGalleryBtn.style.display = "none";
  }
});

// ─── Exports ───

export {
  initGallery,
  loadWorldByTokenId,
  fetchUserGallery,
  refreshGallery,
  expandGallery,
  collapseGallery,
  toggleGallery,
};
