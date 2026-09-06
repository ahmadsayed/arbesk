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
} from "../engine/scene-graph.ts";
import { ensureBabylon } from "../engine/babylon-loader.ts";
import {
  refreshLibraryData,
  resolveSubjectChain,
  setLibrarySubject,
} from "../ui/library-controller.ts";
import { refreshAssetLibrary } from "../ui/asset-library.ts";
import { walletState } from "../state/wallet-state.ts";
import { libraryState } from "../state/library-state.ts";
import { parseAppPath } from "./route-parse.ts";
import { addressToBase58 } from "../utils/base58.ts";

type View = "studio" | "library";

let _currentView: View | null = null;

/**
 * Map a pathname to a view. Studio is the default so "/" and any unknown path
 * (plus the deep-link forms "/studio?asset=…") resolve to the editor.
 */
export function pathToView(pathname: string): View {
  return parseAppPath(pathname).view;
}

/**
 * The profile subject for URL scoping, in priority order: the profile being
 * viewed (opening an asset from someone's public library keeps THEIR id in
 * the URL), then the connected wallet, then nobody (anonymous — bare paths).
 */
function currentUrlSubject(): string {
  return (
    libraryState.get().subjectAddress ||
    walletState.get().walletAddress ||
    ""
  );
}

/**
 * Scope a bare view path (/studio, /library) to a profile subject, preserving
 * the query string: `/studio?asset=…` → `/studio/<base58>?asset=…`. Returns
 * the input unchanged when the path already carries a subject segment, is not
 * a bare view path, or no subject is available/encodable.
 * @param path - path or URL to scope (query string preserved, hash dropped,
 *   matching navigate()'s existing behavior)
 * @param subjectAddress - explicit subject (login redirect); defaults to the
 *   current profile/wallet subject
 */
export function withSubject(path: string, subjectAddress?: string): string {
  const url = new URL(path, location.origin);
  const segments = url.pathname.split("/").filter(Boolean);
  const root = segments[0];
  if (segments.length !== 1 || (root !== "studio" && root !== "library")) {
    return path;
  }
  const subject = subjectAddress ?? currentUrlSubject();
  if (!subject) return path;
  let id: string;
  try {
    id = addressToBase58(subject);
  } catch {
    return path;
  }
  return `/${root}/${id}${url.search}`;
}

/**
 * Rewrite a bare view URL (/library, /studio) to the connected wallet's
 * public profile URL (/library/<base58>, /studio/<base58>), preserving the
 * query string. No-op when the path already carries a subject (the user's own
 * profile, a deliberate visitor view of someone else's profile, or an invalid
 * segment) or is not a bare view path. Uses replaceState so the Back button
 * never hits a redirect loop. Runs on WALLET_CONNECTED, which also fires for
 * auto-restored sessions.
 */
export function scopeUrlToSubject(address: string): void {
  if (!address) return;
  const current = `${location.pathname}${location.search}`;
  const scoped = withSubject(current, address);
  if (scoped === current) return;
  history.replaceState({ view: pathToView(location.pathname) }, "", scoped);
}

async function activateStudio(): Promise<void> {
  // Public profile subject in the URL (/studio/<base58>): adopt it as the
  // library subject and resolve its chain BEFORE any tokenURI reads, so cold
  // cross-chain Studio links work and the sidebar Gallery panel can load the
  // subject's assets (read-only) even without a wallet.
  const { subjectAddress } = parseAppPath(location.pathname);
  if (subjectAddress) {
    setLibrarySubject(subjectAddress);
    if (!libraryState.get().subjectChainId) {
      const resolved = await resolveSubjectChain(subjectAddress);
      libraryState.set({ subjectChainId: resolved });
    }
    void refreshAssetLibrary();
  }
  // Babylon is fetched lazily (see babylon-loader.js) so Library boots and
  // the sign-in modal never wait for a 3D engine they don't use. First
  // Studio entry pays the CDN cost once; later entries are instant.
  try {
    await ensureBabylon();
  } catch (err) {
    console.error("[ENGINE] Failed to load Babylon.js:", err);
    return;
  }
  initEngine(); // idempotent — creates the engine on first Studio entry only
  resumeRenderLoop();
  // Load whatever the URL points at (Library → Studio handoff, or a cold
  // deep-link). No-op when there are no ?asset/?manifest params, so a plain
  // tab-switch back to Studio keeps the in-memory scene intact.
  const params = new URLSearchParams(location.search);
  if (params.get("asset") || params.get("manifest")) {
    await loadFromParams();
  }
}

function activateLibrary(viewChanged: boolean): void {
  pauseRenderLoop();
  // The subject always derives from the CURRENT location.pathname (history
  // has already been updated by the time this runs), so popstate and
  // in-library navigations to another profile stay in sync.
  const { subjectAddress } = parseAppPath(location.pathname);
  const subjectChanged = setLibrarySubject(subjectAddress);
  if (!viewChanged && !subjectChanged) return;
  if (walletState.get().walletAddress || subjectAddress) {
    refreshLibraryData();
  }
}

/**
 * Show a view and run its per-view lifecycle hooks.
 */
export function setView(
  view: View,
  { updateHistory = false, href = null }: { updateHistory?: boolean; href?: string | null } = {}
): void {
  if (view !== "studio" && view !== "library") view = "studio";
  const viewChanged = view !== _currentView;
  _currentView = view;

  document.getElementById("studioView")?.classList.toggle("hidden", view !== "studio");
  document.getElementById("libraryView")?.classList.toggle("hidden", view !== "library");
  document.body.dataset.view = view;
  document.title = view === "library" ? "Library — Arbesk" : "Studio — Arbesk";

  document.querySelectorAll(".page-switcher-tab").forEach((tab) => {
    const tabView = pathToView(
      new URL((tab as HTMLAnchorElement).href, location.origin).pathname
    );
    tab.classList.toggle("active", tabView === view);
  });

  if (updateHistory && href) {
    history.pushState({ view }, "", href);
  }

  // Studio keeps its lifecycle cheap on repeat activations; Library must
  // re-run even for the same view because the profile subject may have
  // changed (/library → /library/<base58>) without a view switch.
  if (view === "studio") {
    if (viewChanged) activateStudio();
  } else {
    activateLibrary(viewChanged);
  }
}

/**
 * Programmatic navigation (e.g. the Library → Studio "open asset" handoff).
 * Bare view paths gain the current profile subject's base58 id.
 * @param path e.g. "/studio?asset=123&assetId=root"
 */
export function navigate(path: string): void {
  const url = new URL(withSubject(path), location.origin);
  setView(pathToView(url.pathname), {
    updateHistory: true,
    href: url.pathname + url.search,
  });
}

/**
 * Wire link interception + back/forward and activate the initial view. Called
 * once from app-init.ts. Module scripts are deferred, so the DOM is fully
 * parsed by the time this runs.
 */
export function initRouter(): void {
  document.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement | null)?.closest?.(
      "a[data-nav]"
    );
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
    // Header Library/Studio tabs carry the profile subject too.
    const scopedHref = withSubject(href);
    const view = pathToView(new URL(scopedHref, location.origin).pathname);
    setView(view, { updateHistory: true, href: scopedHref });
  });

  window.addEventListener("popstate", () => {
    setView(pathToView(location.pathname));
  });

  setView(pathToView(location.pathname));
  // The pre-paint marker from initial-view.ts has done its job — from here
  // the router's .hidden toggles govern which view is visible.
  delete document.documentElement.dataset.initialView;
}
