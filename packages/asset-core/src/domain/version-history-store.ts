/**
 * Version History Store (headless).
 * @remarks Owns the asset's manifest-chain state: entries (oldest→newest),
 *   active/published CIDs, loading state, and the isHistoryNavigation guard.
 *   Heavy dependencies (engine, wallet) are injected through the `_deps` seam
 *   so the package stays environment-agnostic and tests can stub them.
 */

import { on, EVENTS } from "../events/bus.ts";
import {
  setLatestManifestCid,
  getLatestAssetManifestCid,
  getActiveAssetManifestCid,
  getActiveAssetTokenId,
} from "./asset.ts";

export type VersionHistoryEntry = { cid: string; [key: string]: any };

export interface VersionHistoryDeps {
  walkChain: (cid: string) => Promise<VersionHistoryEntry[]>;
  clearScene: () => Promise<void>;
  loadAssetManifest: (cid: string) => Promise<any>;
  fetchPublishedCid: (tokenId: string | number) => Promise<string | null>;
}

function _unconfigured(name: string): () => Promise<never> {
  return () =>
    Promise.reject(
      new Error(
        `asset-core: version-history dep "${name}" not configured — the host app must call configureVersionHistoryDeps()`
      )
    );
}

export const _deps: VersionHistoryDeps = {
  walkChain: _unconfigured("walkChain"),
  clearScene: _unconfigured("clearScene"),
  loadAssetManifest: _unconfigured("loadAssetManifest"),
  fetchPublishedCid: _unconfigured("fetchPublishedCid"),
};

/**
 * Installs the environment-specific dependency implementations.
 */
export function configureVersionHistoryDeps(deps: Partial<VersionHistoryDeps>) {
  Object.assign(_deps, deps);
}

// ─── State ───
let entries: VersionHistoryEntry[] = []; // oldest → newest, from walkManifestChain (incl. nodes map)
let chainRootCid: string | null = null; // CID used to fetch the chain (latest known)
let activeCid: string | null = null; // currently loaded manifest CID
let publishedCid: string | null = null; // CID currently anchored on-chain
let isLoading = false;
let isHistoryNavigation = false;
// Monotonic refresh generation. A walk that resolves after a newer one (or
// after the scene was cleared) must not publish its stale result.
let _refreshSeq = 0;

const _subscribers: Set<(snapshot: VersionHistoryState) => void> = new Set();

function _notify() {
  const snapshot = getState();
  for (const fn of _subscribers) fn(snapshot);
}

/**
 * Drops all chain state and cancels any in-flight refresh.
 * @remarks Used by SCENE_EMPTY / SCENE_CLEARED so a freshly cleared Studio
 *   never keeps showing the previous asset's version strip.
 */
function _reset() {
  _refreshSeq++;
  entries = [];
  chainRootCid = null;
  activeCid = null;
  publishedCid = null;
  _notify();
}

// ─── Public API ───

export interface VersionHistoryState {
  /** oldest → newest */
  entries: VersionHistoryEntry[];
  activeCid: string | null;
  publishedCid: string | null;
  isLoading: boolean;
}

export function getState(): VersionHistoryState {
  return { entries: [...entries], activeCid, publishedCid, isLoading };
}

/**
 * @returns unsubscribe function
 */
export function subscribe(
  fn: (snapshot: VersionHistoryState) => void
): () => boolean {
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
 * Loads a version by manifest CID.
 */
export async function loadVersion(cid: string) {
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
      chainRootCid || getLatestAssetManifestCid();
    await _deps.clearScene();
    if (preservedLatest) {
      setLatestManifestCid(preservedLatest);
    }
    await _deps.loadAssetManifest(cid);
    activeCid = cid;
  } catch (err) {
    console.error("Failed to load history version:", err);
    alert("Failed to load version: " + (err as Error).message);
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

async function _refresh(rootCid: string | null = getActiveAssetManifestCid()) {
  if (!rootCid) {
    _reset();
    return;
  }

  // On history navigation, keep the chain root — just track the active CID.
  if (isHistoryNavigation) {
    activeCid = getActiveAssetManifestCid();
    _notify();
    return;
  }

  // Only the newest refresh may publish its result. A deep link can adopt a
  // collection manifest (whose own version chain is NOT asset history) before
  // the real asset CID resolves; without this guard that slower walk can land
  // after the asset's and leave foreign versions in the strip.
  const seq = ++_refreshSeq;
  chainRootCid = rootCid;
  activeCid = rootCid;

  const tokenId = getActiveAssetTokenId();
  const [chain, pubCid] = await Promise.all([
    _deps.walkChain(rootCid).catch((err) => {
      console.error("History chain fetch failed:", err);
      return [];
    }),
    tokenId
      ? _deps.fetchPublishedCid(tokenId).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (seq !== _refreshSeq) return; // superseded by a newer root or a reset

  entries = chain;
  publishedCid = pubCid;
  _notify();
}

// ─── Bus subscriptions (mirrors the retired asset-history.js) ───

on(EVENTS.SCENE_READY, (e) => {
  const manifestCid = e?.manifestCid || getActiveAssetManifestCid();
  if (!manifestCid) return;

  if (isHistoryNavigation) {
    activeCid = manifestCid;
    _notify();
    return;
  }

  chainRootCid = manifestCid;
  activeCid = manifestCid;
  setLatestManifestCid(manifestCid);
  void _refresh(manifestCid);
});

on(EVENTS.WALLET_CONNECTED, () => {
  // Re-check the published marker now that the token is known. Never re-root
  // at getActiveAssetManifestCid(): a ?asset= deep link can have adopted the
  // COLLECTION manifest CID there, and walking a collection's chain would
  // fill the asset version strip with versions of other files.
  if (chainRootCid && !isHistoryNavigation) {
    void _refresh(chainRootCid);
  }
});

on(EVENTS.ASSET_PUBLISHED, () => {
  // Re-check published CID after mint/update. Publishing saves a new version
  // first, so follow the tip (like a draft save) rather than the old chain root.
  setTimeout(() => {
    const tip = getLatestAssetManifestCid() || chainRootCid;
    if (tip && !isHistoryNavigation) void _refresh(tip);
  }, 500);
});

on(EVENTS.ASSET_DRAFT_SAVED, () => {
  // A save appends a new tip; re-root at the tip (not the active CID, which
  // may still point at an older version while the user scrubs history).
  const tip = getLatestAssetManifestCid() || chainRootCid;
  if (tip && !isHistoryNavigation) void _refresh(tip);
});

on(EVENTS.SCENE_CLEARED, () => {
  // Entering an asset switch clears the scene before the new manifest loads.
  // Drop the old strip now so its ticks (and header version number) cannot
  // leak into the new asset. History navigation also clears the scene, so
  // keep the chain while scrubbing.
  if (!isHistoryNavigation) _reset();
});

on(EVENTS.SCENE_EMPTY, _reset);

// ─── Module-load bootstrap ───
// If the store is imported after SCENE_READY already fired, seed the clock
// from the current asset state exactly like the retired asset-history.js did.
if (getActiveAssetManifestCid() && !isHistoryNavigation) {
  void _refresh(getActiveAssetManifestCid());
}
