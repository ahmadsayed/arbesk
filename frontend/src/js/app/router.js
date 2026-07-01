// @ts-nocheck
/**
 * Minimal client-side router for the unified Studio + Library SPA.
 *
 * Both views live in one document (app.html). Navigation swaps which view is
 * visible instead of reloading the page, so wallet, theme, session, the event
 * bus, and the Babylon engine stay alive across a Library ⇄ Studio switch.
 *
 * Lifecycle model: init-once + toggle-visibility. Nothing is torn down — the
 * Babylon engine is created lazily on first Studio entry and thereafter only
 * paused/resumed, which deliberately avoids needing a disposeEngine() or
 * unsubscribing the shared event-bus listeners.
 */

import {
  initEngine,
  loadFromParams,
  pauseRenderLoop,
  resumeRenderLoop,
} from "../engine/scene-graph.js";
import { refreshLibraryData } from "../ui/library-controller.js";
import { walletState } from "../state/wallet-state.js";

/** @type {"studio"|"library"|null} */
let _currentView = null;

/**
 * Map a pathname to a view. Studio is the default so "/" and any unknown path
 * (plus the deep-link forms "/studio?asset=…") resolve to the editor.
 * @param {string} pathname
 * @returns {"studio"|"library"}
 */
export function pathToView(pathname) {
  return pathname.startsWith("/library") ? "library" : "studio";
}

function activateStudio() {
  initEngine(); // idempotent — creates the engine on first Studio entry only
  resumeRenderLoop();
  // Load whatever the URL points at (Library → Studio handoff, or a cold
  // deep-link). No-op when there are no ?asset/?manifest params, so a plain
  // tab-switch back to Studio keeps the in-memory scene intact.
  const params = new URLSearchParams(location.search);
  if (params.get("asset") || params.get("manifest")) {
    loadFromParams();
  }
}

function activateLibrary() {
  pauseRenderLoop();
  if (walletState.get().walletAddress) {
    refreshLibraryData();
  }
}

/**
 * Show a view and run its per-view lifecycle hooks.
 * @param {"studio"|"library"} view
 * @param {{ updateHistory?: boolean, href?: string|null }} [opts]
 */
export function setView(view, { updateHistory = false, href = null } = {}) {
  if (view !== "studio" && view !== "library") view = "studio";
  if (view === _currentView) return;
  _currentView = view;

  document.getElementById("studioView")?.classList.toggle("hidden", view !== "studio");
  document.getElementById("libraryView")?.classList.toggle("hidden", view !== "library");
  document.body.dataset.view = view;

  document.querySelectorAll(".page-switcher-tab").forEach((tab) => {
    const tabView = pathToView(new URL(tab.href, location.origin).pathname);
    tab.classList.toggle("active", tabView === view);
  });

  if (updateHistory && href) {
    history.pushState({ view }, "", href);
  }

  if (view === "studio") activateStudio();
  else activateLibrary();
}

/**
 * Programmatic navigation (e.g. the Library → Studio "open asset" handoff).
 * @param {string} path e.g. "/studio?asset=123&assetId=root"
 */
export function navigate(path) {
  const url = new URL(path, location.origin);
  setView(pathToView(url.pathname), {
    updateHistory: true,
    href: url.pathname + url.search,
  });
}

/**
 * Wire link interception + back/forward and activate the initial view. Called
 * once from app-init.js. Module scripts are deferred, so the DOM is fully
 * parsed by the time this runs.
 */
export function initRouter() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest?.("a[data-nav]");
    if (!link) return;
    // Respect modified clicks (open-in-new-tab, etc.) and already-handled events.
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const href = link.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    const view = pathToView(new URL(href, location.origin).pathname);
    setView(view, { updateHistory: true, href });
  });

  window.addEventListener("popstate", () => {
    setView(pathToView(location.pathname));
  });

  setView(pathToView(location.pathname));
}
