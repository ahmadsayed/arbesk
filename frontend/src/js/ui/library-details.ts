/**
 * Library Details Pane
 *
 * Windows-Explorer-style details sidebar docked on the right of the
 * full-page Library view (mockup: docs/mockups/library-details-sidebar.html).
 * Shows metadata for the single selected library item plus — for assets — a
 * live, orbitable 3D preview reusing the chat-bubble preview pipeline.
 *
 * Read-only display module: it never writes domain/library state, only reads
 * `libraryState` and reacts to EVENTS.LIBRARY_STATE_CHANGED.
 *
 * Lifecycle notes:
 * - At most one preview handle is owned here (PREVIEW_ID); it is disposed
 *   before any new preview, on deselect, and when the Library view hides
 *   (WebGL contexts are scarce). The chat-preview module also disposes all
 *   previews on pagehide.
 * - Async work (manifest fetch, ownerOf, Babylon load) is race-guarded by a
 *   request counter: a continuation whose seq is no longer current discards
 *   its result (and disposes any preview it just created).
 */

import { libraryState } from "../state/library-state.ts";
import type { LibraryItem } from "../state/library-state.ts";
import { walletState } from "../state/wallet-state.ts";
import { on, EVENTS } from "../asset-core/events/bus.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { loadThumbnailInto } from "../utils/thumbnail.ts";
import { getActiveContract } from "../blockchain/wallet.ts";
import { ensureBabylon } from "../engine/babylon-loader.ts";
import { createChatPreview } from "../services/chat-preview.ts";
import type { PreviewHandle } from "../services/chat-preview.ts";

/** Preview id used with the chat-preview registry (one live preview max). */
const PREVIEW_ID = "library-details";
/** localStorage key for the pane visibility toggle; default visible. */
const VISIBILITY_STORAGE_KEY = "libraryDetailsVisible";

/** ownerOf results per token id (chain read — cache aggressively). */
const _ownerCache = new Map<string, string>();

/** Monotonic request counter; async continuations bail when it moved on. */
let _requestSeq = 0;

let _previewHandle: PreviewHandle | null = null;
let _orbitHintEl: HTMLElement | null = null;
/** Last resolved full owner address, for the copy button. */
let _ownerAddress: string | null = null;

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function disposePreview(): void {
  const handle = _previewHandle;
  _previewHandle = null;
  if (handle) void handle.dispose();
}

export function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Display string for a token owner: the CDP email when the owner is the
 * connected smart account, otherwise the truncated address. There is no
 * address→email lookup (the resolve-email endpoint is email→address only,
 * need-to-know by design), so other users always render as addresses.
 */
export function ownerDisplay(address: string): string {
  const w = walletState.get();
  if (
    w.walletSource === "cdp" &&
    w.email &&
    w.walletAddress &&
    w.walletAddress.toLowerCase() === address.toLowerCase()
  ) {
    return w.email;
  }
  return truncateAddress(address);
}

function formatModified(timestamp: unknown): string {
  const ms = Number(timestamp);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
}

/** ownerOf with a per-token cache; null on RPC failure ("Unknown"). */
async function resolveOwner(tokenId: string): Promise<string | null> {
  const key = String(tokenId);
  const cached = _ownerCache.get(key);
  if (cached !== undefined) return cached;
  const c = getActiveContract();
  if (!c) return null;
  try {
    const owner = await c.methods.ownerOf(key).call();
    const address = typeof owner === "string" ? owner : String(owner);
    _ownerCache.set(key, address);
    return address;
  } catch (err) {
    console.warn("[LIBRARY-DETAILS] ownerOf failed for token", key, err);
    return null;
  }
}

function findItem(id: string | number): LibraryItem | null {
  const state = libraryState.get();
  return (
    (state.collections as LibraryItem[])
      .concat(state.assets)
      .find((i) => String(i.id) === String(id)) || null
  );
}

