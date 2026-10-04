/**
 * Initial SPA view — set BEFORE first paint.
 *
 * Loaded as a blocking classic script in <head> (same pattern as
 * theme-init.js). Marks <html data-initial-view="studio|library"> from the URL
 * so CSS can hide the non-matching view immediately. The Library is the
 * default (matches parseAppPath), so only "/studio…" starts in the Studio — a
 * cold entry never flashes the wrong view while the modules load.
 *
 * app/router.ts deletes the attribute the moment the real router takes over;
 * from then on the .hidden class toggles govern visibility.
 */
document.documentElement.dataset.initialView = location.pathname.startsWith(
  "/studio",
)
  ? "studio"
  : "library";
