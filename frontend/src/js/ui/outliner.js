/**
 * Arbesk Outliner — Scene Hierarchy Tree
 *
 * Renders the scene graph from the current level's manifest.
 * Click to select, double-click child worlds to dive in.
 * Supports drag reorder and drag-from-library to add children.
 */

import { switchView } from "./sidebar.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { emit, on, EVENTS } from "../events/registry.js";
import { assetState } from "../state/asset-state.js";
import { uiState } from "../state/ui-state.js";

let outlinerTree = null;
let outlinerFooter = null;
let selectedNodeId = null;
const collapsedNodeIds = new Set();
let renderedManifestCid = null;

function getOutlinerTree() {
  return outlinerTree || document.querySelector(".outliner-tree");
}

// ─── Initialization ──────────────────────────────────────────────────

function initOutliner() {
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

  // Drag-and-drop from library
  outlinerTree.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    showDropTarget(e);
  });

  outlinerTree.addEventListener("dragleave", hideDropTarget);
  outlinerTree.addEventListener("drop", onDropFromLibrary);

  // Initial render if manifest is already loaded
  if (assetState.get().activeAssetManifestCid) {
    refreshOutliner();
  }
}

// ─── Data ─────────────────────────────────────────────────────────────

async function getCurrentManifest() {
  if (!assetState.get().activeAssetManifestCid) return null;
  try {
    return await getFromRemoteIPFS(assetState.get().activeAssetManifestCid);
  } catch {
    return null;
  }
}

function getNodes() {
  const manifest = assetState.get().currentManifest;
  if (!manifest?.scene?.nodes) return [];
  return manifest.scene.nodes;
}

/**
 * Build a hierarchical outline tree from the flat manifest nodes array.
 * Child-world nodes (nodes with child_ref) are grouped under the nearest
 * preceding regular node so the outline reflects the parent/child relationship
 * shown in the viewport.
 */
function buildOutlineTree(nodes) {
  if (!Array.isArray(nodes)) return [];

  const tree = [];
  let currentParent = null;

  nodes.forEach((node) => {
    const isChildWorld = !!node.child_ref;
    if (isChildWorld && currentParent) {
      currentParent.children ||= [];
      currentParent.children.push({ ...node });
    } else {
      const cloned = { ...node };
      tree.push(cloned);
      if (!isChildWorld) {
        currentParent = cloned;
      }
    }
  });

  return tree;
}

// ─── Rendering ────────────────────────────────────────────────────────

async function refreshOutliner() {
  const manifest = await getCurrentManifest();
  if (!manifest) {
    collapsedNodeIds.clear();
    renderedManifestCid = null;
    renderEmpty();
    return;
  }
  const cid = assetState.get().activeAssetManifestCid;
  if (cid !== renderedManifestCid) {
    collapsedNodeIds.clear();
    renderedManifestCid = cid;
  }
  assetState.set({ currentManifest: manifest });
  renderTree(buildOutlineTree(getNodes()));
}

function renderEmpty() {
  const tree = getOutlinerTree();
  if (!tree) return;
  tree.innerHTML = "";
  if (outlinerFooter) outlinerFooter.textContent = "No items";
}

