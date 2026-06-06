/**
 * Arbesk Collaborator Manager
 *
 * Manages the team panel: add/remove collaborators with roles,
 * toggle burn permissions, and the burn button in the headerbar.
 * Wires to the ArbeskAsset contract via wallet.js.
 */

import {
  addEditor,
  addCollaboratorWithRole,
  removeEditor,
  setCollaboratorRole,
  getCollaboratorRole,
  listCollaboratorsByRole,
  burn,
  setBurnPermission,
  canBurn,
  CollaboratorRole,
} from "../blockchain/wallet.js";
import { showDialog } from "./dialog.js";

// ─── DOM refs ──────────────────────────────────────────────────────────

let teamPanel = null;
let teamList = null;
let teamAddInput = null;
let teamRoleSelect = null;
let teamAddBtn = null;
let teamOwnerBadge = null;
let burnAssetBtn = null;

// ─── Init ──────────────────────────────────────────────────────────────

function initCollaborators() {
  teamPanel = document.getElementById("teamPanel");
  teamList = document.getElementById("teamList");
  teamAddInput = document.getElementById("teamAddInput");
  teamRoleSelect = document.getElementById("teamRoleSelect");
  teamAddBtn = document.getElementById("teamAddBtn");
  teamOwnerBadge = document.getElementById("teamOwnerBadge");
  burnAssetBtn = document.getElementById("burnAssetBtn");

  if (teamAddBtn) {
    teamAddBtn.addEventListener("click", onAddCollaborator);
  }

  if (burnAssetBtn) {
    burnAssetBtn.addEventListener("click", onBurnAsset);
  }

  // Refresh team panel when asset loads or publishes
  document.addEventListener("asset:published", () => refreshTeamPanel());
  document.addEventListener("wallet:connected", () => refreshTeamPanel());
  document.addEventListener("asset:draftSaved", () => refreshTeamPanel());
  document.addEventListener("scene:ready", () => refreshTeamPanel());
}

// ─── Visibility ────────────────────────────────────────────────────────

function showTeamPanel() {
  if (teamPanel) teamPanel.hidden = false;
  if (burnAssetBtn) {
    burnAssetBtn.hidden = !window.activeAssetTokenId;
  }
}

function hideTeamPanel() {
  if (teamPanel) teamPanel.hidden = true;
  if (burnAssetBtn) burnAssetBtn.hidden = true;
}

// Called from asset-save.js after publish
function updateBurnButton() {
  if (!burnAssetBtn) return;
  burnAssetBtn.hidden = !window.activeAssetTokenId;
}

// ─── Data ──────────────────────────────────────────────────────────────

async function refreshTeamPanel() {
  const tokenId = window.activeAssetTokenId;
  if (!tokenId || !window.walletAddress) {
    hideTeamPanel();
    return;
  }
  showTeamPanel();

  // Mark owner
  if (teamOwnerBadge) {
    teamOwnerBadge.hidden = false;
    teamOwnerBadge.textContent = "Owner";
  }

  try {
    const [editors, viewers] = await Promise.all([
      listCollaboratorsByRole(tokenId, CollaboratorRole.Editor),
      listCollaboratorsByRole(tokenId, CollaboratorRole.Viewer),
    ]);

    // Get burn permissions for all collaborators
    const burnPerms = {};
    const allCollaborators = [...(editors || []), ...(viewers || [])];
    await Promise.all(
      allCollaborators.map(async (addr) => {
        const perm = await canBurn(tokenId, addr);
        burnPerms[addr.toLowerCase()] = perm;
      })
    );

    renderTeamList(editors || [], viewers || [], burnPerms);
  } catch {
    // Silently fail — contract may not be on current network
    if (teamList) teamList.innerHTML = "";
  }
}

// ─── Rendering ─────────────────────────────────────────────────────────

