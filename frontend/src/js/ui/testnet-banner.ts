/**
 * Testnet banner.
 * @remarks Reveals `#testnetBanner` when the backend reports a testnet
 *   default chain (Base Sepolia) via /api/v1/config — i.e. on the public
 *   k3s deployment and `start-prod.sh --testnet`. Local dev (Hardhat)
 *   never shows it.
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { initTestnetBanner().catch(() => {}); });
} else {
  initTestnetBanner().catch(() => {});
}
