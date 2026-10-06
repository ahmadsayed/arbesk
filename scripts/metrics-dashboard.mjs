#!/usr/bin/env bun
// @ts-check
/**
 * btop-style terminal dashboard for the backend's Prometheus endpoint.
 *
 * Polls GET /metrics and draws per-chain asset/wallet counts from the token
 * indexer, indexer sync state, and backend process + host load. No Grafana,
 * no Prometheus server — it reads the scrape endpoint directly.
 *
 * Usage:
 *   bun scripts/metrics-dashboard.mjs              # https://promptscad.com/metrics
 *   bun scripts/metrics-dashboard.mjs --url http://localhost:9090/metrics --interval 5
 *   bun scripts/metrics-dashboard.mjs --once      # print one frame and exit
 *
 * Keys: q / Ctrl-C quit.
 */

import { Command } from "commander";

const HISTORY = 120;
const SPARK = "▁▂▃▄▅▆▇█";
// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const ANSI = /\x1b\[[0-9;]*m/g;

/** @param {string} s */
export const stripAnsi = (s) => s.replace(ANSI, "");

/** @typedef {{ name: string, labels: Record<string, string>, value: number }} Sample */
/** @typedef {{ t: number, hostBusy: number, hostTotal: number, procCpu: number }} CpuMark */
/** @typedef {{ series: Map<string, number[]>, lastCpu: CpuMark | null }} History */

// ─── Prometheus text parsing ─────────────────────────────────────────────────

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
 * @param {Sample[]} samples
 * @param {string} name
 * @param {Record<string, string>} [where]
 */
function pick(samples, name, where = {}) {
  return samples.filter(
    (s) => s.name === name && Object.entries(where).every(([k, v]) => s.labels[k] === v),
  );
}

/**
 * @param {Sample[]} samples
 * @param {string} name
 * @param {Record<string, string>} [where]
 */
function value(samples, name, where) {
  return pick(samples, name, where).reduce((sum, s) => sum + s.value, 0);
}

// ─── Drawing primitives ──────────────────────────────────────────────────────

let useColor = !process.env.NO_COLOR;

/** @param {string} code @param {string} s */
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  dim: (/** @type {string} */ s) => paint("2", s),
  bold: (/** @type {string} */ s) => paint("1", s),
  cyan: (/** @type {string} */ s) => paint("36", s),
  green: (/** @type {string} */ s) => paint("32", s),
  yellow: (/** @type {string} */ s) => paint("33", s),
  red: (/** @type {string} */ s) => paint("31", s),
  magenta: (/** @type {string} */ s) => paint("35", s),
};

/** @param {string} s */
const visible = (s) => stripAnsi(s).length;

/** @param {string} s @param {number} width */
function fit(s, width) {
  const len = visible(s);
  if (len <= width) return s + " ".repeat(width - len);
  // Truncate plain text only; coloured lines are kept short by construction.
  return stripAnsi(s).slice(0, Math.max(0, width - 1)) + "…";
}

/**
 * @param {number[]} values
 * @param {number} width
 */
export function sparkline(values, width) {
  const tail = values.slice(-width);
  if (tail.length === 0) return "";
  const lo = Math.min(...tail);
  const hi = Math.max(...tail);
  const span = hi - lo;
  return tail
    .map((v) => SPARK[span === 0 ? 0 : Math.round(((v - lo) / span) * (SPARK.length - 1))])
    .join("");
}

/**
 * Horizontal meter, coloured by fill level unless a fixed colour is given.
 * @param {number} ratio 0..1
 * @param {number} width
 * @param {(s: string) => string} [fixed]
 */
export function meter(ratio, width, fixed) {
  const r = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(r * width);
  const colour = fixed ?? (r > 0.85 ? c.red : r > 0.6 ? c.yellow : c.green);
  return colour("■".repeat(filled)) + c.dim("·".repeat(width - filled));
}

