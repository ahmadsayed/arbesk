/**
 * Sign-in tracking for GET /metrics.
 * @remarks Sessions live in memory and die with the process, so they cannot
 *   answer "how many wallets have signed in". This keeps a per-method sign-in
 *   count and each wallet's first/last sign-in time, persisted under .data/
 *   (the cad-quota.ts state-file precedent) so the numbers survive a deploy.
 *   Wallets are stored as truncated SHA-256 hashes, never raw addresses: the
 *   metrics only need distinct counts.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PROJECT_ROOT } from "./project-root.ts";

/** email = CDP email-login smart account; wallet = browser wallet (EOA). */
export type SigninMethod = "email" | "wallet";
export const SIGNIN_METHODS: SigninMethod[] = ["email", "wallet"];

export interface SigninOptions {
  now?: () => number;
  statePath?: string;
}

interface WalletEntry {
  first: number;
  last: number;
}

interface MethodState {
  signins: number;
  wallets: Record<string, WalletEntry>;
}

type PersistedState = Record<SigninMethod, MethodState>;

export interface MethodStats {
  signins: number;
  wallets: number;
  active: { "24h": number; "7d": number; "30d": number };
}

const DAY_MS = 86400000;
const ACTIVE_WINDOWS = { "24h": DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS } as const;
const DEFAULT_STATE_PATH = path.join(path.resolve(PROJECT_ROOT, ".data"), "signin-stats.json");

let state: PersistedState | null = null;

function emptyState(): PersistedState {
  return { email: { signins: 0, wallets: {} }, wallet: { signins: 0, wallets: {} } };
}

function nowMs(opts: SigninOptions): number {
  return opts.now ? opts.now() : Date.now();
}

function walletKey(address: string): string {
  return createHash("sha256").update(address.toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Tells an email-login smart account from a browser wallet.
 * @remarks CDP smart accounts sign SIWE through their owner EOA, so the proof's
 *   eoaAddress differs from the session address; a browser wallet signs for
 *   itself (eoaAddress absent or equal).
 */
export function classifySignin(address: string, proof: { eoaAddress?: string }): SigninMethod {
  const eoa = proof.eoaAddress?.toLowerCase();
  return eoa && eoa !== address.toLowerCase() ? "email" : "wallet";
}

function isMethodState(v: unknown): v is MethodState {
  const m = v as MethodState;
  return !!m && typeof m.signins === "number" && !!m.wallets && typeof m.wallets === "object";
}

/** Loads persisted stats; a missing, corrupt or wrongly-shaped file starts from zero. */
function loadState(opts: SigninOptions): PersistedState {
  if (state) return state;
  const file = opts.statePath ?? DEFAULT_STATE_PATH;
  state = emptyState();
  try {
    if (!fs.existsSync(file)) return state;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const method of SIGNIN_METHODS) {
      if (isMethodState(parsed?.[method])) state[method] = parsed[method];
    }
  } catch {
    console.log("[SIGNIN] stats state unreadable - starting from zero");
  }
  return state;
}

function save(opts: SigninOptions, current: PersistedState): void {
  const file = opts.statePath ?? DEFAULT_STATE_PATH;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(current));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.log("[SIGNIN] stats state save failed: " + (err as Error).message);
  }
}

/** Records one successful sign-in. Never throws: stats must not break login. */
export function recordSignin(address: string, method: SigninMethod, opts: SigninOptions = {}): void {
  try {
    const current = loadState(opts);
    const now = nowMs(opts);
    const m = current[method];
    m.signins += 1;
    const key = walletKey(address);
    const entry = m.wallets[key];
    m.wallets[key] = { first: entry?.first ?? now, last: now };
    save(opts, current);
  } catch (err) {
    console.log("[SIGNIN] record failed: " + (err as Error).message);
  }
}

/** Per-method sign-in totals, distinct wallets, and wallets active per window. */
export function getSigninStats(opts: SigninOptions = {}): Record<SigninMethod, MethodStats> {
  const current = loadState(opts);
  const now = nowMs(opts);
  const out = {} as Record<SigninMethod, MethodStats>;
  for (const method of SIGNIN_METHODS) {
    const entries = Object.values(current[method].wallets);
    const activeWithin = (ms: number) => entries.filter((e) => now - e.last <= ms).length;
    out[method] = {
      signins: current[method].signins,
      wallets: entries.length,
      active: {
        "24h": activeWithin(ACTIVE_WINDOWS["24h"]),
        "7d": activeWithin(ACTIVE_WINDOWS["7d"]),
        "30d": activeWithin(ACTIVE_WINDOWS["30d"]),
      },
    };
  }
  return out;
}

/** Test helper: drops the in-memory state so the next call reloads from disk. */
export function _resetSigninStats(): void {
  state = null;
}
