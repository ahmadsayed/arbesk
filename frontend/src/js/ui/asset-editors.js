/**
 * Arbesk Team Panel UI Controller
 *
 * Manages the Asset Editors list in the Settings panel.
 */

import {
  fetchEditors,
  isOwner,
  addTeamMember,
  removeTeamMember,
} from "../services/team.js";

// DOM references
const teamPanel = document.getElementById("teamPanel");
const teamList = document.getElementById("teamList");
const teamAddInput = document.getElementById("teamAddInput");
const teamAddBtn = document.getElementById("teamAddBtn");
const teamOwnerBadge = document.getElementById("teamOwnerBadge");
const settingsToggle = document.getElementById("toggleAssetDef");
const settingsBody = document.querySelector(".asset-def-body");

let activeAssetTokenId = null;
let owner = false;

function truncateAddr(addr) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

async function refreshEditors() {
  if (!teamPanel || !activeAssetTokenId) return;

  const editors = await fetchEditors(activeAssetTokenId);
  owner = await isOwner(activeAssetTokenId);

  if (teamOwnerBadge) {
    teamOwnerBadge.hidden = !owner;
  }

  if (!teamList) return;
  teamList.innerHTML = "";

  if (editors.length === 0) {
    teamList.innerHTML = '<p class="team-empty">No editors yet.</p>';
    return;
  }

  for (const addr of editors) {
    const row = document.createElement("div");
    row.className = "team-row";

    const label = document.createElement("span");
    label.className = "team-address";
    label.textContent = truncateAddr(addr);
    label.title = addr;
    row.appendChild(label);

    if (owner && addr.toLowerCase() !== window.walletAddress?.toLowerCase()) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn-team-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove editor";
      removeBtn.addEventListener("click", async () => {
        try {
          removeBtn.disabled = true;
          await removeTeamMember(activeAssetTokenId, addr);
          await refreshEditors();
        } catch (err) {
          alert("Remove failed: " + err.message);
          removeBtn.disabled = false;
        }
      });
      row.appendChild(removeBtn);
    }

    teamList.appendChild(row);
  }
}

async function onAddEditor() {
  if (!activeAssetTokenId || !teamAddInput) return;
  const address = teamAddInput.value.trim();
  if (!address) return;

  try {
    teamAddBtn.disabled = true;
    await addTeamMember(activeAssetTokenId, address);
    teamAddInput.value = "";
    await refreshEditors();
  } catch (err) {
    alert("Add editor failed: " + err.message);
  } finally {
    teamAddBtn.disabled = false;
  }
}

function openSettingsPanel() {
  if (!settingsToggle || !settingsBody) return;
  settingsBody.hidden = false;
  settingsToggle.classList.add("open");
}

function showAssetEditors(tokenId) {
  activeAssetTokenId = tokenId;
  if (teamPanel) {
    teamPanel.hidden = false;
    openSettingsPanel();
    refreshEditors();
  }
}

function hideAssetEditors() {
  activeAssetTokenId = null;
  if (teamPanel) teamPanel.hidden = true;
}

// Event bindings
if (teamAddBtn) {
  teamAddBtn.addEventListener("click", onAddEditor);
}

if (teamAddInput) {
  teamAddInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAddEditor();
  });
}

// Listen for mint success to reveal panel
document.addEventListener("asset:published", (e) => {
  const tokenId = e.detail?.tokenId;
  if (tokenId) showAssetEditors(tokenId);
});

// Listen for scene:ready to check if an existing token matches manifest
// (Future enhancement: map manifest CID → tokenId via contract events or backend index)

export { showAssetEditors, hideAssetEditors, refreshEditors };
