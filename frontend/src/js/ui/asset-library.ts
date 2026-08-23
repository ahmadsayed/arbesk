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
  initEngine,
} from "../engine/scene-graph.ts";
import { ensureBabylon } from "../engine/babylon-loader.ts";
import { getActiveContract, web3 } from "../blockchain/wallet.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { deleteAssetFromCollection } from "../services/asset-delete.ts";
import { trimTokenId } from "../utils/library-items.ts";
import {
  extractThumbnailCid,
  loadThumbnailInto,
} from "../utils/thumbnail.ts";
import { showToast } from "./toasts.ts";
import { updateUrlAsset, clearUrlAssetParams } from "../services/url-utils.ts";
import { switchView, getActiveView } from "./sidebar.ts";
import { CHAIN_IDS, DEPLOYMENT_BLOCKS, LOG_CHUNK_SIZES } from "../../../../constants/chains.js";
import { emit, on, EVENTS } from "../asset-core/events/bus.ts";
import { walletState } from "../state/wallet-state.ts";
import {
  adoptOpenedAsset,
  closeAsset,
  getCurrentManifest,
  getAssetState,
} from "../asset-core/domain/asset.ts";
import {
  adoptOpenedCollection,
  clearSelectedCollection,
  clearActiveCollection,
  getActiveCollectionTokenId,
} from "../asset-core/domain/collection.ts";
import { getOwnedTokens, getSharedTokens } from "../services/api.ts";
import {
  startTaskProgress,
  setTaskProgress,
  finishTaskProgress,
  failTaskProgress,
} from "./task-progress.ts";

/**
 * Build a progress reporter for a Studio asset load. The manifest fetch
 * covers the first 5%; the rest is split evenly across the manifest's scene
 * nodes, with byte-level download progress filling each node's slice
 * (wired via the optional onProgress ctx of the format handlers).
 * @param label - stage label shown next to the bar
 */
function createAssetLoadReporter(label: string): {
  setNodeCount: (n: number) => void;
  setNodeFraction: (nodeId: string, fraction: number) => void;
} {
  const MANIFEST_SHARE = 0.05;
  let total = 0;
  const fractions = new Map<string, number>();
  const render = () => {
    if (total <= 0) return;
    let sum = 0;
    for (const f of fractions.values()) sum += f;
    setTaskProgress(
      Math.min(0.99, MANIFEST_SHARE + (1 - MANIFEST_SHARE) * (sum / total)),
      label
    );
  };
  return {
    setNodeCount(n: number) {
      total = n;
    },
    setNodeFraction(nodeId: string, fraction: number) {
      fractions.set(nodeId, Math.min(1, Math.max(0, fraction)));
      render();
    },
  };
}

let assetLibraryBody: HTMLElement | null = null;
let libraryRenderInFlight = false;
let libraryRenderPending = false;
let _libraryDirty = false;

/**
 * Reconstruct the list of tokens currently owned by an address by scanning
 * ERC-721 Transfer events. This replaces the ERC721Enumerable
 * `tokenOfOwnerByIndex` function that was removed to save storage slots.
 *
 * Scan chunk size comes from LOG_CHUNK_SIZES (per-chain) — public RPCs like
 * Base Sepolia reject wide eth_getLogs ranges.
 */
const DEFAULT_EVENT_CHUNK_SIZE = 100;

function _ownedTokensCacheKey(chainId: number | string, address: string): string {
  return `arbesk-owned-tokens-${chainId}-${address.toLowerCase()}`;
}

interface OwnedTokensCache {
  lastScannedBlock: number;
  owned: string[];
}

