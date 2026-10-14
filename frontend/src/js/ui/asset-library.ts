/**
 * Token-centric browser for owned and shared assets.
 * @remarks Each card is one asset; collection tokens are expanded so every
 *   asset in the collection gets its own card.
 */

import {
  loadAssetManifest,
  clearScene,
  dismissCreatePulse,
  initEngine,
} from "../engine/scene-graph.ts";
import { ensureBabylon } from "../engine/babylon-loader.ts";
import { getActiveContract, getReadClient } from "../blockchain/wallet.ts";
import { getReadableContract } from "../blockchain/read-contract.ts";
import { getContractAddress } from "../blockchain/network-config.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import {
  extractThumbnailCid,
  loadThumbnailInto,
} from "../utils/thumbnail.ts";
import { removeChildAssetNodes } from "../engine/child-remove.ts";
import { showToast } from "./toasts.ts";
import { isAssetOpen } from "../state/edit-mode.ts";
import { confirmDiscardChanges } from "./confirm-discard.ts";
import { initMenuButton, type MenuButtonHandle } from "./menu-button.ts";

import { updateUrlAsset, clearUrlAssetParams } from "../services/url-utils.ts";
import { switchView, getActiveView } from "./sidebar.ts";
import { CHAIN_IDS, DEPLOYMENT_BLOCKS, LOG_CHUNK_SIZES } from "../../../../constants/chains.js";
import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { walletState } from "../state/wallet-state.ts";
import { libraryState, isLibraryVisitor } from "../state/library-state.ts";
import {
  adoptOpenedAsset,
  closeAsset,
  getCurrentManifest,
  getAssetState,
  getActiveAssetName,
} from "@arbesk/asset-core/domain/asset.js";
import {
  adoptOpenedCollection,
  clearSelectedCollection,
  clearActiveCollection,
  getActiveCollectionTokenId,
} from "@arbesk/asset-core/domain/collection.js";
import { getOwnedTokens, getSharedTokens } from "../services/api.ts";
import {
  startTaskProgress,
  setTaskProgress,
  finishTaskProgress,
  failTaskProgress,
} from "./task-progress.ts";

/**
 * Builds a progress reporter for a Studio asset load.
 * @param label stage label shown next to the bar.
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

// Re-export so existing call sites (library-controller, library-details) keep
// their import paths; the implementation lives in blockchain/read-contract.ts
// so engine/ modules can use it without importing ui/.
export { getReadableContract } from "../blockchain/read-contract.ts";

/**
 * The chain profile reads should use when a public-profile subject is active
 * (visitor, or owner viewing their own profile URL); undefined → the
 * connected wallet's chain, exactly as before.
 */
function subjectReadChainId(): number | undefined {
  const s = libraryState.get();
  return s.subjectAddress && s.subjectChainId ? s.subjectChainId : undefined;
}

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

/** Standard ERC-721 Transfer event ABI item for getLogs. */
const TRANSFER_EVENT_ABI_ITEM = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
  ],
} as const;

/**
 * Fetches Transfer events for an address in small block chunks.
 * @remarks Public RPCs like Base Sepolia reject wide eth_getLogs ranges with 413.
 */
