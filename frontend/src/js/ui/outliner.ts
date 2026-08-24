/**
 * Arbesk Outliner - Scene Hierarchy Tree
 *
 * Renders the scene graph from the current level's manifest.
 * Click to select, double-click child assets to dive in.
 * Supports drag reorder and drag-from-library to add children.
 */

import { switchView } from "./sidebar.ts";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.ts";
import { emit, on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { uiState } from "../state/ui-state.ts";
import {
  cacheCurrentManifest,
  getActiveAssetManifestCid,
  getCurrentManifest,
} from "@arbesk/asset-core/domain/asset.js";
import { getManifestNodes } from "../engine/transforms.ts";

let outlinerTree: Element | null = null;
let outlinerFooter: Element | null = null;
let selectedNodeId: string | null = null;
const selectedNodeIds: Set<string> = new Set();
const collapsedNodeIds: Set<string> = new Set();
let renderedManifestCid: string | null = null;

function getOutlinerTree(): Element | null {
  return outlinerTree || document.querySelector(".outliner-tree");
}

// ─── Initialization ──────────────────────────────────────────────────

function initOutliner(): void {
  outlinerTree = document.querySelector(".outliner-tree");
  outlinerFooter = document.querySelector(".outliner-footer");

  if (!outlinerTree) return;

  // [+] Add child button
  const addBtn = document.getElementById("outlinerAddBtn");
  if (addBtn) {
    addBtn.addEventListener("click", onAddChild);
  }

  // [-] Remove button
  const removeBtn = document.getElementById("outlinerRemoveBtn");
  if (removeBtn) {
    removeBtn.addEventListener("click", onRemoveSelected);
  }

  // Listen for scene updates
  on(EVENTS.SCENE_READY, onSceneReady);
  on(EVENTS.SCENE_EMPTY, onSceneEmpty);
  on(EVENTS.ASSET_DRAFT_SAVED, () => refreshOutliner());
  on(EVENTS.SCENE_CLEARED, onSceneEmpty);
  on(EVENTS.NODE_DESELECTED, clearSelection);
  on(EVENTS.SELECTION_CHANGED, syncFromEngine);

  // Drag-and-drop from library
  outlinerTree.addEventListener("dragover", (e) => {
    e.preventDefault();
    const de = e as DragEvent;
    if (de.dataTransfer) de.dataTransfer.dropEffect = "copy";
    showDropTarget(de);
  });

  outlinerTree.addEventListener("dragleave", hideDropTarget);
  outlinerTree.addEventListener("drop", onDropFromLibrary);

  // Initial render if manifest is already loaded
  if (getActiveAssetManifestCid()) {
    refreshOutliner();
  }
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchCurrentManifest(): Promise<any> {
  const cid = getActiveAssetManifestCid();
  if (!cid) return null;
  try {
    return await getFromRemoteIPFS(cid);
  } catch {
    return null;
  }
}

function getNodes(): any[] {
  return getManifestNodes(getCurrentManifest());
}

/**
 * Build a hierarchical outline tree from the flat manifest nodes array.
 * Child-asset nodes (nodes with child_ref) are grouped under the nearest
 * preceding regular node so the outline reflects the parent/child relationship
 * shown in the viewport.
 */
function buildOutlineTree(nodes: any[]): any[] {
  if (!Array.isArray(nodes)) return [];

  const tree: any[] = [];
  let currentParent: any = null;

  nodes.forEach((node) => {
    const isChildAsset = !!node.child_ref;
    if (isChildAsset && currentParent) {
      currentParent.children ||= [];
      currentParent.children.push({ ...node });
    } else {
      const cloned = { ...node };
      tree.push(cloned);
      if (!isChildAsset) {
        currentParent = cloned;
      }
    }
  });

  return tree;
}

// ─── Rendering ────────────────────────────────────────────────────────

async function refreshOutliner(): Promise<void> {
  const cid = getActiveAssetManifestCid();
  const cached = getCurrentManifest() as any;

  let manifest = null;
  if (cached?._manifestCid === cid) {
    // Cache hit: currentManifest already holds this CID's manifest, so reuse it
    // directly — no clone and no redundant write-back. buildOutlineTree clones
    // the nodes it needs, so the shared reference is never mutated.
    manifest = cached;
  } else if (cid) {
    manifest = await fetchCurrentManifest();
    if (manifest) {
      cacheCurrentManifest(manifest, cid);
    }
  }

  if (!manifest) {
    collapsedNodeIds.clear();
    renderedManifestCid = null;
    renderEmpty();
    return;
  }
  if (cid !== renderedManifestCid) {
    collapsedNodeIds.clear();
    renderedManifestCid = cid;
  }
  renderTree(buildOutlineTree(getNodes()));
}

function renderEmpty(): void {
  const tree = getOutlinerTree();
  if (!tree) return;
  tree.innerHTML = "";
  if (outlinerFooter) outlinerFooter.textContent = "No items";
}

function renderTree(
  nodes: any[],
  depth = 0
): { totalNodes: number; childCount: number } {
  const tree = getOutlinerTree();
  if (!tree) return { totalNodes: 0, childCount: 0 };

  if (depth === 0) {
    tree.innerHTML = "";
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    if (depth === 0) {
      tree.innerHTML = '<div class="ledger-empty">No items in this asset</div>';
      updateFooter(0, 0);
    }
    return { totalNodes: 0, childCount: 0 };
  }

  let totalNodes = 0;
  let childCount = 0;

  nodes.forEach((node) => {
    const isChild = !!node.child_ref;
    if (isChild) childCount++;
    totalNodes++;

    const el = createNodeElement(node, isChild, depth);
    tree.appendChild(el);

    const hasChildren =
      Array.isArray(node.children) && node.children.length > 0;
    const isCollapsed = hasChildren && collapsedNodeIds.has(node.node_id);
    if (hasChildren && !isCollapsed) {
      const childStats = renderTree(node.children, depth + 1);
      totalNodes += childStats.totalNodes;
      childCount += childStats.childCount;
    }
  });

  if (depth === 0) {
    updateFooter(totalNodes, childCount);
  }

  return { totalNodes, childCount };
}

function getNodeDisplayName(node: any): string {
  // If node has a real name (not just a copy of its node_id), use it
  if (node.name && node.name !== node.node_id) {
    return node.name;
  }

  // Token children: use a human-readable label.
  // Supports both legacy {tokenId} and collection {collection: {tokenId}, assetID} formats.
  const refTokenId =
    node.child_ref?.tokenId || node.child_ref?.collection?.tokenId;
  if (refTokenId) {
    return `Token #${refTokenId}`;
  }

  // Fall back to node_id or "Untitled"
  return node.node_id || "Untitled";
}

function createNodeElement(node: any, isChildAsset: boolean, depth = 0): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "outliner-node";
  el.dataset.nodeId = node.node_id;
  el.dataset.depth = String(depth);
  el.draggable = true;

  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  // Indentation guides for nested rows
  for (let i = 0; i < depth; i++) {
    const guide = document.createElement("span");
    guide.className = "outliner-node-guide";
    guide.setAttribute("aria-hidden", "true");
    el.appendChild(guide);
  }

  // Expand/collapse toggle or leaf spacer
  let toggle: HTMLElement;
  if (hasChildren) {
    const isCollapsed = collapsedNodeIds.has(node.node_id);
    toggle = document.createElement("button");
    (toggle as HTMLButtonElement).type = "button";
    toggle.className = "outliner-node-toggle";
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.setAttribute(
      "aria-label",
      `${isCollapsed ? "Expand" : "Collapse"} ${getNodeDisplayName(node)}`
    );
    toggle.textContent = isCollapsed ? "▶" : "▼";
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (collapsedNodeIds.has(node.node_id)) {
        collapsedNodeIds.delete(node.node_id);
      } else {
        collapsedNodeIds.add(node.node_id);
      }
      renderTree(buildOutlineTree(getNodes()));
      (
        getOutlinerTree()?.querySelector(
          `[data-node-id="${CSS.escape(node.node_id)}"] .outliner-node-toggle`
        ) as HTMLElement | null
      )?.focus();
    });
  } else {
    toggle = document.createElement("span");
    toggle.className = "outliner-node-toggle";
    toggle.setAttribute("aria-hidden", "true");
    toggle.textContent = "";
  }
  toggle.dataset.hasChildren = String(hasChildren);
  el.appendChild(toggle);

  // Icon
  const icon = document.createElement("span");
  icon.className = "outliner-node-icon";
  icon.textContent = isChildAsset ? "🧩" : "📦";
  el.appendChild(icon);

  // Label
  const label = document.createElement("span");
  label.className = "outliner-node-label";
  label.textContent = getNodeDisplayName(node);
  el.appendChild(label);

  // Badge (token ID for child assets).
  // Supports both legacy {tokenId} and collection {collection: {tokenId}, assetID} formats.
  const badgeTokenId =
    node.child_ref?.tokenId || node.child_ref?.collection?.tokenId;
  if (isChildAsset && badgeTokenId) {
    const badge = document.createElement("span");
    badge.className = "outliner-node-badge";
    badge.textContent = `#${badgeTokenId}`;
    el.appendChild(badge);
  }

  // Click → select (Ctrl/Cmd+click toggles multi-selection)
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    selectNode(node.node_id, e.ctrlKey || e.metaKey);
  });

  // Double-click child → dive
  if (isChildAsset) {
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      diveIntoChild(node);
    });
  }

  // Drag start
  el.addEventListener("dragstart", (e) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData("text/plain", node.node_id);
    e.dataTransfer.effectAllowed = "move";
  });

  return el;
}