function _readOwnedTokensCache(
  chainId: number | string,
  address: string
): OwnedTokensCache | null {
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

function _writeOwnedTokensCache(
  chainId: number | string,
  address: string,
  lastScannedBlock: number,
  owned: string[]
): void {
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
 * Public RPCs like Base Sepolia reject wide eth_getLogs ranges with 413.
 * @param contract - Web3 contract instance
 * @param latest - pre-fetched current block number
 */
async function fetchTransferEvents(
  contract: any,
  address: string,
  direction: "to" | "from",
  startBlock: number,
  latest: number
): Promise<any[]> {
  const allEvents: any[] = [];
  const filter = direction === "to" ? { to: address } : { from: address };

  try {
    const chainId = Number(walletState.get().chainId || CHAIN_IDS.HARDHAT_LOCAL);
    const chunkSize = LOG_CHUNK_SIZES[chainId] ?? DEFAULT_EVENT_CHUNK_SIZE;
    const fromBlock = Math.max(
      startBlock ?? DEPLOYMENT_BLOCKS[chainId] ?? 0,
      0
    );

    console.log(
      `[ASSET-LIBRARY] scanning Transfer ${direction} events ` +
        `from block ${fromBlock} to ${latest} (chain ${chainId}, chunk ${chunkSize})`
    );

    for (let from = fromBlock; from <= latest; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, latest);
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
      (err as Error).message
    );
  }

  return allEvents;
}


/**
 * @param contract - Web3 contract instance
 */
export async function fetchOwnedTokenIds(
  contract: any,
  address: string,
  forceIndexer: boolean = false
): Promise<string[]> {
  const lowerAddress = address.toLowerCase();
  const chainId = Number(walletState.get().chainId || CHAIN_IDS.HARDHAT_LOCAL);

  // Only use the backend indexer for chains that have a configured deployment
  // block. For local/dev chains without one, fall back to an on-chain scan.
  const deploymentBlock = DEPLOYMENT_BLOCKS[chainId] ?? 0;
  if (deploymentBlock > 0) {
    const indexerResult = await getOwnedTokens(address, chainId, forceIndexer);
    if (indexerResult) {
      console.log(
        `[ASSET-LIBRARY] indexer returned ${indexerResult.length} token(s) ` +
          `for ${address} on chain ${chainId}` +
          (forceIndexer ? " (forced)" : "")
      );
      return indexerResult;
    }
  }

  const cache = _readOwnedTokensCache(chainId, address);
  const ownership = new Map<string, string>();
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

async function fetchAssetLibrary(
  address: string,
  forceIndexer: boolean = false
): Promise<{ owned: string[]; shared: string[] }> {
  const contract = getActiveContract();
  if (!contract || !address) {
    console.warn(
      "[ASSET-LIBRARY] No contract available. " +
        "Check that your wallet is connected to the correct network."
    );
    return { owned: [], shared: [] };
  }

  let owned: string[] = [];
  let shared: string[] | null = [];

  try {
    [owned, shared] = await Promise.all([
      fetchOwnedTokenIds(contract, address, forceIndexer),
      getSharedTokens(address, walletState.get().chainId as any, forceIndexer),
    ]);
    if (!Array.isArray(shared)) shared = [];

    // Fallback for local/dev contracts that expose listTokens(address).
    if (shared.length === 0 && typeof contract.methods.listTokens === "function") {
      const memberTokens = await contract.methods.listTokens(address).call();
      for (const tokenId of memberTokens) {
        const id = String(tokenId);
        if (!owned.includes(id)) shared.push(id);
      }
    }
  } catch (err) {
    console.error("Asset library fetch failed:", err);
  }

  return { owned, shared: shared ?? [] };
}

/**
 * Resolve a token into gallery entries.
 * - Standalone asset token → one entry.
 * - Collection token → one entry per asset in the collection's `assets` map.
 *   Each card's "Add to Scene" and "Delete" actions operate on its own asset.
 * @returns gallery entry records (shape varies by branch; may include `{type:"inaccessible"}` markers)
 */
export async function expandTokenToAssets(
  tokenId: string | number
): Promise<any[]> {
  const contract = getActiveContract();
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
            const assetManifest = await getFromRemoteIPFS(assetCid as string);
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
    return [
      {
        type: "inaccessible",
        tokenId: String(tokenId),
        errorReason: (err as Error).message || "Unknown error",
      },
    ];
  }
}

/** @param entry - gallery entry from expandTokenToAssets */
async function openAssetEntry(entry: any): Promise<void> {
  const contract = getActiveContract();
  if (!contract) {
    console.warn("[LIBRARY] No contract available to open asset");
    return;
  }

  const assetLabel = entry.name || `asset #${entry.tokenId}`;
  const loadLabel = `Loading ${assetLabel}…`;
  startTaskProgress(loadLabel, 0.02);
  try {
    clearScene();

    if (entry.isCollection && entry.collectionCid) {
      const { loadCollectionManifest } = await import(
        "../engine/scene-graph.ts"
      );
      const { assetEntries } = await loadCollectionManifest(
        entry.collectionCid,
        {
          chainId: walletState.get().chainId,
          contractAddress: walletState.get().contractAddress,
          tokenId: entry.tokenId,
        } as any
      );
      emit(EVENTS.COLLECTION_OPENED, {
        tokenId: entry.tokenId,
        assetEntries,
      });

      adoptOpenedAsset(entry.manifestCid, {
        tokenId: String(entry.tokenId),
        assetId: entry.assetId,
      });
      adoptOpenedCollection(String(entry.tokenId), { clearSelectedCollection: true });
    } else {
      adoptOpenedAsset(entry.manifestCid, {
        tokenId: String(entry.tokenId),
      });
      clearSelectedCollection();
    }

    dismissCreatePulse();
    updateUrlAsset(entry.tokenId);
    await loadAssetManifest(
      entry.manifestCid,
      null,
      0,
      new Set(),
      createAssetLoadReporter(loadLabel)
    );
    finishTaskProgress(`Loaded ${assetLabel}.`);

    const { refreshTeamPanel } = await import("./collaborators.ts");
    refreshTeamPanel();

    if (window.innerWidth <= 900) {
      switchView("library");
    }
  } catch (err) {
    failTaskProgress(`Failed to load ${assetLabel}.`);
    console.error("Failed to open asset entry", entry, err);
    alert(`Failed to open asset #${entry.tokenId}`);
  }
}

/**
 * Ensure the lazily-loaded Babylon engine is ready before rendering an asset.
 * On a cold `/studio?asset=…` deep-link the WALLET_CONNECTED handler can fire
 * before the router has finished `ensureBabylon()`, which otherwise makes
 * `loadAssetManifest` fail with "BABYLON is not defined". A bare
 * `?asset=<collectionTokenId>` link still skips the engine until an asset is
 * actually opened.
 */
async function ensureEngineReady(): Promise<void> {
  await ensureBabylon();
  initEngine();
}

export async function openAssetByTokenId(
  tokenId: string | number,
  assetId: string | null = null
): Promise<void> {
  const contract = getActiveContract();
  if (!contract) {
    console.warn("[LIBRARY] No contract available to open asset");
    return;
  }

  console.log("[LIBRARY] openAssetByTokenId", tokenId, "assetId", assetId);

  let progressStarted = false;
  try {
    const cid = await contract.methods.tokenURI(tokenId).call();
    if (!cid) {
      console.warn(`[LIBRARY] No tokenURI for Token ID: ${tokenId}; keeping studio empty`);
      clearScene();
      clearUrlAssetParams();
      closeAsset();
      clearActiveCollection();
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
        "../engine/scene-graph.ts"
      );
      const { assetEntries } = await loadCollectionManifest(cid, {
        chainId: walletState.get().chainId,
        contractAddress: walletState.get().contractAddress,
        tokenId,
      } as any);
      emit(EVENTS.COLLECTION_OPENED, { tokenId, assetEntries });

      const assetIds = Object.keys(manifest.assets || {});
      const hasExplicitAssetId = assetId && assetIds.includes(assetId);
      const targetAssetCid = hasExplicitAssetId
        ? manifest.assets[assetId]
        : null;

      clearScene();
      adoptOpenedAsset(targetAssetCid, {
        tokenId: String(tokenId),
        assetId: hasExplicitAssetId ? assetId : null,
      });
      adoptOpenedCollection(String(tokenId), { clearSelectedCollection: true });
      console.log("[LIBRARY] collection asset state set, activeCollectionTokenId:", String(tokenId));
      dismissCreatePulse();
      updateUrlAsset(tokenId, hasExplicitAssetId ? assetId : null);

      if (targetAssetCid) {
        await ensureEngineReady();
        const loadLabel = `Loading asset #${tokenId}…`;
        startTaskProgress(loadLabel, 0.02);
        progressStarted = true;
        await loadAssetManifest(
          targetAssetCid,
          null,
          0,
          new Set(),
          createAssetLoadReporter(loadLabel)
        );
        finishTaskProgress(`Loaded asset #${tokenId}.`);
      }

      const { refreshTeamPanel } = await import("./collaborators.ts");
      refreshTeamPanel();

      if (window.innerWidth <= 900) {
        switchView("library");
      }
      return;
    }

    // Standalone asset: load it directly.
    clearScene();
    adoptOpenedAsset(cid, {
      tokenId: String(tokenId),
      assetId,
    });
    clearSelectedCollection();
    dismissCreatePulse();
    updateUrlAsset(tokenId, assetId);
    await ensureEngineReady();
    const loadLabel = `Loading asset #${tokenId}…`;
    startTaskProgress(loadLabel, 0.02);
    progressStarted = true;
    await loadAssetManifest(cid, null, 0, new Set(), createAssetLoadReporter(loadLabel));
    finishTaskProgress(`Loaded asset #${tokenId}.`);

    const { refreshTeamPanel } = await import("./collaborators.ts");
    refreshTeamPanel();

    if (window.innerWidth <= 900) {
      switchView("library");
    }
  } catch (err) {
    if (progressStarted) failTaskProgress(`Failed to load asset #${tokenId}.`);
    console.warn(`[LIBRARY] Failed to open asset #${tokenId}; keeping studio empty:`, (err as Error).message);
    clearScene();
    clearUrlAssetParams();
    closeAsset();
    clearActiveCollection();
  }
}