function showMessage(state: "empty" | "multi", text: string): void {
  _requestSeq++;
  disposePreview();
  const pane = el("libraryDetails");
  if (pane) pane.dataset.state = state;
  const emptyEl = el("libraryDetailsEmpty");
  if (emptyEl) emptyEl.textContent = text;
}

/** Static thumbnail in the preview area; hides the area when there is none. */
function showStaticThumbnail(item: LibraryItem): void {
  const previewEl = el("libraryDetailsPreview");
  if (!previewEl) return;
  if (_orbitHintEl) _orbitHintEl.hidden = true;
  if (!item.thumbnailCid) {
    previewEl.textContent = "";
    previewEl.hidden = true;
    return;
  }
  previewEl.hidden = false;
  void loadThumbnailInto(previewEl, item.thumbnailCid, item.name || "Item");
}

/**
 * Live 3D preview for an asset's root model source. Falls back to the static
 * thumbnail on any failure (no source, Babylon unavailable, load error) and
 * when the global live-preview cap evicts this preview.
 */
async function startAssetPreview(
  item: LibraryItem,
  manifest: any,
  req: number
): Promise<void> {
  const previewEl = el("libraryDetailsPreview");
  if (!previewEl) return;

  const source = manifest?.scene?.nodes?.[0]?.source;
  if (!source?.cid) {
    showStaticThumbnail(item);
    return;
  }

  try {
    // Babylon is lazy-loaded; in the Library view it is not loaded yet.
    await ensureBabylon();
  } catch (err) {
    console.warn("[LIBRARY-DETAILS] Babylon load failed:", err);
    if (req === _requestSeq) showStaticThumbnail(item);
    return;
  }
  if (req !== _requestSeq) return;

  previewEl.textContent = "";
  previewEl.hidden = false;
  const canvas = document.createElement("canvas");
  previewEl.appendChild(canvas);

  const handle = await createChatPreview(PREVIEW_ID, canvas, {
    cid: source.cid,
    path: source.path,
    format: source.format,
  }, {
    onAutoCollapse: (evictedId: string) => {
      if (evictedId !== PREVIEW_ID || req !== _requestSeq) return;
      // The global MAX_LIVE_PREVIEWS cap evicted us — collapse to static.
      _previewHandle = null;
      showStaticThumbnail(item);
    },
  });

  if (req !== _requestSeq) {
    // Selection changed while the preview spun up; don't leak the context.
    if (handle) void handle.dispose();
    return;
  }
  if (!handle) {
    showStaticThumbnail(item);
    return;
  }
  _previewHandle = handle;
  if (_orbitHintEl) {
    previewEl.appendChild(_orbitHintEl);
    _orbitHintEl.hidden = false;
  }
}

