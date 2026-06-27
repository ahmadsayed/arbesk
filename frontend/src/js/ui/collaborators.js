// @ts-nocheck
/**
 * Arbesk Collaborator Manager - Studio read-only indicator
 *
 * The Studio only shows who can edit the current collection. Actual add/remove
 * management happens in the Library collection menu, which matches the
 * collection-level authorization model.
 */

import { initCollaboratorPanel } from "./collaborators-panel.js";
import { on, EVENTS } from "../events/bus.js";
import { assetState } from "../state/asset-state.js";
import { walletState } from "../state/wallet-state.js";

let teamPanel = null;
let currentPanel = null;

function initCollaborators() {
  teamPanel = document.getElementById("teamPanel");

  on(EVENTS.ASSET_PUBLISHED, refreshTeamPanel);
  on(EVENTS.WALLET_CONNECTED, refreshTeamPanel);
  on(EVENTS.ASSET_DRAFT_SAVED, refreshTeamPanel);
  on(EVENTS.SCENE_READY, refreshTeamPanel);
  on(EVENTS.WALLET_DISCONNECTED, () => {
    hideTeamPanel();
    currentPanel?.destroy();
    currentPanel = null;
  });
}

function showTeamPanel() {
  if (teamPanel) teamPanel.hidden = false;
}

function hideTeamPanel() {
  if (teamPanel) teamPanel.hidden = true;
}

async function refreshTeamPanel() {
  const tokenId = assetState.get().activeAssetTokenId;
  if (!tokenId || !walletState.get().walletAddress) {
    hideTeamPanel();
    return;
  }

  showTeamPanel();

  const tokenIdStr = String(tokenId);
  if (!currentPanel || currentPanel.tokenId !== tokenIdStr) {
    currentPanel?.destroy();
    const panel = initCollaboratorPanel(teamPanel, tokenIdStr, { editable: false });
    panel.tokenId = tokenIdStr;
    currentPanel = panel;
  } else {
    await currentPanel.refresh();
  }
}

export { initCollaborators, refreshTeamPanel };
