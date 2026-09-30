// @test-env dom
/**
 * getReadableContract chain selection: anonymous sessions (no connected
 * wallet) must read from the deployment's default chain as reported by the
 * backend (/api/v1/config → defaultChainId), not from a hardcoded local
 * chain — otherwise a guest on a testnet deployment hits 127.0.0.1:8545.
 */
import { describe, expect, jest, mock, test } from "bun:test";
import { resetModules } from "../helpers/module-registry.js";
import { CHAIN_IDS } from "../../constants/chains.js";

let _config = null;
let _readClientChains = [];

async function loadModule() {
  resetModules();
  _readClientChains = [];

  await mock.module(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      __esModule: true,
      // Disconnected viewer: no chain, no wallet-bound contract.
      walletState: {
        get: jest.fn(() => ({ chainId: null, contract: null })),
      },
      _resetForTesting: jest.fn(),
    }),
  );
  await mock.module(
    "../../frontend/src/js/services/backend-client.js",
    () => ({
      __esModule: true,
      getConfig: jest.fn(async () => _config),
      getContractArtifact: jest.fn(async () => ({ abi: [] })),
    }),
  );
  await mock.module(
    "../../frontend/src/js/blockchain/viem-clients.js",
    () => ({
      __esModule: true,
      getReadClient: jest.fn((chainId) => {
        _readClientChains.push(Number(chainId));
        return {};
      }),
    }),
  );

  return import("../../frontend/src/js/blockchain/read-contract.js");
}

describe("getReadableContract chain selection", () => {
  test("anonymous read uses the backend-reported default chain", async () => {
    _config = { defaultChainId: CHAIN_IDS.BASE_TESTNET };
    const { getReadableContract } = await loadModule();
    const contract = await getReadableContract();
    expect(contract).not.toBeNull();
    expect(_readClientChains).toEqual([CHAIN_IDS.BASE_TESTNET]);
  });

  test("anonymous read falls back to Hardhat local when config is unreachable", async () => {
    _config = null;
    const { getReadableContract } = await loadModule();
    await getReadableContract();
    expect(_readClientChains).toEqual([CHAIN_IDS.HARDHAT_LOCAL]);
  });

  test("explicit chainId wins and never consults the backend config", async () => {
    _config = { defaultChainId: CHAIN_IDS.BASE_TESTNET };
    const mod = await loadModule();
    const { getReadableContract } = mod;
    const { getConfig } = await import(
      "../../frontend/src/js/services/backend-client.js"
    );
    await getReadableContract(CHAIN_IDS.HARDHAT_LOCAL);
    expect(_readClientChains).toEqual([CHAIN_IDS.HARDHAT_LOCAL]);
    expect(getConfig).not.toHaveBeenCalled();
  });
});
