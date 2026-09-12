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
  /** LLM requests per wallet per UTC day; an unusable value refuses everything. */
  dailyLimit: number;
  /** In-flight lock TTL; an unusable value falls back to the derived TTL. */
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

/** Unusable values already reported, so a broken config cannot flood the log. */
const reportedBadValues = new Set<string>();

/**
 * Reports an unusable configuration value once per distinct (kind, value) pair.
 * @remarks Printing the number the caller passed - never the raw environment
 *   string - keeps a mistyped value from being echoed as if it were a secret,
 *   and the dedupe keeps a broken config from filling the log with one line per
 *   request while still telling an operator why requests are being refused.
 */
function reportBadValue(kind: string, value: number, consequence: string): void {
  const why = Number.isNaN(value) ? "NaN" : String(value);
  const key = kind + "=" + why;
  if (reportedBadValues.has(key)) return;
  reportedBadValues.add(key);
  console.log("[CAD] " + kind + " " + why + " is not a finite number >= 1 - " + consequence);
}

/** True for the only values that bound a guard usefully. */
function isUsableBound(value: number): boolean {
  return Number.isFinite(value) && value >= 1;
}

/**
 * Normalizes a caller-supplied daily limit.
 * @remarks Fail closed, deliberately. A typo'd env var parses to NaN and an
 *   `Infinity` slips through `Number()` too; both make `used >= limit` false
 *   forever, so the guard would silently degrade to unlimited spend - invisible
 *   until the bill arrives. A guard that protects a server-side key must not be
 *   switchable off by passing garbage, so anything that is not a finite number
 *   >= 1 is normalized to 0, which refuses every request through the normal
 *   QUOTA branch (a negative value is 0 as well - never silently permissive).
 * @param limit Raw limit from the caller, usually parsed from the environment.
 * @returns The limit to enforce: the input when usable, otherwise 0.
 */
export function dailyLimitOf(limit: number): number {
  if (isUsableBound(limit)) return limit;
  reportBadValue("daily limit", limit, "refusing all CAD requests (fail closed)");
  return 0;
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

/**
 * The limits one CAD request's worst-case duration is derived from.
 * @remarks There is deliberately no kernel term. The server no longer runs the
 *   kernel in the request path - it runs static gates only - so a request is
 *   bounded by provider calls and nothing else. The kernel timeout moved to the
 *   client along with the kernel.
 */
export interface CadRequestLimits {
  /** Provider calls one admitted request may spend (initial attempt + repairs). */
  attempts: number;
  /** Per-call provider timeout - the DeepSeek client's timeoutMs. */
  providerTimeoutMs: number;
}

/**
 * What @arbesk/cad-gen and the DeepSeek client ship with: 3 provider calls at a
 * 120s per-call timeout.
 */
export const CAD_DEFAULT_REQUEST_LIMITS: CadRequestLimits = {
  attempts: 3,
  providerTimeoutMs: 120000,
};

/**
 * Head-room over the worst case: prompt assembly, response serialization and the
 * skew between admission and the first provider call.
 */
export const CAD_LOCK_TTL_MARGIN_MS = 30000;

/**
 * Derives the in-flight lock TTL from the limits that bound the request.
 * @remarks A TTL shorter than the request it guards expires mid-request, which
 *   admits a second concurrent generation for the same wallet and defeats the
 *   one-in-flight guarantee. Deriving it from attempts x provider timeout means
 *   retuning those numbers cannot leave the TTL behind.
 * @param limits The limits the generation loop is actually configured with.
 * @returns The worst-case request duration plus the margin, in milliseconds.
 */
export function lockTtlFor(limits: CadRequestLimits): number {
  return limits.attempts * limits.providerTimeoutMs + CAD_LOCK_TTL_MARGIN_MS;
}

/** The derived worst case for the shipped defaults - the backstop below. */
const DEFAULT_LOCK_TTL_MS = lockTtlFor(CAD_DEFAULT_REQUEST_LIMITS);

/**
 * Normalizes a caller-supplied lock TTL.
 * @remarks The opposite direction from the daily limit: a safe value exists for
 *   a TTL - the derived worst case - so an unusable one falls back to it instead
 *   of being refused. `now - startedAt <= NaN` (or <= 0) is false, which drops
 *   the in-flight lock entirely and lets one wallet run unlimited concurrent
 *   generations with no error anywhere; falling back keeps it held.
 *   The backstop is derived from the shipped default limits, so a caller with
 *   retuned limits must supply a usable TTL - cadLockTtlMs does that for it.
 * @param ttlMs Raw TTL from the caller, usually parsed from the environment.
 * @returns The TTL to enforce: the input when usable, otherwise the derived one.
 */
export function lockTtlOf(ttlMs: number): number {
  if (isUsableBound(ttlMs)) return ttlMs;
  reportBadValue("lock TTL", ttlMs, "using the derived worst-case TTL");
  return DEFAULT_LOCK_TTL_MS;
}

/**
 * Effective lock TTL: CAD_MAX_REQUEST_MS when an operator set a usable positive
 * value, otherwise the value derived from `limits`.
 * @remarks `limits` is deliberately required: an omitted argument would
 *   silently under-derive the TTL from the defaults, which is the same
 *   guard-off-by-accident failure this module normalizes away elsewhere.
 * @param limits Limits the generation loop is configured with.
 * @param env Environment holding the operator override (injectable for tests).
 */
export function cadLockTtlMs(
  limits: CadRequestLimits,
  env: Record<string, string | undefined> = process.env,
): number {
  const override = Number(env.CAD_MAX_REQUEST_MS);
  return isUsableBound(override) ? override : lockTtlFor(limits);
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
  const limit = dailyLimitOf(opts.dailyLimit);
  const ttlMs = lockTtlOf(opts.lockTtlMs);

  const held = locks.get(key);
  if (held) {
    if (now - held.startedAt <= ttlMs) {
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

  if (used >= limit) {
    return {
      ok: false,
      reason: "QUOTA",
      used,
      limit,
      resetsAt: nextUtcMidnightSeconds(now),
    };
  }

  const token = randomUUID();
  locks.set(key, { token, startedAt: now });
  current.wallets[key] = { day, used: used + 1 };
  pruneAndSave(opts, current, now);
  console.log("[CAD] wallet=" + key + " quota=" + (used + 1) + "/" + limit);

  return { ok: true, token, used: used + 1, limit };
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
  const limit = dailyLimitOf(opts.dailyLimit);
  const entry = current.wallets[wallet.toLowerCase()];
  const used = entry && entry.day === utcDay(now) ? entry.used : 0;
  return {
    "X-Cad-Quota-Limit": String(limit),
    "X-Cad-Quota-Remaining": String(Math.max(0, limit - used)),
    "X-Cad-Quota-Reset": String(nextUtcMidnightSeconds(now)),
  };
}

/** Test helper: drops the in-memory counters, the lock table and the log memory. */
export function _resetCadQuota(): void {
  locks.clear();
  reportedBadValues.clear();
  state = null;
}