/**
 * Build a payload for drag-drop / "Add to Scene" using the card's asset entry.
 */
function buildLinkedAssetPayload(entry: any): Record<string, any> {
  const { chainId: walletChainId, contractAddress: walletContractAddress } =
    walletState.get();
  const payload: Record<string, any> = {
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

function normalizeTokenId(id: any): string {
  if (id == null) return "";
  try {
    return BigInt(id).toString();
  } catch {
    return String(id);
  }
}

async function renderAssetLibrary(owned: string[], shared: string[]): Promise<void> {
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

function createEmptyState(title: string, sub: string): HTMLDivElement {
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

function createSection(title: string, entries: any[]): HTMLDivElement {
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
  for (const entry of entries) {
    list.appendChild(
      entry.type === "inaccessible"
        ? createInaccessibleCard(entry)
        : createAssetCard(entry)
    );
  }
  section.appendChild(list);
  return section;
}

/** @param entry - `{type:"inaccessible"}` entry */
function createInaccessibleCard(entry: any): HTMLDivElement {
  const item = document.createElement("div");
  item.className = "asset-card asset-card--inaccessible";
  item.dataset.tokenId = entry.tokenId;
  item.title = entry.errorReason || "Unknown error";
  item.setAttribute("role", "group");
  item.setAttribute("aria-label", `Inaccessible token ${trimTokenId(entry.tokenId)}`);

  const thumbnailEl = document.createElement("div");
  thumbnailEl.className = "asset-card-thumbnail asset-card-thumbnail-empty";
  thumbnailEl.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`;

  const nameEl = document.createElement("div");
  nameEl.className = "asset-card-name";
  nameEl.textContent = trimTokenId(entry.tokenId);

  const badge = document.createElement("span");
  badge.className = `asset-card-badge ${
    entry.role === "owner" ? "badge-owner" : "badge-editor"
  }`;
  badge.textContent = entry.role === "owner" ? "Owner" : "Editor";

  const meta = document.createElement("div");
  meta.className = "asset-card-meta";
  meta.appendChild(badge);

  const burnBtn = document.createElement("button");
  burnBtn.className = "btn btn-outline btn-danger btn-sm";
  burnBtn.textContent = "Burn Token";
  burnBtn.title = "Burn this token to remove it from your wallet";
  burnBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const { showBurnCollectionDialog } = await import("./dialog.ts");
      const { burnCollection } = await import("../services/asset-delete.ts");
      const label = trimTokenId(entry.tokenId);
      const confirmed = await showBurnCollectionDialog(label);
      if (confirmed !== "burn") return;
      await burnCollection(entry.tokenId);
      showToast({ type: "success", title: "Token burned", message: `Token ${label} removed.` });
      item.remove();
    } catch (err) {
      showToast({ type: "error", title: "Burn failed", message: (err as Error).message || "Could not burn token." });
    }
  });

  const actions = document.createElement("div");
  actions.className = "asset-card-actions";
  actions.appendChild(burnBtn);

  item.appendChild(thumbnailEl);
  item.appendChild(nameEl);
  item.appendChild(meta);
  item.appendChild(actions);

  return item;
}

/** @param entry - gallery entry */
function createAssetCard(entry: any): HTMLDivElement {
  const item = document.createElement("div");
  item.className = `asset-card ${
    entry.role === "editor" ? "asset-card--editor" : ""
  }`.trim();
  item.dataset.tokenId = entry.tokenId;
  if (entry.assetId) item.dataset.assetId = entry.assetId;
  item.dataset.manifestCid = entry.manifestCid;
  if (entry.collectionCid) item.dataset.collectionCid = entry.collectionCid;
  item.draggable = true;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("aria-label", `Open asset ${entry.name}`);

  item.addEventListener("dragstart", (event) => {
    const payload = buildLinkedAssetPayload(entry);
    const dt = event.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = "copy";
    dt.setData(
      "application/x-arbesk-linked-asset",
      JSON.stringify(payload)
    );
    dt.setData("text/plain", `${entry.name} Token #${entry.tokenId}`);
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
    if ((e.target as HTMLElement).closest(".asset-card-actions button")) return;
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

  const downloadBtn = document.createElement("button");
  downloadBtn.className = "btn btn-outline btn-sm";
  downloadBtn.title = "Download the model file (GLB/glTF)";
  downloadBtn.setAttribute("aria-label", `Download asset ${entry.name}`);
  downloadBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg><span>Download</span>`;
  downloadBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (downloadBtn.disabled) return;
    downloadBtn.disabled = true;
    try {
      const { downloadAssetByManifestCid } = await import(
        "../services/asset-download.ts"
      );
      const filename = await downloadAssetByManifestCid(
        entry.manifestCid,
        entry.name
      );
      showToast({
        type: "success",
        title: "Download Started",
        message: filename,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Download Failed",
        message: (err as Error).message || "Could not download the model.",
      });
    } finally {
      downloadBtn.disabled = false;
    }
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
  actions.appendChild(downloadBtn);
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

function resolveDeleteVisibility(deleteBtn: HTMLButtonElement, role?: string): void {
  deleteBtn.hidden = role !== "owner";
}

async function onDeleteAsset(event: MouseEvent, entry: any): Promise<void> {
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
      message: (err as Error).message || "Could not remove asset from collection.",
    });
  }
}

/**
 * @param thumbnail - manifest thumbnail field (string CID or `{cid}` record)
 */
async function renderAssetThumbnail(
  thumbnail: any,
  thumbnailEl: HTMLElement,
  assetName?: string
): Promise<void> {
  const thumbnailCid = extractThumbnailCid(thumbnail);
  if (!thumbnailCid) return;
  const img = await loadThumbnailInto(thumbnailEl, thumbnailCid, assetName || "Asset");
  if (img) thumbnailEl.classList.remove("asset-card-thumbnail-empty");
}

async function refreshAssetLibrary(): Promise<void> {
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

/**
 * Update just the active asset's gallery card after publish, using the
 * in-memory manifest. Avoids re-fetching every asset in the collection when
 * only one asset changed.
 */
async function updateActiveAssetCard(): Promise<boolean> {
  if (!assetLibraryBody) return false;

  const { activeAssetTokenId, activeAssetId, activeAssetManifestCid } =
    getAssetState();
  const tokenId = normalizeTokenId(activeAssetTokenId);
  const assetId = activeAssetId ? String(activeAssetId) : null;
  if (!tokenId || !assetId || !activeAssetManifestCid) return false;

  const currentManifest = getCurrentManifest() as any;
  if (
    !currentManifest ||
    currentManifest._manifestCid !== activeAssetManifestCid
  ) {
    return false;
  }

  const selector = `.asset-card[data-token-id="${tokenId}"][data-asset-id="${assetId}"]`;
  const oldCard = assetLibraryBody.querySelector(selector) as HTMLElement | null;
  if (!oldCard) return false;

  const role = oldCard.classList.contains("asset-card--editor")
    ? "editor"
    : "owner";
  const collectionCid = oldCard.dataset.collectionCid || null;

  const entry = {
    type: "asset",
    tokenId: String(activeAssetTokenId),
    assetId,
    manifestCid: activeAssetManifestCid,
    collectionCid,
    name: currentManifest.name || assetId,
    thumbnail: currentManifest.thumbnail || null,
    isCollection: Boolean(collectionCid),
    role,
  };

  const newCard = createAssetCard(entry);
  oldCard.replaceWith(newCard);
  return true;
}

function highlightActiveAsset(): void {
  if (!assetLibraryBody) return;
  const { activeAssetTokenId, activeAssetId } = getAssetState();
  const tokenIdMatch = normalizeTokenId(activeAssetTokenId);
  const assetIdMatch = activeAssetId ? String(activeAssetId) : null;

  assetLibraryBody.querySelectorAll(".asset-card").forEach((el) => {
    const card = el as HTMLElement;
    const matchesToken =
      tokenIdMatch && normalizeTokenId(card.dataset.tokenId) === tokenIdMatch;
    const matchesAsset = assetIdMatch
      ? card.dataset.assetId === assetIdMatch
      : true;
    card.classList.toggle("active", Boolean(matchesToken && matchesAsset));
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

function initAssetLibrary(): void {
  assetLibraryBody = document.getElementById("assetLibraryBody");

  // Delegated: the gallery Connect affordance mirrors the headerbar button.
  assetLibraryBody?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("#galleryConnectBtn")) {
      document.getElementById("connectWalletBtn")?.click();
    }
  });
}

on(EVENTS.SCENE_READY, highlightActiveAsset);

/**
 * Refresh the gallery after a publish signal. Fires on ASSET_PUBLISH_PENDING
 * (tx broadcast — optimistic update) and again on ASSET_PUBLISHED (mined —
 * authoritative). The update is idempotent, so running it twice is harmless.
 */
async function handlePublishUpdate(): Promise<void> {
  // Only pay for a gallery update if the library pane is currently visible.
  // Otherwise mark it dirty and refresh when the user switches back.
  if (getActiveView() !== "library") {
    _libraryDirty = true;
    return;
  }
  // Try a cheap targeted update of the active asset card first; fall back to
  // a full refresh if the card is not currently rendered or the in-memory
  // manifest is not available.
  const updated = await updateActiveAssetCard();
  if (!updated) {
    await refreshAssetLibrary();
  }
  highlightActiveAsset();
}

on(EVENTS.ASSET_PUBLISHED, handlePublishUpdate);
on(EVENTS.ASSET_PUBLISH_PENDING, handlePublishUpdate);

on(EVENTS.SIDEBAR_VIEW_CHANGED, async ({ view }) => {
  if (view !== "library" || !_libraryDirty) return;
  _libraryDirty = false;
  await refreshAssetLibrary();
  highlightActiveAsset();
});

on(EVENTS.ASSET_CLEARED, async () => {
  clearScene();
  closeAsset();
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
  if (assetTokenId && getActiveContract()) {
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
  if (assetTokenId && getActiveContract()) openAssetByTokenId(assetTokenId, assetId);
})();

let _lastRenderedCollectionTokenId: string | null = null;
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
  updateActiveAssetCard,
};
