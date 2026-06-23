/**
 * Arbesk Collaborator Manager — Merkle Architecture
 *
 * Manages the team panel: add/remove collaborators with roles and burn.
 * Editor list is stored on IPFS; on-chain only has the Merkle root.
 * Wires to wallet.js (contract calls) and merkle-editors.js (proofs).
 */

import { updateEditors, CollaboratorRole } from "../blockchain/wallet.js";
import { computeRoot, getProof } from "../gltf/merkle-editors.js";
import { getFromRemoteIPFS } from "../ipfs/remote-ipfs.js";
import { writeToIPFS } from "../ipfs/write-to-ipfs.js";
import { showConfirmDialog } from "./dialog.js";
import { truncateAddress } from "../utils/format.js";
import { showToast } from "./toasts.js";
import { emit, on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";

// ─── DOM refs ──────────────────────────────────────────────────────────

let teamPanel = null;
let teamList = null;
let teamAddInput = null;
let teamRoleSelect = null;
let teamAddBtn = null;
let teamOwnerBadge = null;

// ─── Editor list cache (tokenId → { list, cid }) ──────────────────────

const editorCache = new Map();

// ─── Init ──────────────────────────────────────────────────────────────

function initCollaborators() {
  teamPanel = document.getElementById("teamPanel");
  teamList = document.getElementById("teamList");
  teamAddInput = document.getElementById("teamAddInput");
  teamRoleSelect = document.getElementById("teamRoleSelect");
  teamAddBtn = document.getElementById("teamAddBtn");
  teamOwnerBadge = document.getElementById("teamOwnerBadge");

  if (teamAddBtn) {
    teamAddBtn.addEventListener("click", onAddCollaborator);
  }

  on(EVENTS.ASSET_PUBLISHED, () => refreshTeamPanel());
  on(EVENTS.WALLET_CONNECTED, () => refreshTeamPanel());
  on(EVENTS.ASSET_DRAFT_SAVED, () => refreshTeamPanel());
  on(EVENTS.SCENE_READY, () => refreshTeamPanel());
}

// ─── Visibility ────────────────────────────────────────────────────────

function showTeamPanel() {
  if (teamPanel) teamPanel.hidden = false;
}

function hideTeamPanel() {
  if (teamPanel) teamPanel.hidden = true;
}

// ─── Editor list storage ───────────────────────────────────────────────

function editorListKey(tokenId) {
  return `arbesk_editor_list_${tokenId}`;
}

async function loadEditorList(tokenId) {
  // Check cache first
  if (editorCache.has(tokenId)) return editorCache.get(tokenId);

  // Try localStorage
  try {
    const stored = localStorage.getItem(editorListKey(tokenId));
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.cid) {
        try {
          const fresh = await getFromRemoteIPFS(parsed.cid);
          if (Array.isArray(fresh)) {
            saveEditorList(tokenId, fresh, parsed.cid);
            return fresh;
          }
        } catch {
          /* use cached */
        }
      }
      if (Array.isArray(parsed.list)) {
        editorCache.set(tokenId, parsed.list);
        return parsed.list;
      }
    }
  } catch {
    /* unavailable */
  }
  return null;
}

function saveEditorList(tokenId, list, ipfsCid) {
  editorCache.set(tokenId, list);
  try {
    localStorage.setItem(
      editorListKey(tokenId),
      JSON.stringify({
        list,
        cid: ipfsCid || null,
        saved: Date.now(),
      })
    );
  } catch {
    /* quota exceeded, non-critical */
  }
}

async function getSetVersion(tokenId) {
  try {
    const { contract } = await import("../blockchain/wallet.js");
    const c = contract || walletState.get().contract;
    if (!c) return 1;
    return Number(await c.methods.editorSetVersion(tokenId).call());
  } catch {
    return 1;
  }
}

// ─── Data ──────────────────────────────────────────────────────────────

async function refreshTeamPanel() {
  const tokenId = assetState.get().activeAssetTokenId;
  if (!tokenId || !walletState.get().walletAddress) {
    hideTeamPanel();
    return;
  }
  showTeamPanel();

  if (teamOwnerBadge) {
    teamOwnerBadge.hidden = false;
    teamOwnerBadge.textContent = "Editors";
  }

  try {
    const editorList = await loadEditorList(tokenId);
    if (editorList) {
      renderTeamList(editorList);
    } else if (teamList) {
      teamList.innerHTML = "";
    }
  } catch {
    if (teamList) teamList.innerHTML = "";
  }
}

// ─── Rendering ─────────────────────────────────────────────────────────

