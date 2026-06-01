/**
 * Arbesk Micro-Ledger Store
 *
 * Append-only JSONL file store with query support.
 * Each line is a complete JSON LedgerEntry. No in-place mutations.
 *
 * Storage path: logs/ledger.jsonl (relative to project root)
 */

import fs from "fs";
import path from "path";
import url from "url";
import { validateLedgerEntry } from "./schema.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const LEDGER_PATH = path.resolve(__dirname, "../../logs/ledger.jsonl");

// In-memory cache for fast queries (rebuilt on startup)
let entries = [];
let initialized = false;

/**
 * Ensure the logs directory and ledger file exist.
 */
function ensureLedgerFile() {
  const dir = path.dirname(LEDGER_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(LEDGER_PATH)) {
    fs.writeFileSync(LEDGER_PATH, "", "utf-8");
  }
}

/**
 * Load all entries from the JSONL file into memory.
 * Called once at startup.
 */
export function loadLedger() {
  ensureLedgerFile();

  entries = [];
  const raw = fs.readFileSync(LEDGER_PATH, "utf-8");
  const lines = raw.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
    } catch (err) {
      console.warn(`[LEDGER] skipping malformed line: ${err.message}`);
    }
  }

  initialized = true;
  console.log(`[LEDGER] loaded ${entries.length} entries from ${LEDGER_PATH}`);
  return entries.length;
}

/**
 * Append a single entry to the ledger file and in-memory cache.
 * Validates before writing.
 *
 * @param {Object} entry
 * @returns {{ success: boolean, entry?: Object, error?: string }}
 */
export function appendEntry(entry) {
  if (!initialized) {
    loadLedger();
  }

  const validation = validateLedgerEntry(entry);
  if (!validation.valid) {
    const errMsg = `Invalid entry: ${validation.errors.join("; ")}`;
    console.error(`[LEDGER] ${errMsg}`);
    return { success: false, error: errMsg };
  }

  try {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(LEDGER_PATH, line, "utf-8");
    entries.push(entry);
    console.log(
      `[LEDGER] append ${entry.opType} | manifestId=${entry.manifestId} cid=${entry.cid}`
    );
    return { success: true, entry };
  } catch (err) {
    console.error(`[LEDGER] append failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Query ledger entries with optional filters.
 *
 * @param {Object} filters
 * @param {string} [filters.manifestId] - Filter by manifest
 * @param {string} [filters.opType] - Filter by operation type
 * @param {string} [filters.actorAddress] - Filter by actor
 * @param {number} [filters.since] - Timestamp lower bound (inclusive)
 * @param {number} [filters.until] - Timestamp upper bound (inclusive)
 * @param {number} [filters.limit=50] - Max entries
 * @param {number} [filters.offset=0] - Pagination offset
 * @returns {{ entries: Object[], total: number }}
 */
export function queryLedger(filters = {}) {
  if (!initialized) {
    loadLedger();
  }

  const {
    manifestId,
    opType,
    actorAddress,
    since,
    until,
    limit = 50,
    offset = 0,
  } = filters;

  let filtered = entries;

  if (manifestId) {
    filtered = filtered.filter((e) => e.manifestId === manifestId);
  }
  if (opType) {
    filtered = filtered.filter((e) => e.opType === opType);
  }
  if (actorAddress) {
    filtered = filtered.filter(
      (e) => e.actorAddress.toLowerCase() === actorAddress.toLowerCase()
    );
  }
  if (since) {
    filtered = filtered.filter((e) => e.timestamp >= since);
  }
  if (until) {
    filtered = filtered.filter((e) => e.timestamp <= until);
  }

  // Most recent first
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const total = filtered.length;
  const page = filtered.slice(offset, offset + Math.min(limit, 500));

  return { entries: page, total, limit: Math.min(limit, 500), offset };
}

/**
 * Get aggregated stats from the ledger.
 */
export function getLedgerStats() {
  if (!initialized) {
    loadLedger();
  }

  const stats = {
    totalOperations: entries.length,
    byOpType: {},
    byDay: {},
    uniqueManifests: new Set(),
    uniqueActors: new Set(),
  };

  for (const entry of entries) {
    stats.byOpType[entry.opType] = (stats.byOpType[entry.opType] || 0) + 1;
    stats.uniqueManifests.add(entry.manifestId);
    stats.uniqueActors.add(entry.actorAddress.toLowerCase());

    const day = new Date(entry.timestamp).toISOString().split("T")[0];
    stats.byDay[day] = (stats.byDay[day] || 0) + 1;
  }

  return {
    totalOperations: stats.totalOperations,
    byOpType: stats.byOpType,
    byDay: stats.byDay,
    uniqueManifests: stats.uniqueManifests.size,
    uniqueActors: stats.uniqueActors.size,
  };
}

/**
 * Get the total number of entries.
 */
export function getEntryCount() {
  if (!initialized) {
    loadLedger();
  }
  return entries.length;
}
