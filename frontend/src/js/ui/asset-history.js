/**
 * Asset History Browser — Timeline Scrubber
 *
 * Renders a horizontal draggable timeline of asset version nodes.
 * Inspired by Google Earth historical imagery timeline.
 *
 * Visual states:
 *   • .active    → currently loaded in the scene (enlarged accent node)
 *   • .published → currently anchored on-chain (accent ring + dot)
 *
 * Drag the timeline to scrub through versions. Click any node to load it.
 */

import { clearScene, loadAssetManifest } from "../engine/scene-graph.js";
import { contract } from "../blockchain/wallet.js";

// ─── DOM References ───
const historySection = document.getElementById("assetHistory");
const historyBar = historySection
  ? historySection.querySelector(".history-bar")
  : null;

// ─── State ───
let chainCache = []; // Array of {cid, version, name, nodeCount, timestamp}
let chainRootCid = null; // CID used to fetch the chain (latest known)
let activeCid = null; // Currently loaded manifest CID
let publishedCid = null; // CID currently on-chain
let isHistoryNavigation = false;
let isLoading = false;

// ─── Drag-to-scroll State ───
let isDragging = false;
let dragStartX = 0;
let dragScrollLeft = 0;

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
  const tokenId = window.activeAssetTokenId;
  if (!tokenId || !contract) return null;
  try {
    const c = contract || window.contract;
    if (!c) return null;
    const cid = await c.methods.tokenURI(tokenId).call();
    return cid || null;
  } catch {
    return null;
  }
}

function _formatVersion(entry) {
  return `${entry.version}`;
}

function _render() {
  if (!historyBar) return;

  // Preserve the track line, remove only nodes
  const existingNodes = historyBar.querySelectorAll(".history-node");
  existingNodes.forEach((n) => n.remove());

  if (chainCache.length === 0) {
    if (historySection) historySection.hidden = true;
    return;
  }

  if (historySection) historySection.hidden = false;

  for (const entry of chainCache) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "history-node";
    node.textContent = _formatVersion(entry);
    node.title = `${entry.name || "Untitled"} • v${entry.version} • ${
      entry.nodeCount
    } node${entry.nodeCount !== 1 ? "s" : ""}${
      entry.timestamp ? " • " + new Date(entry.timestamp).toLocaleString() : ""
    }`;
    node.setAttribute("aria-label", `Load asset version ${entry.version}`);
    node.dataset.cid = entry.cid;

    if (entry.cid === activeCid) {
      node.classList.add("active");
      node.setAttribute("aria-current", "true");
    }
    if (entry.cid === publishedCid) {
      node.classList.add("published");
    }

    node.addEventListener("click", (e) => {
      // Prevent click from firing after a drag
      if (node.dataset.dragged === "true") {
        delete node.dataset.dragged;
        return;
      }
      _onNodeClick(entry.cid);
    });
    historyBar.appendChild(node);
  }

  // Scroll active node into view
  const activeNode = historyBar.querySelector(".history-node.active");
  if (activeNode) {
    activeNode.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }
}

async function _onNodeClick(cid) {
  if (isLoading || cid === activeCid) return;
  isLoading = true;
  isHistoryNavigation = true;
  activeCid = cid;
  _render();
  const selectedNode = historyBar?.querySelector(
    `.history-node[data-cid="${CSS.escape(cid)}"]`
  );
  selectedNode?.classList.add("loading");

  try {
    clearScene();
    await loadAssetManifest(cid);
    activeCid = cid;
    _render();
  } catch (err) {
    console.error("Failed to load history version:", err);
    alert("Failed to load version: " + err.message);
  } finally {
    isLoading = false;
    setTimeout(() => {
      isHistoryNavigation = false;
    }, 100);
  }
}

async function _refresh() {
  const manifestCid = window.activeAssetManifestCid;
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

// ─── Drag-to-scroll ───

function _initDragScroll() {
  if (!historyBar) return;

  historyBar.addEventListener("mousedown", (e) => {
    // Don't start drag if clicking a node
    if (e.target.closest(".history-node")) return;
    isDragging = true;
    dragStartX = e.pageX - historyBar.offsetLeft;
    dragScrollLeft = historyBar.scrollLeft;
    historyBar.style.cursor = "grabbing";
  });

  historyBar.addEventListener("mouseleave", () => {
    isDragging = false;
    historyBar.style.cursor = "grab";
  });

  historyBar.addEventListener("mouseup", () => {
    isDragging = false;
    historyBar.style.cursor = "grab";
  });

  historyBar.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - historyBar.offsetLeft;
    const walk = (x - dragStartX) * 1.5; // multiplier for faster scrolling
    historyBar.scrollLeft = dragScrollLeft - walk;
  });

  // Touch support for mobile
  historyBar.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest(".history-node")) return;
      isDragging = true;
      dragStartX = e.touches[0].pageX - historyBar.offsetLeft;
      dragScrollLeft = historyBar.scrollLeft;
    },
    { passive: true }
  );

  historyBar.addEventListener("touchend", () => {
    isDragging = false;
  });

  historyBar.addEventListener(
    "touchmove",
    (e) => {
      if (!isDragging) return;
      const x = e.touches[0].pageX - historyBar.offsetLeft;
      const walk = (x - dragStartX) * 1.5;
      historyBar.scrollLeft = dragScrollLeft - walk;
    },
    { passive: true }
  );

  // Distinguish drag from click on nodes
  historyBar.addEventListener("mousedown", (e) => {
    const node = e.target.closest(".history-node");
    if (!node) return;
    const startX = e.clientX;
    const onMouseUp = (upE) => {
      const dx = Math.abs(upE.clientX - startX);
      if (dx > 3) {
        node.dataset.dragged = "true";
      }
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mouseup", onMouseUp);
  });
}

// ─── Event Listeners ───

document.addEventListener("scene:ready", (e) => {
  const manifestCid = e.detail?.manifestCid || window.activeAssetManifestCid;
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
  window.latestAssetManifestCid = manifestCid;
  _refresh();
});

document.addEventListener("wallet:connected", () => {
  if (window.activeAssetManifestCid && !isHistoryNavigation) {
    _refresh();
  }
});

document.addEventListener("asset:published", () => {
  // Re-check published CID after mint/update
  setTimeout(_refresh, 500);
});

document.addEventListener("asset:draftSaved", () => {
  // Refresh chain after a new version is saved (no blockchain event)
  _refresh();
});

document.addEventListener("scene:empty", () => {
  chainCache = [];
  chainRootCid = null;
  activeCid = null;
  publishedCid = null;
  _render();
});

// ─── Initialize ───
_initDragScroll();

if (window.activeAssetManifestCid) {
  chainRootCid = window.activeAssetManifestCid;
  _refresh();
}
