// @ts-nocheck
/**
 * Arbesk Asset Library - token-centric browser for owned and shared assets.
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
import { contract as walletContract, web3 } from "../blockchain/wallet.js";
import {
  getBlobFromRemoteIPFS,
  getFromRemoteIPFS,
} from "../ipfs/remote-ipfs.js";
import { deleteAssetFromCollection } from "../services/asset-delete.js";
import { showToast } from "./toasts.js";
import { updateUrlAsset, clearUrlAssetParams } from "../services/url-utils.js";
import { switchView } from "./sidebar.js";
import { CHAIN_IDS, DEPLOYMENT_BLOCKS } from "../../../../constants/chains.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";
import { getOwnedTokens } from "../services/api.js";

let assetLibraryBody = null;
let libraryRenderInFlight = false;
let libraryRenderPending = false;

function getContract() {
  return walletContract || walletState.get().contract || null;
}

/**
 * Reconstruct the list of tokens currently owned by an address by scanning
 * ERC-721 Transfer events. This replaces the ERC721Enumerable
 * `tokenOfOwnerByIndex` function that was removed to save storage slots.
 */
const EVENT_CHUNK_SIZE = 100;

function _ownedTokensCacheKey(chainId, address) {
  return `arbesk-owned-tokens-${chainId}-${address.toLowerCase()}`;
}

function _readOwnedTokensCache(chainId, address) {
  try {
    const raw = localStorage.getItem(_ownedTokensCacheKey(chainId, address));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.lastScannedBlock === "number" &&
      Array.isArray(parsed.owned)
    ) {
      return parsed;
    }
  } catch {
    // ignore corrupt cache
  }
  return null;
}

function _writeOwnedTokensCache(chainId, address, lastScannedBlock, owned) {
  try {
    localStorage.setItem(
      _ownedTokensCacheKey(chainId, address),
      JSON.stringify({ lastScannedBlock, owned })
    );
  } catch {
    // ignore storage errors
  }
}

/**
 * Fetch Transfer events for a specific address in small block chunks.
 * Public RPCs like Monad Testnet reject wide eth_getLogs ranges with 413.
 * @param {number} latest - pre-fetched current block number
 */
async function fetchTransferEvents(contract, address, direction, startBlock, latest) {
  const allEvents = [];
  const filter = direction === "to" ? { to: address } : { from: address };

  try {
    const chainId = Number(walletState.get().chainId || CHAIN_IDS.HARDHAT_LOCAL);
    const fromBlock = Math.max(
      startBlock ?? DEPLOYMENT_BLOCKS[chainId] ?? 0,
      0
    );

    console.log(
      `[ASSET-LIBRARY] scanning Transfer ${direction} events ` +
        `from block ${fromBlock} to ${latest} (chain ${chainId})`
    );

    for (let from = fromBlock; from <= latest; from += EVENT_CHUNK_SIZE) {
      const to = Math.min(from + EVENT_CHUNK_SIZE - 1, latest);
      const chunk = await contract.getPastEvents("Transfer", {
        filter,
        fromBlock: from,
        toBlock: to,
      });
      allEvents.push(...chunk);
    }
  } catch (err) {
    console.warn(
      `[ASSET-LIBRARY] Failed to fetch Transfer ${direction} events:`,
      err.message
    );
  }

  return allEvents;
}


