/**
 * Token indexer init resilience.
 *
 * A transient RPC failure during the boot-time catchUp must not permanently
 * disable the indexer: the 15s background poll must still be scheduled so the
 * indexer self-heals once the RPC recovers (seen live 2026-07-04 when
 * sepolia.base.org blipped at backend start and chain 84532 never polled
 * again).
 */
import { jest } from "@jest/globals";

const TEST_CHAIN_FAIL = 999901;
const TEST_CHAIN_OK = 999902;
const BASE_SEPOLIA = 84532;

// sepolia.base.org rejects eth_getLogs spanning more than 2000 blocks
// ("Returned error: query exceeds max block range 2000", seen 2026-07-04).
const BASE_SEPOLIA_MAX_GETLOGS_RANGE = 2000;

let _getBlockNumber;
let _getPastLogs;

async function loadModule() {
  _getBlockNumber = jest.fn().mockResolvedValue(0);
  _getPastLogs = jest.fn().mockResolvedValue([]);

  const fakeWeb3 = {
    eth: {
      getBlockNumber: _getBlockNumber,
      getPastLogs: _getPastLogs,
      Contract: class {
        constructor() {}
      },
    },
    utils: { toBigInt: (x) => BigInt(x) },
  };

  await jest.unstable_mockModule("../src/config.js", () => ({
    getWeb3: jest.fn(() => fakeWeb3),
    getContractAddress: jest.fn(() => "0x0000000000000000000000000000000000000001"),
    NETWORK_CONFIGS: {},
  }));

  return import("../src/api/token-indexer.js");
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

test("boot-time catchUp failure still schedules the background poll (self-heals)", async () => {
  const { getIndexer } = await loadModule();
  _getBlockNumber
    .mockRejectedValueOnce(new Error("request to https://sepolia.base.org/ failed"))
    .mockResolvedValue(0);

  const indexer = getIndexer(TEST_CHAIN_FAIL);
  await expect(indexer.init()).rejects.toThrow("sepolia.base.org");

  try {
    // The poll timer must exist despite the failed initial catch-up...
    expect(indexer.pollTimer).not.toBeNull();

    // ...and the next tick must retry against the RPC and succeed.
    await jest.advanceTimersByTimeAsync(15000);
    expect(_getBlockNumber).toHaveBeenCalledTimes(2);
  } finally {
    indexer.stop();
  }
});

test("Base Sepolia backfill chunks never exceed the RPC's 2000-block getLogs range", async () => {
  const { getIndexer } = await loadModule();

  // Simulate sepolia.base.org: reject any getLogs span wider than 2000 blocks.
  _getPastLogs.mockImplementation(({ fromBlock, toBlock }) => {
    if (toBlock - fromBlock + 1 > BASE_SEPOLIA_MAX_GETLOGS_RANGE) {
      return Promise.reject(
        new Error("Returned error: query exceeds max block range 2000")
      );
    }
    return Promise.resolve([]);
  });

  const indexer = getIndexer(BASE_SEPOLIA);
  indexer._saveState = () => {}; // keep the test off the real .data directory
  indexer.lastScannedBlock = 43587050;
  _getBlockNumber.mockResolvedValue(43591300); // ~4250 blocks behind tip

  await expect(indexer.catchUp()).resolves.toBeUndefined();
  expect(_getPastLogs.mock.calls.length).toBeGreaterThan(1);
});

test("successful init schedules the background poll", async () => {
  const { getIndexer } = await loadModule();

  const indexer = getIndexer(TEST_CHAIN_OK);
  await indexer.init();

  try {
    expect(indexer.pollTimer).not.toBeNull();
    await jest.advanceTimersByTimeAsync(15000);
    expect(_getBlockNumber).toHaveBeenCalledTimes(2);
  } finally {
    indexer.stop();
  }
});
