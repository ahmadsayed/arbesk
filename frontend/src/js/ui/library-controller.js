// @ts-nocheck
/**
 * Library Controller
 *
 * Data + gating logic for the Library view, extracted from the old
 * library-init.js so the unified SPA bootstrap (app-init.js) can import it
 * without dragging in page-level wiring. Owns collection/asset fetching and the
 * sign-in gate; the router calls refreshLibraryData() when the Library view
 * becomes active.
 */

import { walletState } from "../state/wallet-state.js";
import { libraryState } from "../state/library-state.js";
import { contract as walletContract } from "../blockchain/wallet.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { deriveDefaultCollectionId } from "../utils/collections.js";
import { fetchAssetLibrary, expandTokenToAssets } from "./asset-library.js";

// Optimistic collections created within this window are kept even if ownerOf
// temporarily fails or the indexer has not caught up yet (e.g. smart-wallet
// state propagation delays on public testnets).
const OPTIMISTIC_COLLECTION_GRACE_MS = 2 * 60 * 1000;

function ts() {
  return new Date().toLocaleTimeString();
}

export function applyWalletGate(connected) {
  const gate = document.getElementById("libraryGate");
  const main = document.getElementById("libraryMain");
  if (!gate || !main) return;
  gate.classList.toggle("hidden", connected);
  main.classList.toggle("hidden", !connected);

  const createBtn = document.getElementById("libraryCreateCollectionBtn");
  const uploadBtn = document.getElementById("libraryUploadBtn");
  if (createBtn) createBtn.hidden = !connected;
  if (uploadBtn) uploadBtn.hidden = !connected;
}

function extractThumbnailCid(thumbnail) {
  if (!thumbnail) return "";
  if (typeof thumbnail === "string") return thumbnail;
  return thumbnail.cid || thumbnail.source?.cid || "";
}

function isNonexistentTokenError(err) {
  const msg = (err?.message || err?.data || "").toString().toLowerCase();
  return (
    msg.includes("nonexistent") ||
    msg.includes("erc721nonexistenttoken") ||
    msg.includes("invalid token") ||
    msg.includes("token id does not exist")
  );
}

async function fetchCollectionMetadata(tokenId) {
  const start = performance.now();
  const c = walletContract || walletState.get().contract;
  if (!c) return null;
  try {
    const uriStart = performance.now();
    const cid = await c.methods.tokenURI(tokenId).call();
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

async function isTokenOwnedBy(tokenId, address) {
  const c = walletContract || walletState.get().contract;
  if (!c || !address) return false;
  try {
    const owner = await c.methods.ownerOf(tokenId).call();
    return owner.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

async function buildCollectionEntries(tokenIds, role, walletAddr) {
  const entries = await Promise.all(
    tokenIds.map((tokenId) => fetchCollectionMetadata(tokenId))
  );
  const defaultIdHex = deriveDefaultCollectionId(walletAddr);
  // tokenIds come from the contract as decimal strings; soliditySha3 returns hex.
  const defaultId = defaultIdHex ? BigInt(defaultIdHex).toString() : null;
  return entries
    .filter(Boolean)
    .map((meta) => {
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

export async function loadCurrentAssets() {
  const state = libraryState.get();
  const tokenId = state.currentCollectionTokenId;
  if (!tokenId) {
    libraryState.set({ assets: [] });
    return;
  }

  const isStale = () =>
    String(libraryState.get().currentCollectionTokenId) !== String(tokenId);

  libraryState.set({ assets: [], isLoading: true });
  try {
    const collection = state.collections.find(
      (c) => String(c.tokenId) === String(tokenId)
    );
    const role = collection?.role || "owner";
    const entries = (await expandTokenToAssets(tokenId)).filter(
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
    }));
    libraryState.set({ assets, isLoading: false });
  } catch (err) {
    console.error("[LIBRARY] Failed to load collection assets", err);
    if (!isStale()) libraryState.set({ assets: [], isLoading: false });
  }
}

/** @type {Promise<void>|null} */
let _refreshInFlight = null;

export async function refreshLibraryData(forceIndexer = false) {
  if (_refreshInFlight) {
    return _refreshInFlight;
  }

  const run = async () => {
  const start = performance.now();
  const { walletAddress } = walletState.get();
  if (!walletAddress) return;

  libraryState.set({ isLoading: true });
  try {
    const fetchStart = performance.now();
    const { owned, shared } = await fetchAssetLibrary(walletAddress, forceIndexer);
    console.log(
      `[${ts()}] [LIBRARY] fetchAssetLibrary returned ${owned.length} owned in ` +
        `${Math.round(performance.now() - fetchStart)}ms`
    );

    const currentState = libraryState.get();
    const currentTokenId = currentState.currentCollectionTokenId;
    const now = Date.now();

    // Reuse optimistic collection metadata for freshly created collections.
    // This avoids waiting for Pinata to propagate the new manifest before the
    // card can render.
    const optimisticByTokenId = new Map(
      currentState.collections
        .filter(
          (c) =>
            c.createdAt && now - c.createdAt < OPTIMISTIC_COLLECTION_GRACE_MS
        )
        .map((c) => [String(c.tokenId), c])
    );

    const ownedFromOptimistic = [];
    const ownedToFetch = [];
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
      buildCollectionEntries(ownedToFetch, "owner", walletAddress),
      buildCollectionEntries(shared, "editor", walletAddress),
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
            walletAddress
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
    ).filter(Boolean);
    const collections = [...fetchedCollections, ...keptMissing];

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
