#!/usr/bin/env bun
// @ts-check
/**
 * btop-style terminal dashboard for the backend's Prometheus endpoint, drawn
 * with blessed + blessed-contrib.
 *
 * Polls GET /metrics and shows per-chain asset/wallet counts from the token
 * indexer, indexer sync state, and backend process + host load. No Grafana,
 * no Prometheus server — it reads the scrape endpoint directly.
 *
 * Usage:
 *   bun scripts/metrics-dashboard.mjs              # https://promptscad.com/metrics
 *   bun scripts/metrics-dashboard.mjs --url http://localhost:9090/metrics --interval 5
 *   bun scripts/metrics-dashboard.mjs --once       # print a plain-text snapshot and exit
 *
 * Keys: q / Esc / Ctrl-C quit.
 */

import { Command } from "commander";

const HISTORY = 120;
const LINE_COLOURS = ["cyan", "magenta", "yellow", "green"];

/** @typedef {{ name: string, labels: Record<string, string>, value: number }} Sample */
/**
 * @typedef {{ chainId: string, network: string, live: number, burned: number, minted: number,
 *   wallets: number, editors: number, shared: number, scanned: number, head: number,
 *   lastOk: number }} ChainView
 */
/**
 * @typedef {{ method: string, signins: number, wallets: number, active24h: number,
 *   active7d: number, active30d: number }} SigninView
 */
/**
 * @typedef {{ chains: ChainView[],
 *   topWallets: Array<{ chainId: string, network: string, address: string, assets: number }>,
 *   signins: SigninView[],
 *   system: { cores: number, memTotal: number, memFree: number, rss: number, heapUsed: number,
 *     load: number[], uptime: number, hostCpuTotal: number, hostCpuIdle: number, procCpu: number } }} View
 */
/** @typedef {{ hostPct: number, procPct: number }} CpuRates */
/**
 * @typedef {{ x: string[], live: Map<string, number[]>, wallets: Map<string, number[]>,
 *   lastCpu: { t: number, busy: number, total: number, proc: number } | null }} History
 */

// ─── Prometheus text → view model ────────────────────────────────────────────

/**
 * Parses Prometheus text exposition format into samples.
 * @param {string} text
 * @returns {Sample[]}
 */
