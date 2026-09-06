/**
 * Data and gating logic for the Library view: collection/asset fetching and
 * the sign-in gate.
 */

import { walletState } from "../state/wallet-state.ts";
import { libraryState, isLibraryVisitor } from "../state/library-state.ts";
import type {
  LibraryAssetItem,
  LibraryCollectionItem,
} from "../state/library-state.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { deriveDefaultCollectionId } from "@arbesk/asset-core/utils/collections.js";
import { extractThumbnailCid } from "../utils/thumbnail.ts";
import { CHAIN_IDS, DEPLOYMENT_BLOCKS } from "../../../../constants/chains.js";
import { getNetworkSelectKey } from "../blockchain/network-config.ts";
import {
  fetchAssetLibrary,
  expandTokenToAssets,
  getReadableContract,
} from "./asset-library.ts";

// Optimistic collections created within this window are kept even if ownerOf
// temporarily fails or the indexer has not caught up yet (e.g. smart-wallet
// state propagation delays on public testnets).
const OPTIMISTIC_COLLECTION_GRACE_MS = 2 * 60 * 1000;

function ts(): string {
  return new Date().toLocaleTimeString();
}

/**
 * Real (production/testnet) networks: chains with a configured deployment
 * block. Hardhat local is dev-only and never first-class.
 */
function realNetworks(): number[] {
  return Object.entries(DEPLOYMENT_BLOCKS)
    .filter(([, block]) => Number(block) > 0)
    .map(([id]) => Number(id));
}

/**
 * Candidate chains for a profile subject's tokens, in probe order: the real
 * networks (indexer-backed), then the connected wallet's chain if not already
 * covered, then Hardhat local last (dev-only).
 */
function subjectChainCandidates(): number[] {
  const candidates = realNetworks();
  const walletChain = Number(walletState.get().chainId);
  if (
    Number.isFinite(walletChain) &&
    walletChain > 0 &&
    !candidates.includes(walletChain)
  ) {
    candidates.push(walletChain);
  }
  if (!candidates.includes(CHAIN_IDS.HARDHAT_LOCAL)) {
    candidates.push(CHAIN_IDS.HARDHAT_LOCAL);
  }
  return candidates;
}

/**
 * Resolve the chain a profile subject's tokens live on by probing each
 * candidate with an owned-token lookup (per-chain RPC failures fall through
 * to the next candidate). When no candidate has tokens, returns the first
 * REAL network so an empty profile renders against the production network —
 * falling back to Hardhat local only when no real network is configured at
 * all (pure local dev backend).
 */
export async function resolveSubjectChain(address: string): Promise<number> {
  const candidates = subjectChainCandidates();
  for (const chainId of candidates) {
    try {
      const { owned } = await fetchAssetLibrary(address, false, {
        includeShared: false,
        chainId,
      });
      if (owned.length > 0) {
        console.log(`[LIBRARY] profile subject ${address} resolved to chain ${chainId}`);
        return chainId;
      }
    } catch (err) {
      console.warn(
        `[LIBRARY] subject chain probe failed on chain ${chainId}:`,
        (err as Error).message
      );
    }
  }
  return realNetworks()[0] ?? CHAIN_IDS.HARDHAT_LOCAL;
}

/**
 * Sync the header network selector's DISPLAY to a chain (read-only — never
 * switches the wallet's network). Used so a resolved profile chain is
 * honestly reflected while browsing it.
 */
function syncNetworkSelectorDisplay(chainId: number | null | undefined): void {
  if (!chainId) return;
  const netSel = document.getElementById(
    "headerbarNetworkSelect"
  ) as HTMLSelectElement | null;
  if (!netSel) return;
  const key = getNetworkSelectKey(chainId);
  if (key) netSel.value = key;
}

export function applyWalletGate(connected: boolean): void {
  const gate = document.getElementById("libraryGate");
  const main = document.getElementById("libraryMain");
  const subject = libraryState.get().subjectAddress;
  // Anonymous visitors with a profile subject skip the sign-in gate.
  const showGate = !connected && !subject;
  if (gate && main) {
    gate.classList.toggle("hidden", !showGate);
    main.classList.toggle("hidden", showGate);
  }

  const visitor = isLibraryVisitor();
  const createBtn = document.getElementById("libraryCreateCollectionBtn");
  const uploadBtn = document.getElementById("libraryUploadBtn");
  if (createBtn) createBtn.hidden = !connected || visitor;
  if (uploadBtn) uploadBtn.hidden = !connected || visitor;

  const badge = document.getElementById("libraryVisitorBadge");
  if (badge) {
    badge.hidden = !visitor;
    if (visitor && subject) {
      badge.textContent = "Read-only · public library";
    }
  }
}

