/**
 * Token indexer init resilience.
 *
 * A transient RPC failure during the boot-time catchUp must not permanently
 * disable the indexer: the 15s background poll must still be scheduled so the
 * indexer self-heals once the RPC recovers (seen live 2026-07-04 when
 * sepolia.base.org blipped at backend start and chain 84532 never polled
 * again).
 */

import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { advanceTimersByTimeAsync } from "./helpers/timers.js";
import { resetModules } from "./helpers/module-registry.js";
const TEST_CHAIN_FAIL = 999901;
const TEST_CHAIN_OK = 999902;
const BASE_SEPOLIA = 84532;

// sepolia.base.org's eth_getLogs cap is unpublished and tightens under load:
// 2000 → 1000 (seen 2026-10-01) → 500 (seen 2026-10-05). The indexer now
// self-adjusts; this constant is only the backfill's starting expectation.
const BASE_SEPOLIA_MAX_GETLOGS_RANGE = 1000;

let _getBlockNumber;
let _getLogs;

async function loadModule() {
  _getBlockNumber = jest.fn().mockResolvedValue(0n);
  _getLogs = jest.fn().mockResolvedValue([]);

  const fakeClient = {
    getBlockNumber: _getBlockNumber,
    getLogs: _getLogs,
    readContract: jest.fn().mockResolvedValue(""),
  };

  await mock.module("../src/config.ts", () => ({
    getPublicClient: jest.fn(() => fakeClient),
    getContractAddress: jest.fn(() => "0x0000000000000000000000000000000000000001"),
    NETWORK_CONFIGS: {},
  }));

  return import("../src/api/token-indexer.ts");
}

beforeEach(() => {
  resetModules();
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

  const indexer = getIndexer(TEST_CHAIN_FAIL, { cat: jest.fn() });
  await expect(indexer.init()).rejects.toThrow("sepolia.base.org");

  try {
    // The poll timer must exist despite the failed initial catch-up...
    expect(indexer.pollTimer).not.toBeNull();

    // ...and the next tick must retry against the RPC and succeed.
    await advanceTimersByTimeAsync(15000);
    expect(_getBlockNumber).toHaveBeenCalledTimes(2);
  } finally {
    indexer.stop();
  }
});

test("Base Sepolia backfill chunks never exceed the RPC's 1000-block getLogs range", async () => {
  const { getIndexer } = await loadModule();

  // Simulate sepolia.base.org: reject any getLogs span wider than 1000 blocks.
  // viem getLogs takes bigint block bounds.
  _getLogs.mockImplementation(({ fromBlock, toBlock }) => {
    if (Number(toBlock - fromBlock) + 1 > BASE_SEPOLIA_MAX_GETLOGS_RANGE) {
      return Promise.reject(
        new Error("eth_getLogs is limited to a 1,000 range")
      );
    }
    return Promise.resolve([]);
  });

  const indexer = getIndexer(BASE_SEPOLIA, { cat: jest.fn() });
  indexer._saveState = () => {}; // keep the test off the real .data directory
  indexer.lastScannedBlock = 43587050;
  _getBlockNumber.mockResolvedValue(43591300n); // ~4250 blocks behind tip

  await expect(indexer.catchUp()).resolves.toBeUndefined();
  expect(_getLogs.mock.calls.length).toBeGreaterThan(1);
});

test("mid-backfill tightening to 500: snaps to the advertised cap and completes", async () => {
  const { getIndexer } = await loadModule();

  // Simulate sepolia.base.org enforcing a 500-block cap.
  _getLogs.mockImplementation(({ fromBlock, toBlock }) => {
    if (Number(toBlock - fromBlock) + 1 > 500) {
      return Promise.reject(new Error("eth_getLogs is limited to a 500 range"));
    }
    return Promise.resolve([]);
  });

  const indexer = getIndexer(BASE_SEPOLIA, { cat: jest.fn() });
  indexer._saveState = () => {};
  indexer.lastScannedBlock = 43587050;
  _getBlockNumber.mockResolvedValue(43588300n); // 1250 blocks behind tip

  await expect(indexer.catchUp()).resolves.toBeUndefined();

  // The first 1000-wide request is rejected, the chunk snaps to 500, and
  // every subsequent request respects the cap.
  expect(Number(_getLogs.mock.calls[0][0].toBlock - _getLogs.mock.calls[0][0].fromBlock) + 1)
    .toBe(1000);
  for (const [{ fromBlock, toBlock }] of _getLogs.mock.calls.slice(1)) {
    expect(Number(toBlock - fromBlock) + 1).toBeLessThanOrEqual(500);
  }
  expect(indexer.lastScannedBlock).toBe(43588300);
  expect(indexer.logChunkSize).toBe(500);
});

