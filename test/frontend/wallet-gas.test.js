/**
 * @jest-environment jsdom
 *
 * wallet-gas.js — shared gas resolution for contract sends.
 * CDP smart accounts skip estimation (sponsored UserOperations, bundler
 * re-estimates); EOA wallets estimate and pad by 20%.
 */
import { jest } from "@jest/globals";

let _connectionSource = "injected";

async function loadModule() {
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-core.js",
    () => ({
      getActiveConnectionSource: () => _connectionSource,
    })
  );
  return import("../../frontend/src/js/blockchain/wallet-gas.js");
}

beforeEach(() => {
  jest.resetModules();
  _connectionSource = "injected";
});

describe("resolveGas", () => {
  test("returns SMART_ACCOUNT_GAS_LIMIT without calling estimateGas for CDP smart accounts", async () => {
    _connectionSource = "cdp";
    const { resolveGas, SMART_ACCOUNT_GAS_LIMIT } = await loadModule();
    const tx = { estimateGas: jest.fn() };

    const gas = await resolveGas(tx, "0xFrom");

    expect(gas).toBe(SMART_ACCOUNT_GAS_LIMIT);
    expect(tx.estimateGas).not.toHaveBeenCalled();
  });

  test("estimates and pads by 20% for EOA wallets", async () => {
    const { resolveGas } = await loadModule();
    const tx = { estimateGas: jest.fn().mockResolvedValue(100000n) };

    const gas = await resolveGas(tx, "0xFrom");

    expect(tx.estimateGas).toHaveBeenCalledWith({ from: "0xFrom" });
    expect(gas).toBe(120000);
  });

  test("floors the padded estimate for EOA wallets", async () => {
    const { resolveGas } = await loadModule();
    const tx = { estimateGas: jest.fn().mockResolvedValue(100001n) };

    const gas = await resolveGas(tx, "0xFrom");

    expect(gas).toBe(120001);
  });

  test("falls back to the padded fallback gas for EOA wallets when estimation fails", async () => {
    const { resolveGas } = await loadModule();
    const tx = { estimateGas: jest.fn().mockRejectedValue(new Error("revert")) };

    const gas = await resolveGas(tx, "0xFrom", 120000);

    expect(gas).toBe(144000);
  });

  test("rethrows the estimation error for EOA wallets when no fallback is given", async () => {
    const { resolveGas } = await loadModule();
    const tx = { estimateGas: jest.fn().mockRejectedValue(new Error("revert")) };

    await expect(resolveGas(tx, "0xFrom")).rejects.toThrow("revert");
  });

  test("never calls estimateGas for CDP even when a fallback is given", async () => {
    _connectionSource = "cdp";
    const { resolveGas, SMART_ACCOUNT_GAS_LIMIT } = await loadModule();
    const tx = { estimateGas: jest.fn() };

    const gas = await resolveGas(tx, "0xFrom", 120000);

    expect(gas).toBe(SMART_ACCOUNT_GAS_LIMIT);
    expect(tx.estimateGas).not.toHaveBeenCalled();
  });
});
