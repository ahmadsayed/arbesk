/**
 * Per-wallet CAD quota and concurrency lock.
 * @remarks Two concerns live here because they are decided together at
 *   admission: (1) one in-flight request per wallet, held in memory only, since
 *   in-flight work cannot survive a restart; (2) a daily LLM-request counter,
 *   persisted under .data/ because a cap that evaporates on deploy is not a cap.
 *   Follows the src/api/token-indexer.ts state-file precedent.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECT_ROOT } from "./project-root.ts";

export interface QuotaOptions {
  dailyLimit: number;
  lockTtlMs: number;
  now?: () => number;
  statePath?: string;
}

export type QuotaDecision =
  | { ok: true; token: string; used: number; limit: number }
  | { ok: false; reason: "IN_PROGRESS"; startedAt: number }
  | { ok: false; reason: "QUOTA"; used: number; limit: number; resetsAt: number };

interface WalletState {
  /** UTC day key (YYYY-MM-DD) this count belongs to. */
  day: string;
  used: number;
}

interface PersistedState {
  wallets: Record<string, WalletState>;
}

const DATA_DIR = path.resolve(PROJECT_ROOT, ".data");
const DEFAULT_STATE_PATH = path.join(DATA_DIR, "cad-quota.json");
const PRUNE_AFTER_DAYS = 2;

/** wallet -> { token, startedAt } for requests currently running. */
const locks = new Map<string, { token: string; startedAt: number }>();
let state: PersistedState | null = null;

function nowMs(opts: QuotaOptions): number {
  return opts.now ? opts.now() : Date.now();
}

/** UTC day key, so the quota rolls over at 00:00 UTC regardless of host TZ. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch seconds of the next UTC midnight. */
function nextUtcMidnightSeconds(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000;
}

function statePathOf(opts: QuotaOptions): string {
  return opts.statePath ?? DEFAULT_STATE_PATH;
}

/**
 * Loads the persisted counters.
 * @remarks A missing, corrupt or wrongly-shaped file starts from zero rather
 *   than failing the request: the quota is a guard rail, not an authorization
 *   boundary.
 */