/**
 * @param {string} title
 * @param {string[]} body
 * @param {number} width outer width including borders
 */
function box(title, body, width) {
  const inner = width - 2;
  const head = `─ ${title} `;
  const top = c.dim("┌") + head + c.dim("─".repeat(Math.max(0, inner - visible(head)))) + c.dim("┐");
  const rows = body.map((l) => c.dim("│") + fit(` ${l}`, inner) + c.dim("│"));
  return [top, ...rows, c.dim("└" + "─".repeat(inner) + "┘")];
}

/** @param {number} n */
const num = (n) => n.toLocaleString("en-US");

/** @param {number} bytes */
function human(bytes) {
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

// ─── History ─────────────────────────────────────────────────────────────────

/** @returns {History} */
export function createHistory() {
  return { series: new Map(), lastCpu: null };
}

/** @param {History} h @param {string} key @param {number} v */
function record(h, key, v) {
  const arr = h.series.get(key) ?? [];
  arr.push(v);
  if (arr.length > HISTORY) arr.shift();
  h.series.set(key, arr);
}

/**
 * Folds one scrape into the history and returns derived CPU percentages.
 * @param {History} h
 * @param {Sample[]} samples
 * @param {number} now epoch ms
 */
export function observe(h, samples, now) {
  const hostTotal = value(samples, "arbesk_host_cpu_seconds_total");
  const hostIdle = value(samples, "arbesk_host_cpu_seconds_total", { mode: "idle" });
  const procCpu = value(samples, "arbesk_process_cpu_seconds_total");
  /** @type {CpuMark} */
  const mark = { t: now, hostBusy: hostTotal - hostIdle, hostTotal, procCpu };

  let hostPct = NaN;
  let procPct = NaN;
  const prev = h.lastCpu;
  if (prev && mark.hostTotal > prev.hostTotal) {
    hostPct = (mark.hostBusy - prev.hostBusy) / (mark.hostTotal - prev.hostTotal);
    // Percent of one core, like top/btop per-process CPU.
    procPct = (mark.procCpu - prev.procCpu) / ((mark.t - prev.t) / 1000);
  }
  h.lastCpu = mark;
  if (Number.isFinite(hostPct)) record(h, "host_cpu", hostPct);
  if (Number.isFinite(procPct)) record(h, "proc_cpu", procPct);

  for (const s of pick(samples, "arbesk_assets", { state: "live" })) {
    record(h, `assets:${s.labels.chain_id}`, s.value);
  }
  for (const s of pick(samples, "arbesk_wallets")) {
    record(h, `wallets:${s.labels.chain_id}`, s.value);
  }
  return { hostPct, procPct };
}

// ─── Panels ──────────────────────────────────────────────────────────────────

/**
 * @param {Sample[]} samples
 * @param {History} h
 * @param {string} chainId
 * @param {number} width
 * @param {number} nowSec
 */
function chainPanel(samples, h, chainId, width, nowSec) {
  const where = { chain_id: chainId };
  const network = pick(samples, "arbesk_wallets", where)[0]?.labels.network ?? chainId;
  const live = value(samples, "arbesk_assets", { ...where, state: "live" });
  const burned = value(samples, "arbesk_assets", { ...where, state: "burned" });
  const minted = value(samples, "arbesk_assets_minted", where);
  const wallets = value(samples, "arbesk_wallets", where);
  const editors = value(samples, "arbesk_editors", where);
  const shared = value(samples, "arbesk_shared_assets", where);
  const scanned = value(samples, "arbesk_indexer_last_scanned_block", where);
  const head = value(samples, "arbesk_indexer_chain_head_block", where);
  const lastOk = value(samples, "arbesk_indexer_last_success_timestamp_seconds", where);
  const chunk = value(samples, "arbesk_indexer_log_chunk_size", where);

  const lag = Math.max(0, head - scanned);
  const age = lastOk ? nowSec - lastOk : Infinity;
  let status;
  if (head === 0) status = c.red("● waiting for first catch-up");
  else if (lastOk === 0) status = c.yellow(`● backfilling (${num(lag)} behind)`);
  else if (age > 120) status = c.red(`● stale ${duration(age)}`);
  else if (lag > 0) status = c.yellow(`● catching up (${num(lag)} behind)`);
  else status = c.green("● synced");

  const sparkW = Math.max(10, width - 16);
  const top = pick(samples, "arbesk_wallet_assets", where).sort((a, b) => b.value - a.value);
  const topMax = top[0]?.value ?? 1;
  const barW = Math.min(40, Math.max(6, width - 30));

  const body = [
    `${c.bold("Assets ")}  ${c.cyan(num(live))} live   ${c.dim(`${num(burned)} burned · ${num(minted)} minted`)}`,
    `${c.bold("Wallets")}  ${c.magenta(num(wallets))} holding   ${c.dim(`${num(editors)} editors · ${num(shared)} shared assets`)}`,
    `${c.bold("Indexer")}  ${status}  ${c.dim(`block ${num(scanned)}/${num(head)} · chunk ${num(chunk)}`)}`,
    "",
    `${c.dim("assets ")}  ${c.cyan(sparkline(h.series.get(`assets:${chainId}`) ?? [], sparkW))}`,
    `${c.dim("wallets")}  ${c.magenta(sparkline(h.series.get(`wallets:${chainId}`) ?? [], sparkW))}`,
  ];
  if (top.length) {
    body.push("", c.dim("Top wallets"));
    for (const t of top.slice(0, 5)) {
      body.push(`  ${shortAddr(t.labels.address).padEnd(12)} ${meter(t.value / topMax, barW, c.cyan)} ${num(t.value)}`);
    }
  }
  return box(`${c.bold(network)} ${c.dim(`#${chainId}`)}`, body, width);
}

/**
 * @param {Sample[]} samples
 * @param {History} h
 * @param {{ hostPct: number, procPct: number }} cpu
 * @param {number} width
 */
function systemPanel(samples, h, cpu, width) {
  const barW = Math.max(10, Math.floor((width - 30) / 2));
  const sparkW = Math.max(10, width - barW - 30);
  const pct = (/** @type {number} */ r) => (Number.isFinite(r) ? `${(r * 100).toFixed(1)}%` : "  …  ").padStart(6);
  const cores = value(samples, "arbesk_host_cpus");
  const memTotal = value(samples, "arbesk_host_memory_bytes", { type: "total" });
  const memFree = value(samples, "arbesk_host_memory_bytes", { type: "free" });
  const rss = value(samples, "arbesk_process_memory_bytes", { type: "rss" });
  const heapUsed = value(samples, "arbesk_process_memory_bytes", { type: "heap_used" });
  const load = ["1m", "5m", "15m"].map((w) => value(samples, "arbesk_host_load", { window: w }).toFixed(2));
  const uptime = value(samples, "arbesk_process_uptime_seconds");

  const body = [
    `${c.bold("Host CPU")} ${meter(cpu.hostPct, barW)} ${pct(cpu.hostPct)} ${c.green(sparkline(h.series.get("host_cpu") ?? [], sparkW))}`,
    `${c.bold("Proc CPU")} ${meter(cpu.procPct, barW)} ${pct(cpu.procPct)} ${c.green(sparkline(h.series.get("proc_cpu") ?? [], sparkW))}`,
    `${c.bold("Host mem")} ${meter((memTotal - memFree) / memTotal, barW)} ${human(memTotal - memFree)} / ${human(memTotal)}`,
    // RSS against host memory: Bun's heapUsed can exceed heapTotal, so a heap
    // ratio would be misleading.
    `${c.bold("Proc mem")} ${meter(rss / memTotal, barW)} ${human(rss)} rss  ${c.dim(`heap ${human(heapUsed)}`)}`,
    c.dim(`load ${load.join(" ")} · ${cores} cores · backend up ${duration(uptime)}`),
  ];
  return box(c.bold("System"), body, width);
}

/**
 * Renders a full frame.
 * @param {{ samples: Sample[] | null, error?: string, history: History, cpu: { hostPct: number, procPct: number }, url: string, width: number, now: number }} opts
 * @returns {string}
 */
export function renderFrame({ samples, error, history, cpu, url, width, now }) {
  const w = Math.max(50, width);
  const clock = new Date(now).toLocaleTimeString();
  const header = `${c.bold(c.cyan("arbesk"))} ${c.dim("metrics")}  ${c.dim(url)}`;
  const lines = [fit(header, w - clock.length) + c.dim(clock), ""];

  if (!samples) {
    lines.push(...box(c.red("unreachable"), [c.red(error ?? "no data"), c.dim("retrying…  (local backend? pass --url http://localhost:9090/metrics)")], w));
    return lines.join("\n");
  }

  const chains = [...new Set(pick(samples, "arbesk_wallets").map((s) => s.labels.chain_id))];
  if (chains.length === 0) {
    lines.push(...box("Indexer", [c.yellow("no indexers running yet — waiting for the backend's first catch-up")], w));
  }
  // Two chain panels side by side when the terminal is wide enough.
  const cols = chains.length > 1 && w >= 140 ? 2 : 1;
  const panelW = cols === 2 ? Math.floor((w - 1) / 2) : w;
  for (let i = 0; i < chains.length; i += cols) {
    const row = chains.slice(i, i + cols).map((id) => chainPanel(samples, history, id, panelW, now / 1000));
    const height = Math.max(...row.map((p) => p.length));
    for (let r = 0; r < height; r++) {
      lines.push(row.map((p) => p[r] ?? " ".repeat(panelW)).join(" "));
    }
  }
  lines.push(...systemPanel(samples, history, cpu, w));
  lines.push(c.dim(" q quit"));
  return lines.join("\n");
}

// ─── Main loop ───────────────────────────────────────────────────────────────

/** @param {string} url */
async function scrape(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return parsePrometheus(await res.text());
}

async function main() {
  const program = new Command()
    .name("metrics-dashboard")
    .description("btop-style terminal view of the backend /metrics endpoint")
    .option("--url <url>", "metrics endpoint", process.env.ARBESK_METRICS_URL || "https://promptscad.com/metrics")
    .option("--interval <seconds>", "refresh interval", "2")
    .option("--once", "print a single frame and exit")
    .option("--no-color", "disable colour")
    .parse();
  const opts = program.opts();
  useColor = opts.color && !process.env.NO_COLOR;
  const intervalMs = Math.max(500, Number(opts.interval) * 1000);
  const history = createHistory();

  /** @returns {Promise<string>} */
  const tick = async () => {
    const now = Date.now();
    const width = process.stdout.columns || 100;
    try {
      const samples = await scrape(opts.url);
      const cpu = observe(history, samples, now);
      return renderFrame({ samples, history, cpu, url: opts.url, width, now });
    } catch (err) {
      return renderFrame({ samples: null, error: String(/** @type {Error} */ (err).message), history, cpu: { hostPct: NaN, procPct: NaN }, url: opts.url, width, now });
    }
  };

  if (opts.once) {
    // CPU needs two scrapes for a rate; take a short baseline first.
    await tick();
    await new Promise((r) => setTimeout(r, 500));
    process.stdout.write((await tick()) + "\n");
    return;
  }

  const restore = () => {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
    process.exit(0);
  };
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  process.on("SIGINT", restore);
  process.on("SIGTERM", restore);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (d) => {
      const key = d.toString();
      if (key === "q" || key === "Q" || key === "\x03") restore();
    });
  }

  for (;;) {
    const frame = await tick();
    process.stdout.write("\x1b[H\x1b[2J" + frame);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

if (import.meta.main) {
  await main();
}
