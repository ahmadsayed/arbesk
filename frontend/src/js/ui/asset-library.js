/**
 * Arbesk Asset Library — token-centric browser for owned and shared assets.
 * Phase C: Library is now a sidebar view navigated by the View Switcher.
 */

import {
  loadAssetManifest,
  clearScene,
  dismissCreatePulse,
} from "../engine/scene-graph.js";
import { burn, contract as walletContract } from "../blockchain/wallet.js";
import {
  getBlobFromRemoteIPFS,
  getFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { showConfirmDialog } from "./dialog.js";
import { showToast } from "./toasts.js";
import { updateUrlAsset, clearUrlAssetParams } from "../services/url-utils.js";
import { switchView } from "./sidebar.js";
import { CHAIN_IDS } from "../constants/chains.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";

let assetLibraryBody = null;

function getContract() {
  return walletContract || walletState.get().contract || null;
}

async function fetchAssetLibrary(address) {
  const contract = getContract();
  if (!contract || !address) {
    console.warn(
      "[ASSET-LIBRARY] No contract available. " +
        "Check that your wallet is connected to the correct network."
    );
    return { owned: [], shared: [] };
  }

  const owned = [];
  const shared = [];

  try {
    const balance = await contract.methods.balanceOf(address).call();
    const indices = Array.from({ length: Number(balance) }, (_, i) => i);
    const ids = await Promise.all(
      indices.map((i) =>
        contract.methods.tokenOfOwnerByIndex(address, i).call()
      )
    );
    ids.forEach((id) => owned.push(String(id)));

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
    console.warn("[LIBRARY] No contract available to open asset");
    return;
  }

  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) {
      alert(`Asset not found for Token ID: ${tokenId}`);
      return;
    }

    const manifest = await getFromRemoteIPFS(cid);
    if (manifest?.type === "collection") {
      const { loadCollectionManifest } = await import(
        "../engine/scene-graph.js"
      );
      const { assetEntries } = await loadCollectionManifest(cid, {
        chainId: walletState.get().chainId,
        contractAddress: walletState.get().contractAddress,
        tokenId,
      });
      emit(EVENTS.COLLECTION_OPENED, { tokenId, assetEntries });

      // Auto-load the first asset from the collection into the viewport.
      const firstAsset = assetEntries.find((e) => e.kind === "asset");
      if (firstAsset) {
        clearScene();
        assetState.set({
          activeAssetTokenId: String(tokenId),
          activeCollectionTokenId: String(tokenId),
          activeAssetId: firstAsset.assetID,
          activeAssetManifestCid: firstAsset.value,
          latestAssetManifestCid: firstAsset.value,
        });
        dismissCreatePulse();
        updateUrlAsset(tokenId);
        await loadAssetManifest(firstAsset.value);

        const { showAssetEditors } = await import("./asset-editors.js");
        showAssetEditors(tokenId);

        if (window.innerWidth <= 900) {
          switchView("library");
        }
      }
      return;
    }

    clearScene();
    assetState.set({
      activeAssetTokenId: String(tokenId),
      activeAssetManifestCid: cid,
      latestAssetManifestCid: cid,
    });

    dismissCreatePulse();
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

function createEmptyState(title, sub) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";

  const icon = document.createElement("div");
  icon.className = "empty-state-icon";
  icon.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
    <line x1="12" y1="22.08" x2="12" y2="12"></line>
  </svg>`;
  wrap.appendChild(icon);

  const h = document.createElement("p");
  h.className = "empty-state-title";
  h.textContent = title;
  wrap.appendChild(h);

  const p = document.createElement("p");
  p.className = "empty-state-sub";
  p.textContent = sub;
  wrap.appendChild(p);

  return wrap;
}

function createSection(title, tokenIds, role) {
  const section = document.createElement("div");
  section.className = "asset-library-section";

  const heading = document.createElement("h4");
  heading.className = "asset-library-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  if (tokenIds.length === 0) {
    const empty =
      title === "My Assets"
        ? createEmptyState(
            "No assets yet",
            "Create your first asset to see it here."
          )
        : createEmptyState(
            "No shared assets",
            "Assets shared with you will appear here."
          );
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
  item.className = "asset-card";
  item.dataset.tokenId = tokenId;
  item.draggable = true;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `Open asset ${tokenId}`);

  item.addEventListener("dragstart", (event) => {
    const { chainId: walletChainId, contractAddress: walletContractAddress } =
      walletState.get();
    const chainId = Number(walletChainId || CHAIN_IDS.HARDHAT_LOCAL);
    const contractAddr = walletContractAddress || null;
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
  thumbnailEl.className = "asset-card-thumbnail asset-card-thumbnail-empty";
  thumbnailEl.textContent = "✦";

  // Reload overlay that appears when metadata fails to load
  const reloadBtn = document.createElement("button");
  reloadBtn.className = "asset-card-reload";
  reloadBtn.type = "button";
  reloadBtn.title = "Retry loading asset metadata";
  reloadBtn.setAttribute("aria-label", "Retry loading asset metadata");
  reloadBtn.hidden = true;
  reloadBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/>
  </svg>`;
  thumbnailEl.appendChild(reloadBtn);

  const nameEl = document.createElement("div");
  nameEl.className = "asset-card-name";
  nameEl.textContent = `Loading… #${tokenId}`;

  const badge = document.createElement("span");
  badge.className = `asset-card-badge ${
    role === "owner" ? "badge-owner" : "badge-editor"
  }`;
  badge.textContent = role === "owner" ? "Owner" : "Editor";

  // Click or keyboard activate anywhere on the card (except action buttons) to open.
  item.addEventListener("click", (e) => {
    if (e.target.closest(".asset-card-actions button")) return;
    openAssetByTokenId(tokenId);
  });
  item.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openAssetByTokenId(tokenId);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-outline btn-sm";
  addBtn.textContent = "Add to Scene";
  addBtn.title = "Add this asset as a linked asset in the current scene";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const { chainId: walletChainId, contractAddress: walletContractAddress } =
      walletState.get();
    const chainId = Number(walletChainId || CHAIN_IDS.HARDHAT_LOCAL);
    const contractAddr = walletContractAddress || null;
    emit(EVENTS.ASSET_ADD_LINKED_REQUESTED, {
      token_id: String(tokenId),
      standard: "ERC721",
      resolution: "latest",
      chainId,
      contractAddress: contractAddr,
    });
  });

  const burnBtn = document.createElement("button");
  burnBtn.className = "btn btn-outline btn-danger btn-sm asset-card-burn";
  burnBtn.title = "Permanently burn this asset";
  burnBtn.setAttribute("aria-label", `Burn asset ${tokenId}`);
  burnBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.048 8.287 8.287 0 0 0 9 9.6a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z"/>
    <path d="M12 18a3.75 3.75 0 0 0 .495-7.467 5.99 5.99 0 0 0-1.925 3.546 5.974 5.974 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z"/>
  </svg><span>Burn</span>`;
  burnBtn.addEventListener("click", (e) => onBurnAsset(e, tokenId));

  const meta = document.createElement("div");
  meta.className = "asset-card-meta";
  meta.appendChild(badge);

  const actions = document.createElement("div");
  actions.className = "asset-card-actions";
  actions.appendChild(addBtn);
  actions.appendChild(burnBtn);

  item.appendChild(thumbnailEl);
  item.appendChild(nameEl);
  item.appendChild(meta);
  item.appendChild(actions);

  const runLoad = () =>
    loadAssetMetadata(tokenId, nameEl, thumbnailEl, reloadBtn, item);
  reloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    runLoad();
  });
  runLoad();
  resolveBurnVisibility(burnBtn, tokenId, role);
  return item;
}

async function resolveBurnVisibility(burnBtn, tokenId, role) {
  if (role === "owner") {
    burnBtn.hidden = false;
    return;
  }
  const contract = getContract();
  const { walletAddress } = walletState.get();
  if (!contract || !walletAddress) return;
  try {
    // Show burn for any token (editor verified at burn time via Merkle proof).
    burnBtn.hidden = false;
  } catch {
    burnBtn.hidden = true;
  }
}

async function onBurnAsset(event, tokenId) {
  event.stopPropagation();
  const confirmed = await showConfirmDialog(
    "Burn Asset",
    `Are you sure you want to permanently burn Asset #${tokenId}? This action cannot be undone. The token will be destroyed, its on-chain record removed, and all collaborators will lose access.`,
    [
      { text: "Cancel", value: "cancel" },
      { text: "Burn", value: "burn", className: "btn btn-danger" },
    ]
  );

  if (confirmed !== "burn") return;

  const txHash = await burn(tokenId, []);
  if (txHash) {
    if (String(assetState.get().activeAssetTokenId) === String(tokenId)) {
      emit(EVENTS.ASSET_CLEARED);
    }
    showToast({
      type: "info",
      title: "Asset Burned",
      message: `Asset #${tokenId} has been permanently destroyed.`,
    });
  }
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
    thumbnailEl.classList.remove("asset-card-thumbnail-empty");
    thumbnailEl.appendChild(img);
  } catch (err) {
    console.warn("Failed to load asset thumbnail", thumbnailCid, err);
  }
}

