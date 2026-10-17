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
 *
 * Also marks <html data-wallet-restoring> when a previous sign-in is stored
 * (the "arbesk-last-wallet" key wallet-core.ts writes), so CSS can hold back
 * the signed-out UI (header Sign in, library gate) while the silent restore
 * runs instead of flashing it. app-init.ts removes the attribute once
 * initWallet() settles.
 */
document.documentElement.dataset.initialView = location.pathname.startsWith(
  "/studio",
)
  ? "studio"
  : "library";

try {
  if (localStorage.getItem("arbesk-last-wallet")) {
    document.documentElement.dataset.walletRestoring = "";
  }
} catch {
  // Storage blocked (private mode / sandbox): show the signed-out UI as usual.
}