export function parsePrometheus(text) {
  /** @type {Sample[]} */
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([a-zA-Z_:][\w:]*)(\{(.*)\})?\s+(\S+)/);
    if (!m) continue;
    /** @type {Record<string, string>} */
    const labels = {};
    if (m[3]) {
      for (const lm of m[3].matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
        labels[lm[1]] = lm[2].replace(/\\n/g, "\n").replace(/\\(["\\])/g, "$1");
      }
    }
    out.push({ name: m[1], labels, value: Number(m[4]) });
  }
  return out;
}

/**
 * Sum of every sample of `name` whose labels match `where`.
 * @param {Sample[]} samples
 * @param {string} name
 * @param {Record<string, string>} [where]
 */
function sum(samples, name, where = {}) {
  return samples
    .filter((s) => s.name === name && Object.entries(where).every(([k, v]) => s.labels[k] === v))
    .reduce((acc, s) => acc + s.value, 0);
}

/**
 * Shapes raw samples into what the widgets display.
 * @param {Sample[]} samples
 * @returns {View}
 */
export function summarize(samples) {
  const chainIds = [...new Set(samples.filter((s) => s.name === "arbesk_wallets").map((s) => s.labels.chain_id))];
  const chains = chainIds.map((chainId) => {
    const where = { chain_id: chainId };
    return {
      chainId,
      network: samples.find((s) => s.name === "arbesk_wallets" && s.labels.chain_id === chainId)?.labels.network ?? chainId,
      live: sum(samples, "arbesk_assets", { ...where, state: "live" }),
      burned: sum(samples, "arbesk_assets", { ...where, state: "burned" }),
      minted: sum(samples, "arbesk_assets_minted", where),
      wallets: sum(samples, "arbesk_wallets", where),
      editors: sum(samples, "arbesk_editors", where),
      shared: sum(samples, "arbesk_shared_assets", where),
      scanned: sum(samples, "arbesk_indexer_last_scanned_block", where),
      head: sum(samples, "arbesk_indexer_chain_head_block", where),
      lastOk: sum(samples, "arbesk_indexer_last_success_timestamp_seconds", where),
    };
  });
  const topWallets = samples
    .filter((s) => s.name === "arbesk_wallet_assets")
    .map((s) => ({ chainId: s.labels.chain_id, network: s.labels.network, address: s.labels.address, assets: s.value }))
    .sort((a, b) => b.assets - a.assets);
  const signins = ["email", "wallet"].map((method) => ({
    method,
    signins: sum(samples, "arbesk_signins_total", { method }),
    wallets: sum(samples, "arbesk_signin_wallets", { method }),
    active24h: sum(samples, "arbesk_active_wallets", { method, window: "24h" }),
    active7d: sum(samples, "arbesk_active_wallets", { method, window: "7d" }),
    active30d: sum(samples, "arbesk_active_wallets", { method, window: "30d" }),
  }));
  return {
    chains,
    topWallets,
    signins,
    system: {
      cores: sum(samples, "arbesk_host_cpus"),
      memTotal: sum(samples, "arbesk_host_memory_bytes", { type: "total" }),
      memFree: sum(samples, "arbesk_host_memory_bytes", { type: "free" }),
      rss: sum(samples, "arbesk_process_memory_bytes", { type: "rss" }),
      heapUsed: sum(samples, "arbesk_process_memory_bytes", { type: "heap_used" }),
      load: ["1m", "5m", "15m"].map((window) => sum(samples, "arbesk_host_load", { window })),
      uptime: sum(samples, "arbesk_process_uptime_seconds"),
      hostCpuTotal: sum(samples, "arbesk_host_cpu_seconds_total"),
      hostCpuIdle: sum(samples, "arbesk_host_cpu_seconds_total", { mode: "idle" }),
      procCpu: sum(samples, "arbesk_process_cpu_seconds_total"),
    },
  };
}

/**
 * One-word-ish indexer health for a chain.
 * @param {ChainView} chain
 * @param {number} nowSec
 */
export function syncStatus(chain, nowSec) {
  const lag = Math.max(0, chain.head - chain.scanned);
  if (chain.head === 0) return "waiting";
  if (chain.lastOk === 0) return `backfill -${num(lag)}`;
  const age = nowSec - chain.lastOk;
  if (age > 120) return `stale ${duration(age)}`;
  if (lag > 0) return `behind ${num(lag)}`;
  return "synced";
}

// ─── History (charts + CPU rates) ────────────────────────────────────────────

/** @returns {History} */
export function createHistory() {
  return { x: [], live: new Map(), wallets: new Map(), lastCpu: null };
}

/** @param {number[]} arr @param {number} v */
function push(arr, v) {
  arr.push(v);
  if (arr.length > HISTORY) arr.shift();
}

/**
 * Folds one scrape into the chart history and derives CPU rates from the
 * counter deltas since the previous scrape.
 * @param {History} h
 * @param {View} view
 * @param {number} now epoch ms
 * @returns {CpuRates}
 */
export function observe(h, view, now) {
  const { hostCpuTotal: total, hostCpuIdle: idle, procCpu: proc } = view.system;
  const mark = { t: now, busy: total - idle, total, proc };
  const prev = h.lastCpu;
  const rates = { hostPct: NaN, procPct: NaN };
  if (prev && mark.total > prev.total && mark.t > prev.t) {
    rates.hostPct = (mark.busy - prev.busy) / (mark.total - prev.total);
    // Percent of one core, like top/btop per-process CPU.
    rates.procPct = (mark.proc - prev.proc) / ((mark.t - prev.t) / 1000);
  }
  h.lastCpu = mark;

  h.x.push(new Date(now).toLocaleTimeString("en-GB"));
  if (h.x.length > HISTORY) h.x.shift();
  for (const c of view.chains) {
    for (const [series, v] of /** @type {const} */ ([[h.live, c.live], [h.wallets, c.wallets]])) {
      const arr = series.get(c.chainId) ?? [];
      push(arr, v);
      series.set(c.chainId, arr);
    }
  }
  return rates;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** @param {number} n */
const num = (n) => n.toLocaleString("en-US");

/** @param {number} bytes */
export function human(bytes) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** @param {number} s */
function duration(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
}

/** @param {string} a */
const shortAddr = (a) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** @param {number} r */
const pct = (r) => (Number.isFinite(r) ? `${(r * 100).toFixed(1)}%` : "…");

/**
 * Plain-text snapshot for --once (scripts, CI, non-TTY).
 * @param {View} view
 * @param {CpuRates} cpu
 * @param {number} now epoch ms
 */
export function formatSnapshot(view, cpu, now) {
  const s = view.system;
  const lines = view.chains.map(
    (c) =>
      `${c.network} (#${c.chainId}): ${num(c.live)} live / ${num(c.burned)} burned / ${num(c.minted)} minted · ` +
      `${num(c.wallets)} wallets · ${num(c.editors)} editors · ${num(c.shared)} shared · ` +
      `indexer ${syncStatus(c, now / 1000)} @ ${num(c.scanned)}/${num(c.head)}`,
  );
  if (lines.length === 0) lines.push("no indexers running yet");
  for (const w of view.topWallets.slice(0, 5)) {
    lines.push(`  ${w.address}  ${num(w.assets)} assets  (#${w.chainId})`);
  }
  for (const g of view.signins) {
    lines.push(
      `sign-ins ${g.method}: ${num(g.wallets)} wallets · active ${num(g.active24h)} 24h / ` +
        `${num(g.active7d)} 7d / ${num(g.active30d)} 30d · ${num(g.signins)} sign-ins`,
    );
  }
  lines.push(
    `host cpu ${pct(cpu.hostPct)} · mem ${human(s.memTotal - s.memFree)}/${human(s.memTotal)} · ` +
      `load ${s.load.map((l) => l.toFixed(2)).join(" ")} · ${s.cores} cores`,
    `backend cpu ${pct(cpu.procPct)} · rss ${human(s.rss)} · heap ${human(s.heapUsed)} · up ${duration(s.uptime)}`,
  );
  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

/** @param {string} url */
async function scrape(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return summarize(parsePrometheus(await res.text()));
}

/**
 * Full-screen dashboard. blessed is loaded lazily so --once and the unit
 * tests never touch the terminal.
 * @param {string} url
 * @param {number} intervalMs
 */
async function runDashboard(url, intervalMs) {
  const { default: blessed } = await import("blessed");
  const { default: contrib } = await import("blessed-contrib");

  const screen = blessed.screen({ smartCSR: true, title: "arbesk metrics" });
  const grid = new contrib.grid({ rows: 12, cols: 12, screen });
  const tableStyle = { keys: false, interactive: false, fg: "white", border: { type: "line", fg: "cyan" } };

  const chainsTable = grid.set(0, 0, 4, 9, contrib.table, {
    ...tableStyle,
    label: ` Chains · ${url} `,
    columnSpacing: 2,
    columnWidth: [21, 6, 5, 7, 7, 8, 8, 12],
  });
  const walletsTable = grid.set(0, 9, 4, 3, contrib.table, {
    ...tableStyle,
    label: " Top wallets ",
    columnSpacing: 2,
    columnWidth: [13, 6],
  });
  const lineOpts = { showLegend: true, legend: { width: 22 }, wholeNumbersOnly: true, style: { baseline: "white" } };
  const assetsChart = grid.set(4, 0, 5, 4, contrib.line, { ...lineOpts, label: " Live assets " });
  const walletsChart = grid.set(4, 4, 5, 4, contrib.line, { ...lineOpts, label: " Holding wallets " });
  const signinsTable = grid.set(4, 8, 5, 4, contrib.table, {
    ...tableStyle,
    label: " Sign-ins (wallets) ",
    columnSpacing: 2,
    columnWidth: [7, 6, 4, 4, 4, 7],
  });
  const gaugeOpts = { stroke: "green", fill: "white" };
  const hostCpuGauge = grid.set(9, 0, 3, 3, contrib.gauge, { ...gaugeOpts, label: " Host CPU " });
  const hostMemGauge = grid.set(9, 3, 3, 3, contrib.gauge, { ...gaugeOpts, label: " Host memory " });
  const procCpuGauge = grid.set(9, 6, 3, 3, contrib.gauge, { ...gaugeOpts, label: " Backend CPU (1 core) " });
  const systemBox = grid.set(9, 9, 3, 3, blessed.box, { label: " System ", tags: true, border: { type: "line" } });

  screen.key(["q", "escape", "C-c"], () => {
    screen.destroy();
    process.exit(0);
  });

  const history = createHistory();

  /**
   * @param {any} chart
   * @param {Map<string, number[]>} series
   * @param {View} view
   */
  const drawLines = (chart, series, view) => {
    if (history.x.length < 2) return;
    chart.setData(
      view.chains.map((c, i) => ({
        title: c.network,
        x: history.x.slice(-(series.get(c.chainId)?.length ?? 0)),
        y: series.get(c.chainId) ?? [],
        style: { line: LINE_COLOURS[i % LINE_COLOURS.length] },
      })),
    );
  };

  const tick = async () => {
    const now = Date.now();
    try {
      const view = await scrape(url);
      const cpu = observe(history, view, now);
      const s = view.system;

      chainsTable.setData({
        headers: ["Network", "Chain", "Live", "Burned", "Minted", "Wallets", "Editors", "Indexer"],
        data: view.chains.map((c) => [
          c.network, c.chainId, num(c.live), num(c.burned), num(c.minted),
          num(c.wallets), num(c.editors), syncStatus(c, now / 1000),
        ]),
      });
      walletsTable.setData({
        headers: ["Wallet", "Assets"],
        data: view.topWallets.slice(0, 10).map((w) => [shortAddr(w.address), num(w.assets)]),
      });
      signinsTable.setData({
        headers: ["Method", "Total", "24h", "7d", "30d", "Logins"],
        data: view.signins.map((g) => [
          g.method, num(g.wallets), num(g.active24h), num(g.active7d), num(g.active30d), num(g.signins),
        ]),
      });
      drawLines(assetsChart, history.live, view);
      drawLines(walletsChart, history.wallets, view);

      // blessed-contrib's gauge reads any value < 1.001 as a 0..1 fraction
      // (and multiplies by 100), so always hand it a clamped ratio.
      /** @param {number} r */
      const ratio = (r) => Math.min(1, Math.max(0, Number.isFinite(r) ? r : 0));
      hostCpuGauge.setPercent(ratio(cpu.hostPct));
      hostMemGauge.setPercent(ratio((s.memTotal - s.memFree) / s.memTotal));
      procCpuGauge.setPercent(ratio(cpu.procPct));
      systemBox.setContent(
        `load ${s.load.map((l) => l.toFixed(2)).join(" ")}\n` +
          `${s.cores} cores, ${human(s.memTotal)}\n` +
          `rss ${human(s.rss)}\n` +
          `heap ${human(s.heapUsed)}\n` +
          `up ${duration(s.uptime)}\n` +
          `{gray-fg}updated ${new Date(now).toLocaleTimeString()}{/gray-fg}`,
      );
    } catch (err) {
      systemBox.setContent(
        `{red-fg}unreachable{/red-fg}\n${String(/** @type {Error} */ (err).message)}\n` +
          `{gray-fg}retrying… local backend? --url http://localhost:9090/metrics{/gray-fg}`,
      );
    }
    screen.render();
  };

  screen.on("resize", () => {
    for (const w of [chainsTable, walletsTable, signinsTable, assetsChart, walletsChart, hostCpuGauge, hostMemGauge, procCpuGauge]) {
      w.emit("attach");
    }
    screen.render();
  });

  for (;;) {
    await tick();
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  const opts = new Command()
    .name("metrics-dashboard")
    .description("btop-style terminal view of the backend /metrics endpoint")
    .option("--url <url>", "metrics endpoint", process.env.ARBESK_METRICS_URL || "https://promptscad.com/metrics")
    .option("--interval <seconds>", "refresh interval", "2")
    .option("--once", "print a plain-text snapshot and exit")
    .parse()
    .opts();

  if (opts.once || !process.stdout.isTTY) {
    // CPU needs two scrapes for a rate; take a short baseline first.
    const history = createHistory();
    observe(history, await scrape(opts.url), Date.now());
    await new Promise((r) => setTimeout(r, 500));
    const view = await scrape(opts.url);
    const now = Date.now();
    console.log(formatSnapshot(view, observe(history, view, now), now));
    return;
  }
  await runDashboard(opts.url, Math.max(500, Number(opts.interval) * 1000));
}

if (import.meta.main) {
  await main();
}