/**
 * Summarize a collection manifest for gallery card rendering.
 * Pure function — no I/O.
 */
function buildCollectionCardSummary(manifest, tokenId) {
  const assetCount = manifest?.assets ? Object.keys(manifest.assets).length : 0;
  return {
    tokenId: String(tokenId),
    name: manifest?.name || `Collection #${tokenId}`,
    assetCount,
    thumbnailCid: manifest?.thumbnail?.cid || null,
  };
}

async function loadAssetMetadata(
  tokenId,
  nameEl,
  thumbnailEl,
  reloadBtn,
  item
) {
  const contract = getContract();
  if (!contract) return;

  nameEl.textContent = `Loading… #${tokenId}`;
  thumbnailEl.className = "asset-card-thumbnail asset-card-thumbnail-empty";
  thumbnailEl.classList.remove("asset-card-thumbnail-error");
  item?.classList.remove("asset-card-error");
  if (reloadBtn) reloadBtn.hidden = true;

  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) {
      nameEl.textContent = "Unnamed Asset";
      return;
    }
    const manifest = await getFromRemoteIPFS(cid);
    const summary = buildCollectionCardSummary(manifest, tokenId);
    nameEl.textContent = `${summary.name} (${summary.assetCount} asset${
      summary.assetCount === 1 ? "" : "s"
    })`;
    await renderAssetThumbnail(manifest.thumbnail, thumbnailEl, summary.name);
  } catch (err) {
    console.warn("Failed to load asset metadata for token", tokenId, err);
    nameEl.textContent = `Asset #${tokenId} (unreachable)`;
    item?.classList.add("asset-card-error");
    thumbnailEl.classList.add("asset-card-thumbnail-error");
    if (reloadBtn) reloadBtn.hidden = false;
  }
}

