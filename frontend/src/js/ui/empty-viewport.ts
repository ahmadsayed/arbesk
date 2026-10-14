/**
 * Empty-viewport card: guidance shown over the canvas while no asset is open.
 * @remarks Plain DOM, not Babylon chrome. Without a wallet (or in visitor
 *   mode) New ▾ is hidden, so the action buttons are hidden with it.
 */
import { on, EVENTS } from "@arbesk/asset-core/events/bus.js";
import { hasOpenAsset } from "../state/edit-mode.ts";

function render(): void {
  const card = document.getElementById("emptyViewport");
  if (!card) return;
  card.hidden = hasOpenAsset();
  const canCreate = !document.getElementById("newMenuBtn")?.hidden;
  const actions = card.querySelector<HTMLElement>(".empty-viewport-actions");
  if (actions) actions.hidden = !canCreate;
}

function forward(buttonId: string, targetId: string): void {
  document.getElementById(buttonId)?.addEventListener("click", () => {
    document.getElementById(targetId)?.click();
  });
}

function initEmptyViewport(): void {
  forward("emptyViewportUpload", "newMenuUpload");
  forward("emptyViewportEmpty", "newAssetBtn");
  for (const type of [
    EVENTS.ASSET_STATE_CHANGED,
    EVENTS.PENDING_EDITS_CHANGED,
    EVENTS.SCENE_EMPTY,
    EVENTS.SCENE_READY,
    EVENTS.WALLET_STATE_CHANGED,
    EVENTS.WALLET_CONNECTED,
    EVENTS.WALLET_DISCONNECTED,
    EVENTS.LIBRARY_STATE_CHANGED,
  ]) {
    on(type, render);
  }
  render();
}

export { initEmptyViewport };