function loadState(opts: QuotaOptions): PersistedState {
  if (state) return state;
  const file = statePathOf(opts);
  try {
    if (!fs.existsSync(file)) {
      state = { wallets: {} };
      return state;
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PersistedState;
    state = parsed && typeof parsed === "object" && parsed.wallets && typeof parsed.wallets === "object"
      ? parsed
      : { wallets: {} };
    if (state !== parsed) console.log("[CAD] quota state unreadable - starting from zero");
  } catch {
    console.log("[CAD] quota state unreadable - starting from zero");
    state = { wallets: {} };
  }
  return state;
}

/** Prunes entries older than the retention window and writes atomically. */
function pruneAndSave(opts: QuotaOptions, current: PersistedState, now: number): void {
  const cutoff = utcDay(now - PRUNE_AFTER_DAYS * 86400000);
  for (const [wallet, entry] of Object.entries(current.wallets)) {
    if (entry.day < cutoff) delete current.wallets[wallet];
  }
  const file = statePathOf(opts);
  try {
    if (!fs.existsSync(path.dirname(file))) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.log("[CAD] quota state save failed: " + (err as Error).message);
  }
}

/** The limits one CAD request's worst-case duration is derived from. */
export interface CadRequestLimits {
  /** Provider calls one admitted request may spend (initial attempt + repairs). */
  attempts: number;
  /** Per-call provider timeout - the DeepSeek client's timeoutMs. */
  providerTimeoutMs: number;
  /** Per-attempt kernel (Manifold) execution timeout. */
  kernelTimeoutMs: number;
}

/**
 * What @arbesk/cad-gen and the DeepSeek client ship with: 3 attempts, a 120s
 * per-call provider timeout and a 10s kernel timeout.
 */
export const CAD_DEFAULT_REQUEST_LIMITS: CadRequestLimits = {
  attempts: 3,
  providerTimeoutMs: 120000,
  kernelTimeoutMs: 10000,
};

/**
 * Head-room over the worst case: prompt assembly, kernel WASM cold start,
 * response serialization and the skew between admission and the first call.
 */
export const CAD_LOCK_TTL_MARGIN_MS = 30000;

/**
 * Derives the in-flight lock TTL from the limits that bound the request.
 * @remarks A TTL shorter than the request it guards expires mid-request, which
 *   admits a second concurrent generation for the same wallet and defeats the
 *   one-in-flight guarantee. Deriving it from attempts x (provider timeout +
 *   kernel timeout) means retuning those numbers cannot leave the TTL behind.
 * @param limits The limits the generation loop is actually configured with.
 * @returns The worst-case request duration plus the margin, in milliseconds.
 */
export function lockTtlFor(limits: CadRequestLimits): number {
  return limits.attempts * (limits.providerTimeoutMs + limits.kernelTimeoutMs)
    + CAD_LOCK_TTL_MARGIN_MS;
}

/**
 * Effective lock TTL: CAD_MAX_REQUEST_MS when an operator set a usable positive
 * value, otherwise the value derived from `limits`.
 * @remarks Callers must pass the same limits they hand the generator, so the
 *   default tracks the real worst case instead of a hard-coded 120s.
 * @param limits Limits the generation loop is configured with.
 * @param env Environment holding the operator override (injectable for tests).
 */
export function cadLockTtlMs(
  limits: CadRequestLimits = CAD_DEFAULT_REQUEST_LIMITS,
  env: Record<string, string | undefined> = process.env,
): number {
  const override = Number(env.CAD_MAX_REQUEST_MS);
  return Number.isFinite(override) && override > 0 ? override : lockTtlFor(limits);
}

/**
 * Admits or rejects one CAD request for a wallet.
 * @remarks Called synchronously so the quota check and lock acquisition cannot
 *   race (spec section 6, admission order). The quota is charged here, once per
 *   admitted request, and never per internal repair attempt.
 */
export function acquireCadSlot(wallet: string, opts: QuotaOptions): QuotaDecision {
  const now = nowMs(opts);
  const key = wallet.toLowerCase();

  const held = locks.get(key);
  if (held) {
    if (now - held.startedAt <= opts.lockTtlMs) {
      return { ok: false, reason: "IN_PROGRESS", startedAt: held.startedAt };
    }
    // Expired: whatever held it is gone (a lock never outlives its request, and
    // in-flight state dies with the process). Drop it so the table cannot grow.
    locks.delete(key);
  }

  const current = loadState(opts);
  const day = utcDay(now);
  const entry = current.wallets[key];
  const used = entry && entry.day === day ? entry.used : 0;

  if (used >= opts.dailyLimit) {
    return {
      ok: false,
      reason: "QUOTA",
      used,
      limit: opts.dailyLimit,
      resetsAt: nextUtcMidnightSeconds(now),
    };
  }

  const token = randomUUID();
  locks.set(key, { token, startedAt: now });
  current.wallets[key] = { day, used: used + 1 };
  pruneAndSave(opts, current, now);
  console.log("[CAD] wallet=" + key + " quota=" + (used + 1) + "/" + opts.dailyLimit);

  return { ok: true, token, used: used + 1, limit: opts.dailyLimit };
}

/**
 * Releases the in-flight lock.
 * @remarks A release with a stale token is ignored: a lock is only ever freed
 *   by the request that took it.
 */
export function releaseCadSlot(wallet: string, token: string): void {
  const key = wallet.toLowerCase();
  const held = locks.get(key);
  if (held && held.token === token) locks.delete(key);
}

/** Quota headers, so a UI can show the remaining budget. */
export function cadQuotaHeaders(wallet: string, opts: QuotaOptions): Record<string, string> {
  const now = nowMs(opts);
  const current = loadState(opts);
  const entry = current.wallets[wallet.toLowerCase()];
  const used = entry && entry.day === utcDay(now) ? entry.used : 0;
  return {
    "X-Cad-Quota-Limit": String(opts.dailyLimit),
    "X-Cad-Quota-Remaining": String(Math.max(0, opts.dailyLimit - used)),
    "X-Cad-Quota-Reset": String(nextUtcMidnightSeconds(now)),
  };
}

/** Test helper: drops the in-memory counters and the lock table. */
export function _resetCadQuota(): void {
  locks.clear();
  state = null;
}
