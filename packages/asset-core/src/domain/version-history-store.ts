/**
 * Version History Store (headless)
 *
 * Owns the asset's manifest-chain state: entries (oldest→newest), the active
 * and published CIDs, loading state, and the isHistoryNavigation guard.
 * Logic extracted from the retired ui/asset-history.js; the scene clock and
 * model clock views subscribe here and render it as clock dials.
 *
 * Heavy dependencies (engine, wallet) are injected through the `_deps` seam
 * (`configureVersionHistoryDeps`) so the package stays environment-agnostic
 * and unit tests can stub them without loading the 3D engine. The browser wiring
 * lives in `frontend/src/js/engine/version-history-deps.ts`.
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
 * Install the environment-specific dependency implementations (browser:
 * engine/time-travel + engine/scene-graph + blockchain/wallet). Called once
 * from the host app's boot wiring; tests may still assign `_deps` fields
 * directly.
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

const _subscribers: Set<(snapshot: VersionHistoryState) => void> = new Set();

function _notify() {
  const snapshot = getState();
  for (const fn of _subscribers) fn(snapshot);
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
 * @param cid manifest CID to load
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

async function _refresh() {
  const manifestCid = getActiveAssetManifestCid();
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

  const tokenId = getActiveAssetTokenId();
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
  _refresh();
});

on(EVENTS.WALLET_CONNECTED, () => {
  if (getActiveAssetManifestCid() && !isHistoryNavigation) {
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
if (getActiveAssetManifestCid() && !isHistoryNavigation) {
  _refresh();
}