export async function fetchOwnedTokenIds(contract, address) {
  const lowerAddress = address.toLowerCase();
  const chainId = Number(walletState.get().chainId || CHAIN_IDS.HARDHAT_LOCAL);

  // Only use the backend indexer for chains that have a configured deployment
  // block. For local/dev chains without one, fall back to an on-chain scan.
  const deploymentBlock = DEPLOYMENT_BLOCKS[chainId] ?? 0;
  if (deploymentBlock > 0) {
    const indexerResult = await getOwnedTokens(address, chainId);
    if (indexerResult) {
      console.log(
        `[ASSET-LIBRARY] indexer returned ${indexerResult.length} token(s) ` +
          `for ${address} on chain ${chainId}`
      );
      return indexerResult;
    }
  }

  const cache = _readOwnedTokensCache(chainId, address);
  const ownership = new Map();
  let startBlock = deploymentBlock;

  if (cache) {
    startBlock = Math.max(cache.lastScannedBlock, deploymentBlock);
    for (const tokenId of cache.owned) {
      ownership.set(String(tokenId), lowerAddress);
    }
  }

  const latest = Number(await web3.eth.getBlockNumber());
  const [transfersTo, transfersFrom] = await Promise.all([
    fetchTransferEvents(contract, address, "to", startBlock, latest),
    fetchTransferEvents(contract, address, "from", startBlock, latest),
  ]);

  // Apply events in block order so the latest transfer for each tokenId wins.
  const allTransfers = [...transfersTo, ...transfersFrom].sort(
    (a, b) =>
      Number(a.blockNumber) - Number(b.blockNumber) ||
      Number(a.logIndex) - Number(b.logIndex)
  );

  let maxBlock = startBlock;
  for (const event of allTransfers) {
    const tokenId = String(event.returnValues.tokenId);
    ownership.set(tokenId, event.returnValues.to.toLowerCase());
    if (Number(event.blockNumber) > maxBlock) {
      maxBlock = Number(event.blockNumber);
    }
  }

  const owned = Array.from(ownership.entries())
    .filter(([, currentOwner]) => currentOwner === lowerAddress)
    .map(([tokenId]) => tokenId);

  _writeOwnedTokensCache(chainId, address, maxBlock, owned);
  return owned;
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
 * Resolve a token into gallery entries.
 * - Standalone asset token → one entry.
 * - Collection token → one entry per asset in the collection's `assets` map.
 *   Each card's "Add to Scene" and "Delete" actions operate on its own asset.
 */
export async function expandTokenToAssets(tokenId) {
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

      // One card per asset. Name + thumbnail are resolved from each asset's
      // own manifest, falling back to the collection-level values.
      const entries = await Promise.all(
        assetEntries.map(async ([assetId, assetCid]) => {
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
          return {
            ...base,
            assetId,
            manifestCid: assetCid,
            collectionCid: cid,
            name,
            thumbnail,
            isCollection: true,
          };
        })
      );
      return entries;
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
        selectedCollectionId: null,
        activeAssetId: entry.assetId,
        activeAssetManifestCid: entry.manifestCid,
        latestAssetManifestCid: entry.manifestCid,
      });
    } else {
      assetState.set({
        activeAssetTokenId: String(entry.tokenId),
        selectedCollectionId: null,
        activeAssetManifestCid: entry.manifestCid,
        latestAssetManifestCid: entry.manifestCid,
      });
    }

    dismissCreatePulse();
    updateUrlAsset(entry.tokenId);
    await loadAssetManifest(entry.manifestCid);

    const { refreshTeamPanel } = await import("./collaborators.js");
    refreshTeamPanel();

    if (window.innerWidth <= 900) {
      switchView("library");
    }
  } catch (err) {
    console.error("Failed to open asset entry", entry, err);
    alert(`Failed to open asset #${entry.tokenId}`);
  }
}