function renderTeamList(editorList) {
  if (!teamList) return;

  teamList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const selfAddr = (walletState.get().walletAddress || "").toLowerCase();

  for (const entry of editorList) {
    // Skip self
    if (entry.address.toLowerCase() === selfAddr) continue;

    const el = document.createElement("div");
    el.className = "team-item";
    el.dataset.address = entry.address;

    const roleLabel =
      entry.role === CollaboratorRole.Editor ? "Editor" : "Viewer";

    const roleBadge = document.createElement("span");
    roleBadge.className = `team-role-badge team-role-${roleLabel.toLowerCase()}`;
    roleBadge.textContent = roleLabel;

    const addrSpan = document.createElement("span");
    addrSpan.className = "team-addr";
    addrSpan.textContent = truncateAddress(entry.address);

    const actions = document.createElement("div");
    actions.className = "team-actions";

    // Role toggle
    const roleBtn = document.createElement("button");
    roleBtn.className = "btn btn-icon btn-xs";
    roleBtn.title =
      entry.role === CollaboratorRole.Editor
        ? "Downgrade to Viewer"
        : "Upgrade to Editor";
    roleBtn.textContent = entry.role === CollaboratorRole.Editor ? "▼" : "▲";
    roleBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newRole =
        entry.role === CollaboratorRole.Editor
          ? CollaboratorRole.Viewer
          : CollaboratorRole.Editor;
      await changeCollaboratorRole(tokenId(), entry.address, newRole);
    });
    actions.appendChild(roleBtn);

    // Remove button
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-icon btn-xs btn-danger";
    removeBtn.title = "Remove collaborator";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeCollaborator(tokenId(), entry.address);
    });
    actions.appendChild(removeBtn);

    el.appendChild(roleBadge);
    el.appendChild(addrSpan);
    el.appendChild(actions);

    el.addEventListener("click", () => {
      teamList
        .querySelectorAll(".team-item")
        .forEach((i) => i.classList.remove("team-item-selected"));
      el.classList.add("team-item-selected");
    });

    fragment.appendChild(el);
  }

  if (!fragment.childNodes.length) {
    const empty = document.createElement("p");
    empty.className = "team-empty";
    empty.textContent = "No collaborators yet.";
    fragment.appendChild(empty);
  }

  teamList.appendChild(fragment);
}

// ─── Token ID Helper ───────────────────────────────────────────────────

function tokenId() {
  return assetState.get().activeAssetTokenId;
}

// ─── Merkle-based Edit Operations ──────────────────────────────────────

/**
 * Add a collaborator. Fetches current editor list, appends entry,
 * computes new Merkle root, gets caller proof, submits updateEditors.
 */
async function onAddCollaborator() {
  const addr = teamAddInput?.value?.trim();
  if (!addr) return;

  const role = parseInt(teamRoleSelect?.value || "2", 10);
  if (role !== CollaboratorRole.Viewer && role !== CollaboratorRole.Editor)
    return;

  const id = tokenId();
  if (!id) return;

  const currentList = await loadEditorList(id);
  if (!currentList) {
    showToast({
      type: "error",
      title: "Error",
      message: "Cannot load editor list.",
    });
    return;
  }

  // Check not already in list
  if (currentList.some((e) => e.address.toLowerCase() === addr.toLowerCase())) {
    showToast({
      type: "info",
      title: "Already Added",
      message: "This address is already a collaborator.",
    });
    return;
  }

  const newList = [...currentList, { address: addr, role }];
  await applyEditorSetChange(id, currentList, newList);
  teamAddInput.value = "";
}

async function removeCollaborator(id, addr) {
  const currentList = await loadEditorList(id);
  if (!currentList) return;

  const newList = currentList.filter(
    (e) => e.address.toLowerCase() !== addr.toLowerCase()
  );
  if (newList.length === currentList.length) return; // not found
  if (newList.length === 0) {
    showToast({
      type: "error",
      title: "Error",
      message: "Cannot remove the last editor.",
    });
    return;
  }

  await applyEditorSetChange(id, currentList, newList);
}

async function changeCollaboratorRole(id, addr, newRole) {
  const currentList = await loadEditorList(id);
  if (!currentList) return;

  const newList = currentList.map((e) =>
    e.address.toLowerCase() === addr.toLowerCase() ? { ...e, role: newRole } : e
  );

  await applyEditorSetChange(id, currentList, newList);
}

/**
 * Apply a Merkle editor set change: compute new root, get caller proof,
 * submit to contract, and store updated list on IPFS + localStorage.
 */
async function applyEditorSetChange(tokenId, currentList, newList) {
  const walletAddr = walletState.get().walletAddress;
  if (!walletAddr) return;

  // Get current on-chain version
  const currentVersion = await getSetVersion(tokenId);
  const nextVersion = currentVersion + 1;

  // Get proof that caller is in the CURRENT tree (before the change)
  const callerProof = getProof(
    currentList,
    walletAddr,
    tokenId,
    currentVersion
  );
  if (!callerProof) {
    showToast({
      type: "error",
      title: "Permission Denied",
      message: "You are not an editor of this token.",
    });
    return;
  }

  // Compute new root for the updated list
  const newRoot = computeRoot(newList, tokenId, nextVersion);

  // Store new list on IPFS
  let newCid = "";
  try {
    const json = JSON.stringify(newList);
    const blob = new Blob([json], { type: "application/json" });
    newCid = await writeToIPFS(blob, `editors_token_${tokenId}_v${nextVersion}.json`, null, {
      compress: true,
    });
  } catch (e) {
    console.warn("Failed to store editor list on IPFS:", e.message);
  }

  // Submit to contract
  const txHash = await updateEditors(
    tokenId,
    newRoot,
    newCid || "",
    CollaboratorRole.Editor,
    callerProof.proof
  );

  if (txHash) {
    saveEditorList(tokenId, newList, newCid);
    refreshTeamPanel();
  }
}

// ─── Exports ───────────────────────────────────────────────────────────

export { initCollaborators, refreshTeamPanel };