test("off-by-one cap: a same-size snap halves instead of looping", async () => {
  const { getIndexer } = await loadModule();

  // Provider advertises 500 but counts inclusively: only spans < 500 pass.
  _getLogs.mockImplementation(({ fromBlock, toBlock }) => {
    if (Number(toBlock - fromBlock) + 1 >= 500) {
      return Promise.reject(new Error("eth_getLogs is limited to a 500 range"));
    }
    return Promise.resolve([]);
  });

  const indexer = getIndexer(BASE_SEPOLIA, { cat: jest.fn() });
  indexer._saveState = () => {};
  indexer.lastScannedBlock = 43587050;
  _getBlockNumber.mockResolvedValue(43587600n);

  await expect(indexer.catchUp()).resolves.toBeUndefined();
  expect(indexer.logChunkSize).toBe(250);
  expect(indexer.lastScannedBlock).toBe(43587600);
});

test("transient getLogs errors propagate without shrinking the chunk", async () => {
  const { getIndexer } = await loadModule();

  _getLogs.mockRejectedValue(new Error("fetch failed: socket hang up"));

  const indexer = getIndexer(BASE_SEPOLIA, { cat: jest.fn() });
  indexer._saveState = () => {};
  indexer.lastScannedBlock = 43587050;
  _getBlockNumber.mockResolvedValue(43588000n);

  await expect(indexer.catchUp()).rejects.toThrow("socket hang up");
  expect(indexer.logChunkSize).toBe(1000);
  expect(_getLogs).toHaveBeenCalledTimes(1);
});

test("chunk grows back toward the ceiling after 5 consecutive successes", async () => {
  const { getIndexer } = await loadModule();

  // Enforce 500 for the first rejection only, then relax completely —
  // the provider's load spike passed.
  let rejected = false;
  _getLogs.mockImplementation(({ fromBlock, toBlock }) => {
    if (!rejected && Number(toBlock - fromBlock) + 1 > 500) {
      rejected = true;
      return Promise.reject(new Error("eth_getLogs is limited to a 500 range"));
    }
    return Promise.resolve([]);
  });

  const indexer = getIndexer(BASE_SEPOLIA, { cat: jest.fn() });
  indexer._saveState = () => {};
  indexer.lastScannedBlock = 43587050;
  _getBlockNumber.mockResolvedValue(43593050n); // 6000 blocks behind tip

  await expect(indexer.catchUp()).resolves.toBeUndefined();
  // 500 → (5 successes) → 1000 = configured ceiling.
  expect(indexer.logChunkSize).toBe(1000);
});

test("parseGetLogsRangeCap parses plain and comma-separated caps", async () => {
  const { parseGetLogsRangeCap } = await loadModule();
  expect(parseGetLogsRangeCap("eth_getLogs is limited to a 500 range")).toBe(500);
  expect(parseGetLogsRangeCap("eth_getLogs is limited to a 1,000 range")).toBe(1000);
  expect(parseGetLogsRangeCap("eth_getLogs is limited to a 10 block range")).toBe(10);
  expect(parseGetLogsRangeCap("fetch failed: socket hang up")).toBeNull();
  expect(parseGetLogsRangeCap("query returned more than 10000 results")).toBeNull();
});

test("successful init schedules the background poll", async () => {
  const { getIndexer } = await loadModule();

  const indexer = getIndexer(TEST_CHAIN_OK, { cat: jest.fn() });
  await indexer.init();

  try {
    expect(indexer.pollTimer).not.toBeNull();
    await advanceTimersByTimeAsync(15000);
    expect(_getBlockNumber).toHaveBeenCalledTimes(2);
  } finally {
    indexer.stop();
  }
});