export async function openAssetByTokenId(tokenId, assetId = null) {
  const contract = getContract();
  if (!contract) {
    console.warn("[LIBRARY] No contract available to open asset");
    return;
  }

  console.log("[LIBRARY] openAssetByTokenId", tokenId, "assetId", assetId);

  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) {
      console.warn(`[LIBRARY] No tokenURI for Token ID: ${tokenId}; keeping studio empty`);
      clearScene();
      clearUrlAssetParams();
      assetState.set({
        activeAssetManifestCid: null,
        activeAssetTokenId: null,
        activeAssetName: null,
        latestAssetManifestCid: null,
        currentManifest: null,
        activeCollectionTokenId: null,
        activeAssetId: null,
        selectedCollectionId: null,
      });
      return;
    }

    const manifest = await getFromRemoteIPFS(cid);
    console.log("[LIBRARY] tokenURI resolved, manifest type:", manifest?.type);

    // Collections: load the collection manifest into the Gallery sidebar.
    // Only load a specific asset if the caller explicitly passed an assetId
    // (e.g. from a gallery card or a shared ?assetId= link); a bare
    // ?asset=<collectionTokenId> opens an empty studio so the user can choose
    // which asset to load.
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
      const hasExplicitAssetId = assetId && assetIds.includes(assetId);
      const targetAssetCid = hasExplicitAssetId
        ? manifest.assets[assetId]
        : null;

      clearScene();
      assetState.set({
        activeAssetTokenId: String(tokenId),
        activeCollectionTokenId: String(tokenId),
        selectedCollectionId: null,
        activeAssetId: hasExplicitAssetId ? assetId : null,
        activeAssetManifestCid: targetAssetCid,
        latestAssetManifestCid: targetAssetCid,
      });
      console.log("[LIBRARY] collection asset state set, activeCollectionTokenId:", String(tokenId));
      dismissCreatePulse();
      updateUrlAsset(tokenId, hasExplicitAssetId ? assetId : null);

      if (targetAssetCid) {
        await loadAssetManifest(targetAssetCid);
      }

      const { refreshTeamPanel } = await import("./collaborators.js");
      refreshTeamPanel();

      if (window.innerWidth <= 900) {
        switchView("library");
      }
      return;
    }

    // Standalone asset: load it directly.
    clearScene();
    assetState.set({
      activeAssetTokenId: String(tokenId),
      selectedCollectionId: null,
      activeAssetId: assetId,
      activeAssetManifestCid: cid,
      latestAssetManifestCid: cid,
    });
    dismissCreatePulse();
    updateUrlAsset(tokenId, assetId);
    await loadAssetManifest(cid);

    const { refreshTeamPanel } = await import("./collaborators.js");
    refreshTeamPanel();

    if (window.innerWidth <= 900) {
      switchView("library");
    }
  } catch (err) {
    console.warn(`[LIBRARY] Failed to open asset #${tokenId}; keeping studio empty:`, err.message);
    clearScene();
    clearUrlAssetParams();
    assetState.set({
      activeAssetManifestCid: null,
      activeAssetTokenId: null,
      activeAssetName: null,
      latestAssetManifestCid: null,
      currentManifest: null,
      activeCollectionTokenId: null,
      activeAssetId: null,
      selectedCollectionId: null,
    });
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

function normalizeTokenId(id) {
  if (id == null) return "";
  try {
    return BigInt(id).toString();
  } catch {
    return String(id);
  }
}

function getActiveCollectionTokenId() {
  return assetState.get().activeCollectionTokenId || null;
}

async function renderAssetLibrary(owned, shared) {
  if (!assetLibraryBody) return;
  assetLibraryBody.innerHTML = "";

  const activeTokenId = normalizeTokenId(getActiveCollectionTokenId());
  _lastRenderedCollectionTokenId = activeTokenId || null;
  const ownedIds = activeTokenId
    ? owned.filter((id) => normalizeTokenId(id) === activeTokenId)
    : owned;
  const sharedIds = activeTokenId
    ? shared.filter((id) => normalizeTokenId(id) === activeTokenId)
    : shared;

  const [ownedNested, sharedNested] = await Promise.all([
    Promise.all(
      ownedIds.map(async (tokenId) => {
        const entries = await expandTokenToAssets(tokenId);
        entries.forEach((e) => {
          e.role = "owner";
        });
        return entries;
      })
    ),
    Promise.all(
      sharedIds.map(async (tokenId) => {
        const entries = await expandTokenToAssets(tokenId);
        entries.forEach((e) => {
          e.role = "editor";
        });
        return entries;
      })
    ),
  ]);
  const ownedEntries = ownedNested.flat();
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

  const h = document.createElement("h2");
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

  const meta = document.createElement("div");
  meta.className = "asset-card-meta";
  meta.appendChild(badge);

  const actions = document.createElement("div");
  actions.className = "asset-card-actions";
  actions.appendChild(addBtn);
  actions.appendChild(deleteBtn);

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
  return item;
}

function resolveDeleteVisibility(deleteBtn, role) {
  deleteBtn.hidden = role !== "owner";
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

  libraryRenderInFlight = true;
  try {
    do {
      libraryRenderPending = false;
      const { owned, shared } = await fetchAssetLibrary(walletAddress);
      await renderAssetLibrary(owned, shared);
    } while (libraryRenderPending);
  } finally {
    libraryRenderInFlight = false;
  }

  // A new refresh may have been requested while we were releasing the flag.
  if (libraryRenderPending) {
    return refreshAssetLibrary();
  }
}

function highlightActiveAsset() {
  if (!assetLibraryBody) return;
  const { activeAssetTokenId, activeAssetId } = assetState.get();
  const tokenIdMatch = normalizeTokenId(activeAssetTokenId);
  const assetIdMatch = activeAssetId ? String(activeAssetId) : null;

  assetLibraryBody.querySelectorAll(".asset-card").forEach((el) => {
    const matchesToken =
      tokenIdMatch && normalizeTokenId(el.dataset.tokenId) === tokenIdMatch;
    const matchesAsset = assetIdMatch
      ? el.dataset.assetId === assetIdMatch
      : true;
    el.classList.toggle("active", Boolean(matchesToken && matchesAsset));
  });
}

// Loading state shown while scanning Transfer events after wallet connect.
const LOADING_GALLERY_HTML = `
  <div class="library-loading">
    <div class="library-spinner" aria-hidden="true"></div>
    <p>Scanning the chain for your tokens…</p>
  </div>`;

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
    <h2 class="empty-state-title">No assets yet</h2>
    <p class="empty-state-sub">Sign in to browse and open the asset tokens you own.</p>
    <button id="galleryConnectBtn" class="empty-state-action btn btn-primary btn-sm" type="button">Login / Signup</button>
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

on(EVENTS.ASSET_CLEARED, async () => {
  clearScene();
  emit(EVENTS.SCENE_EMPTY);
  clearUrlAssetParams();
  await refreshAssetLibrary();
});

on(EVENTS.ASSET_OPEN_BY_TOKEN_ID, (e) => {
  if (e?.tokenId) openAssetByTokenId(e.tokenId, e?.assetId || null);
});

on(EVENTS.WALLET_CONNECTED, async () => {
  const params = new URLSearchParams(window.location.search);
  const assetTokenId = params.get("asset");
  const assetId = params.get("assetId");
  if (assetTokenId && getContract()) {
    await openAssetByTokenId(assetTokenId, assetId);
  }

  if (assetLibraryBody) {
    assetLibraryBody.innerHTML = LOADING_GALLERY_HTML;
  }
  await refreshAssetLibrary();
});

// Wallet may already be connected by the time this module loads (e.g. page
// reload with an injected provider). In that case the WALLET_CONNECTED event
// already fired before our listener was registered, so open the URL asset now.
(function openUrlAssetIfReady() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const assetTokenId = params.get("asset");
  const assetId = params.get("assetId");
  if (assetTokenId && getContract()) openAssetByTokenId(assetTokenId, assetId);
})();

let _lastRenderedCollectionTokenId = null;
on(EVENTS.ASSET_STATE_CHANGED, (state) => {
  const tokenId = state?.activeCollectionTokenId ?? null;
  if (tokenId !== _lastRenderedCollectionTokenId) {
    _lastRenderedCollectionTokenId = tokenId;
    refreshAssetLibrary();
  }
});

on(EVENTS.WALLET_DISCONNECTED, () => {
  _lastRenderedCollectionTokenId = null;
  if (assetLibraryBody) {
    assetLibraryBody.innerHTML = DISCONNECTED_GALLERY_HTML;
  }
});

export {
  initAssetLibrary,
  fetchAssetLibrary,
  refreshAssetLibrary,
  renderAssetLibrary,
};
