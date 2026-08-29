/**
 * @jest-environment jsdom
 *
 * wallet-gas.ts — shared gas resolution for contract sends.
 * CDP smart accounts skip estimation (sponsored UserOperations, bundler
 * re-estimates); EOA wallets estimate via the viem read client and pad by 20%.
 */
import { jest } from "@jest/globals";

let _connectionSource = "injected";
let _estimateGas;
let _getReadClient;

async function loadModule() {
  _estimateGas = jest.fn();
  _getReadClient = jest.fn(() => ({ estimateGas: _estimateGas }));
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/wallet-core.ts",
    () => ({
      getActiveConnectionSource: () => _connectionSource,
    })
  );
  await jest.unstable_mockModule(
    "../../frontend/src/js/blockchain/viem-clients.ts",
    () => ({
      getReadClient: _getReadClient,
      getWalletClient: jest.fn(),
    })
  );
  return import("../../frontend/src/js/blockchain/wallet-gas.ts");
}

beforeEach(() => {
  jest.resetModules();
  _connectionSource = "injected";
});

describe("resolveGas", () => {
  test("returns SMART_ACCOUNT_GAS_LIMIT without estimating for CDP smart accounts", async () => {
    _connectionSource = "cdp";
    const { resolveGas, SMART_ACCOUNT_GAS_LIMIT } = await loadModule();

    const gas = await resolveGas({ to: "0xTo", data: "0xData", from: "0xFrom" });

    expect(gas).toBe(SMART_ACCOUNT_GAS_LIMIT);
    expect(_estimateGas).not.toHaveBeenCalled();
  });

  test("estimates via the read client and pads by 20% for EOA wallets", async () => {
    const { resolveGas } = await loadModule();
    _estimateGas.mockResolvedValue(100000n);

    const gas = await resolveGas({ to: "0xTo", data: "0xData", from: "0xFrom" });

    expect(_getReadClient).toHaveBeenCalledWith(undefined);
    expect(_estimateGas).toHaveBeenCalledWith({
      account: "0xFrom",
      to: "0xTo",
      data: "0xData",
    });
    expect(gas).toBe(120000n);
  });

  test("floors the padded estimate for EOA wallets", async () => {
    const { resolveGas } = await loadModule();
    _estimateGas.mockResolvedValue(100001n);

    const gas = await resolveGas({ to: "0xTo", data: "0xData", from: "0xFrom" });

    expect(gas).toBe(120001n);
  });

  test("forwards value and chainId to the read client estimation", async () => {
    const { resolveGas } = await loadModule();
    _estimateGas.mockResolvedValue(100000n);

    await resolveGas({
      to: "0xTo",
      data: "0xData",
      value: 5n,
      from: "0xFrom",
      chainId: 84532,
    });

    expect(_getReadClient).toHaveBeenCalledWith(84532);
    expect(_estimateGas).toHaveBeenCalledWith({
      account: "0xFrom",
      to: "0xTo",
      data: "0xData",
      value: 5n,
    });
  });

  test("falls back to the padded fallback gas for EOA wallets when estimation fails", async () => {
    const { resolveGas } = await loadModule();
    _estimateGas.mockRejectedValue(new Error("revert"));

    const gas = await resolveGas({
      to: "0xTo",
      data: "0xData",
      from: "0xFrom",
      fallbackGas: 120000,
    });

    expect(gas).toBe(144000n);
  });

  test("rethrows the estimation error for EOA wallets when no fallback is given", async () => {
    const { resolveGas } = await loadModule();
    _estimateGas.mockRejectedValue(new Error("revert"));

    await expect(
      resolveGas({ to: "0xTo", data: "0xData", from: "0xFrom" })
    ).rejects.toThrow("revert");
  });

  test("never estimates for CDP even when a fallback is given", async () => {
    _connectionSource = "cdp";
    const { resolveGas, SMART_ACCOUNT_GAS_LIMIT } = await loadModule();

    const gas = await resolveGas({
      to: "0xTo",
      data: "0xData",
      from: "0xFrom",
      fallbackGas: 120000,
    });

    expect(gas).toBe(SMART_ACCOUNT_GAS_LIMIT);
    expect(_estimateGas).not.toHaveBeenCalled();
  });
});
