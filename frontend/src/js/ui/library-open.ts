/**
 * Library → Studio navigation — leaf module.
 *
 * Both library-grid and library-context-menu need openInStudio; keeping it
 * here (router-only dependency) avoids a library-grid ↔ library-context-menu
 * import cycle.
 */

/**
 * Open an asset in the Studio view.
 *
 * SPA in-app transition — no full reload, so the wallet/session stay alive.
 * The router activates the Studio view and calls loadFromParams() to open the
 * asset the query string points at.
 */
export function openInStudio(tokenId: string | number, assetId?: string | number): void {
  const params = new URLSearchParams();
  params.set("asset", String(tokenId));
  if (assetId) params.set("assetId", String(assetId));
  import("../app/router.ts")
    .then(({ navigate }) => navigate(`/studio?${params.toString()}`))
    .catch((err) => console.error("[LIBRARY] open-in-studio failed:", err));
}
