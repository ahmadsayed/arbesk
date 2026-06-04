/**
 * Arbesk Outliner — Scene Hierarchy Tree
 *
 * Renders the scene graph from the current level's manifest.
 * Click to select, double-click child worlds to dive in.
 * Supports drag reorder and drag-from-library to add children.
 */

import { switchView } from "./sidebar.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";

const DEPTH_INDENT = 1; // rem per level

let outlinerTree = null;
let outlinerFooter = null;
let selectedNodeId = null;

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
  document.addEventListener("scene:ready", onSceneReady);
  document.addEventListener("scene:empty", onSceneEmpty);
  document.addEventListener("asset:draftSaved", () => refreshOutliner());

  // Drag-and-drop from library
  outlinerTree.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    showDropTarget(e);
  });

  outlinerTree.addEventListener("dragleave", hideDropTarget);
  outlinerTree.addEventListener("drop", onDropFromLibrary);

  // Initial render if manifest is already loaded
  if (window.activeAssetManifestCid) {
    refreshOutliner();
  }
}

// ─── Data ─────────────────────────────────────────────────────────────

async function getCurrentManifest() {
  if (!window.activeAssetManifestCid) return null;
  try {
    return await getFromRemoteIPFS(window.activeAssetManifestCid);
  } catch {
    return null;
  }
}

function getNodes() {
  const manifest = window._currentManifest;
  if (!manifest?.scene?.nodes) return [];
  return manifest.scene.nodes;
}

// ─── Rendering ────────────────────────────────────────────────────────

async function refreshOutliner() {
  const manifest = await getCurrentManifest();
  if (!manifest) {
    renderEmpty();
    return;
  }
  window._currentManifest = manifest;
  renderTree(getNodes());
}

function renderEmpty() {
  if (!outlinerTree) return;
  outlinerTree.innerHTML = "";
  if (outlinerFooter) outlinerFooter.textContent = "No items";
}

function renderTree(nodes, depth = 0) {
  if (!outlinerTree) return;
  outlinerTree.innerHTML = "";

  if (nodes.length === 0) {
    outlinerTree.innerHTML =
      '<div class="ledger-empty">No items in this world</div>';
    updateFooter(0, 0);
    return;
  }

  let childCount = 0;
  const fragment = document.createDocumentFragment();

  nodes.forEach((node) => {
    const isChild = !!node.child_ref;
    if (isChild) childCount++;

    const el = createNodeElement(node, isChild, depth);
    fragment.appendChild(el);
  });

  outlinerTree.appendChild(fragment);
  updateFooter(nodes.length, childCount);
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

function createNodeElement(node, isChildWorld, depth) {
  const el = document.createElement("div");
  el.className = "outliner-node";
  el.dataset.nodeId = node.node_id;
  el.dataset.depth = depth;
  el.draggable = true;

  // Icon
  const icon = document.createElement("span");
  icon.className = "outliner-node-icon";
  icon.textContent = isChildWorld ? "🧩" : "📦";
  el.appendChild(icon);

  // Label — prefer display name, fall back to token descriptor, then node_id
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

function updateFooter(totalNodes, childCount) {
  if (!outlinerFooter) return;
  const depth = window._nestingDepth || 0;
  outlinerFooter.textContent = `${totalNodes} item${
    totalNodes !== 1 ? "s" : ""
  } · ${childCount} child${childCount !== 1 ? "ren" : ""} · Depth ${depth}/5`;
}

// ─── Selection ────────────────────────────────────────────────────────

function selectNode(nodeId) {
  // Deselect previous
  if (selectedNodeId) {
    const prev = outlinerTree?.querySelector(
      `[data-node-id="${CSS.escape(selectedNodeId)}"]`
    );
    if (prev) prev.classList.remove("selected");
  }

  // Select new
  selectedNodeId = nodeId;
  const el = outlinerTree?.querySelector(
    `[data-node-id="${CSS.escape(nodeId)}"]`
  );
  if (el) el.classList.add("selected");

  // Dispatch for inspector / viewport sync
  document.dispatchEvent(
    new CustomEvent("outliner:nodeSelected", { detail: { nodeId } })
  );
}

function clearSelection() {
  if (selectedNodeId) {
    const el = outlinerTree?.querySelector(
      `[data-node-id="${CSS.escape(selectedNodeId)}"]`
    );
    if (el) el.classList.remove("selected");
  }
  selectedNodeId = null;
}

// ─── Actions ──────────────────────────────────────────────────────────

function diveIntoChild(node) {
  if (!node.child_ref) return;
  document.dispatchEvent(
    new CustomEvent("nesting:diveRequested", {
      detail: { childRef: node.child_ref, nodeId: node.node_id },
    })
  );
}

function onAddChild() {
  // Switch to library view so user can drag an asset
  switchView("library");
}

async function onRemoveSelected() {
  if (!selectedNodeId) return;
  document.dispatchEvent(
    new CustomEvent("outliner:removeRequested", {
      detail: { nodeId: selectedNodeId },
    })
  );
}

// ─── Drag & Drop from Library ────────────────────────────────────────

function showDropTarget(e) {
  const target = e.target.closest(".outliner-node");
  hideDropTarget();
  if (target) {
    target.classList.add("outliner-drop-target", "active");
  }
}

function hideDropTarget() {
  outlinerTree?.querySelectorAll(".outliner-drop-target").forEach((el) => {
    el.classList.remove("active");
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
      document.dispatchEvent(
        new CustomEvent("asset:linkedDropped", {
          detail: {
            type: "linked_asset",
            token_id: String(payload.token_id),
            standard: payload.standard || "ERC721",
            resolution: payload.resolution || "latest",
            chainId: payload.chainId,
            contractAddress: payload.contractAddress,
          },
        })
      );
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
}

// ─── Exports ─────────────────────────────────────────────────────────

export { initOutliner, refreshOutliner, selectNode, clearSelection };
