/**
 * Arbesk Asset Library — token-centric browser for owned and shared assets.
 * Phase C: Library is now a sidebar view navigated by the View Switcher.
 *
 * Gallery semantics: each card represents one asset. Collection tokens are
 * expanded so every asset inside the collection gets its own card.
 */

import {
  loadAssetManifest,
  clearScene,
  dismissCreatePulse,
} from "../engine/scene-graph.js";
import {
  contract as walletContract,
  burn as burnToken,
  CollaboratorRole,
} from "../blockchain/wallet.js";
import { getProof } from "../gltf/merkle-editors.js";
import {
  getBlobFromRemoteIPFS,
  getFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { deleteAssetFromCollection } from "../services/asset-delete.js";
import { showConfirmDialog } from "./dialog.js";
import { showToast } from "./toasts.js";
import { updateUrlAsset, clearUrlAssetParams } from "../services/url-utils.js";
import { switchView } from "./sidebar.js";
import { CHAIN_IDS } from "../constants/chains.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";

let assetLibraryBody = null;
let libraryRenderInFlight = false;
let libraryRenderPending = false;

const EDITOR_LIST_PREFIX = "arbesk_editor_list_";

function getContract() {
  return walletContract || walletState.get().contract || null;
}

/**
 * Load the editor list for a token so we can build a Merkle proof for
 * on-chain actions (burn, URI update, etc.). Falls back to a owner-only
 * list because the token owner is always an Editor at mint time.
 */
async function loadEditorListForProof(tokenId) {
  const walletAddress = walletState.get().walletAddress;
  const contract = getContract();
  if (!walletAddress || !contract) return null;

  // 1) Try the locally cached editor list first.
  try {
    const stored = localStorage.getItem(EDITOR_LIST_PREFIX + tokenId);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed.list)) return parsed.list;
    }
  } catch {
    // localStorage unavailable or corrupted
  }

  // 2) Fall back to the IPFS editor list URI stored on-chain.
  try {
    const listCid = await contract.methods.editorListURI(tokenId).call();
    if (listCid) {
      const list = await getFromRemoteIPFS(listCid);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.warn(
      `[ASSET-LIBRARY] Failed to load editor list for ${tokenId}:`,
      err.message
    );
  }

  // 3) Last resort: owner-only list (matches the default mint editor set).
  return [{ address: walletAddress, role: CollaboratorRole.Editor }];
}

async function buildBurnProof(tokenId) {
  const walletAddress = walletState.get().walletAddress;
  const contract = getContract();
  if (!walletAddress || !contract) return null;

  try {
    const version = await contract.methods.editorSetVersion(tokenId).call();
    const editorList = await loadEditorListForProof(tokenId);
    if (!editorList || editorList.length === 0) return null;

    const result = getProof(
      editorList,
      walletAddress,
      tokenId,
      Number(version)
    );
    return result?.proof || [];
  } catch (err) {
    console.warn(`[ASSET-LIBRARY] Failed to build burn proof:`, err);
    return null;
  }
}

/**
 * Reconstruct the list of tokens currently owned by an address by scanning
 * ERC-721 Transfer events. This replaces the ERC721Enumerable
 * `tokenOfOwnerByIndex` function that was removed to save storage slots.
 */
async function fetchOwnedTokenIds(contract, address) {
  const lowerAddress = address.toLowerCase();
  const ownership = new Map();

  try {
    const [transfersTo, transfersFrom] = await Promise.all([
      contract.getPastEvents("Transfer", {
        filter: { to: address },
        fromBlock: 0,
        toBlock: "latest",
      }),
      contract.getPastEvents("Transfer", {
        filter: { from: address },
        fromBlock: 0,
        toBlock: "latest",
      }),
    ]);

    // Apply events in block order so the latest transfer for each tokenId wins.
    const allTransfers = [...transfersTo, ...transfersFrom].sort(
      (a, b) =>
        Number(a.blockNumber) - Number(b.blockNumber) ||
        Number(a.logIndex) - Number(b.logIndex)
    );

    for (const event of allTransfers) {
      const tokenId = String(event.returnValues.tokenId);
      ownership.set(tokenId, event.returnValues.to.toLowerCase());
    }
  } catch (err) {
    console.warn(
      "[ASSET-LIBRARY] Failed to fetch Transfer events:",
      err.message
    );
  }

  return Array.from(ownership.entries())
    .filter(([, currentOwner]) => currentOwner === lowerAddress)
    .map(([tokenId]) => tokenId);
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

  let owned = [];
  const shared = [];

  try {
    owned = await fetchOwnedTokenIds(contract, address);

    // Shared tokens (editor but not owner) are not discoverable on-chain
    // without an indexer because editor state is a Merkle root. A future
    // off-chain indexer can populate this list from EditorSetChanged events
    // and editor list IPFS CIDs.
    if (typeof contract.methods.listTokens === "function") {
      const memberTokens = await contract.methods.listTokens(address).call();
      for (const tokenId of memberTokens) {
        const id = String(tokenId);
        if (!owned.includes(id)) shared.push(id);
      }
    }
  } catch (err) {
    console.error("Asset library fetch failed:", err);
  }

  return { owned, shared };
}

