// @ts-check
/**
 * Domain: Asset — the one open asset. Facade over the legacy assetState
 * store: this module is the ONLY writer of the asset name and the
 * CID/tokenId/currentManifest identity fields, and the single subscription
 * point for chrome rendering.
 */
import { on, emit, EVENTS } from "../events/bus.js";
import { assetState, tagManifestCid } from "../state/asset-state.js";
import { getStateForNewAsset } from "../utils/new-asset.js";

/** @type {Set<(snapshot: Readonly<AssetSnapshot>) => void>} */
const _listeners = new Set();

/**
 * @typedef {Object} AssetSnapshot
 * @property {string|null} name
 * @property {string|null} assetId
 * @property {string|null} tokenId
 * @property {string|null} activeCid
 * @property {string|null} latestCid
 */

/**
 * Frozen point-in-time view of the active asset for renderers.
 * @returns {Readonly<AssetSnapshot>}
 */
export function getAssetSnapshot() {
  const s = assetState.get();
  return Object.freeze({
    name: s.activeAssetName,
    assetId: s.activeAssetId,
    tokenId: s.activeAssetTokenId,
    activeCid: s.activeAssetManifestCid,
    latestCid: s.latestAssetManifestCid,
  });
}

/**
 * Subscribe to asset changes. Fires immediately with the current snapshot,
 * then on every ASSET_STATE_CHANGED.
 * @param {(snapshot: Readonly<AssetSnapshot>) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeAsset(fn) {
  _listeners.add(fn);
  fn(getAssetSnapshot());
  return () => _listeners.delete(fn);
}

on(EVENTS.ASSET_STATE_CHANGED, () => {
  const snapshot = getAssetSnapshot();
  for (const fn of _listeners) fn(snapshot);
});

const DEFAULT_NAMES = new Set([
  "untitled asset",
  "my asset",
  "no asset open",
  "",
]);

/**
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
export function isDefaultAssetName(name) {
  return DEFAULT_NAMES.has((name || "").toLowerCase().trim());
}

/**
 * Rename the active asset. The only writer of activeAssetName.
 * @param {string} name
 */
export function renameAsset(name) {
  assetState.set({ activeAssetName: name });
}

/**
 * Naming rule for a freshly loaded manifest (SCENE_READY): the manifest's
 * name wins; with no manifest name keep the session name; with neither,
 * fall back to "Untitled Asset".
 * @param {any} manifest
 */
export function adoptLoadedManifestName(manifest) {
  const current = assetState.get().activeAssetName;
  const name = manifest?.name || current || "Untitled Asset";
  if (manifest?.name || !current) {
    assetState.set({ activeAssetName: name });
  }
}

/**
 * Naming rule for chat-driven auto-saves: adopt the manifest's name only
 * when it is a real name — a default/absent name must not clobber a good
 * session name. (Moved verbatim from ui/asset-save.js.)
 * @param {any} manifest
 */
export function adoptManifestName(manifest) {
  const name = manifest?.name?.trim();
  if (name && !isDefaultAssetName(name)) {
    assetState.set({ activeAssetName: name });
  }
}

/**
 * Clear the active asset for a fresh draft: name, CIDs, token identity go;
 * the open collection context survives (getStateForNewAsset semantics).
 */
export function resetForNewAsset() {
  assetState.set({
    ...getStateForNewAsset(assetState.get()),
    activeAssetName: null,
  });
}

/**
 * Close the active asset entirely (library close-out).
 */
export function closeAsset() {
  assetState.set({
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetId: null,
    activeAssetName: null,
    currentManifest: null,
  });
}

// ─── Identity / CID commands (Phase 2) ─────────────────────────────
// The ONLY writers of activeAssetManifestCid, latestAssetManifestCid,
// activeAssetTokenId, activeAssetId, currentManifest. Collection-context
// fields (activeCollectionTokenId, selectedCollectionId) ride along here
// as a transitional seam — Phase 3 moves them to the Collection module.

/**
 * Adopt a freshly opened/loaded asset: active + latest CIDs point at `cid`.
 * Identity keys are written only when present (`in` semantics), so callers
 * reproduce their exact legacy patches — pass `tokenId: null` explicitly to
 * clear. `clearSelectedCollection: true` writes `selectedCollectionId: null`.
 * @param {string} cid
 * @param {{tokenId?: string|null, assetId?: string|null, collectionTokenId?: string|null, clearSelectedCollection?: boolean}} [identity]
 */
