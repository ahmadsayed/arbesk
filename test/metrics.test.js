/**
 * Prometheus /metrics endpoint and the terminal dashboard that reads it.
 *
 * Counts come straight from the token indexer's in-memory ownership map:
 * live = owner ≠ 0x0, burned = owner = 0x0, wallets = distinct live owners.
 */

import { beforeEach, expect, jest, mock, test } from "bun:test";
import { resetModules } from "./helpers/module-registry.js";

const CHAIN = 31337;
const ZERO = "0x0000000000000000000000000000000000000000";
const ALICE = "0x00000000000000000000000000000000000000a1";
const BOB = "0x00000000000000000000000000000000000000b0";

async function load() {
  const fakeClient = {
    getBlockNumber: jest.fn().mockResolvedValue(0n),
    getLogs: jest.fn().mockResolvedValue([]),
    readContract: jest.fn().mockResolvedValue(""),
  };
  await mock.module("../src/config.ts", () => ({
    getPublicClient: jest.fn(() => fakeClient),
    getContractAddress: jest.fn(() => "0x0000000000000000000000000000000000000001"),
    NETWORK_CONFIGS: { [CHAIN]: { name: "Hardhat Local" } },
  }));
  const indexerMod = await import("../src/api/token-indexer.ts");
  const metricsMod = await import("../src/api/routes/metrics.ts");
  return { ...indexerMod, ...metricsMod, fakeClient };
}

function transfer(tokenId, from, to, block = 10) {
  return { eventName: "Transfer", blockNumber: BigInt(block), args: { tokenId: BigInt(tokenId), from, to } };
}

/** An indexer with 3 tokens for ALICE, 1 for BOB, 1 burned. */
async function seeded() {
  const mod = await load();
  const indexer = mod.getIndexer(CHAIN, /** @type {any} */ ({}));
  indexer._applyLogs([
    transfer(1, ZERO, ALICE),
    transfer(2, ZERO, ALICE),
    transfer(3, ZERO, ALICE),
    transfer(4, ZERO, BOB),
    transfer(5, ZERO, BOB),
    transfer(5, BOB, ZERO, 11),
  ]);
  indexer.tokenEditors.set("1", [BOB]);
  indexer.editorTokens.set(BOB, ["1"]);
  return { ...mod, indexer };
}

beforeEach(() => {
  resetModules();
});

test("getStats counts live, burned, minted assets and distinct holding wallets", async () => {
  const { indexer } = await seeded();
  const stats = indexer.getStats();
  expect(stats).toMatchObject({
    chainId: CHAIN,
    minted: 5,
    live: 4,
    burned: 1,
    holders: 2,
    editors: 1,
    sharedAssets: 1,
  });
  expect(stats.topHolders).toEqual([
    { address: ALICE, assets: 3 },
    { address: BOB, assets: 1 },
  ]);
});

test("getStats caps topHolders at topN", async () => {
  const { indexer } = await seeded();
  expect(indexer.getStats(1).topHolders).toEqual([{ address: ALICE, assets: 3 }]);
});

test("catchUp records the chain head and last success time", async () => {
  const { indexer, fakeClient } = await seeded();
  fakeClient.getBlockNumber.mockResolvedValue(5n);
  indexer.lastScannedBlock = 5;
  await indexer.catchUp();
  const stats = indexer.getStats();
  expect(stats.latestBlock).toBe(5);
  expect(stats.lastCatchUpOkAt).toBeGreaterThan(0);
});

test("catchUp failure leaves lastCatchUpOkAt untouched", async () => {
  const { indexer, fakeClient } = await seeded();
  fakeClient.getBlockNumber.mockRejectedValue(new Error("rpc down"));
  await expect(indexer.catchUp()).rejects.toThrow("rpc down");
  expect(indexer.getStats().lastCatchUpOkAt).toBe(0);
});

test("renderMetrics emits Prometheus text with per-chain labels", async () => {
  const { indexer, renderMetrics } = await seeded();
  const text = renderMetrics([indexer.getStats()]);
  const labels = `chain_id="${CHAIN}",network="Hardhat Local"`;
  expect(text).toContain("# TYPE arbesk_assets gauge");
  expect(text).toContain(`arbesk_assets{${labels},state="live"} 4`);
  expect(text).toContain(`arbesk_assets{${labels},state="burned"} 1`);
  expect(text).toContain(`arbesk_assets_minted{${labels}} 5`);
  expect(text).toContain(`arbesk_wallets{${labels}} 2`);
  expect(text).toContain(`arbesk_wallet_assets{${labels},address="${ALICE}"} 3`);
  expect(text).toContain("# TYPE arbesk_process_cpu_seconds_total counter");
  expect(text).toMatch(/^arbesk_host_cpus \d+$/m);
  expect(text.endsWith("\n")).toBe(true);
});