/**
 * Resolve a token into a single gallery entry.
 * - Standalone asset token → one entry.
 * - Collection token → one representative entry using the first asset.
 *   The gallery cards are token-centric; the card's "Add to Scene" and
 *   "Delete" actions operate on the representative asset.
 */
async function expandTokenToAssets(tokenId) {
  const contract = getContract();
  if (!contract) return [];

  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) return [];

    const manifest = await getFromRemoteIPFS(cid);
    const base = { tokenId: String(tokenId), collectionCid: null };

    if (manifest?.type === "collection" && manifest.assets) {
      const assetEntries = Object.entries(manifest.assets);
      if (assetEntries.length === 0) return [];

      // Use the first asset as the token's representative card.
      const [assetId, assetCid] = assetEntries[0];
      let name = assetId;
      let thumbnail = manifest?.thumbnail || null;
      try {
        const assetManifest = await getFromRemoteIPFS(assetCid);
        name = assetManifest?.name || assetId;
        thumbnail = assetManifest?.thumbnail || thumbnail;
      } catch (err) {
        console.warn(
          `[ASSET-LIBRARY] Failed to load asset ${assetId} for token ${tokenId}`,
          err
        );
      }
      return [
        {
          ...base,
          assetId,
          manifestCid: assetCid,
          collectionCid: cid,
          name,
          thumbnail,
          isCollection: true,
        },
      ];
    }

    return [
      {
        ...base,
        assetId: null,
        manifestCid: cid,
        name: manifest?.name || `Asset #${tokenId}`,
        thumbnail: manifest?.thumbnail || null,
        isCollection: false,
      },
    ];
  } catch (err) {
    console.warn("[ASSET-LIBRARY] Failed to expand token", tokenId, err);
    return [];
  }
}

async function openAssetEntry(entry) {
  const contract = getContract();
  if (!contract) {
    console.warn("[LIBRARY] No contract available to open asset");
    return;
  }

  try {
    clearScene();

    if (entry.isCollection && entry.collectionCid) {
      const { loadCollectionManifest } = await import(
        "../engine/scene-graph.js"
      );
      const { assetEntries } = await loadCollectionManifest(
        entry.collectionCid,
        {
          chainId: walletState.get().chainId,
          contractAddress: walletState.get().contractAddress,
          tokenId: entry.tokenId,
        }
      );
      emit(EVENTS.COLLECTION_OPENED, {
        tokenId: entry.tokenId,
        assetEntries,
      });

      assetState.set({
        activeAssetTokenId: String(entry.tokenId),
        activeCollectionTokenId: String(entry.tokenId),
        activeAssetId: entry.assetId,
        activeAssetManifestCid: entry.manifestCid,
        latestAssetManifestCid: entry.manifestCid,
      });
    } else {
      assetState.set({
        activeAssetTokenId: String(entry.tokenId),
        activeAssetManifestCid: entry.manifestCid,
        latestAssetManifestCid: entry.manifestCid,
      });
    }

    dismissCreatePulse();
    updateUrlAsset(entry.tokenId);
    await loadAssetManifest(entry.manifestCid);

    const { showAssetEditors } = await import("./asset-editors.js");
    showAssetEditors(entry.tokenId);

    if (window.innerWidth <= 900) {
      switchView("library");
    }
  } catch (err) {
    console.error("Failed to open asset entry", entry, err);
    alert(`Failed to open asset #${entry.tokenId}`);
  }
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

    // Collections: load the collection manifest and auto-open the first asset
    // so that a page reload with ?asset=TOKENID restores the viewport.
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

      const assetIds = Object.keys(manifest.assets || {});
      const firstAssetId = assetIds[0] || null;
      const firstAssetCid = firstAssetId
        ? manifest.assets[firstAssetId]
        : null;

      clearScene();
      assetState.set({
        activeAssetTokenId: String(tokenId),
        activeCollectionTokenId: String(tokenId),
        activeAssetId: firstAssetId,
        activeAssetManifestCid: firstAssetCid,
        latestAssetManifestCid: firstAssetCid,
      });
      dismissCreatePulse();
      updateUrlAsset(tokenId);

      if (firstAssetCid) {
        await loadAssetManifest(firstAssetCid);
      }

      if (window.innerWidth <= 900) {
        switchView("library");
      }
      return;
    }

    // Standalone asset: load it directly.
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

