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

test("dashboard parses the endpoint's output and renders chain + system panels", async () => {
  const { indexer, renderMetrics } = await seeded();
  const dash = await import("../scripts/metrics-dashboard.mjs");
  const samples = dash.parsePrometheus(renderMetrics([indexer.getStats()]));

  const live = samples.find((s) => s.name === "arbesk_assets" && s.labels.state === "live");
  expect(live).toEqual({
    name: "arbesk_assets",
    labels: { chain_id: String(CHAIN), network: "Hardhat Local", state: "live" },
    value: 4,
  });

  const history = dash.createHistory();
  dash.observe(history, samples, 1_000);
  const cpu = dash.observe(history, samples, 2_000);
  const frame = dash.stripAnsi(
    dash.renderFrame({ samples, history, cpu, url: "http://x/metrics", width: 100, now: 2_000 }),
  );
  expect(frame).toContain("Hardhat Local");
  expect(frame).toMatch(/Assets\s+4 live\s+1 burned · 5 minted/);
  expect(frame).toMatch(/Wallets\s+2 holding/);
  expect(frame).toContain("0x0000…00a1");
  expect(frame).toContain("System");
});

test("dashboard renders an unreachable panel instead of throwing", async () => {
  const dash = await import("../scripts/metrics-dashboard.mjs");
  const frame = dash.renderFrame({
    samples: null,
    error: "fetch failed",
    history: dash.createHistory(),
    cpu: { hostPct: NaN, procPct: NaN },
    url: "http://x/metrics",
    width: 80,
    now: 0,
  });
  expect(frame).toContain("unreachable");
  expect(frame).toContain("fetch failed");
});

test("sparkline scales to the window and meter clamps its ratio", async () => {
  const dash = await import("../scripts/metrics-dashboard.mjs");
  expect(dash.sparkline([0, 1, 2, 3, 4, 5, 6, 7], 8)).toBe("▁▂▃▄▅▆▇█");
  expect(dash.sparkline([5, 5, 5], 8)).toBe("▁▁▁");
  expect(dash.stripAnsi(dash.meter(2, 4))).toBe("■■■■");
  expect(dash.stripAnsi(dash.meter(NaN, 4))).toBe("····");
});