async function refreshAssetLibrary() {
  const { walletAddress } = walletState.get();
  if (!walletAddress || !assetLibraryBody) return;
  const { owned, shared } = await fetchAssetLibrary(walletAddress);
  renderAssetLibrary(owned, shared);
}

function highlightActiveAsset() {
  if (!assetLibraryBody || !assetState.get().activeAssetTokenId) return;
  assetLibraryBody.querySelectorAll(".asset-card").forEach((el) => {
    el.classList.toggle(
      "active",
      el.dataset.tokenId === String(assetState.get().activeAssetTokenId)
    );
  });
}

// Rich disconnected empty-state, mirrors the static markup in studio.pug so
// the Connect affordance reappears after a disconnect.
const DISCONNECTED_GALLERY_HTML = `
  <div class="empty-state">
    <div class="empty-state-icon">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path>
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path>
        <path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path>
      </svg>
    </div>
    <p class="empty-state-title">No assets yet</p>
    <p class="empty-state-sub">Connect your wallet to browse and open the asset tokens you own.</p>
    <button id="galleryConnectBtn" class="empty-state-action btn btn-primary btn-sm" type="button">Connect Wallet</button>
  </div>`;

function initAssetLibrary() {
  assetLibraryBody = document.getElementById("assetLibraryBody");

  // Delegated: the gallery Connect affordance mirrors the headerbar button.
  assetLibraryBody?.addEventListener("click", (e) => {
    if (e.target.closest("#galleryConnectBtn")) {
      document.getElementById("connectWalletBtn")?.click();
    }
  });
}

on(EVENTS.SCENE_READY, highlightActiveAsset);
on(EVENTS.ASSET_PUBLISHED, async () => {
  await refreshAssetLibrary();
  highlightActiveAsset();
});

on(EVENTS.ASSET_BURNED, async () => {
  clearUrlAssetParams();
  await refreshAssetLibrary();
});

on(EVENTS.ASSET_CLEARED, async () => {
  clearScene();
  emit(EVENTS.SCENE_EMPTY);
  clearUrlAssetParams();
  await refreshAssetLibrary();
});

on(EVENTS.ASSET_OPEN_BY_TOKEN_ID, (e) => {
  if (e?.tokenId) openAssetByTokenId(e.tokenId);
});

on(EVENTS.WALLET_CONNECTED, async () => {
  await refreshAssetLibrary();

  const assetTokenId = new URLSearchParams(window.location.search).get("asset");
  if (assetTokenId && getContract()) await openAssetByTokenId(assetTokenId);
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  if (assetLibraryBody) {
    assetLibraryBody.innerHTML = DISCONNECTED_GALLERY_HTML;
  }
});

export {
  initAssetLibrary,
  openAssetByTokenId,
  fetchAssetLibrary,
  refreshAssetLibrary,
};