function getOutlinerFooter(): Element | null {
  return outlinerFooter || document.querySelector(".outliner-footer");
}

function updateFooter(totalNodes: number, childCount: number): void {
  const footer = getOutlinerFooter();
  if (!footer) return;
  const depth = uiState.get().nestingDepth;
  footer.textContent = `${totalNodes} item${
    totalNodes !== 1 ? "s" : ""
  } · ${childCount} child${childCount !== 1 ? "ren" : ""} · Depth ${depth}/5`;
}

// ─── Selection ────────────────────────────────────────────────────────

function _rowFor(nodeId: string): Element | null | undefined {
  return getOutlinerTree()?.querySelector(
    `[data-node-id="${CSS.escape(nodeId)}"]`
  );
}

function _syncRowSelectionClasses(): void {
  const tree = getOutlinerTree();
  if (!tree) return;
  for (const el of tree.querySelectorAll(".outliner-node.selected")) {
    el.classList.remove("selected");
  }
  for (const id of selectedNodeIds) {
    _rowFor(id)?.classList.add("selected");
  }
}

function selectNode(nodeId: string, additive = false): void {
  if (additive) {
    if (selectedNodeIds.has(nodeId)) {
      selectedNodeIds.delete(nodeId);
    } else {
      selectedNodeIds.add(nodeId);
    }
    selectedNodeId = selectedNodeIds.has(nodeId)
      ? nodeId
      : [...selectedNodeIds].at(-1) || null;
  } else {
    selectedNodeIds.clear();
    selectedNodeIds.add(nodeId);
    selectedNodeId = nodeId;
  }
  _syncRowSelectionClasses();

  // Dispatch for inspector / viewport sync
  emit(EVENTS.OUTLINER_NODE_SELECTED, { nodeId, additive });
}