function renderItem(item: LibraryItem): void {
  const req = ++_requestSeq;
  disposePreview();
  _ownerAddress = null;

  const pane = el("libraryDetails");
  if (pane) pane.dataset.state = item.type === "collection" ? "collection" : "asset";

  const titleEl = el("libraryDetailsTitle");
  if (titleEl) titleEl.textContent = item.name || "Untitled";
  const badgeEl = el("libraryDetailsBadge");
  if (badgeEl) {
    badgeEl.textContent = item.type === "collection" ? "Collection" : "Asset";
  }
  const roleEl = el("libraryDetailsRole");
  if (roleEl) roleEl.textContent = capitalize(item.role || "");

  // Owner — cached chain read; CDP users see their own email when the
  // owner is the connected smart account, otherwise a truncated address.
  const ownerEl = el("libraryDetailsOwner");
  const copyBtn = el<HTMLButtonElement>("libraryDetailsCopyOwner");
  if (ownerEl) {
    ownerEl.textContent = "…";
    ownerEl.removeAttribute("title");
  }
  if (copyBtn) copyBtn.hidden = true;
  void resolveOwner(String(item.tokenId)).then((address) => {
    if (req !== _requestSeq) return;
    _ownerAddress = address;
    const display = address ? ownerDisplay(address) : "Unknown";
    if (ownerEl) {
      ownerEl.textContent = display;
      if (address && display !== address) ownerEl.title = address;
    }
    if (copyBtn) copyBtn.hidden = !address;
  });

  // Manifest — Modified + Children rows, then the preview.
  const modifiedEl = el("libraryDetailsModified");
  if (modifiedEl) modifiedEl.textContent = "…";
  void (async () => {
    let manifest: any = null;
    try {
      manifest = await getFromRemoteIPFS(item.manifestCid);
    } catch (err) {
      console.warn("[LIBRARY-DETAILS] manifest fetch failed:", err);
    }
    if (req !== _requestSeq) return;

    if (modifiedEl) modifiedEl.textContent = formatModified(manifest?.timestamp);

    const childrenRow = el("libraryDetailsChildrenRow");
    if (item.type === "collection") {
      // Collections have no scene nodes — omit the row.
      if (childrenRow) childrenRow.hidden = true;
      showStaticThumbnail(item);
      return;
    }

    if (childrenRow) childrenRow.hidden = false;
    const childrenEl = el("libraryDetailsChildren");
    const nodes = manifest?.scene?.nodes;
    if (childrenEl) {
      childrenEl.textContent = Array.isArray(nodes) ? `${nodes.length} nodes` : "—";
    }
    void startAssetPreview(item, manifest, req);
  })();
}

function render(): void {
  const pane = el("libraryDetails");
  if (!pane) return;
  // Hidden pane: no fetches, no live preview — just make sure nothing leaks.
  if (pane.classList.contains("hidden")) {
    _requestSeq++;
    disposePreview();
    return;
  }

  const { selectedIds } = libraryState.get();
  if (selectedIds.length === 0) {
    showMessage("empty", "Select an item to see details");
    return;
  }
  if (selectedIds.length > 1) {
    showMessage("multi", `${selectedIds.length} items selected`);
    return;
  }
  const item = findItem(selectedIds[0]);
  if (!item) {
    showMessage("empty", "Select an item to see details");
    return;
  }
  renderItem(item);
}

function applyVisibility(visible: boolean): void {
  const pane = el("libraryDetails");
  const toggleBtn = el("libraryDetailsToggleBtn");
  pane?.classList.toggle("hidden", !visible);
  toggleBtn?.classList.toggle("active", visible);
  toggleBtn?.setAttribute("aria-pressed", String(visible));
}

/** Dispose the preview when the router hides the Library view. */
function initViewLeaveGuard(): void {
  const view = document.getElementById("libraryView");
  if (!view || typeof MutationObserver === "undefined") return;
  new MutationObserver(() => {
    if (view.classList.contains("hidden")) {
      _requestSeq++;
      disposePreview();
    }
  }).observe(view, { attributes: true, attributeFilter: ["class"] });
}

export function initLibraryDetails(): void {
  _orbitHintEl = el("libraryDetailsOrbitHint");

  applyVisibility(localStorage.getItem(VISIBILITY_STORAGE_KEY) !== "false");

  el("libraryDetailsToggleBtn")?.addEventListener("click", () => {
    const pane = el("libraryDetails");
    const show = pane ? pane.classList.contains("hidden") : true;
    localStorage.setItem(VISIBILITY_STORAGE_KEY, String(show));
    applyVisibility(show);
    if (show) render();
    else {
      _requestSeq++;
      disposePreview();
    }
  });

  el("libraryDetailsCopyOwner")?.addEventListener("click", () => {
    if (!_ownerAddress) return;
    try {
      void navigator.clipboard?.writeText(_ownerAddress);
    } catch (err) {
      console.warn("[LIBRARY-DETAILS] clipboard copy failed:", err);
    }
  });

  initViewLeaveGuard();
  on(EVENTS.LIBRARY_STATE_CHANGED, render);
  render();
}
