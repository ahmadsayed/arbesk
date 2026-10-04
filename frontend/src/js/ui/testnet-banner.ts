/**
 * Testnet banner and header network status.
 * @remarks The banner reveals `#testnetBanner` when the backend reports a
 *   testnet default chain (Base Sepolia) via /api/v1/config — i.e. on the
 *   public k3s deployment and `start-prod.sh --testnet`. The header status
 *   (`#networkStatus`) shows on any non-mainnet default chain, local dev
 *   (Hardhat) included, as a dot plus a visible text label.
 */
import { CHAIN_IDS } from "../../../../constants/chains.js";
import { getConfig } from "../services/backend-client.ts";

export async function initTestnetBanner(): Promise<void> {
  const banner = document.getElementById("testnetBanner");
  if (!banner) return;
  const config = await getConfig();
  if (Number(config?.defaultChainId) === CHAIN_IDS.BASE_TESTNET) {
    banner.classList.add("visible");
  }
}

const NETWORK_STATUS: Record<number, { label: string; title: string }> = {
  [CHAIN_IDS.BASE_TESTNET]: { label: "Testnet", title: "Base Sepolia Testnet" },
  [CHAIN_IDS.HARDHAT_LOCAL]: { label: "Local", title: "Hardhat Local" },
};

/**
 * Header network status: a dot plus a visible text label (never colour
 * alone — WCAG 1.4.1), shown only for non-mainnet deployments.
 * @remarks Clicking opens the account menu (where the network select lives)
 *   when signed in, otherwise starts sign-in.
 */
export async function initNetworkStatus(): Promise<void> {
  const el = document.getElementById("networkStatus");
  if (!el || el.dataset.networkStatusInit) return;
  // Claim synchronously and attach the listener before the first await:
  // the module self-init and an explicit call must not double-register.
  el.dataset.networkStatusInit = "1";
  el.addEventListener("click", () => {
    const avatar = document.getElementById("disconnectWalletBtn");
    if (avatar && !avatar.classList.contains("hidden")) avatar.click();
    else document.getElementById("connectWalletBtn")?.click();
  });

  const config = await getConfig();
  const info = NETWORK_STATUS[Number(config?.defaultChainId)];
  if (!info) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.title = info.title;
  el.setAttribute("aria-label", `Network: ${info.title}`);
  const label = el.querySelector(".network-status-label");
  if (label) label.textContent = info.label;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initTestnetBanner().catch(() => {});
    initNetworkStatus().catch(() => {});
  });
} else {
  initTestnetBanner().catch(() => {});
  initNetworkStatus().catch(() => {});
}
