// @ts-nocheck
/**
 * Version History Store (headless)
 *
 * Owns the asset's manifest-chain state: entries (oldest→newest), the active
 * and published CIDs, loading state, and the isHistoryNavigation guard.
 * Logic extracted from the retired ui/asset-history.js; the scene clock and
 * model clock views subscribe here and render it as clock dials.
 *
 * Heavy dependencies (engine, wallet) are dynamically imported via `_deps`
 * at call time so unit tests can stub them without loading BABYLON.
 */

import { on, EVENTS } from "../events/bus.js";
import { assetState } from "./asset-state.js";

export const _deps = {
  walkChain: async (cid) => {
    const { walkManifestChain } = await import("../engine/time-travel.js");
    return walkManifestChain(cid);
  },
  clearScene: async () => {
    const { clearScene } = await import("../engine/scene-graph.js");
    clearScene();
  },
  loadAssetManifest: async (cid) => {
    const { loadAssetManifest } = await import("../engine/scene-graph.js");
    return loadAssetManifest(cid);
  },
  fetchPublishedCid: async (tokenId) => {
    const { contract } = await import("../blockchain/wallet.js");
    if (!contract) return null;
    const cid = await contract.methods.tokenURI(tokenId).call();
    return cid || null;
  },
};

// ─── State ───
let entries = []; // oldest → newest, from walkManifestChain (incl. nodes map)
let chainRootCid = null; // CID used to fetch the chain (latest known)
let activeCid = null; // currently loaded manifest CID
let publishedCid = null; // CID currently anchored on-chain
let isLoading = false;
let isHistoryNavigation = false;

const _subscribers = new Set();

function _notify() {
  const snapshot = getState();
  for (const fn of _subscribers) fn(snapshot);
}

// ─── Public API ───

export function getState() {
  return { entries: [...entries], activeCid, publishedCid, isLoading };
}

export function subscribe(fn) {
  _subscribers.add(fn);
  return () => _subscribers.delete(fn);
}

export function _resetSubscribers() {
  _subscribers.clear();
}

export function activeIndex() {
  const i = entries.findIndex((e) => e.cid === activeCid);
  return i === -1 ? entries.length - 1 : i;
}

/**
 * Versions relevant to one node: where it first appears, and every version
 * whose snapshot differs from the previous version's. Versions where the
 * node is absent are never included.
 */
export function versionsForNode(nodeId) {
  const out = [];
  let prev; // undefined = node absent in previous version
  for (const entry of entries) {
    const snap = entry.nodes ? entry.nodes[nodeId] : undefined;
    if (snap !== undefined && snap !== prev) out.push(entry);
    prev = snap;
  }
  return out;
}

export async function loadVersion(cid) {
  if (isLoading || cid === activeCid) return;
  const prevCid = activeCid;
  isLoading = true;
  isHistoryNavigation = true;
  activeCid = cid;
  _notify();

  try {
    // clearScene() resets latestAssetManifestCid, but the chain root (latest
    // version) must survive while the user is scrubbing history.
    const preservedLatest =
      chainRootCid || assetState.get().latestAssetManifestCid;
    await _deps.clearScene();
    if (preservedLatest) {
      assetState.set({ latestAssetManifestCid: preservedLatest });
    }
    await _deps.loadAssetManifest(cid);
    activeCid = cid;
  } catch (err) {
    console.error("Failed to load history version:", err);
    alert("Failed to load version: " + err.message);
    activeCid = prevCid; // snap the hand back
  } finally {
    isLoading = false;
    // Stays true until loadAssetManifest() resolved and scene:ready listeners
    // ran — a fixed timeout was too short for slow IPFS loads.
    isHistoryNavigation = false;
    _notify();
  }
}

// ─── Refresh ───

async function _refresh() {
  const manifestCid = assetState.get().activeAssetManifestCid;
  if (!manifestCid) {
    entries = [];
    chainRootCid = null;
    activeCid = null;
    publishedCid = null;
    _notify();
    return;
  }

  // On history navigation, keep the chain root — just track the active CID.
  if (isHistoryNavigation) {
    activeCid = manifestCid;
    _notify();
    return;
  }

  chainRootCid = manifestCid;
  activeCid = manifestCid;

  const tokenId = assetState.get().activeAssetTokenId;
  const [chain, pubCid] = await Promise.all([
    _deps.walkChain(chainRootCid).catch((err) => {
      console.error("History chain fetch failed:", err);
      return [];
    }),
    tokenId
      ? _deps.fetchPublishedCid(tokenId).catch(() => null)
      : Promise.resolve(null),
  ]);

  entries = chain;
  publishedCid = pubCid;
  _notify();
}

// ─── Bus subscriptions (mirrors the retired asset-history.js) ───

on(EVENTS.SCENE_READY, (e) => {
  const manifestCid = e?.manifestCid || assetState.get().activeAssetManifestCid;
  if (!manifestCid) return;

  if (isHistoryNavigation) {
    activeCid = manifestCid;
    _notify();
    return;
  }

  chainRootCid = manifestCid;
  activeCid = manifestCid;
  assetState.set({ latestAssetManifestCid: manifestCid });
  _refresh();
});

on(EVENTS.WALLET_CONNECTED, () => {
  if (assetState.get().activeAssetManifestCid && !isHistoryNavigation) {
    _refresh();
  }
});

on(EVENTS.ASSET_PUBLISHED, () => {
  // Re-check published CID after mint/update.
  setTimeout(_refresh, 500);
});

on(EVENTS.ASSET_DRAFT_SAVED, () => {
  _refresh();
});

on(EVENTS.SCENE_EMPTY, () => {
  entries = [];
  chainRootCid = null;
  activeCid = null;
  publishedCid = null;
  _notify();
});

// ─── Module-load bootstrap ───
// If the store is imported after SCENE_READY already fired, seed the clock
// from the current asset state exactly like the retired asset-history.js did.
if (assetState.get().activeAssetManifestCid && !isHistoryNavigation) {
  _refresh();
}
