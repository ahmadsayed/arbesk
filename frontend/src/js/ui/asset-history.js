/**
 * Asset Version Scrubber
 *
 * A single GNOME-style slider in the header bar scrubs through the asset's
 * save/version history (the manifest chain). The thumb position is the
 * version index; a popover surfaces per-version detail (name, node count,
 * timestamp) on hover/focus. This is the app's sole version control.
 *
 * States surfaced on the control:
 *   • .loading    → a version is being fetched/loaded into the scene
 *   • .published  → the currently selected version is the one anchored on-chain
 */

import { clearScene, loadAssetManifest } from "../engine/scene-graph.js";
import { contract } from "../blockchain/wallet.js";
import { getManifestHistory } from "../services/api.js";
import { on, EVENTS } from "../events/registry.js";
import { assetState } from "../state/asset-state.js";

// ─── DOM References ───
const historySection = document.getElementById("assetHistory");
const slider = document.getElementById("historySlider");
const badge = document.getElementById("historyVersionBadge");
const popover = document.getElementById("historyDetailPopover");

// ─── State ───
let chainCache = []; // Array of {cid, version, name, nodeCount, timestamp}, oldest→newest
let chainRootCid = null; // CID used to fetch the chain (latest known)
let activeCid = null; // Currently loaded manifest CID
let publishedCid = null; // CID currently on-chain
let isHistoryNavigation = false;
let isLoading = false;

// ─── Helpers ───

async function _fetchChain(cid) {
  if (!cid) return [];
  try {
    const { chain } = await getManifestHistory(cid);
    return chain;
  } catch (err) {
    console.error("History chain fetch failed:", err);
    return [];
  }
}

async function _fetchPublishedCid() {
  const tokenId = assetState.get().activeAssetTokenId;
  if (!tokenId || !contract) return null;
  try {
    if (!contract) return null;
    const cid = await contract.methods.tokenURI(tokenId).call();
    return cid || null;
  } catch {
    return null;
  }
}

function _activeIndex() {
  const i = chainCache.findIndex((e) => e.cid === activeCid);
  return i === -1 ? chainCache.length - 1 : i;
}

function _entryDetail(entry) {
  if (!entry) return "";
  const nodes = `${entry.nodeCount} node${entry.nodeCount !== 1 ? "s" : ""}`;
  const when = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : "";
  return [entry.name || "Untitled", `v${entry.version}`, nodes, when]
    .filter(Boolean)
    .join(" · ");
}

function _updatePopover(entry) {
  if (!popover) return;
  popover.textContent = _entryDetail(entry);
}

// Anchor the fixed-position popover under the current thumb so it escapes the
// headerbar's overflow:hidden clipping.
function _positionPopover() {
  if (!popover || !slider) return;
  const r = slider.getBoundingClientRect();
  const max = parseFloat(slider.max) || 0;
  const val = parseFloat(slider.value) || 0;
  const ratio = max > 0 ? val / max : 0;
  popover.style.left = `${r.left + ratio * r.width}px`;
  popover.style.top = `${r.bottom + 8}px`;
}

function _showPopover() {
  if (popover && popover.textContent) {
    _positionPopover();
    popover.hidden = false;
  }
}

function _hidePopover() {
  if (popover) popover.hidden = true;
}

function _render() {
  if (!slider || !historySection) return;

  if (chainCache.length === 0) {
    historySection.hidden = true;
    return;
  }

  historySection.hidden = false;

  const index = _activeIndex();
  slider.min = 0;
  slider.max = chainCache.length - 1;
  slider.step = 1;
  slider.value = String(index);

  const entry = chainCache[index];
  if (badge) badge.textContent = entry ? `v${entry.version}` : "v1";
  slider.setAttribute(
    "aria-valuetext",
    entry ? `Version ${entry.version}` : ""
  );

  // Mark whether the selected version is the one currently anchored on-chain.
  historySection.classList.toggle(
    "published",
    !!publishedCid && entry?.cid === publishedCid
  );

  _updatePopover(entry);
}

