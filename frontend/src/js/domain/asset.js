// @ts-check
/**
 * Domain: Asset — the one open asset. Facade over the legacy assetState
 * store: this module is the ONLY writer of the asset name and the single
 * subscription point for chrome rendering. CID/tokenId fields still flow
 * through assetState directly (privatized in Phase 2 with the save/publish
 * commands).
 */
import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
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