async function fetchTransferEvents(
  contract: any,
  address: string,
  direction: "to" | "from",
  startBlock: number,
  latest: number,
  chainId?: number
): Promise<any[]> {
  const allEvents: any[] = [];
  try {
    const id = Number(chainId ?? walletState.get().chainId ?? CHAIN_IDS.HARDHAT_LOCAL);
    const chunkSize = LOG_CHUNK_SIZES[id] ?? DEFAULT_EVENT_CHUNK_SIZE;
    const fromBlock = Math.max(
      startBlock ?? DEPLOYMENT_BLOCKS[id] ?? 0,
      0
    );

    console.log(
      `[ASSET-LIBRARY] scanning Transfer ${direction} events ` +
        `from block ${fromBlock} to ${latest} (chain ${id}, chunk ${chunkSize})`
    );

    for (let from = fromBlock; from <= latest; from += chunkSize) {
      const to = Math.min(from + chunkSize - 1, latest);
      const chunk = await getReadClient(id).getLogs({
        address: contract.address as `0x${string}`,
        event: TRANSFER_EVENT_ABI_ITEM,
        args:
          direction === "to"
            ? { to: address as `0x${string}` }
            : { from: address as `0x${string}` },
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
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


export async function fetchOwnedTokenIds(
  contract: any,
  address: string,
  forceIndexer: boolean = false,
  chainId?: number
): Promise<string[]> {
  const lowerAddress = address.toLowerCase();
  const id = Number(chainId ?? walletState.get().chainId ?? CHAIN_IDS.HARDHAT_LOCAL);

  // Only use the backend indexer for chains that have a configured deployment
  // block. For local/dev chains without one, fall back to an on-chain scan.
  const deploymentBlock = DEPLOYMENT_BLOCKS[id] ?? 0;
  if (deploymentBlock > 0) {
    const indexerResult = await getOwnedTokens(address, id, forceIndexer);
    if (indexerResult) {
      console.log(
        `[ASSET-LIBRARY] indexer returned ${indexerResult.length} token(s) ` +
          `for ${address} on chain ${id}` +
          (forceIndexer ? " (forced)" : "")
      );
      return indexerResult;
    }
  }

  const cache = _readOwnedTokensCache(id, address);
  const ownership = new Map<string, string>();
  let startBlock = deploymentBlock;

  if (cache) {
    startBlock = Math.max(cache.lastScannedBlock, deploymentBlock);
    for (const tokenId of cache.owned) {
      ownership.set(String(tokenId), lowerAddress);
    }
  }

  const latest = Number(await getReadClient(id).getBlockNumber());
  const [transfersTo, transfersFrom] = await Promise.all([
    fetchTransferEvents(contract, address, "to", startBlock, latest, id),
    fetchTransferEvents(contract, address, "from", startBlock, latest, id),
  ]);

  // Apply events in block order so the latest transfer for each tokenId wins.
  const allTransfers = [...transfersTo, ...transfersFrom].sort(
    (a, b) =>
      Number(a.blockNumber) - Number(b.blockNumber) ||
      Number(a.logIndex) - Number(b.logIndex)
  );

  let maxBlock = startBlock;
  for (const event of allTransfers) {
    const tokenId = String(event.args.tokenId);
    ownership.set(tokenId, event.args.to.toLowerCase());
    if (Number(event.blockNumber) > maxBlock) {
      maxBlock = Number(event.blockNumber);
    }
  }

  const owned = Array.from(ownership.entries())
    .filter(([, currentOwner]) => currentOwner === lowerAddress)
    .map(([tokenId]) => tokenId);

  _writeOwnedTokensCache(id, address, maxBlock, owned);
  return owned;
}

/**
 * Shared-with-me tokens from the indexer, with the local/dev `listTokens`
 * contract fallback.
 */
async function fetchSharedTokenIds(
  contract: any,
  address: string,
  owned: string[],
  chainId: number | undefined,
  forceIndexer: boolean
): Promise<string[]> {
  let shared: string[] | null = await getSharedTokens(
    address,
    (chainId ?? walletState.get().chainId) as any,
    forceIndexer
  );
  if (!Array.isArray(shared)) shared = [];

  // Fallback for local/dev contracts that expose listTokens(address).
  const hasListTokens = Array.isArray(contract.abi)
    ? contract.abi.some((i: any) => i.type === "function" && i.name === "listTokens")
    : false;
  if (shared.length === 0 && hasListTokens) {
    const memberTokens = (await getReadClient(chainId).readContract({
      address: contract.address as `0x${string}`,
      abi: contract.abi,
      functionName: "listTokens",
      args: [address],
    })) as readonly bigint[];
    for (const tokenId of memberTokens) {
      const id = String(tokenId);
      if (!owned.includes(id)) shared.push(id);
    }
  }
  return shared;
}

async function fetchAssetLibrary(
  address: string,
  forceIndexer: boolean = false,
  { includeShared = true, chainId = undefined }: { includeShared?: boolean; chainId?: number } = {}
): Promise<{ owned: string[]; shared: string[] }> {
  const contract = await getReadableContract(chainId);
  if (!contract || !address) {
    console.warn(
      "[ASSET-LIBRARY] No contract available. " +
        "Check that your wallet is connected to the correct network."
    );
    return { owned: [], shared: [] };
  }

  try {
    const owned = await fetchOwnedTokenIds(contract, address, forceIndexer, chainId);
    const shared = includeShared
      ? await fetchSharedTokenIds(contract, address, owned, chainId, forceIndexer)
      : [];
    return { owned, shared };
  } catch (err) {
    console.error("Asset library fetch failed:", err);
    return { owned: [], shared: [] };
  }
}

/**
 * Resolves a token into gallery entries: a standalone asset becomes one
 * entry; a collection becomes one entry per asset in its `assets` map.
 * @remarks Returns records whose shape varies by branch and may include
 *   `{ type: "inaccessible" }` markers.
 */
export async function expandTokenToAssets(
  tokenId: string | number,
  chainId?: number
): Promise<any[]> {
  const contract = await getReadableContract(chainId);
  if (!contract) return [];

  try {
    const cid = await contract.read.tokenURI([BigInt(tokenId)]);
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
  const readChainId = subjectReadChainId();
  const contract = await getReadableContract(readChainId);
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
          chainId: readChainId ?? walletState.get().chainId,
          contractAddress: readChainId
            ? getContractAddress(readChainId)
            : walletState.get().contractAddress,
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
    // A card clicked during the first Studio entry races the lazy Babylon
    // load; without this the load throws and the open is lost.
    await ensureEngineReady();
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
 * Ensures the lazily-loaded Babylon engine is ready before rendering an asset.
 * @remarks On a cold deep-link the wallet handler can fire before
 *   ensureBabylon() finishes, which would make loadAssetManifest fail with
 *   "BABYLON is not defined".
 */
async function ensureEngineReady(): Promise<void> {
  await ensureBabylon();
  initEngine();
}

export async function openAssetByTokenId(
  tokenId: string | number,
  assetId: string | null = null
): Promise<void> {
  const readChainId = subjectReadChainId();
  const contract = await getReadableContract(readChainId);
  if (!contract) {
    console.warn("[LIBRARY] No contract available to open asset");
    return;
  }

  console.log("[LIBRARY] openAssetByTokenId", tokenId, "assetId", assetId);

  let progressStarted = false;
  try {
    const cid = await contract.read.tokenURI([BigInt(tokenId)]);
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
        chainId: readChainId ?? walletState.get().chainId,
        contractAddress: readChainId
          ? getContractAddress(readChainId)
          : walletState.get().contractAddress,
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
 * Build a payload for drag-drop / card insert using the card's asset entry.
 * @param mode - `live-ref` links the latest version; `fork` inserts a copy.
 */
function buildLinkedAssetPayload(
  entry: any,
  mode: "live-ref" | "fork"
): Record<string, any> {
  const { chainId: walletChainId, contractAddress: walletContractAddress } =
    walletState.get();
  const payload: Record<string, any> = {
    type: "linked_asset",
    token_id: String(entry.tokenId),
    standard: "ERC721",
    resolution: "latest",
    chainId: Number(walletChainId || CHAIN_IDS.HARDHAT_LOCAL),
    contractAddress: walletContractAddress || null,
    mode,
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

async function renderAssetLibrary(
  owned: string[],
  shared: string[],
  { visitor = false }: { visitor?: boolean } = {}
): Promise<void> {
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

  // A profile subject's tokens may live on another chain — expand on the
  // resolved subject chain.
  const expandChainId = subjectReadChainId();

  const [ownedNested, sharedNested] = await Promise.all([
    Promise.all(
      ownedIds.map(async (tokenId) => {
        const entries = await expandTokenToAssets(tokenId, expandChainId);
        entries.forEach((e) => {
          e.role = "owner";
        });
        return entries;
      })
    ),
    Promise.all(
      sharedIds.map(async (tokenId) => {
        const entries = await expandTokenToAssets(tokenId, expandChainId);
        entries.forEach((e) => {
          e.role = "editor";
        });
        return entries;
      })
    ),
  ]);
  _lastRender = {
    ownedEntries: ownedNested.flat(),
    sharedEntries: sharedNested.flat(),
    visitor,
  };
  renderSections();
}

/** Last fetched entries, kept so open/close can re-render without refetching. */
let _lastRender: { ownedEntries: any[]; sharedEntries: any[]; visitor: boolean } | null =
  null;
let _menuHandles: MenuButtonHandle[] = [];
let _lastOwnCardKey = "";

/** Identity of the open asset; its own card is hidden from the Insert list. */
function ownCardKey(): string {
  const { activeAssetTokenId, activeAssetId, activeAssetManifestCid } = getAssetState();
  return `${normalizeTokenId(activeAssetTokenId)}|${activeAssetId ?? ""}|${
    activeAssetManifestCid ? "open" : ""
  }`;
}

/** The open asset can't be inserted into itself, so its card is not listed. */
function isOwnCard(entry: any): boolean {
  const { activeAssetTokenId, activeAssetId, activeAssetManifestCid } = getAssetState();
  const tokenId = normalizeTokenId(activeAssetTokenId);
  if (activeAssetId) {
    return (
      entry.assetId === String(activeAssetId) &&
      (!tokenId || normalizeTokenId(entry.tokenId) === tokenId)
    );
  }
  return (
    Boolean(tokenId && activeAssetManifestCid) &&
    !entry.assetId &&
    normalizeTokenId(entry.tokenId) === tokenId
  );
}

function failedSummary(count: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "asset-library-failed";
  el.append(`${count} ${count === 1 ? "asset" : "assets"} can't be loaded. `);
  const link = document.createElement("a");
  link.href = "/library";
  link.setAttribute("data-nav", "");
  link.textContent = "Manage in Library";
  el.appendChild(link);
  return el;
}

function renderSections(): void {
  if (!assetLibraryBody || !_lastRender) return;
  const { ownedEntries, sharedEntries, visitor } = _lastRender;
  for (const h of _menuHandles) h.destroy();
  _menuHandles = [];
  assetLibraryBody.innerHTML = "";
  _lastOwnCardKey = ownCardKey();

  const loadable = (list: any[]) => list.filter((e) => e.type !== "inaccessible");
  const visible = (list: any[]) =>
    loadable(list).filter((e) => visitor || !isOwnCard(e));
  const ownedLoadable = loadable(ownedEntries);
  const ownedVisible = visible(ownedEntries);
  const sharedLoadable = loadable(sharedEntries);
  const sharedVisible = visible(sharedEntries);

  // Only the open asset left in a section: nothing to list, nothing to explain.
  if (ownedVisible.length > 0 || ownedLoadable.length === 0) {
    assetLibraryBody.appendChild(
      createSection(visitor ? "Public Assets" : "Your assets", ownedVisible, visitor)
    );
  }
  if (sharedVisible.length > 0) {
    assetLibraryBody.appendChild(
      createSection("Shared with you", sharedVisible, visitor)
    );
  }
  const failed =
    ownedEntries.length -
    ownedLoadable.length +
    (sharedEntries.length - sharedLoadable.length);
  if (failed > 0) assetLibraryBody.appendChild(failedSummary(failed));
  applySearchFilter();
  updateInsertChrome();
}

let _searchTerm = "";

/** Hides cards whose name doesn't contain the search term (client-side only). */
function applySearchFilter(): void {
  if (!assetLibraryBody) return;
  const term = _searchTerm.trim().toLowerCase();
  assetLibraryBody.querySelectorAll<HTMLElement>(".asset-card").forEach((card) => {
    const name = card.querySelector(".asset-card-name")?.textContent ?? "";
    card.hidden = term !== "" && !name.toLowerCase().includes(term);
  });
}

const INSERT_HINT = "Insert a live link to another asset. Changes to the original show up here.";
const BROWSE_HINT = "Read-only public profile. Open an asset to view it.";

/** Panel title, hint and the "open an asset first" notice follow mode + open asset. */
function updateInsertChrome(): void {
  const visitor = isLibraryVisitor();
  const title = document.getElementById("insertPanelTitle");
  if (title) title.textContent = visitor ? "Browse" : "Insert";
  const hint = document.getElementById("insertPanelHint");
  if (hint) hint.textContent = visitor ? BROWSE_HINT : INSERT_HINT;
  const notice = document.getElementById("insertNoAsset");
  // Signed out, "New empty asset" can't start a draft — the sign-in empty
  // state below says what to do instead.
  if (notice) notice.hidden = visitor || isAssetOpen() || !walletState.get().walletAddress;
}

function cachedAssetName(assetID: string | null): string {
  if (!assetID) return "asset";
  const all = [...(_lastRender?.ownedEntries ?? []), ...(_lastRender?.sharedEntries ?? [])];
  return all.find((e) => e.assetId === assetID)?.name || assetID;
}

on(EVENTS.ASSET_LINKED_INSERTED, ({ nodeId, assetID }) => {
  const target = getActiveAssetName() || "Untitled Asset";
  showToast({
    type: "success",
    title: `${cachedAssetName(assetID)} inserted into ${target}`,
    duration: 6000,
    actions: [{ label: "Undo", onClick: () => removeChildAssetNodes([nodeId]) }],
  });
});

on(EVENTS.ASSET_LINKED_INSERT_FAILED, ({ assetID, reason }) => {
  showToast({
    type: "error",
    title: `Couldn't insert ${cachedAssetName(assetID)}`,
    message: reason,
  });
});

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

function createSection(title: string, entries: any[], visitor: boolean = false): HTMLDivElement {
  const section = document.createElement("div");
  section.className = "asset-library-section";

  const heading = document.createElement("h4");
  heading.className = "asset-library-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  if (entries.length === 0) {
    const empty = visitor
      ? createEmptyState(
          "No public assets yet",
          "This profile hasn't published any assets yet."
        )
      : title === "Your assets"
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
    list.appendChild(createAssetCard(entry, visitor));
  }
  section.appendChild(list);
  return section;
}

function wireCardDrag(item: HTMLDivElement, entry: any): void {
  item.addEventListener("dragstart", (event) => {
    if (!item.draggable) {
      event.preventDefault();
      return;
    }
    const payload = buildLinkedAssetPayload(entry, "live-ref");
    const dt = event.dataTransfer;
    if (!dt) return;
    dt.effectAllowed = "copy";
    dt.setData(
      "application/x-arbesk-linked-asset",
      JSON.stringify(payload)
    );
    dt.setData("text/plain", `${entry.name} Token #${entry.tokenId}`);
  });
}

function buildCardThumbnail(): {
  thumbnailEl: HTMLDivElement;
  reloadBtn: HTMLButtonElement;
} {
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
  return { thumbnailEl, reloadBtn };
}

function wireCardThumbnailLoading(
  entry: any,
  thumbnailEl: HTMLDivElement,
  reloadBtn: HTMLButtonElement
): void {
  const runLoad = () =>
    renderAssetThumbnail(entry.thumbnail, thumbnailEl, entry.name);
  reloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    runLoad();
  });
  runLoad();
}

/** Opens the entry after confirming that unsaved edits may be discarded. */
async function openEntryConfirmed(entry: any): Promise<void> {
  if (!(await confirmDiscardChanges())) return;
  await openAssetEntry(entry);
}

/**
 * Navigates to /library through the router's delegated `a[data-nav]` handler.
 * @remarks router.ts imports this module, so importing navigate() here would
 *   create a cycle; a transient data-nav link reuses the same path.
 */
function goToLibrary(): void {
  const link = document.createElement("a");
  link.href = "/library";
  link.setAttribute("data-nav", "");
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

let _menuSeq = 0;

/**
 * The card's ⋯ button and its popover: Insert a copy / Open / Show in Library.
 * @remarks Visitors get only "Show in Library"; inserting and opening from
 *   the menu are owner actions (a visitor's card body already opens).
 */
function buildCardMenu(entry: any, visitor: boolean = false): { anchor: HTMLDivElement; moreBtn: HTMLButtonElement } {
  const menuId = `assetCardMenu${++_menuSeq}`;
  const name = entry.name || `asset #${entry.tokenId}`;

  const anchor = document.createElement("div");
  anchor.className = "menu-anchor asset-card-menu";

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "btn btn-icon asset-card-more";
  moreBtn.setAttribute("aria-haspopup", "menu");
  moreBtn.setAttribute("aria-expanded", "false");
  moreBtn.setAttribute("aria-controls", menuId);
  moreBtn.setAttribute("aria-label", `More actions for ${name}`);
  moreBtn.title = "More actions";
  moreBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="/icons.svg#more-horizontal"/></svg>`;

  const menu = document.createElement("ul");
  menu.id = menuId;
  menu.className = "menu-popover";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions for ${name}`);
  menu.hidden = true;
  const labels: Array<[string, string]> = [
    ["insert-copy", "Insert a copy"],
    ["open", `Open ${name}`],
    ["library", "Show in Library"],
  ];
  for (const [action, label] of visitor ? labels.slice(2) : labels) {
    const li = document.createElement("li");
    li.className = "menu-item";
    li.setAttribute("role", "menuitem");
    li.tabIndex = -1;
    li.dataset.action = action;
    li.textContent = label;
    menu.appendChild(li);
  }
  anchor.append(moreBtn, menu);

  _menuHandles.push(
    initMenuButton(moreBtn, menu, {
      align: "end",
      onSelect(item) {
        switch (item.dataset.action) {
          case "insert-copy":
            emit(EVENTS.ASSET_ADD_LINKED_REQUESTED, buildLinkedAssetPayload(entry, "fork"));
            break;
          case "open":
            void openEntryConfirmed(entry);
            break;
          case "library":
            goToLibrary();
            break;
        }
      },
    })
  );
  return { anchor, moreBtn };
}

/**
 * Insert needs a scene to insert into: cards are inert until an asset is open.
 * @remarks Inert cards can't be dragged and opt out of the hover highlight.
 */
function applyInsertAvailability(card: HTMLElement, enabled: boolean): void {
  const main = card.querySelector<HTMLButtonElement>(".asset-card-main");
  if (main) main.disabled = !enabled;
  card.draggable = enabled;
  card.classList.toggle("asset-card--disabled", !enabled);
  card
    .querySelector<HTMLElement>('[data-action="insert-copy"]')
    ?.setAttribute("aria-disabled", String(!enabled));
}

function createAssetCard(entry: any, visitor: boolean = false): HTMLDivElement {
  const item = document.createElement("div");
  item.className = `asset-card ${
    entry.role === "editor" ? "asset-card--editor" : ""
  }`.trim();
  item.dataset.tokenId = entry.tokenId;
  if (entry.assetId) item.dataset.assetId = entry.assetId;
  item.dataset.manifestCid = entry.manifestCid;
  if (entry.collectionCid) item.dataset.collectionCid = entry.collectionCid;
  // Dragging an asset into the scene is an edit affordance — owners only.
  item.draggable = !visitor;
  if (!visitor) wireCardDrag(item, entry);

  const { thumbnailEl, reloadBtn } = buildCardThumbnail();

  const nameEl = document.createElement("div");
  nameEl.className = "asset-card-name";
  nameEl.textContent = entry.name || `Loading… #${entry.tokenId}`;

  // The card body is the primary action: Insert (visitors can only open).
  const main = document.createElement("button");
  main.type = "button";
  main.className = "asset-card-main";
  main.setAttribute(
    "aria-label",
    `${visitor ? "Open" : "Insert"} ${entry.name || `asset #${entry.tokenId}`}`
  );
  main.append(thumbnailEl, nameEl);
  main.addEventListener("click", () => {
    if (visitor) {
      void openEntryConfirmed(entry);
      return;
    }
    emit(EVENTS.ASSET_ADD_LINKED_REQUESTED, buildLinkedAssetPayload(entry, "live-ref"));
  });
  item.appendChild(main);
  // Sibling of the main button (nested buttons are invalid), overlaid by CSS.
  item.appendChild(reloadBtn);

  item.appendChild(buildCardMenu(entry, visitor).anchor);
  if (!visitor) applyInsertAvailability(item, isAssetOpen());

  wireCardThumbnailLoading(entry, thumbnailEl, reloadBtn);
  return item;
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

/**
 * Show/hide the "Read-only · public profile" pill in the Gallery header.
 * @remarks The badge mirrors the library-view toolbar badge; visitors get
 *   read-only cards, so this is the only panel-level identity signal.
 */
function updateGalleryVisitorChrome(): void {
  const badge = document.getElementById("galleryVisitorBadge");
  if (!badge) return;
  const subject = libraryState.get().subjectAddress;
  const visitor = isLibraryVisitor();
  badge.hidden = !visitor;
  updateInsertChrome();
  if (visitor && subject) {
    badge.textContent = "Read-only · public profile";
  }
}

async function refreshAssetLibrary(): Promise<void> {
  const { walletAddress } = walletState.get();
  // A profile subject's assets load read-only, even without a wallet.
  const subject = libraryState.get().subjectAddress;
  const address = subject ?? walletAddress;
  if (!address || !assetLibraryBody) return;
  const visitor = isLibraryVisitor();
  const chainId = subject ? subjectReadChainId() : undefined;

  updateGalleryVisitorChrome();

  if (libraryRenderInFlight) {
    libraryRenderPending = true;
    return;
  }

  libraryRenderInFlight = true;
  try {
    do {
      libraryRenderPending = false;
      const { owned, shared } = await fetchAssetLibrary(address, false, {
        includeShared: !visitor,
        chainId,
      });
      await renderAssetLibrary(owned, shared, { visitor });
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
 * Updates just the active asset's gallery card after publish.
 * @remarks Avoids re-fetching every asset when only one changed.
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

  // The open asset's own card is hidden, so patch the cached entry (shown
  // again when the asset closes) as well as any card currently in the DOM.
  const cached = findCachedEntry(tokenId, assetId);
  const selector = `.asset-card[data-token-id="${tokenId}"][data-asset-id="${assetId}"]`;
  const oldCard = assetLibraryBody.querySelector(selector) as HTMLElement | null;
  if (!cached && !oldCard) return false;

  const prior = cached ?? entryFromCard(oldCard as HTMLElement);
  const entry = {
    type: "asset",
    tokenId: String(activeAssetTokenId),
    assetId,
    manifestCid: activeAssetManifestCid,
    collectionCid: prior.collectionCid,
    name: currentManifest.name || assetId,
    thumbnail: currentManifest.thumbnail || null,
    isCollection: Boolean(prior.collectionCid),
    role: prior.role,
  };

  if (cached) Object.assign(cached, entry);
  if (oldCard) oldCard.replaceWith(createAssetCard(entry));
  return true;
}

/** The cached gallery entry for an asset, if the last render included it. */
function findCachedEntry(tokenId: string, assetId: string): any | null {
  if (!_lastRender) return null;
  const all = [..._lastRender.ownedEntries, ..._lastRender.sharedEntries];
  return (
    all.find(
      (e) =>
        e.type !== "inaccessible" &&
        normalizeTokenId(e.tokenId) === tokenId &&
        e.assetId === assetId
    ) ?? null
  );
}

/** Role and collection recovered from a rendered card's markup. */
function entryFromCard(card: HTMLElement): { role: string; collectionCid: string | null } {
  return {
    role: card.classList.contains("asset-card--editor") ? "editor" : "owner",
    collectionCid: card.dataset.collectionCid || null,
  };
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

  const search = document.getElementById("insertSearchInput") as HTMLInputElement | null;
  search?.addEventListener("input", () => {
    _searchTerm = search.value;
    applySearchFilter();
  });
  document.getElementById("insertNewAssetBtn")?.addEventListener("click", () => {
    document.getElementById("newAssetBtn")?.click();
  });
  updateInsertChrome();

  // Delegated: the gallery Connect affordance mirrors the headerbar button.
  assetLibraryBody?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("#galleryConnectBtn")) {
      document.getElementById("connectWalletBtn")?.click();
    }
  });
}

on(EVENTS.SCENE_READY, highlightActiveAsset);

/**
 * Refreshes the gallery after a publish signal.
 * @remarks Runs on ASSET_PUBLISH_PENDING (optimistic) and again on
 *   ASSET_PUBLISHED (authoritative); the update is idempotent, so running it
 *   twice is harmless.
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

/**
 * Refreshes the gallery only when its sidebar view is visible.
 * @remarks Keeps page-load cost proportional to owned collections rather than
 *   the (unbounded) number of assets inside them.
 */
function refreshGalleryWhenVisible(): void {
  if (getActiveView() !== "library") {
    _libraryDirty = true;
    return;
  }
  void refreshAssetLibrary();
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
  refreshGalleryWhenVisible();
});

on(EVENTS.ASSET_OPEN_BY_TOKEN_ID, (e) => {
  if (e?.tokenId) openAssetByTokenId(e.tokenId, e?.assetId || null);
});

on(EVENTS.WALLET_CONNECTED, async () => {
  updateInsertChrome();
  const params = new URLSearchParams(window.location.search);
  const assetTokenId = params.get("asset");
  const assetId = params.get("assetId");
  if (assetTokenId && getActiveContract()) {
    await openAssetByTokenId(assetTokenId, assetId);
  }

  if (assetLibraryBody) {
    assetLibraryBody.innerHTML = LOADING_GALLERY_HTML;
  }
  refreshGalleryWhenVisible();
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
    refreshGalleryWhenVisible();
  }
  syncInsertState();
});
on(EVENTS.PENDING_EDITS_CHANGED, syncInsertState);

/**
 * Reflects the open asset on the rendered cards without refetching.
 * @remarks Opening/closing flips the disabled state; a different open asset
 *   also changes which card is hidden, which re-renders from the cached
 *   entries.
 */
function syncInsertState(): void {
  // The notice is independent of the cards: keep it right before the first
  // render and after disconnect too.
  updateInsertChrome();
  if (!assetLibraryBody || !_lastRender) return;
  if (ownCardKey() !== _lastOwnCardKey) {
    renderSections();
    return;
  }
  const enabled = isAssetOpen();
  assetLibraryBody
    .querySelectorAll<HTMLElement>(".asset-card")
    .forEach((card) => applyInsertAvailability(card, enabled));
}

on(EVENTS.WALLET_DISCONNECTED, () => {
  _lastRenderedCollectionTokenId = null;
  // A profile subject keeps the Gallery panel alive read-only after disconnect.
  if (libraryState.get().subjectAddress) {
    void refreshAssetLibrary();
    return;
  }
  if (assetLibraryBody) {
    assetLibraryBody.innerHTML = DISCONNECTED_GALLERY_HTML;
  }
  updateInsertChrome();
});

export {
  initAssetLibrary,
  fetchAssetLibrary,
  refreshAssetLibrary,
  renderAssetLibrary,
  updateActiveAssetCard,
};