async function _loadVersion(cid) {
  if (isLoading || cid === activeCid) return;
  isLoading = true;
  isHistoryNavigation = true;
  activeCid = cid;
  historySection?.classList.add("loading");
  _render();

  try {
    // clearScene() resets latestAssetManifestCid, but we need to keep
    // the chain root (latest version) while the user is scrubbing history.
    const preservedLatest = chainRootCid || assetState.get().latestAssetManifestCid;
    clearScene();
    if (preservedLatest) {
      assetState.set({ latestAssetManifestCid: preservedLatest });
    }
    await loadAssetManifest(cid);
    activeCid = cid;
    _render();
  } catch (err) {
    console.error("Failed to load history version:", err);
    alert("Failed to load version: " + err.message);
  } finally {
    isLoading = false;
    historySection?.classList.remove("loading");
    // Keep the flag true until loadAssetManifest() has finished and scene:ready
    // listeners have run. A fixed timeout was too short for slow IPFS loads and
    // caused the scene:ready listener to treat the history load as a normal load,
    // overwriting window.latestAssetManifestCid with the old version CID.
    isHistoryNavigation = false;
  }
}

async function _refresh() {
  const manifestCid = assetState.get().activeAssetManifestCid;
  if (!manifestCid) {
    chainCache = [];
    chainRootCid = null;
    activeCid = null;
    publishedCid = null;
    _render();
    return;
  }

  // On history navigation, don't change the chain root — just update active state
  if (isHistoryNavigation) {
    activeCid = manifestCid;
    _render();
    return;
  }

  // On normal load, update chain root to the latest manifest
  chainRootCid = manifestCid;
  activeCid = manifestCid;

  // Fetch chain and published CID in parallel
  const [chain, pubCid] = await Promise.all([
    _fetchChain(chainRootCid),
    _fetchPublishedCid(),
  ]);

  chainCache = chain;
  publishedCid = pubCid;
  _render();
}

// ─── Slider interaction ───

function _initSlider() {
  if (!slider) return;

  // Live: update the badge + popover as the thumb moves (cheap, no load).
  slider.addEventListener("input", () => {
    const index = parseInt(slider.value, 10);
    const entry = chainCache[index];
    if (!entry) return;
    if (badge) badge.textContent = `v${entry.version}`;
    _updatePopover(entry);
    _positionPopover();
    _showPopover();
  });

  // Commit: load the landed version on release / keyboard step. Using `change`
  // (not `input`) avoids firing a load for every intermediate value mid-drag.
  slider.addEventListener("change", () => {
    const index = parseInt(slider.value, 10);
    const entry = chainCache[index];
    if (entry && entry.cid !== activeCid) _loadVersion(entry.cid);
  });

  // Surface the detail popover on hover/focus, hide when leaving.
  slider.addEventListener("mouseenter", _showPopover);
  slider.addEventListener("focus", _showPopover);
  slider.addEventListener("mouseleave", _hidePopover);
  slider.addEventListener("blur", _hidePopover);
}

// ─── Event Listeners ───

on(EVENTS.SCENE_READY, (e) => {
  const manifestCid = e.detail?.manifestCid || assetState.get().activeAssetManifestCid;
  if (!manifestCid) return;

  if (isHistoryNavigation) {
    // Just update active state, keep existing chain
    activeCid = manifestCid;
    _render();
    return;
  }

  // Normal load — refresh everything
  chainRootCid = manifestCid;
  activeCid = manifestCid;
  assetState.set({ latestAssetManifestCid: manifestCid });
  _refresh();
});

on(EVENTS.WALLET_CONNECTED, () => {
  if (assetState.get().activeAssetManifestCid && !isHistoryNavigation) {
    _refresh();
  }
});

on(EVENTS.ASSET_PUBLISHED, () => {
  // Re-check published CID after mint/update
  setTimeout(_refresh, 500);
});

on(EVENTS.ASSET_DRAFT_SAVED, () => {
  // Refresh chain after a new version is saved (no blockchain event)
  _refresh();
});

on(EVENTS.SCENE_EMPTY, () => {
  chainCache = [];
  chainRootCid = null;
  activeCid = null;
  publishedCid = null;
  _render();
});

// ─── Initialize ───
_initSlider();

const _initCid = assetState.get().activeAssetManifestCid;
if (_initCid) {
  chainRootCid = _initCid;
  _refresh();
}
