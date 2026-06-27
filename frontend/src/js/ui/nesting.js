// @ts-nocheck
/**
 * Arbesk Nesting Navigation - Dive/Ascend State Machine
 *
 * Manages breadcrumb path bar, back button, and depth gating
 * for fractal world nesting.
 */

import { clearScene, loadAssetManifest } from "../engine/scene-graph.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { uiState } from "../state/ui-state.js";

const MAX_DEPTH = 5;

// Navigation stack: [{ cid, name, assetName, tokenId, contractAddress }]
let navStack = [];
let currentDepth = 0;

// DOM
let backBtn = null;
let pathBar = null;

// ─── Initialization ──────────────────────────────────────────────────

function initNesting() {
  backBtn = document.getElementById("backBtn");
  pathBar = document.getElementById("pathBar");

  if (backBtn) {
    backBtn.addEventListener("click", ascendOneLevel);
  }

  // Keyboard: Alt+Left = ascend
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "ArrowLeft") {
      const tag = document.activeElement?.tagName?.toLowerCase();
      const editing =
        document.activeElement?.isContentEditable ||
        tag === "input" ||
        tag === "textarea" ||
        tag === "select";
      if (editing) return;
      e.preventDefault();
      ascendOneLevel();
    }
  });

  // Keyboard: Escape at child root = ascend
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentDepth > 0) {
      // Don't ascend if a dialog/modal is open
      const activeEl = document.activeElement;
      if (activeEl && activeEl.tagName === "BODY") {
        e.preventDefault();
        ascendOneLevel();
      }
    }
  });

  // Listen for dive requests
  on(EVENTS.NESTING_DIVE_REQUESTED, onDiveRequested);

  // Update publish button visibility based on depth
  updatePublishVisibility();
}

// ─── Dive ────────────────────────────────────────────────────────────

async function onDiveRequested(e) {
  const { childRef, nodeId: _nodeId } = e;
  if (!childRef) return;

  if (currentDepth >= MAX_DEPTH) {
    alert("Maximum nesting depth reached (5 levels).");
    return;
  }

  try {
    // Resolve child manifest CID from token
    const manifest = await resolveChildManifest(childRef);
    if (!manifest) {
      alert("Could not resolve child world manifest.");
      return;
    }

    // Save current state on the stack
    const { activeAssetManifestCid, activeAssetName, activeAssetTokenId } =
      assetState.get();
    navStack.push({
      cid: activeAssetManifestCid,
      name: activeAssetName || "World",
      assetName: activeAssetName,
      tokenId: activeAssetTokenId,
    });

    // Load child world
    clearScene();
    // Extract tokenId from either old ({tokenId}) or new ({collection: {tokenId}}) format
    const refTokenId = childRef.tokenId || childRef.collection?.tokenId || null;

    assetState.set({
      activeAssetManifestCid: manifest.cid,
      latestAssetManifestCid: manifest.cid,
      activeAssetName: manifest.name || "Child World",
      activeAssetTokenId: refTokenId,
    });
    uiState.set({ nestingDepth: ++currentDepth });

    await loadAssetManifest(manifest.cid);

    // Update breadcrumb
    renderBreadcrumb();
    updatePublishVisibility();
    updateBottomBarDepth();

    emit(EVENTS.NESTING_DID_DIVE, { depth: currentDepth, name: manifest.name });
  } catch (err) {
    console.error("[NESTING] dive failed:", err);
    alert("Failed to open child world: " + err.message);
  }
}

// ─── Ascend ───────────────────────────────────────────────────────────

async function ascendOneLevel() {
  if (navStack.length === 0) return;

  const prev = navStack.pop();
  currentDepth = Math.max(0, currentDepth - 1);
  uiState.set({ nestingDepth: currentDepth });

  try {
    clearScene();
    assetState.set({
      activeAssetManifestCid: prev.cid,
      latestAssetManifestCid: prev.cid,
      activeAssetName: prev.assetName,
      activeAssetTokenId: prev.tokenId,
    });

    await loadAssetManifest(prev.cid);

    renderBreadcrumb();
    updatePublishVisibility();
    updateBottomBarDepth();

    emit(EVENTS.NESTING_DID_ASCEND, { depth: currentDepth, name: prev.name });
  } catch (err) {
    console.error("[NESTING] ascend failed:", err);
    alert("Failed to return to parent world: " + err.message);
  }
}

function ascendToLevel(targetIndex) {
  // Click on a breadcrumb segment to jump directly
  while (navStack.length > targetIndex) {
    navStack.pop();
  }
  ascendOneLevel();
}

// ─── Breadcrumb Rendering ─────────────────────────────────────────────

function renderBreadcrumb() {
  if (!pathBar) return;

  pathBar.innerHTML = "";

  if (navStack.length === 0) {
    pathBar.classList.add("hidden");
    if (backBtn) backBtn.classList.add("hidden");
    return;
  }

  pathBar.classList.remove("hidden");
  if (backBtn) backBtn.classList.remove("hidden");

  navStack.forEach((entry, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "pathbar-separator";
      sep.textContent = "▸";
      pathBar.appendChild(sep);
    }

    const seg = document.createElement("button");
    seg.className = "pathbar-segment";
    seg.textContent = entry.name || "World";
    seg.title = `Go back to ${entry.name}`;
    seg.addEventListener("click", () => ascendToLevel(i));
    pathBar.appendChild(seg);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function resolveChildManifest(childRef) {
  try {
    let cid = null;

    // New collection-based format: { collection: {...}, assetID }
    if (childRef?.assetID && childRef?.collection) {
      const { resolveCollectionChildRef } = await import(
        "../blockchain/token-resolver.js"
      );
      const result = await resolveCollectionChildRef(childRef, null);
      cid = result?.manifestCid || null;
    } else {
      // Legacy format: { type: "token", chainId, contractAddress, tokenId, ... }
      const { resolveChildRef } = await import(
        "../blockchain/token-resolver.js"
      );
      const result = await resolveChildRef(childRef);
      cid = result?.manifestCid || null;
    }

    if (!cid) return null;
    const manifest = await getFromRemoteIPFS(cid);
    return { cid, ...manifest };
  } catch {
    return null;
  }
}

function updatePublishVisibility() {
  const publishBtn = document.getElementById("publishAssetBtn");
  if (publishBtn) {
    // Token-based child worlds are publishable regardless of depth.
    // Only hide publish when truly at root level with no token (empty state).
    const hidePublish =
      currentDepth > 0 && !assetState.get().activeAssetTokenId;
    publishBtn.classList.toggle("hidden", hidePublish);
  }
}

function updateBottomBarDepth() {
  const statusEl = document.getElementById("bottomBarStatus");
  if (statusEl && currentDepth > 0) {
    statusEl.textContent = `Depth ${currentDepth}/${MAX_DEPTH}`;
  } else if (statusEl) {
    statusEl.textContent = "Draft";
  }
}

// ─── Reset (on new asset) ─────────────────────────────────────────────

function resetNesting() {
  navStack = [];
  currentDepth = 0;
  uiState.set({ nestingDepth: 0 });
  if (pathBar) pathBar.classList.add("hidden");
  if (backBtn) backBtn.classList.add("hidden");
  updatePublishVisibility();
}

on(EVENTS.SCENE_EMPTY, resetNesting);

// ─── Exports ─────────────────────────────────────────────────────────

export { initNesting, ascendOneLevel, resetNesting, currentDepth };
