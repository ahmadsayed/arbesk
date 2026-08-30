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
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { loadThumbnailInto, extractThumbnailCid } from "../utils/thumbnail.ts";
import { loadEditorList } from "@arbesk/asset-core/domain/editors.js";
import { getActiveContract } from "../blockchain/wallet.ts";
import { ensureBabylon } from "../engine/babylon-loader.ts";
import { createChatPreview } from "../services/chat-preview.ts";
import type { PreviewHandle } from "../services/chat-preview.ts";
import { openItem } from "./library-grid.ts";
import { CHAIN_IDS } from "../../../../constants/chains.js";

// Loaded lazily so the edit-metadata flow (and its dialog/write deps) never
// enters the module graph until the user clicks "Edit metadata…". The flow
// lives in library-context-menu.ts so the details pane and the context menu
// share one collection-write path.
const contextMenuOps = () => import("./library-context-menu.ts");

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
/** Item currently shown in the pane — target of the Open button. */
let _currentItemId: string | number | null = null;
/** Full manifest CID of the current item, for the copy button. */
let _currentCid: string | null = null;

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function disposePreview(): void {
  const handle = _previewHandle;
  _previewHandle = null;
  if (handle) void handle.dispose();
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Display string for a token owner: the CDP email when the owner is the
 * connected smart account, otherwise the truncated address. There is no
 * address→email lookup (the resolve-email endpoint is email→address only,
 * need-to-know by design), so other users always render as addresses.
 */
function ownerDisplay(address: string): string {
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
    const owner = await c.read.ownerOf([BigInt(key)]);
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

/** Resolve the empty-state "at Home vs in a collection" context. */
function resolveEmptyStateContext(state: any) {
  const atHome =
    state.currentCollectionTokenId === null ||
    state.currentCollectionTokenId === undefined ||
    state.currentCollectionTokenId === "";
  const openCollection = atHome
    ? null
    : state.collections.find(
        (c: any) => String(c.tokenId) === String(state.currentCollectionTokenId)
      );
  return { atHome, openCollection };
}

function emptyStateTitle(multi: boolean, atHome: boolean, openCollection: any): string {
  return multi ? "Selection" : atHome ? "Home" : openCollection?.name || "Collection";
}

function emptyStateHint(atHome: boolean): string {
  return atHome
    ? "Open a collection to upload .glb, .gltf or .3mf files"
    : "Drop .glb, .gltf or .3mf files anywhere to upload";
}

function emptyStatePrompt(multi: boolean): string {
  return multi ? "Select a single item to see details" : "Select an item to see details";
}

/**
 * Empty / multi-select state, styled like the item details view (title,
 * badge, k/v rows). The overview row shows the location's item count from
 * libraryState — no fetches — followed by a context-aware upload hint and
 * the prompt line.
 */
function renderEmptyState(selectedCount = 0): void {
  _requestSeq++;
  disposePreview();
  _currentItemId = null;
  _currentCid = null;
  const multi = selectedCount > 1;
  const pane = el("libraryDetails");
  if (pane) pane.dataset.state = multi ? "multi" : "empty";

  const state = libraryState.get();
  const { collections, assets } = state;
  const { atHome, openCollection } = resolveEmptyStateContext(state);

  const titleEl = el("libraryDetailsEmptyTitle");
  if (titleEl) {
    titleEl.textContent = emptyStateTitle(multi, atHome, openCollection);
  }
  const badgeEl = el("libraryDetailsEmptyBadge");
  if (badgeEl) badgeEl.textContent = multi ? "Items" : "Overview";

  const labelEl = el("libraryDetailsEmptyLabel");
  const countEl = el("libraryDetailsEmptyCount");
  if (multi) {
    if (labelEl) labelEl.textContent = "Selected";
    if (countEl) countEl.textContent = String(selectedCount);
  } else {
    if (labelEl) labelEl.textContent = atHome ? "Collections" : "Assets";
    if (countEl) {
      countEl.textContent = String(atHome ? collections.length : assets.length);
    }
  }
  // Mirrors the drop-overlay label in ui/library-toolbar.ts — at Home there
  // is no target collection, so dropping files is rejected.
  const hintEl = el("libraryDetailsEmptyHint");
  if (hintEl) {
    hintEl.textContent = emptyStateHint(atHome);
  }
  const promptEl = el("libraryDetailsEmptyPrompt");
  if (promptEl) {
    promptEl.textContent = emptyStatePrompt(multi);
  }
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

/** Mid-truncate a CID for the "Current" row: 10 head + 8 tail chars. */
function midTruncate(text: string, head = 10, tail = 8): string {
  return text.length <= head + tail + 1
    ? text
    : `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/** Chain display name for the Anchor row. */
function chainName(): string {
  const id = Number(walletState.get().chainId);
  return id === CHAIN_IDS.BASE_TESTNET ? "Base Sepolia" : "Hardhat local";
}

/** Cap for the prev_manifest_cid walk that counts versions. */
const VERSION_WALK_CAP = 30;

/**
 * Version count = manifest-chain length. Walks prev_manifest_cid links,
 * capped so long histories don't stall the pane; `more` flags a capped walk.
 */
async function countVersions(
  manifest: any
): Promise<{ count: number; more: boolean }> {
  let count = 1;
  let prev = manifest?.prev_manifest_cid;
  while (prev && count < VERSION_WALK_CAP) {
    let m: any = null;
    try {
      m = await getFromRemoteIPFS(prev);
    } catch {
      break;
    }
    if (!m) break;
    count++;
    prev = m.prev_manifest_cid;
  }
  return { count, more: count === VERSION_WALK_CAP && !!prev };
}

/**
 * Collection preview: a mosaic of its first assets' thumbnails with a "+N"
 * overflow tile. Falls back to the collection's own static thumbnail when no
 * asset thumbnails resolve; an empty collection gets an upload hint.
 */
async function startCollectionMosaic(
  item: LibraryItem,
  manifest: any,
  req: number
): Promise<void> {
  const previewEl = el("libraryDetailsPreview");
  if (!previewEl) return;
  if (_orbitHintEl) _orbitHintEl.hidden = true;

  const assetCids = Object.values(manifest?.assets || {}).filter(
    (c): c is string => typeof c === "string" && !!c
  );
  if (assetCids.length === 0) {
    previewEl.textContent = "";
    const hint = document.createElement("div");
    hint.className = "library-details-mosaic-empty";
    const line1 = document.createElement("span");
    line1.textContent = "Empty collection";
    const line2 = document.createElement("strong");
    line2.textContent = "Upload .glb, .gltf or .3mf";
    hint.append(line1, line2);
    previewEl.appendChild(hint);
    previewEl.hidden = false;
    return;
  }

  const picks = assetCids.slice(0, 4);
  const thumbs = await Promise.all(
    picks.map(async (cid) => {
      try {
        return extractThumbnailCid((await getFromRemoteIPFS(cid))?.thumbnail);
      } catch {
        return null;
      }
    })
  );
  if (req !== _requestSeq) return;
  if (!thumbs.some(Boolean)) {
    showStaticThumbnail(item);
    return;
  }

  previewEl.textContent = "";
  const mosaic = document.createElement("div");
  mosaic.className = "library-details-mosaic";
  picks.forEach((_, i) => {
    const tile = document.createElement("div");
    mosaic.appendChild(tile);
    const thumbCid = thumbs[i];
    if (thumbCid) {
      void loadThumbnailInto(tile, thumbCid, item.name || "Collection");
    }
  });
  const extra = assetCids.length - picks.length;
  if (extra > 0) {
    const more = document.createElement("div");
    more.className = "library-details-mosaic-more";
    more.textContent = `+${extra}`;
    mosaic.appendChild(more);
  }
  previewEl.appendChild(mosaic);
  previewEl.hidden = false;
}

/**
 * Render the Metadata row from a manifest's `metadata.annotations` map,
 * flattened into a single "key: value · key: value" string (an em dash when
 * empty). Collections are editable via the "Edit metadata…" button (Step 3);
 * assets show annotations read-only (they are edited in Studio).
 */
function renderMetadata(manifest: any, isCollection: boolean): void {
  const target = el("libraryDetailsMetadata");
  const annotations = (manifest?.metadata?.annotations ?? {}) as Record<
    string,
    unknown
  >;
  const keys = Object.keys(annotations);
  if (target) {
    target.textContent =
      keys.length === 0
        ? "—"
        : keys.map((k) => k + ": " + JSON.stringify(annotations[k])).join(" · ");
  }
  const editBtn = el("libraryDetailsEditMetadataBtn");
  if (editBtn) editBtn.hidden = !isCollection;
}

function renderCollectionDetails(
  item: LibraryItem,
  manifest: any,
  req: number,
  childrenLabel: HTMLElement | null,
  childrenEl: HTMLElement | null,
  formatRow: HTMLElement | null
): void {
  // Collections have no scene nodes — show the asset count instead.
  if (childrenLabel) childrenLabel.textContent = "Assets";
  const assetCount = manifest?.assets ? Object.keys(manifest.assets).length : 0;
  if (childrenEl) {
    childrenEl.textContent =
      assetCount === 1 ? "1 asset" : `${assetCount} assets`;
  }
  if (formatRow) formatRow.hidden = true;
  renderMetadata(manifest, true);
  void startCollectionMosaic(item, manifest, req);
}

function renderAssetDetails(
  item: LibraryItem,
  manifest: any,
  req: number,
  childrenLabel: HTMLElement | null,
  childrenEl: HTMLElement | null,
  formatRow: HTMLElement | null
): void {
  if (childrenLabel) childrenLabel.textContent = "Children";
  const nodes = manifest?.scene?.nodes;
  if (childrenEl) {
    childrenEl.textContent = Array.isArray(nodes) ? `${nodes.length} nodes` : "—";
  }
  if (formatRow) formatRow.hidden = false;
  const formatEl = el("libraryDetailsFormat");
  const format = manifest?.scene?.nodes?.[0]?.source?.format;
  if (formatEl) formatEl.textContent = format ? String(format).toUpperCase() : "—";
  renderMetadata(manifest, false);
  void startAssetPreview(item, manifest, req);
}

async function renderManifestDetails(
  item: LibraryItem,
  req: number,
  modifiedEl: HTMLElement | null,
  versionEl: HTMLElement | null
): Promise<void> {
  let manifest: any = null;
  try {
    manifest = await getFromRemoteIPFS(item.manifestCid);
  } catch (err) {
    console.warn("[LIBRARY-DETAILS] manifest fetch failed:", err);
  }
  if (req !== _requestSeq) return;

  if (modifiedEl) modifiedEl.textContent = formatModified(manifest?.timestamp);

  if (versionEl && !manifest) versionEl.textContent = "—";
  if (manifest) {
    const { count, more } = await countVersions(manifest);
    if (req !== _requestSeq) return;
    if (versionEl) versionEl.textContent = more ? `v${count}+` : `v${count}`;
  }

  const childrenLabel = el("libraryDetailsChildrenLabel");
  const childrenEl = el("libraryDetailsChildren");
  const formatRow = el("libraryDetailsFormatRow");
  if (item.type === "collection") {
    renderCollectionDetails(item, manifest, req, childrenLabel, childrenEl, formatRow);
    return;
  }

  renderAssetDetails(item, manifest, req, childrenLabel, childrenEl, formatRow);
}

function renderEditorsRow(
  list: any[],
  req: number,
  editorsEl: HTMLElement | null
): void {
  if (req !== _requestSeq) return;
  if (editorsEl) {
    editorsEl.textContent =
      list.length === 0
        ? "just you"
        : list.length === 1
          ? "1 editor"
          : `${list.length} editors`;
  }
}

function renderOwnerRow(
  address: string | null,
  req: number,
  ownerEl: HTMLElement | null,
  copyBtn: HTMLButtonElement | null
): void {
  if (req !== _requestSeq) return;
  _ownerAddress = address;
  const display = address ? ownerDisplay(address) : "Unknown";
  if (ownerEl) {
    ownerEl.textContent = display;
    if (address && display !== address) ownerEl.title = address;
  }
  if (copyBtn) copyBtn.hidden = !address;
}

function renderItemHeader(item: LibraryItem): void {
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
}

function renderItem(item: LibraryItem): void {
  const req = ++_requestSeq;
  disposePreview();
  _ownerAddress = null;
  _currentItemId = item.id;
  _currentCid = item.manifestCid || null;

  renderItemHeader(item);

  // Each newly selected item starts with the disclosure collapsed.
  const extraEl = el("libraryDetailsExtra");
  if (extraEl) extraEl.hidden = true;
  const moreBtn = el("libraryDetailsMoreBtn");
  if (moreBtn) moreBtn.setAttribute("aria-expanded", "false");

  // Current manifest CID — mid-truncated, full value on hover + copy.
  const cidEl = el("libraryDetailsCid");
  const copyCidBtn = el<HTMLButtonElement>("libraryDetailsCopyCid");
  if (cidEl) {
    cidEl.textContent = _currentCid ? midTruncate(_currentCid) : "—";
    if (_currentCid) cidEl.title = _currentCid;
    else cidEl.removeAttribute("title");
  }
  if (copyCidBtn) copyCidBtn.hidden = !_currentCid;

  const anchorEl = el("libraryDetailsAnchor");
  if (anchorEl) anchorEl.textContent = `#${item.tokenId} · ${chainName()}`;

  // Editors — token-scoped Merkle list (chain read + IPFS, cached).
  const editorsEl = el("libraryDetailsEditors");
  if (editorsEl) editorsEl.textContent = "…";
  void loadEditorList(String(item.tokenId)).then((list) =>
    renderEditorsRow(list, req, editorsEl)
  );

  // Owner — cached chain read; CDP users see their own email when the
  // owner is the connected smart account, otherwise a truncated address.
  const ownerEl = el("libraryDetailsOwner");
  const copyBtn = el<HTMLButtonElement>("libraryDetailsCopyOwner");
  if (ownerEl) {
    ownerEl.textContent = "…";
    ownerEl.removeAttribute("title");
  }
  if (copyBtn) copyBtn.hidden = true;
  void resolveOwner(String(item.tokenId)).then((address) =>
    renderOwnerRow(address, req, ownerEl, copyBtn)
  );

  // Manifest — Modified/Assets/Format rows + version walk, then the preview.
  const modifiedEl = el("libraryDetailsModified");
  if (modifiedEl) modifiedEl.textContent = "…";
  const versionEl = el("libraryDetailsVersion");
  if (versionEl) versionEl.textContent = "…";
  void renderManifestDetails(item, req, modifiedEl, versionEl);
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
    renderEmptyState();
    return;
  }
  if (selectedIds.length > 1) {
    renderEmptyState(selectedIds.length);
    return;
  }
  const item = findItem(selectedIds[0]);
  if (!item) {
    renderEmptyState();
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

  el("libraryDetailsCopyCid")?.addEventListener("click", () => {
    if (!_currentCid) return;
    try {
      void navigator.clipboard?.writeText(_currentCid);
    } catch (err) {
      console.warn("[LIBRARY-DETAILS] clipboard copy failed:", err);
    }
  });

  // Open behaves exactly like double-clicking the card: collections enter,
  // assets open in the Studio.
  el("libraryDetailsOpenBtn")?.addEventListener("click", () => {
    if (_currentItemId !== null) openItem(_currentItemId);
  });

  el("libraryDetailsMoreBtn")?.addEventListener("click", () => {
    const extra = el("libraryDetailsExtra");
    const btn = el("libraryDetailsMoreBtn");
    if (!extra || !btn) return;
    const show = extra.hidden;
    extra.hidden = !show;
    btn.setAttribute("aria-expanded", String(show));
  });

  // Collection-only affordance: opens the shared annotations editor, which
  // writes through updateCollectionManifest (applyCollectionMutation +
  // updateAssetURI) — the same seam rename/delete use.
  el("libraryDetailsEditMetadataBtn")?.addEventListener("click", () => {
    if (_currentItemId === null) return;
    contextMenuOps()
      .then(({ requestEditCollectionMetadata }) =>
        requestEditCollectionMetadata(String(_currentItemId))
      )
      .catch((err) =>
        console.warn(
          "[LIBRARY-DETAILS] edit metadata flow failed to load:",
          err
        )
      );
  });

  initViewLeaveGuard();
  on(EVENTS.LIBRARY_STATE_CHANGED, render);
  render();
}
