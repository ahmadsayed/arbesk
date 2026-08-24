/**
 * Arbesk Collaborator Manager - Studio read-only indicator
 *
 * The Studio only shows who can edit the current collection. Actual add/remove
 * management happens in the Library collection menu, which matches the
 * collection-level authorization model.
 */

import { initCollaboratorPanel } from "./collaborators-panel.ts";
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { getActiveAssetTokenId } from "@arbesk/asset-core/domain/asset.js";
import { walletState } from "../state/wallet-state.ts";

let teamPanel: HTMLElement | null = null;
let currentPanel: (ReturnType<typeof initCollaboratorPanel> & { tokenId?: string }) | null = null;

function initCollaborators(): void {
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

function showTeamPanel(): void {
  if (teamPanel) teamPanel.hidden = false;
}

function hideTeamPanel(): void {
  if (teamPanel) teamPanel.hidden = true;
}

async function refreshTeamPanel(): Promise<void> {
  const tokenId = getActiveAssetTokenId();
  if (!tokenId || !walletState.get().walletAddress) {
    hideTeamPanel();
    return;
  }

  showTeamPanel();

  const tokenIdStr = String(tokenId);
  if (!currentPanel || currentPanel.tokenId !== tokenIdStr) {
    currentPanel?.destroy();
    const panel = initCollaboratorPanel(teamPanel as HTMLElement, tokenIdStr, { editable: false });
    (panel as any).tokenId = tokenIdStr;
    currentPanel = panel;
  } else {
    await currentPanel.refresh();
  }
}

export { initCollaborators, refreshTeamPanel };
