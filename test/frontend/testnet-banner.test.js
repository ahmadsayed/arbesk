// @test-env dom
/**
 * testnet-banner: reveals #testnetBanner only when the backend reports
 * Base Sepolia (84532) as the default chain — public testnet deployments
 * show it, local dev (Hardhat) does not.
 */

import { beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
async function loadModule(config) {
  resetModules();
  await mock.module(
    "../../frontend/src/js/services/backend-client.js",
    () => ({ getConfig: jest.fn().mockResolvedValue(config) })
  );
  return import("../../frontend/src/js/ui/testnet-banner.js");
}

describe("initTestnetBanner", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="testnetBanner" class="testnet-banner"></div>';
  });

  test("shows the banner on Base Sepolia", async () => {
    const mod = await loadModule({ defaultChainId: 84532 });
    await mod.initTestnetBanner();
    expect(document.getElementById("testnetBanner").classList.contains("visible")).toBe(true);
  });

  test("stays hidden on Hardhat local", async () => {
    const mod = await loadModule({ defaultChainId: 31337 });
    await mod.initTestnetBanner();
    expect(document.getElementById("testnetBanner").classList.contains("visible")).toBe(false);
  });

  test("stays hidden when config is unavailable", async () => {
    const mod = await loadModule(null);
    await mod.initTestnetBanner();
    expect(document.getElementById("testnetBanner").classList.contains("visible")).toBe(false);
  });

  test("no banner element is a no-op", async () => {
    document.body.innerHTML = "";
    const mod = await loadModule({ defaultChainId: 84532 });
    await expect(mod.initTestnetBanner()).resolves.toBeUndefined();
  });
});

describe("initNetworkStatus", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="networkStatus" class="network-status" hidden><span class="network-status-dot"></span><span class="network-status-label"></span></button>
      <button id="disconnectWalletBtn" class="hidden"></button>
      <button id="connectWalletBtn"></button>`;
  });

  test("Base Sepolia shows a visible 'Testnet' label with the full name as title", async () => {
    const mod = await loadModule({ defaultChainId: 84532 });
    await mod.initNetworkStatus();
    const el = document.getElementById("networkStatus");
    expect(el.hidden).toBe(false);
    expect(el.querySelector(".network-status-label").textContent).toBe("Testnet");
    expect(el.title).toBe("Base Sepolia Testnet");
    expect(el.getAttribute("aria-label")).toBe("Network: Base Sepolia Testnet");
  });

  test("Hardhat local shows 'Local'", async () => {
    const mod = await loadModule({ defaultChainId: 31415822 });
    await mod.initNetworkStatus();
    expect(document.querySelector(".network-status-label").textContent).toBe("Local");
  });

  test("unknown or missing chain stays hidden", async () => {
    const mod = await loadModule(null);
    await mod.initNetworkStatus();
    expect(document.getElementById("networkStatus").hidden).toBe(true);
  });

  test("click opens the account menu when signed in, else sign-in", async () => {
    const mod = await loadModule({ defaultChainId: 84532 });
    await mod.initNetworkStatus();
    const avatar = document.getElementById("disconnectWalletBtn");
    const signin = document.getElementById("connectWalletBtn");
    const a = jest.fn(); const s = jest.fn();
    avatar.addEventListener("click", a);
    signin.addEventListener("click", s);
    document.getElementById("networkStatus").click();
    expect(s).toHaveBeenCalledTimes(1);
    avatar.classList.remove("hidden");
    document.getElementById("networkStatus").click();
    expect(a).toHaveBeenCalledTimes(1);
  });
});
