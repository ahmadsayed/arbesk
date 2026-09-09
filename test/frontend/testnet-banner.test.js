/**
 * @jest-environment jsdom
 *
 * testnet-banner: reveals #testnetBanner only when the backend reports
 * Base Sepolia (84532) as the default chain — public testnet deployments
 * show it, local dev (Hardhat) does not.
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

async function loadModule(config) {
  jest.resetModules();
  await jest.unstable_mockModule(
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