function clearSelection(): void {
  selectedNodeIds.clear();
  selectedNodeId = null;
  _syncRowSelectionClasses();
}

/**
 * Mirror an engine-driven selection change (viewport pick, Ctrl+A, Escape)
 * without re-emitting — the engine is the source of truth.
 */
function syncFromEngine(e: any): void {
  const ids = Array.isArray(e?.nodeIds) ? e.nodeIds : [];
  selectedNodeIds.clear();
  for (const id of ids) selectedNodeIds.add(id);
  selectedNodeId = ids.at(-1) || null;
  _syncRowSelectionClasses();
}

// ─── Actions ──────────────────────────────────────────────────────────

function diveIntoChild(node: any): void {
  if (!node.child_ref) return;
  emit(EVENTS.NESTING_DIVE_REQUESTED, {
    childRef: node.child_ref,
    nodeId: node.node_id,
  });
}

function onAddChild(): void {
  // Switch to library view so user can drag an asset
  switchView("library");
}

async function onRemoveSelected(): Promise<void> {
  if (!selectedNodeId) return;
  emit(EVENTS.OUTLINER_REMOVE_REQUESTED, { nodeId: selectedNodeId });
}

// ─── Drag & Drop from Library ────────────────────────────────────────

function showDropTarget(e: DragEvent): void {
  const target = (e.target as HTMLElement).closest(
    ".outliner-node"
  );
  hideDropTarget();
  if (target) {
    target.classList.add("drag-over");
  }
}

function hideDropTarget(): void {
  outlinerTree?.querySelectorAll(".outliner-node.drag-over").forEach((el) => {
    el.classList.remove("drag-over");
  });
}

function onDropFromLibrary(e: Event): void {
  e.preventDefault();
  hideDropTarget();

  const raw = (e as DragEvent).dataTransfer?.getData(
    "application/x-arbesk-linked-asset"
  );
  if (!raw) return;

  try {
    const payload = JSON.parse(raw);
    if (payload?.type === "linked_asset" && payload.token_id) {
      emit(EVENTS.ASSET_LINKED_DROPPED, {
        type: "linked_asset",
        token_id: String(payload.token_id),
        standard: payload.standard || "ERC721",
        resolution: payload.resolution || "latest",
        chainId: payload.chainId,
        contractAddress: payload.contractAddress,
      });
    }
  } catch {
    // ignore
  }
}

// ─── Event Handlers ───────────────────────────────────────────────────

function onSceneReady(): void {
  refreshOutliner();
}

function onSceneEmpty(): void {
  renderEmpty();
  clearSelection();
  collapsedNodeIds.clear();
}

// ─── Exports ─────────────────────────────────────────────────────────

export {
  initOutliner,
  refreshOutliner,
  renderTree,
  selectNode,
  clearSelection,
  createNodeElement,
  buildOutlineTree,
  getNodes,
};
