/**
 * Sign-in tracking: per-method sign-in counts and distinct/active wallets,
 * persisted under .data/ so the numbers survive a deploy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, expect, test } from "bun:test";

const ALICE = "0x00000000000000000000000000000000000000A1";
const BOB = "0x00000000000000000000000000000000000000b0";
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1);

/** @type {string} */
let statePath;

beforeEach(async () => {
  statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "signin-stats-")), "signin-stats.json");
  const mod = await import("../src/api/signin-stats.ts");
  mod._resetSigninStats();
});

async function load() {
  return import("../src/api/signin-stats.ts");
}

test("classifySignin: an EOA signing for a different session address is an email smart account", async () => {
  const { classifySignin } = await load();
  expect(classifySignin(ALICE, { eoaAddress: BOB })).toBe("email");
  expect(classifySignin(ALICE, { eoaAddress: ALICE.toLowerCase() })).toBe("wallet");
  expect(classifySignin(ALICE, {})).toBe("wallet");
});

test("counts sign-ins and distinct wallets per method, case-insensitively", async () => {
  const { recordSignin, getSigninStats } = await load();
  recordSignin(ALICE, "wallet", { statePath, now: () => T0 });
  recordSignin(ALICE.toLowerCase(), "wallet", { statePath, now: () => T0 + 1000 });
  recordSignin(BOB, "email", { statePath, now: () => T0 });

  const stats = getSigninStats({ statePath, now: () => T0 + 2000 });
  expect(stats.wallet).toMatchObject({ signins: 2, wallets: 1 });
  expect(stats.email).toMatchObject({ signins: 1, wallets: 1 });
});

test("active windows count wallets by their last sign-in", async () => {
  const { recordSignin, getSigninStats } = await load();
  recordSignin(ALICE, "wallet", { statePath, now: () => T0 });
  recordSignin(BOB, "wallet", { statePath, now: () => T0 + 20 * DAY });

  const stats = getSigninStats({ statePath, now: () => T0 + 20 * DAY + 1000 });
  expect(stats.wallet.active).toEqual({ "24h": 1, "7d": 1, "30d": 2 });
});

test("state persists to disk without raw addresses and reloads after a restart", async () => {
  const mod = await load();
  mod.recordSignin(ALICE, "wallet", { statePath, now: () => T0 });

  const raw = fs.readFileSync(statePath, "utf8");
  expect(raw.toLowerCase()).not.toContain(ALICE.slice(2).toLowerCase());

  mod._resetSigninStats();
  expect(mod.getSigninStats({ statePath, now: () => T0 }).wallet).toMatchObject({ signins: 1, wallets: 1 });
});

test("a missing or corrupt state file starts from zero", async () => {
  const { getSigninStats, _resetSigninStats } = await load();
  expect(getSigninStats({ statePath, now: () => T0 }).wallet).toEqual({
    signins: 0,
    wallets: 0,
    active: { "24h": 0, "7d": 0, "30d": 0 },
  });
  fs.writeFileSync(statePath, "{not json");
  _resetSigninStats();
  expect(getSigninStats({ statePath, now: () => T0 }).email.signins).toBe(0);
});
