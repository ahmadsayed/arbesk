import os from "os";
import { Hono } from "hono";
import { NETWORK_CONFIGS } from "../../config.ts";
import { listIndexers } from "../token-indexer.ts";
import type { IndexerStats } from "../token-indexer.ts";

/**
 * Whether GET /metrics is served.
 * @remarks On by default (production included — it only reads in-memory
 *   indexer state); METRICS_ENABLED=false turns it off.
 */
export function metricsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.METRICS_ENABLED !== "false";
}

type Labels = Record<string, string | number>;
type Sample = { labels?: Labels; value: number };

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatLabels(labels: Labels | undefined): string {
  if (!labels) return "";
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(String(v))}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}

/** Builds Prometheus text exposition format (version 0.0.4). */
class MetricsWriter {
  lines: string[] = [];

  metric(name: string, type: "gauge" | "counter", help: string, samples: Sample[]): void {
    this.lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const { labels, value } of samples) {
      this.lines.push(`${name}${formatLabels(labels)} ${value}`);
    }
  }

  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

function chainLabels(stats: IndexerStats): Labels {
  return {
    chain_id: stats.chainId,
    network: NETWORK_CONFIGS[stats.chainId]?.name ?? String(stats.chainId),
  };
}

function writeIndexerMetrics(w: MetricsWriter, all: IndexerStats[]): void {
  const per = (pick: (s: IndexerStats) => number): Sample[] =>
    all.map((s) => ({ labels: chainLabels(s), value: pick(s) }));

  w.metric("arbesk_assets", "gauge", "Indexed asset tokens by state.",
    all.flatMap((s) => [
      { labels: { ...chainLabels(s), state: "live" }, value: s.live },
      { labels: { ...chainLabels(s), state: "burned" }, value: s.burned },
    ]));
  w.metric("arbesk_assets_minted", "gauge", "Asset tokens ever minted (live + burned).",
    per((s) => s.minted));
  w.metric("arbesk_wallets", "gauge", "Distinct wallets holding at least one live asset.",
    per((s) => s.holders));
  w.metric("arbesk_editors", "gauge", "Distinct editor wallets across all assets.",
    per((s) => s.editors));
  w.metric("arbesk_shared_assets", "gauge", "Assets with at least one editor.",
    per((s) => s.sharedAssets));
  w.metric("arbesk_wallet_assets", "gauge", "Live assets held by the top wallets.",
    all.flatMap((s) =>
      s.topHolders.map((h) => ({ labels: { ...chainLabels(s), address: h.address }, value: h.assets })),
    ));
  w.metric("arbesk_indexer_last_scanned_block", "gauge", "Last block the indexer has applied.",
    per((s) => s.lastScannedBlock));
  w.metric("arbesk_indexer_chain_head_block", "gauge", "Chain tip seen at the last catch-up.",
    per((s) => s.latestBlock));
  w.metric("arbesk_indexer_last_success_timestamp_seconds", "gauge",
    "Unix time of the last successful catch-up (0 = never).",
    per((s) => Math.floor(s.lastCatchUpOkAt / 1000)));
  w.metric("arbesk_indexer_log_chunk_size", "gauge", "Current adaptive eth_getLogs block range.",
    per((s) => s.logChunkSize));
}

function writeProcessMetrics(w: MetricsWriter): void {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  w.metric("arbesk_process_cpu_seconds_total", "counter", "Backend process CPU time.", [
    { labels: { mode: "user" }, value: cpu.user / 1e6 },
    { labels: { mode: "system" }, value: cpu.system / 1e6 },
  ]);
  w.metric("arbesk_process_memory_bytes", "gauge", "Backend process memory.", [
    { labels: { type: "rss" }, value: mem.rss },
    { labels: { type: "heap_used" }, value: mem.heapUsed },
    { labels: { type: "heap_total" }, value: mem.heapTotal },
  ]);
  w.metric("arbesk_process_uptime_seconds", "gauge", "Backend process uptime.", [
    { value: Math.floor(process.uptime()) },
  ]);
}

function writeHostMetrics(w: MetricsWriter): void {
  const modes = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
  const cpus = os.cpus();
  for (const { times } of cpus) {
    for (const mode of Object.keys(modes) as Array<keyof typeof modes>) modes[mode] += times[mode];
  }
  w.metric("arbesk_host_cpu_seconds_total", "counter", "Host CPU time summed over all cores.",
    Object.entries(modes).map(([mode, ms]) => ({ labels: { mode }, value: ms / 1000 })));
  w.metric("arbesk_host_cpus", "gauge", "Host logical CPU count.", [{ value: cpus.length }]);
  w.metric("arbesk_host_memory_bytes", "gauge", "Host memory.", [
    { labels: { type: "total" }, value: os.totalmem() },
    { labels: { type: "free" }, value: os.freemem() },
  ]);
  const [l1, l5, l15] = os.loadavg();
  w.metric("arbesk_host_load", "gauge", "Host load average.", [
    { labels: { window: "1m" }, value: l1 },
    { labels: { window: "5m" }, value: l5 },
    { labels: { window: "15m" }, value: l15 },
  ]);
}

/** Renders every Arbesk metric in Prometheus text format. */
export function renderMetrics(stats: IndexerStats[]): string {
  const w = new MetricsWriter();
  writeIndexerMetrics(w, stats);
  writeProcessMetrics(w);
  writeHostMetrics(w);
  return w.toString();
}

/**
 * GET /metrics — Prometheus scrape endpoint.
 * @remarks Reads indexer state only; never triggers an RPC catch-up.
 */
export default function metricsRoutes() {
  const app = new Hono();
  app.get("/", (c) => {
    const body = renderMetrics(listIndexers().map((i) => i.getStats()));
    return c.body(body, 200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
  });
  return app;
}
