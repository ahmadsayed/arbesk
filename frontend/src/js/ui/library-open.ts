/**
 * Library → Studio navigation.
 * @remarks A leaf module: both library-grid and library-context-menu need
 *   openInStudio, and keeping it here avoids an import cycle between them.
 */

/**
 * Opens an asset in the Studio view.
 * @remarks In-app transition (no full reload) so the wallet and session stay
 *   alive.
 */
export function openInStudio(tokenId: string | number, assetId?: string | number): void {
  const params = new URLSearchParams();
  params.set("asset", String(tokenId));
  if (assetId) params.set("assetId", String(assetId));
  import("../app/router.ts")
    .then(({ navigate }) => navigate(`/studio?${params.toString()}`))
    .catch((err) => console.error("[LIBRARY] open-in-studio failed:", err));
}