function renderTree(nodes, depth = 0) {
  const tree = getOutlinerTree();
  if (!tree) return { totalNodes: 0, childCount: 0 };

  if (depth === 0) {
    tree.innerHTML = "";
  }

  if (!Array.isArray(nodes) || nodes.length === 0) {
    if (depth === 0) {
      tree.innerHTML =
        '<div class="ledger-empty">No items in this world</div>';
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

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
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

function getNodeDisplayName(node) {
  // If node has a real name (not just a copy of its node_id), use it
  if (node.name && node.name !== node.node_id) {
    return node.name;
  }

  // Token children: use a human-readable label
  if (node.child_ref?.tokenId) {
    return `Token #${node.child_ref.tokenId}`;
  }

  // Fall back to node_id or "Untitled"
  return node.node_id || "Untitled";
}

function createNodeElement(node, isChildWorld, depth = 0) {
  const el = document.createElement("div");
  el.className = "outliner-node";
  el.dataset.nodeId = node.node_id;
  el.dataset.depth = depth;
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
  let toggle;
  if (hasChildren) {
    const isCollapsed = collapsedNodeIds.has(node.node_id);
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "outliner-node-toggle";
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.setAttribute("aria-label", `${isCollapsed ? "Expand" : "Collapse"} ${getNodeDisplayName(node)}`);
    toggle.textContent = isCollapsed ? "▶" : "▼";
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      if (collapsedNodeIds.has(node.node_id)) {
        collapsedNodeIds.delete(node.node_id);
      } else {
        collapsedNodeIds.add(node.node_id);
      }
      renderTree(buildOutlineTree(getNodes()));
      getOutlinerTree()
        ?.querySelector(`[data-node-id="${CSS.escape(node.node_id)}"] .outliner-node-toggle`)
        ?.focus();
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
  icon.textContent = isChildWorld ? "🧩" : "📦";
  el.appendChild(icon);

  // Label
  const label = document.createElement("span");
  label.className = "outliner-node-label";
  label.textContent = getNodeDisplayName(node);
  el.appendChild(label);

  // Badge (token ID for child worlds)
  if (isChildWorld && node.child_ref?.tokenId) {
    const badge = document.createElement("span");
    badge.className = "outliner-node-badge";
    badge.textContent = `#${node.child_ref.tokenId}`;
    el.appendChild(badge);
  }

  // Click → select
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    selectNode(node.node_id);
  });

  // Double-click child → dive
  if (isChildWorld) {
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      diveIntoChild(node);
    });
  }

  // Drag start
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", node.node_id);
    e.dataTransfer.effectAllowed = "move";
  });

  return el;
}

function getOutlinerFooter() {
  return outlinerFooter || document.querySelector(".outliner-footer");
}

function updateFooter(totalNodes, childCount) {
  const footer = getOutlinerFooter();
  if (!footer) return;
  const depth = uiState.get().nestingDepth;
  footer.textContent = `${totalNodes} item${
    totalNodes !== 1 ? "s" : ""
  } · ${childCount} child${childCount !== 1 ? "ren" : ""} · Depth ${depth}/5`;
}

// ─── Selection ────────────────────────────────────────────────────────

function selectNode(nodeId) {
  // Deselect previous
  if (selectedNodeId) {
    const prev = getOutlinerTree()?.querySelector(
      `[data-node-id="${CSS.escape(selectedNodeId)}"]`
    );
    if (prev) prev.classList.remove("selected");
  }

  // Select new
  selectedNodeId = nodeId;
  const el = getOutlinerTree()?.querySelector(
    `[data-node-id="${CSS.escape(nodeId)}"]`
  );
  if (el) el.classList.add("selected");

  // Dispatch for inspector / viewport sync
  emit(EVENTS.OUTLINER_NODE_SELECTED, { nodeId });
}

function clearSelection() {
  if (selectedNodeId) {
    const el = getOutlinerTree()?.querySelector(
      `[data-node-id="${CSS.escape(selectedNodeId)}"]`
    );
    if (el) el.classList.remove("selected");
  }
  selectedNodeId = null;
}

// ─── Actions ──────────────────────────────────────────────────────────

function diveIntoChild(node) {
  if (!node.child_ref) return;
  emit(EVENTS.NESTING_DIVE_REQUESTED, {
    childRef: node.child_ref,
    nodeId: node.node_id,
  });
}

function onAddChild() {
  // Switch to library view so user can drag an asset
  switchView("library");
}

async function onRemoveSelected() {
  if (!selectedNodeId) return;
  emit(EVENTS.OUTLINER_REMOVE_REQUESTED, { nodeId: selectedNodeId });
}

// ─── Drag & Drop from Library ────────────────────────────────────────

function showDropTarget(e) {
  const target = e.target.closest(".outliner-node");
  hideDropTarget();
  if (target) {
    target.classList.add("drag-over");
  }
}

function hideDropTarget() {
  outlinerTree?.querySelectorAll(".outliner-node.drag-over").forEach((el) => {
    el.classList.remove("drag-over");
  });
}

function onDropFromLibrary(e) {
  e.preventDefault();
  hideDropTarget();

  const raw = e.dataTransfer.getData("application/x-arbesk-linked-asset");
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

function onSceneReady() {
  refreshOutliner();
}

function onSceneEmpty() {
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
