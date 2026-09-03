/**
 * Dive/ascend navigation for fractal asset nesting (breadcrumb bar, back
 * button, and depth gating).
 */

import { clearScene, loadAssetManifest } from "../engine/scene-graph.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { uiState } from "../state/ui-state.ts";
import {
  adoptOpenedAsset,
  renameAsset,
  getAssetState,
} from "@arbesk/asset-core/domain/asset.js";

const MAX_DEPTH = 5;

// Navigation stack: [{ cid, name, assetName, tokenId, contractAddress }]
let navStack: Array<Record<string, any>> = [];
let currentDepth = 0;

// DOM
let backBtn: HTMLElement | null = null;
let pathBar: HTMLElement | null = null;

// ─── Initialization ──────────────────────────────────────────────────

function initNesting(): void {
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
        (document.activeElement as any)?.isContentEditable ||
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

/**
 * @remarks `e` is the NESTING_DIVE_REQUESTED event payload.
 */
async function onDiveRequested(e: any): Promise<void> {
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
      alert("Could not resolve child asset manifest.");
      return;
    }

    // Save current state on the stack
    const { activeAssetManifestCid, activeAssetName, activeAssetTokenId } =
      getAssetState();
    navStack.push({
      cid: activeAssetManifestCid,
      name: activeAssetName || "Asset",
      assetName: activeAssetName,
      tokenId: activeAssetTokenId,
    });

    // Load child asset
    clearScene();
    // Extract tokenId from either old ({tokenId}) or new ({collection: {tokenId}}) format
    const refTokenId = childRef.tokenId || childRef.collection?.tokenId || null;

    adoptOpenedAsset(manifest.cid, { tokenId: refTokenId });
    renameAsset(manifest.name || "Child Asset");
    uiState.set({ nestingDepth: ++currentDepth });

    await loadAssetManifest(manifest.cid);

    // Update breadcrumb
    renderBreadcrumb();
    updatePublishVisibility();
    updateBottomBarDepth();

    emit(EVENTS.NESTING_DID_DIVE, { depth: currentDepth, name: manifest.name });
  } catch (err) {
    console.error("[NESTING] dive failed:", err);
    alert("Failed to open child asset: " + (err as Error).message);
  }
}

// ─── Ascend ───────────────────────────────────────────────────────────

async function ascendOneLevel(): Promise<void> {
  if (navStack.length === 0) return;

  const prev = navStack.pop();
  if (!prev) return;
  currentDepth = Math.max(0, currentDepth - 1);
  uiState.set({ nestingDepth: currentDepth });

  try {
    clearScene();
    adoptOpenedAsset(prev.cid, { tokenId: prev.tokenId });
    renameAsset(prev.assetName);

    await loadAssetManifest(prev.cid);

    renderBreadcrumb();
    updatePublishVisibility();
    updateBottomBarDepth();

    emit(EVENTS.NESTING_DID_ASCEND, { depth: currentDepth, name: prev.name });
  } catch (err) {
    console.error("[NESTING] ascend failed:", err);
    alert("Failed to return to parent asset: " + (err as Error).message);
  }
}

function ascendToLevel(targetIndex: number): void {
  // Click on a breadcrumb segment to jump directly
  while (navStack.length > targetIndex) {
    navStack.pop();
  }
  ascendOneLevel();
}

// ─── Breadcrumb Rendering ─────────────────────────────────────────────

function renderBreadcrumb(): void {
  const bar = pathBar;
  if (!bar) return;

  bar.innerHTML = "";

  if (navStack.length === 0) {
    bar.classList.add("hidden");
    if (backBtn) backBtn.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");
  if (backBtn) backBtn.classList.remove("hidden");

  navStack.forEach((entry, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "pathbar-separator";
      sep.textContent = "▸";
      bar.appendChild(sep);
    }

    const seg = document.createElement("button");
    seg.className = "pathbar-segment";
    seg.textContent = entry.name || "Asset";
    seg.title = `Go back to ${entry.name}`;
    seg.addEventListener("click", () => ascendToLevel(i));
    bar.appendChild(seg);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function resolveChildManifest(childRef: any): Promise<any> {
  try {
    let cid = null;

    // New collection-based format: { collection: {...}, assetID }
    if (childRef?.assetID && childRef?.collection) {
      const { resolveCollectionChildRef } = await import(
        "../blockchain/token-resolver.ts"
      );
      const result = await resolveCollectionChildRef(childRef, null);
      cid = result?.manifestCid || null;
    } else {
      // Legacy format: { type: "token", chainId, contractAddress, tokenId, ... }
      const { resolveChildRef } = await import(
        "../blockchain/token-resolver.ts"
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

function updatePublishVisibility(): void {
  const publishBtn = document.getElementById("publishAssetBtn");
  if (publishBtn) {
    // Token-based child assets are publishable regardless of depth.
    // Only hide publish when truly at root level with no token (empty state).
    const hidePublish =
      currentDepth > 0 && !getAssetState().activeAssetTokenId;
    publishBtn.classList.toggle("hidden", hidePublish);
  }
}

function updateBottomBarDepth(): void {
  const statusEl = document.getElementById("bottomBarStatus");
  if (statusEl && currentDepth > 0) {
    statusEl.textContent = `Depth ${currentDepth}/${MAX_DEPTH}`;
  } else if (statusEl) {
    statusEl.textContent = "Draft";
  }
}

// ─── Reset (on new asset) ─────────────────────────────────────────────

function resetNesting(): void {
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