/**
 * Build a payload for drag-drop / "Add to Scene" using the card's asset entry.
 */
function buildLinkedAssetPayload(entry) {
  const { chainId: walletChainId, contractAddress: walletContractAddress } =
    walletState.get();
  const payload = {
    type: "linked_asset",
    token_id: String(entry.tokenId),
    standard: "ERC721",
    resolution: "latest",
    chainId: Number(walletChainId || CHAIN_IDS.HARDHAT_LOCAL),
    contractAddress: walletContractAddress || null,
  };
  if (entry.assetId) payload.assetID = entry.assetId;
  return payload;
}

async function renderAssetLibrary(owned, shared) {
  if (!assetLibraryBody) return;
  assetLibraryBody.innerHTML = "";

  const ownedNested = await Promise.all(
    owned.map(async (tokenId) => {
      const entries = await expandTokenToAssets(tokenId);
      entries.forEach((e) => {
        e.role = "owner";
      });
      return entries;
    })
  );
  const ownedEntries = ownedNested.flat();

  const sharedNested = await Promise.all(
    shared.map(async (tokenId) => {
      const entries = await expandTokenToAssets(tokenId);
      entries.forEach((e) => {
        e.role = "editor";
      });
      return entries;
    })
  );
  const sharedEntries = sharedNested.flat();

  assetLibraryBody.appendChild(createSection("My Assets", ownedEntries));
  if (sharedEntries.length > 0) {
    assetLibraryBody.appendChild(
      createSection("Shared Assets", sharedEntries)
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

function createSection(title, entries) {
  const section = document.createElement("div");
  section.className = "asset-library-section";

  const heading = document.createElement("h4");
  heading.className = "asset-library-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  if (entries.length === 0) {
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
  for (const entry of entries) list.appendChild(createAssetCard(entry));
  section.appendChild(list);
  return section;
}

function createAssetCard(entry) {
  const item = document.createElement("div");
  item.className = "asset-card";
  item.dataset.tokenId = entry.tokenId;
  if (entry.assetId) item.dataset.assetId = entry.assetId;
  item.dataset.manifestCid = entry.manifestCid;
  item.draggable = true;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `Open asset ${entry.name}`);

  item.addEventListener("dragstart", (event) => {
    const payload = buildLinkedAssetPayload(entry);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "application/x-arbesk-linked-asset",
      JSON.stringify(payload)
    );
    event.dataTransfer.setData("text/plain", `${entry.name} Token #${entry.tokenId}`);
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
  nameEl.textContent = entry.name || `Loading… #${entry.tokenId}`;

  const badge = document.createElement("span");
  badge.className = `asset-card-badge ${
    entry.role === "owner" ? "badge-owner" : "badge-editor"
  }`;
  badge.textContent = entry.role === "owner" ? "Owner" : "Editor";

  // Click or keyboard activate anywhere on the card (except action buttons) to open.
  item.addEventListener("click", (e) => {
    if (e.target.closest(".asset-card-actions button")) return;
    openAssetEntry(entry);
  });
  item.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openAssetEntry(entry);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "btn btn-outline btn-sm";
  addBtn.textContent = "Add to Scene";
  addBtn.title = "Add this asset as a linked asset in the current scene";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    emit(EVENTS.ASSET_ADD_LINKED_REQUESTED, buildLinkedAssetPayload(entry));
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn btn-outline btn-danger btn-sm asset-card-delete";
  deleteBtn.title = "Remove this asset from its collection";
  deleteBtn.setAttribute("aria-label", `Delete asset ${entry.name}`);
  deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18"/>
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
  </svg><span>Delete</span>`;
  deleteBtn.addEventListener("click", (e) => onDeleteAsset(e, entry));

  const burnBtn = document.createElement("button");
  burnBtn.className = "btn btn-outline btn-danger btn-sm asset-card-burn";
  burnBtn.title = "Burn this token and remove it permanently";
  burnBtn.setAttribute("aria-label", `Burn token ${entry.tokenId}`);
  burnBtn.textContent = "Burn";
  burnBtn.addEventListener("click", (e) => onBurnAsset(e, entry));

  const meta = document.createElement("div");
  meta.className = "asset-card-meta";
  meta.appendChild(badge);

  const actions = document.createElement("div");
  actions.className = "asset-card-actions";
  actions.appendChild(addBtn);
  actions.appendChild(deleteBtn);
  actions.appendChild(burnBtn);

  item.appendChild(thumbnailEl);
  item.appendChild(nameEl);
  item.appendChild(meta);
  item.appendChild(actions);

  const runLoad = () => renderAssetThumbnail(entry.thumbnail, thumbnailEl, entry.name);
  reloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    runLoad();
  });
  runLoad();
  resolveDeleteVisibility(deleteBtn, entry.role);
  resolveBurnVisibility(burnBtn, entry.role);
  return item;
}

function resolveDeleteVisibility(deleteBtn, role) {
  deleteBtn.hidden = role !== "owner";
}

function resolveBurnVisibility(burnBtn, role) {
  burnBtn.hidden = role !== "owner";
}

async function onDeleteAsset(event, entry) {
  event.stopPropagation();

  if (!entry.isCollection || !entry.assetId) {
    showToast({
      type: "warning",
      title: "Cannot Delete",
      message: "This asset is not part of a collection.",
    });
    return;
  }

  try {
    await deleteAssetFromCollection({
      tokenId: entry.tokenId,
      assetId: entry.assetId,
      assetName: entry.name,
      onAfterDelete: refreshAssetLibrary,
    });
  } catch (err) {
    console.error("[ASSET-LIBRARY] Delete asset failed:", err);
    showToast({
      type: "error",
      title: "Delete Failed",
      message: err.message || "Could not remove asset from collection.",
    });
  }
}

async function onBurnAsset(event, entry) {
  event.stopPropagation();

  const result = await showConfirmDialog(
    "Burn token?",
    `This will permanently destroy token #${entry.tokenId}. This action cannot be undone.`,
    [
      { text: "Cancel", value: "cancel" },
      {
        text: "Burn",
        value: "burn",
        className: "btn btn-danger dialog-action-btn",
      },
    ]
  );

  if (result !== "burn") return;

  try {
    const proof = await buildBurnProof(entry.tokenId);
    if (!proof) {
      showToast({
        type: "error",
        title: "Burn Failed",
        message: "Could not build an editor proof for this token.",
      });
      return;
    }

    const txHash = await burnToken(entry.tokenId, proof);
    if (!txHash) {
      showToast({
        type: "error",
        title: "Burn Failed",
        message: "The burn transaction was not confirmed.",
      });
      return;
    }

    showToast({
      type: "success",
      title: "Token Burned",
      message: `Token #${entry.tokenId} was destroyed.`,
    });
  } catch (err) {
    console.error("[ASSET-LIBRARY] Burn failed:", err);
    showToast({
      type: "error",
      title: "Burn Failed",
      message: err.message || "Could not burn the token.",
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

async function refreshAssetLibrary() {
  const { walletAddress } = walletState.get();
  if (!walletAddress || !assetLibraryBody) return;

  if (libraryRenderInFlight) {
    libraryRenderPending = true;
    return;
  }

  do {
    libraryRenderInFlight = true;
    libraryRenderPending = false;
    const { owned, shared } = await fetchAssetLibrary(walletAddress);
    await renderAssetLibrary(owned, shared);
    libraryRenderInFlight = false;
  } while (libraryRenderPending);
}

function highlightActiveAsset() {
  if (!assetLibraryBody) return;
  const { activeAssetTokenId, activeAssetId } = assetState.get();
  const tokenIdMatch = activeAssetTokenId ? String(activeAssetTokenId) : null;
  const assetIdMatch = activeAssetId ? String(activeAssetId) : null;

  assetLibraryBody.querySelectorAll(".asset-card").forEach((el) => {
    const matchesToken = tokenIdMatch && el.dataset.tokenId === tokenIdMatch;
    const matchesAsset = assetIdMatch
      ? el.dataset.assetId === assetIdMatch
      : true;
    el.classList.toggle("active", Boolean(matchesToken && matchesAsset));
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
  clearScene();
  assetState.set({
    activeAssetTokenId: null,
    activeCollectionTokenId: null,
    activeAssetId: null,
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
    activeAssetName: null,
  });
  emit(EVENTS.SCENE_EMPTY);
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
