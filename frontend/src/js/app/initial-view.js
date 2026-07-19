/**
 * Initial SPA view — set BEFORE first paint.
 *
 * Loaded as a blocking classic script in <head> (same pattern as
 * theme-init.js). Marks <html data-initial-view="studio|library"> from the URL
 * so CSS can hide the non-matching view immediately — a cold /library entry
 * never flashes the Studio while the deferred scripts and modules load.
 *
 * app/router.js deletes the attribute the moment the real router takes over;
 * from then on the .hidden class toggles govern visibility.
 */
document.documentElement.dataset.initialView = location.pathname.startsWith(
  "/library",
)
  ? "library"
  : "studio";