export function adoptOpenedAsset(cid, identity = {}) {
  /** @type {Record<string, any>} */
  const patch = {
    activeAssetManifestCid: cid,
    latestAssetManifestCid: cid,
  };
  if ("tokenId" in identity) patch.activeAssetTokenId = identity.tokenId;
  if ("assetId" in identity) patch.activeAssetId = identity.assetId;
  if ("collectionTokenId" in identity)
    patch.activeCollectionTokenId = identity.collectionTokenId;
  if (identity.clearSelectedCollection) patch.selectedCollectionId = null;
  assetState.set(patch);
}

/**
 * Root-load tail (scene-loader): the loaded manifest becomes active and is
 * cached as currentManifest. Does NOT touch latestAssetManifestCid — the
 * version-history store's SCENE_READY listener owns the chain tip.
 * @param {string} cid
 * @param {any} manifest
 */
export function activateAssetManifest(cid, manifest) {
  assetState.set({
    activeAssetManifestCid: cid,
    currentManifest: tagManifestCid(manifest, cid),
  });
}

/** @param {string|null} cid */
export function setActiveManifestCid(cid) {
  assetState.set({ activeAssetManifestCid: cid });
}

/** @param {string|null} cid */
export function setLatestManifestCid(cid) {
  assetState.set({ latestAssetManifestCid: cid });
}

/**
 * Scene cleared: both CIDs go. Token identity and currentManifest survive
 * (clearScene semantics — preserved verbatim from engine/cleanup.js).
 */
export function clearAssetManifestCids() {
  assetState.set({
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
  });
}

/**
 * Cache a fetched manifest against its CID without changing active/latest
 * (outliner cache fill, no-changes save path).
 * @param {any} manifest
 * @param {string|null} cid
 */
export function cacheCurrentManifest(manifest, cid) {
  assetState.set({ currentManifest: tagManifestCid(manifest, cid) });
}

/**
 * A new version was written to IPFS: it becomes the active + latest tip and
 * the cached current manifest.
 * @param {string} cid
 * @param {any} manifest
 */
export function recordSavedVersion(cid, manifest) {
  assetState.set({
    latestAssetManifestCid: cid,
    activeAssetManifestCid: cid,
    currentManifest: tagManifestCid(manifest, cid),
  });
}

/**
 * Publish succeeded: the collection token is now the asset's on-chain
 * identity.
 * @param {string|number} tokenId
 * @param {string} assetId
 */
export function adoptPublishedIdentity(tokenId, assetId) {
  assetState.set({
    activeCollectionTokenId: String(tokenId),
    activeAssetTokenId: String(tokenId),
    activeAssetId: assetId,
  });
}

// ─── Save/publish commands (Phase 2) ───────────────────────────────
// IO stays in injected deps so the domain module never imports
// services/asset-save/* (which imports this module for the state commands).

/**
 * Name resolution for saves (verbatim from ui/asset-save.js): the in-session
 * rename wins; a tokenized asset falls back to its on-chain name; drafts fall
 * back to "My Asset".
 * @param {(tokenId: string) => Promise<string|null>} fetchTokenName
 * @returns {Promise<string>}
 */
async function _resolveAssetName(fetchTokenName) {
  const current = assetState.get().activeAssetName;
  if (current) return current;
  const tokenId = assetState.get().activeAssetTokenId;
  if (tokenId) return (await fetchTokenName(tokenId)) || "My Asset";
  return "My Asset";
}

/**
 * Save the current draft. Builds and uploads the manifest via the injected
 * serializer, updates the URL for non-tokenized drafts, and emits
 * ASSET_DRAFT_SAVED. Returns the serializer's result verbatim; failures
 * propagate to the caller (the UI owns toasts/progress).
 * @param {{saveDraft: (assetName: string, options?: any) => Promise<any>,
 *          fetchTokenName: (tokenId: string) => Promise<string|null>,
 *          updateUrlManifest: (cid: string) => void}} deps
 * @returns {Promise<any>}
 */
export async function saveDraftAsset(deps) {
  const assetName = await _resolveAssetName(deps.fetchTokenName);
  const result = await deps.saveDraft(assetName);
  if (!result.ok) return result;

  // Only rewrite the URL for non-tokenized drafts. For tokenized assets, the
  // ?asset=<tokenId> URL already anchors to the blockchain; avoid stashing a
  // draft manifest in query params.
  if (!assetState.get().activeAssetTokenId) {
    deps.updateUrlManifest(result.cid);
  }
  emit(EVENTS.ASSET_DRAFT_SAVED, { cid: result.cid });
  return result;
}