/**
 * Point the library at a public profile (`/library/<base58>`), or back at the
 * connected wallet with null. Resets the open collection, selection and
 * loaded assets when the subject actually changes, then re-applies the
 * gate/chrome.
 * @returns true when the subject changed
 */
export function setLibrarySubject(address: string | null): boolean {
  const prev = libraryState.get().subjectAddress;
  const changed =
    (prev || "").toLowerCase() !== (address || "").toLowerCase();
  if (changed) {
    libraryState.set({
      subjectAddress: address,
      subjectChainId: null,
      collections: [],
      currentCollectionTokenId: null,
      selectedIds: [],
      assets: [],
    });
    // Leaving a profile restores the wallet chain in the selector display.
    if (!address) {
      syncNetworkSelectorDisplay(Number(walletState.get().chainId) || null);
    }
  }
  applyWalletGate(Boolean(walletState.get().walletAddress));
  return changed;
}

function isNonexistentTokenError(err: any): boolean {
  const msg = (err?.message || err?.data || "").toString().toLowerCase();
  return (
    msg.includes("nonexistent") ||
    msg.includes("erc721nonexistenttoken") ||
    msg.includes("invalid token") ||
    msg.includes("token id does not exist")
  );
}

interface CollectionMetadata {
  tokenId: string;
  manifestCid: string;
  name: string;
  thumbnail: any;
}

async function fetchCollectionMetadata(
  tokenId: string,
  chainId?: number
): Promise<CollectionMetadata | null> {
  const start = performance.now();
  const c = await getReadableContract(chainId);
  if (!c) return null;
  try {
    const uriStart = performance.now();
    const cid = await c.read.tokenURI([BigInt(tokenId)]);
    console.log(
      `[${ts()}] [LIBRARY] tokenURI ${tokenId} → ${cid ? cid.slice(0, 20) + "…" : null} ` +
        `(${Math.round(performance.now() - uriStart)}ms)`
    );
    if (!cid) return null;

    const ipfsStart = performance.now();
    const manifest = await getFromRemoteIPFS(cid);
    console.log(
      `[${ts()}] [LIBRARY] getFromRemoteIPFS ${cid.slice(0, 20)}… ` +
        `(${Math.round(performance.now() - ipfsStart)}ms)`
    );

    return {
      tokenId: String(tokenId),
      manifestCid: cid,
      name: manifest?.name || `Collection #${tokenId}`,
      thumbnail: manifest?.thumbnail || null,
    };
  } catch (err) {
    // Named collections that have not been minted yet are expected; don't warn.
    if (!isNonexistentTokenError(err)) {
      console.warn(`[LIBRARY] Failed to load collection metadata for ${tokenId}`, err);
    }
    return null;
  } finally {
    console.log(
      `[${ts()}] [LIBRARY] fetchCollectionMetadata ${tokenId} total ` +
        `${Math.round(performance.now() - start)}ms`
    );
  }
}