test("GET /metrics serves every created indexer with the Prometheus content type", async () => {
  const { default: metricsRoutes } = await seeded();
  const res = await metricsRoutes().request("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/plain; version=0.0.4");
  expect(await res.text()).toContain(`arbesk_wallets{chain_id="${CHAIN}",network="Hardhat Local"} 2`);
});

test("metricsEnabled: on everywhere by default, METRICS_ENABLED=false turns it off", async () => {
  const { metricsEnabled } = await load();
  expect(metricsEnabled({})).toBe(true);
  expect(metricsEnabled({ NODE_ENV: "production" })).toBe(true);
  expect(metricsEnabled({ NODE_ENV: "production", METRICS_ENABLED: "false" })).toBe(false);
});

test("dashboard summarizes the endpoint's output into chain, wallet and system views", async () => {
  const { indexer, renderMetrics } = await seeded();
  const dash = await import("../scripts/metrics-dashboard.mjs");
  const view = dash.summarize(dash.parsePrometheus(renderMetrics([indexer.getStats()])));

  expect(view.chains).toEqual([
    expect.objectContaining({
      chainId: String(CHAIN),
      network: "Hardhat Local",
      live: 4,
      burned: 1,
      minted: 5,
      wallets: 2,
      editors: 1,
      shared: 1,
    }),
  ]);
  expect(view.topWallets.map((w) => [w.address, w.assets])).toEqual([[ALICE, 3], [BOB, 1]]);
  expect(view.system.cores).toBeGreaterThan(0);
  expect(view.system.memTotal).toBeGreaterThan(0);
});

test("parsePrometheus unescapes label values", async () => {
  const dash = await import("../scripts/metrics-dashboard.mjs");
  expect(dash.parsePrometheus('m{a="x\\"y\\\\z"} 2\n# HELP m h\n')).toEqual([
    { name: "m", labels: { a: 'x"y\\z' }, value: 2 },
  ]);
});

test("syncStatus reports waiting, backfill, stale, behind and synced", async () => {
  const dash = await import("../scripts/metrics-dashboard.mjs");
  const chain = { head: 100, scanned: 100, lastOk: 1000 };
  expect(dash.syncStatus({ ...chain, head: 0 }, 1000)).toBe("waiting");
  expect(dash.syncStatus({ ...chain, scanned: 40, lastOk: 0 }, 1000)).toBe("backfill -60");
  expect(dash.syncStatus(chain, 1000 + 300)).toBe("stale 5m 0s");
  expect(dash.syncStatus({ ...chain, scanned: 90 }, 1010)).toBe("behind 10");
  expect(dash.syncStatus(chain, 1010)).toBe("synced");
});

test("observe derives CPU rates from counter deltas and keeps per-chain history", async () => {
  const dash = await import("../scripts/metrics-dashboard.mjs");
  const view = (/** @type {number} */ total, /** @type {number} */ idle, /** @type {number} */ proc, /** @type {number} */ live) => ({
    chains: [{ chainId: "1", live, wallets: 1 }],
    topWallets: [],
    system: { hostCpuTotal: total, hostCpuIdle: idle, procCpu: proc },
  });
  const h = dash.createHistory();
  const first = dash.observe(h, view(100, 80, 1, 3), 0);
  expect(Number.isNaN(first.hostPct)).toBe(true);
  // 10s host CPU, 6s idle → 40% busy; 0.5s process CPU over 2s wall → 25% of a core.
  expect(dash.observe(h, view(110, 86, 1.5, 4), 2000)).toEqual({ hostPct: 0.4, procPct: 0.25 });
  expect(h.live.get("1")).toEqual([3, 4]);
  expect(h.x).toHaveLength(2);
});

test("formatSnapshot prints chain counts, top wallets and system load", async () => {
  const { indexer, renderMetrics } = await seeded();
  const dash = await import("../scripts/metrics-dashboard.mjs");
  const view = dash.summarize(dash.parsePrometheus(renderMetrics([indexer.getStats()])));
  const text = dash.formatSnapshot(view, { hostPct: 0.25, procPct: NaN }, Date.now());
  expect(text).toContain("Hardhat Local (#31337): 4 live / 1 burned / 5 minted · 2 wallets");
  expect(text).toContain(`${ALICE}  3 assets`);
  expect(text).toContain("host cpu 25.0%");
  expect(text).toContain("backend cpu …");
});
