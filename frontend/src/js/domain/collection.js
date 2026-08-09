// @ts-check
/**
 * Domain: Collection — collection-context state commands.
 *
 * Owns reads/writes of activeCollectionTokenId and selectedCollectionId.
 * The canonical publish seam is added in Task 2.
 */
import { assetState } from "../state/asset-state.js";

/** @returns {string|null} */
export function getActiveCollectionTokenId() {
  return assetState.get().activeCollectionTokenId || null;
}

/** @returns {string|null} */
export function getSelectedCollectionId() {
  return assetState.get().selectedCollectionId || null;
}

/**
 * Adopt a collection as the active collection context.
 * @param {string|number} tokenId
 * @param {{clearSelectedCollection?: boolean}} [options]
 */
export function adoptOpenedCollection(
  tokenId,
  { clearSelectedCollection = false } = {}
) {
  /** @type {Record<string, any>} */
  const patch = { activeCollectionTokenId: String(tokenId) };
  if (clearSelectedCollection) patch.selectedCollectionId = null;
  assetState.set(patch);
}

/**
 * Select a target collection for the next publish (collection dropdown).
 * @param {string|number|null} tokenId
 */
export function selectCollection(tokenId) {
  assetState.set({
    selectedCollectionId: tokenId ? String(tokenId) : null,
  });
}

/** Clear the selected-collection hint. */
export function clearSelectedCollection() {
  assetState.set({ selectedCollectionId: null });
}

/** Clear the active collection context entirely (library close-out / error). */
export function clearActiveCollection() {
  assetState.set({
    activeCollectionTokenId: null,
    selectedCollectionId: null,
  });
}

/**
 * Publish succeeded: the token is now the active collection.
 * @param {string|number} tokenId
 */
export function adoptPublishedCollection(tokenId) {
  assetState.set({ activeCollectionTokenId: String(tokenId) });
}