async function isTokenOwnedBy(tokenId: string, address: string, chainId?: number): Promise<boolean> {
  const c = await getReadableContract(chainId);
  if (!c || !address) return false;
  try {
    const owner = await c.read.ownerOf([BigInt(tokenId)]);
    return owner.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

async function buildCollectionEntries(
  tokenIds: string[],
  role: string,
  walletAddr: string,
  chainId?: number
): Promise<LibraryCollectionItem[]> {
  const entries = await Promise.all(
    tokenIds.map((tokenId) => fetchCollectionMetadata(tokenId, chainId))
  );
  const defaultIdHex = deriveDefaultCollectionId(walletAddr);
  // tokenIds come from the contract as decimal strings; soliditySha3 returns hex.
  const defaultId = defaultIdHex ? BigInt(defaultIdHex).toString() : null;
  return entries.filter((meta) => meta !== null).map((meta) => {
      const isDefault = defaultId && String(meta.tokenId) === defaultId;
      return {
        id: `collection-${meta.tokenId}`,
        type: "collection",
        tokenId: meta.tokenId,
        manifestCid: meta.manifestCid,
        name: isDefault
          ? "Default"
          : meta.name || `Collection #${meta.tokenId}`,
        thumbnailCid: extractThumbnailCid(meta.thumbnail),
        status: "besked",
        role,
      };
    });
}

export async function loadCurrentAssets(): Promise<void> {
  const state = libraryState.get();
  const tokenId = state.currentCollectionTokenId;
  if (!tokenId) {
    libraryState.set({ assets: [] });
    return;
  }
  // Profile libraries read on the subject's resolved chain.
  const readChainId =
    state.subjectAddress && state.subjectChainId
      ? state.subjectChainId
      : undefined;

  const isStale = () =>
    String(libraryState.get().currentCollectionTokenId) !== String(tokenId);

  libraryState.set({ assets: [], isLoading: true });
  try {
    const collection = state.collections.find(
      (c) => String(c.tokenId) === String(tokenId)
    );
    const role = collection?.role || "owner";
    const entries = (await expandTokenToAssets(tokenId, readChainId)).filter(
      (e) => e.type !== "inaccessible"
    );

    if (isStale()) return;

    const assets = entries.map((entry) => ({
        id: `asset-${entry.tokenId}-${entry.assetId}`,
        type: "asset",
        tokenId: entry.tokenId,
        assetId: entry.assetId,
        manifestCid: entry.manifestCid,
        name: entry.name || entry.assetId || `Asset`,
        thumbnailCid: extractThumbnailCid(entry.thumbnail),
        status: "besked",
        role,
      })) as LibraryAssetItem[];
    libraryState.set({ assets, isLoading: false });
  } catch (err) {
    console.error("[LIBRARY] Failed to load collection assets", err);
    if (!isStale()) libraryState.set({ assets: [], isLoading: false });
  }
}

let _refreshInFlight: Promise<void> | null = null;

/**
 * Commits a freshly fetched collection list to state, then reloads the open
 * collection's assets (or clears them when the collection vanished).
 */
async function commitCollections(
  collections: LibraryCollectionItem[],
  currentTokenId: string | number | null,
  start: number
): Promise<void> {
  const stillExists = collections.some(
    (c) => String(c.tokenId) === String(currentTokenId)
  );
  libraryState.set({
    collections,
    currentCollectionTokenId: stillExists ? currentTokenId : null,
    selectedIds: [],
    isLoading: false,
  });
  if (currentTokenId) {
    await loadCurrentAssets();
  }
  console.log(
    `[${ts()}] [LIBRARY] refreshLibraryData done in ` +
      `${Math.round(performance.now() - start)}ms`
  );
}

export async function refreshLibraryData(forceIndexer: boolean = false): Promise<void> {
  if (_refreshInFlight) {
    return _refreshInFlight;
  }

  const run = async (): Promise<void> => {
  const start = performance.now();
  const { walletAddress } = walletState.get();
  const subjectAddress = libraryState.get().subjectAddress;
  // Public profiles load the subject's library; owner mode loads the wallet's.
  const effectiveAddress = subjectAddress ?? walletAddress;
  if (!effectiveAddress) return;
  const visitor = isLibraryVisitor();

  // A profile URL must find the subject's tokens regardless of the VIEWER's
  // chain (or absence of a wallet): probe candidate chains and read on the
  // one that has tokens. Non-profile loads keep the wallet chain.
  let readChainId: number | undefined;
  if (subjectAddress) {
    const resolved = await resolveSubjectChain(subjectAddress);
    libraryState.set({ subjectChainId: resolved });
    readChainId = resolved;
    syncNetworkSelectorDisplay(resolved);
  }

  libraryState.set({ isLoading: true });
  try {
    const fetchStart = performance.now();
    // Visitors see the profile's own collections only — shared-with-them
    // tokens are the subject's private collaboration context, not profile data.
    const { owned, shared } = await fetchAssetLibrary(
      effectiveAddress,
      forceIndexer,
      { includeShared: !visitor, chainId: readChainId }
    );
    console.log(
      `[${ts()}] [LIBRARY] fetchAssetLibrary returned ${owned.length} owned in ` +
        `${Math.round(performance.now() - fetchStart)}ms`
    );

    const currentState = libraryState.get();
    const currentTokenId = currentState.currentCollectionTokenId;

    if (visitor) {
      const metaStart = performance.now();
      const collections = await buildCollectionEntries(
        owned,
        "owner",
        effectiveAddress,
        readChainId
      );
      console.log(
        `[${ts()}] [LIBRARY] buildCollectionEntries done in ` +
          `${Math.round(performance.now() - metaStart)}ms (visitor)`
      );
      await commitCollections(collections, currentTokenId, start);
      return;
    }

    const now = Date.now();

    // Reuse optimistic collection metadata for freshly created collections.
    // This avoids waiting for Pinata to propagate the new manifest before the
    // card can render.
    const optimisticByTokenId = new Map<string, LibraryCollectionItem>(
      currentState.collections
        .filter(
          (c) =>
            c.createdAt && now - c.createdAt < OPTIMISTIC_COLLECTION_GRACE_MS
        )
        .map((c) => [String(c.tokenId), c])
    );

    const ownedFromOptimistic: LibraryCollectionItem[] = [];
    const ownedToFetch: string[] = [];
    for (const tokenId of owned) {
      const optimistic = optimisticByTokenId.get(String(tokenId));
      if (optimistic) {
        console.log(
          `[${ts()}] [LIBRARY] reusing optimistic metadata for ${tokenId}`
        );
        ownedFromOptimistic.push({
          id: optimistic.id,
          type: "collection",
          tokenId: optimistic.tokenId,
          manifestCid: optimistic.manifestCid,
          name: optimistic.name,
          thumbnailCid: optimistic.thumbnailCid || "",
          status: "besked",
          role: "owner",
          createdAt: optimistic.createdAt,
        });
      } else {
        ownedToFetch.push(tokenId);
      }
    }

    const metaStart = performance.now();
    const [fetchedOwnedEntries, sharedEntries] = await Promise.all([
      buildCollectionEntries(ownedToFetch, "owner", effectiveAddress, readChainId),
      buildCollectionEntries(shared, "editor", effectiveAddress, readChainId),
    ]);
    const ownedEntries = [...ownedFromOptimistic, ...fetchedOwnedEntries];
    console.log(
      `[${ts()}] [LIBRARY] buildCollectionEntries done in ` +
        `${Math.round(performance.now() - metaStart)}ms ` +
        `(${ownedFromOptimistic.length} optimistic, ${ownedToFetch.length} fetched)`
    );

    const fetchedCollections = [...ownedEntries, ...sharedEntries];

    // getPastEvents scans can lag behind a freshly mined mint on local nodes,
    // causing optimistic collections to disappear on refresh. Verify ownership
    // of any missing collections via ownerOf before dropping them. Keep recently
    // created optimistic collections for a grace period even when ownerOf
    // temporarily fails (e.g. smart-wallet state propagation delays).
    const missing = currentState.collections.filter(
      (current) =>
        !fetchedCollections.some(
          (fetched) => String(fetched.tokenId) === String(current.tokenId)
        )
    );
    const keptMissing = (
      await Promise.all(
        missing.map(async (current) => {
          const ageMs = current.createdAt ? now - current.createdAt : Infinity;
          const inGracePeriod = ageMs < OPTIMISTIC_COLLECTION_GRACE_MS;
          const ownStart = performance.now();
          const stillOwned = await isTokenOwnedBy(
            current.tokenId,
            effectiveAddress,
            readChainId
          );
          console.log(
            `[${ts()}] [LIBRARY] ownerOf ${current.tokenId} → ${stillOwned} ` +
              `(${Math.round(performance.now() - ownStart)}ms)`
          );
          if (stillOwned) {
            return current;
          }
          if (inGracePeriod) {
            console.log(
              `[${ts()}] [LIBRARY] keeping optimistic collection ${current.tokenId} ` +
                `within grace period (${Math.round(ageMs / 1000)}s)`
            );
            return current;
          }
          return null;
        })
      )
    ).filter((c) => c !== null);
    const collections = [...fetchedCollections, ...keptMissing];
    await commitCollections(collections, currentTokenId, start);
  } catch (err) {
    console.error("[LIBRARY] Failed to refresh library data", err);
    libraryState.set({ isLoading: false });
  }
  };

  _refreshInFlight = run();
  try {
    await _refreshInFlight;
  } finally {
    _refreshInFlight = null;
  }
}