function renderTeamList(editors, viewers, burnPerms) {
  if (!teamList) return;

  teamList.innerHTML = "";

  const createItem = (addr, role, roleLabel, canBurnFlag) => {
    const el = document.createElement("div");
    el.className = "team-item";
    el.dataset.address = addr;

    const addrDisplay =
      addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

    const roleBadge = document.createElement("span");
    roleBadge.className = `team-role-badge team-role-${roleLabel.toLowerCase()}`;
    roleBadge.textContent = roleLabel;

    const addrSpan = document.createElement("span");
    addrSpan.className = "team-addr";
    addrSpan.textContent = addrDisplay;

    const actions = document.createElement("div");
    actions.className = "team-actions";

    // Burn permission toggle (editors only)
    if (role === CollaboratorRole.Editor) {
      const burnBtn = document.createElement("button");
      burnBtn.className = "btn btn-icon btn-xs";
      burnBtn.title = canBurnFlag
        ? "Revoke burn permission"
        : "Grant burn permission";
      burnBtn.textContent = canBurnFlag ? "🔥" : "🔥";
      burnBtn.style.opacity = canBurnFlag ? "1" : "0.3";
      burnBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await setBurnPermission(tokenId(), addr, !canBurnFlag);
        refreshTeamPanel();
      });
      actions.appendChild(burnBtn);
    }

    // Role change button
    const roleBtn = document.createElement("button");
    roleBtn.className = "btn btn-icon btn-xs";
    roleBtn.title =
      role === CollaboratorRole.Editor
        ? "Downgrade to Viewer"
        : "Upgrade to Editor";
    roleBtn.textContent = role === CollaboratorRole.Editor ? "▼" : "▲";
    roleBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const newRole =
        role === CollaboratorRole.Editor
          ? CollaboratorRole.Viewer
          : CollaboratorRole.Editor;
      await setCollaboratorRole(tokenId(), addr, newRole);
      refreshTeamPanel();
    });
    actions.appendChild(roleBtn);

    // Remove button
    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-icon btn-xs btn-danger";
    removeBtn.title = "Remove collaborator";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeEditor(tokenId(), addr);
      refreshTeamPanel();
    });
    actions.appendChild(removeBtn);

    el.appendChild(roleBadge);
    el.appendChild(addrSpan);
    el.appendChild(actions);

    // Click to select
    el.addEventListener("click", () => {
      teamList
        .querySelectorAll(".team-item")
        .forEach((i) => i.classList.remove("team-item-selected"));
      el.classList.add("team-item-selected");
    });

    return el;
  };

  const fragment = document.createDocumentFragment();

  editors.forEach((addr) => {
    if (addr.toLowerCase() === (window.walletAddress || "").toLowerCase())
      return;
    fragment.appendChild(
      createItem(
        addr,
        CollaboratorRole.Editor,
        "Editor",
        burnPerms[addr.toLowerCase()]
      )
    );
  });

  viewers.forEach((addr) => {
    if (addr.toLowerCase() === (window.walletAddress || "").toLowerCase())
      return;
    fragment.appendChild(
      createItem(addr, CollaboratorRole.Viewer, "Viewer", false)
    );
  });

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
  return window.activeAssetTokenId;
}

// ─── Handlers ──────────────────────────────────────────────────────────

async function onAddCollaborator() {
  const addr = teamAddInput?.value?.trim();
  if (!addr) return;

  const role = parseInt(teamRoleSelect?.value || "2", 10);
  if (role !== CollaboratorRole.Viewer && role !== CollaboratorRole.Editor)
    return;

  const txHash = await addCollaboratorWithRole(tokenId(), addr, role);
  if (txHash) {
    teamAddInput.value = "";
    refreshTeamPanel();
  }
}

async function onBurnAsset() {
  const id = tokenId();
  if (!id) return;

  const confirmed = await showDialog(
    "Burn Asset",
    `Are you sure you want to permanently burn token #${id}? This cannot be undone. All collaborators will be removed and the token will cease to exist.`,
    [
      { text: "Cancel", value: "cancel" },
      { text: "Burn Token", value: "burn", className: "btn-danger" },
    ]
  );

  if (confirmed !== "burn") return;

  const txHash = await burn(id);
  if (txHash) {
    // Clear active asset state
    window.activeAssetTokenId = null;
    window.activeAssetManifestCid = null;
    hideTeamPanel();
    if (burnAssetBtn) burnAssetBtn.hidden = true;
    document.dispatchEvent(new CustomEvent("asset:cleared"));
  }
}

// ─── Exports ───────────────────────────────────────────────────────────

export { initCollaborators, refreshTeamPanel, updateBurnButton };

