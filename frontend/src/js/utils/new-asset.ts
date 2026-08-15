/**
 * Pure helpers for the Studio "New Asset" action.
 */

/**
 * Compute the asset-state patch used when starting a new asset.
 * Preserves the opened/selected collection so new assets publish into the
 * collection the user is currently working in instead of falling back to the
 * wallet's default collection.
 */
export function getStateForNewAsset(currentState: Record<string, any> | null | undefined): Record<string, any> {
  return {
    activeAssetManifestCid: null,
    latestAssetManifestCid: null,
    activeAssetTokenId: null,
    activeAssetId: null,
    activeCollectionTokenId: currentState?.activeCollectionTokenId ?? null,
    selectedCollectionId: currentState?.selectedCollectionId ?? null,
  };
}
