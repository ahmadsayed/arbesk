import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import {
  acquireCadSlot, releaseCadSlot, cadQuotaHeaders, _resetCadQuota,
  lockTtlFor, cadLockTtlMs, CAD_DEFAULT_REQUEST_LIMITS, dailyLimitOf,
} from "../../src/api/cad-quota.ts";

const OPTS = { dailyLimit: 2, lockTtlMs: 1000 };
const W = "0xWallet";

let statePath;
beforeEach(() => {
  statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cad-quota-")), "q.json");
  _resetCadQuota();
});
const opts = (extra = {}) => ({ ...OPTS, statePath, ...extra });

describe("daily quota", () => {
  it("allows up to the limit then refuses", () => {
    const a = acquireCadSlot(W, opts());
    expect(a.ok).toBe(true);
    releaseCadSlot(W, a.token);

    const b = acquireCadSlot(W, opts());
    expect(b.ok).toBe(true);
    releaseCadSlot(W, b.token);

    const c = acquireCadSlot(W, opts());
    expect(c.ok).toBe(false);
    expect(c.reason).toBe("QUOTA");
    expect(c.used).toBe(2);
    expect(c.limit).toBe(2);
  });

  it("isolates wallets", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, a.token);
    const b = acquireCadSlot(W, opts());
    releaseCadSlot(W, b.token);
    expect(acquireCadSlot("0xOther", opts()).ok).toBe(true);
  });

  it("resets at the next UTC day", () => {
    let now = Date.UTC(2026, 8, 11, 23, 59, 0);
    const clock = () => now;
    for (let i = 0; i < 2; i++) {
      const d = acquireCadSlot(W, opts({ now: clock }));
      releaseCadSlot(W, d.token);
    }
    expect(acquireCadSlot(W, opts({ now: clock })).reason).toBe("QUOTA");

    now = Date.UTC(2026, 8, 12, 0, 0, 1);
    expect(acquireCadSlot(W, opts({ now: clock })).ok).toBe(true);
  });

  it("persists across a simulated restart", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, a.token);
    _resetCadQuota();
    const b = acquireCadSlot(W, opts());
    expect(b.ok).toBe(true);
    releaseCadSlot(W, b.token);
    expect(acquireCadSlot(W, opts()).reason).toBe("QUOTA");
  });

  it("starts from zero when the state file is corrupt", () => {
    fs.writeFileSync(statePath, "{ not json");
    _resetCadQuota();
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
  });

  it("tolerates a state file whose shape is wrong", () => {
    fs.writeFileSync(statePath, JSON.stringify({ nope: true }));
    _resetCadQuota();
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
  });
});

describe("unusable daily limit (fail closed)", () => {
  it("refuses rather than degrading to unlimited when the limit is not a positive number", () => {
    for (const dailyLimit of [NaN, Infinity, -1, 0]) {
      _resetCadQuota();
      const d = acquireCadSlot(W, opts({ dailyLimit }));
      expect(d.ok).toBe(false);
      expect(d.reason).toBe("QUOTA");
      expect(d.limit).toBe(0);
      expect(d.used).toBe(0);
    }
  });

  it("still admits with a valid limit", () => {
    const d = acquireCadSlot(W, opts({ dailyLimit: 1 }));
    expect(d.ok).toBe(true);
    releaseCadSlot(W, d.token);
  });

  it("advertises the enforced limit, not the caller's garbage", () => {
    _resetCadQuota();
    const h = cadQuotaHeaders(W, opts({ dailyLimit: NaN }));
    expect(h["X-Cad-Quota-Limit"]).toBe("0");
    expect(h["X-Cad-Quota-Remaining"]).toBe("0");
  });

  it("passes a usable limit through unchanged", () => {
    expect(dailyLimitOf(7)).toBe(7);
    expect(dailyLimitOf(1)).toBe(1);
  });

  it("says why it refuses, once per bad value instead of once per request", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      _resetCadQuota();
      const said = () => spy.mock.calls.filter((c) => String(c[0]).includes("daily limit")).length;
      acquireCadSlot(W, opts({ dailyLimit: NaN }));
      expect(said()).toBeGreaterThan(0);
      for (let i = 0; i < 5; i++) acquireCadSlot(W, opts({ dailyLimit: NaN }));
      expect(said()).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("unusable lock TTL (falls back to the derived value)", () => {
  /** What an unusable TTL must behave as: the derived worst case for the defaults. */
  const DERIVED = lockTtlFor(CAD_DEFAULT_REQUEST_LIMITS);

  it("still refuses a second concurrent request when the TTL is not a positive number", () => {
    for (const lockTtlMs of [NaN, Infinity, -1, 0]) {
      _resetCadQuota();
      let now = 1000;
      const clock = () => now;
      expect(acquireCadSlot(W, opts({ lockTtlMs, dailyLimit: 10, now: clock })).ok).toBe(true);
      // One millisecond later the lock must still be held: with a raw NaN or 0
      // the comparison is false and the guard would be off entirely.
      now += 1;
      const second = acquireCadSlot(W, opts({ lockTtlMs, dailyLimit: 10, now: clock }));
      expect(second.ok).toBe(false);
      expect(second.reason).toBe("IN_PROGRESS");
    }
  });

  it("holds the lock for the derived TTL, not for the garbage it was handed", () => {
    let now = 0;
    const clock = () => now;
    acquireCadSlot(W, opts({ lockTtlMs: NaN, now: clock }));

    now = DERIVED - 1;
    expect(acquireCadSlot(W, opts({ lockTtlMs: NaN, now: clock })).reason).toBe("IN_PROGRESS");

    now = DERIVED + 1;
    expect(acquireCadSlot(W, opts({ lockTtlMs: NaN, now: clock })).ok).toBe(true);
  });

  it("leaves a usable TTL alone", () => {
    let now = 1000;
    const clock = () => now;
    acquireCadSlot(W, opts({ lockTtlMs: 5000, now: clock }));
    now += 5001;
    expect(acquireCadSlot(W, opts({ lockTtlMs: 5000, now: clock })).ok).toBe(true);
  });

  it("says why it fell back, once per bad value instead of once per request", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      _resetCadQuota();
      const said = () => spy.mock.calls.filter((c) => String(c[0]).includes("lock TTL")).length;
      for (let i = 0; i < 3; i++) acquireCadSlot(W, opts({ lockTtlMs: NaN, now: () => 1000 * i }));
      expect(said()).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("in-flight lock", () => {
  it("refuses a second concurrent request for the same wallet", () => {
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
    const second = acquireCadSlot(W, opts());
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("IN_PROGRESS");
  });

  it("frees the lock once released", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, a.token);
    expect(acquireCadSlot(W, opts()).ok).toBe(true);
  });

  it("ignores a release from a stale token", () => {
    const a = acquireCadSlot(W, opts());
    releaseCadSlot(W, "not-the-token");
    expect(acquireCadSlot(W, opts()).reason).toBe("IN_PROGRESS");
    releaseCadSlot(W, a.token);
  });

  it("expires a stale lock after the TTL", () => {
    let now = 1000;
    const clock = () => now;
    acquireCadSlot(W, opts({ now: clock }));
    now += OPTS.lockTtlMs + 1;
    expect(acquireCadSlot(W, opts({ now: clock })).ok).toBe(true);
  });

  it("does not take the lock when the quota rejects the request", () => {
    for (let i = 0; i < 2; i++) {
      const d = acquireCadSlot(W, opts());
      releaseCadSlot(W, d.token);
    }
    expect(acquireCadSlot(W, opts()).reason).toBe("QUOTA");
    // Spec section 6: a rejected request can never take the lock, so raising the
    // limit must admit immediately instead of reporting IN_PROGRESS.
    expect(acquireCadSlot(W, opts({ dailyLimit: 3 })).ok).toBe(true);
  });

  it("charges one quota unit per admitted request, not per attempt", () => {
    const a = acquireCadSlot(W, opts({ dailyLimit: 1 }));
    expect(a.used).toBe(1);
    releaseCadSlot(W, a.token);
    expect(acquireCadSlot(W, opts({ dailyLimit: 1 })).reason).toBe("QUOTA");
  });
});

describe("cadQuotaHeaders", () => {
  it("reports limit, remaining and reset", () => {
    const now = Date.UTC(2026, 8, 11, 10, 0, 0);
    const h = cadQuotaHeaders(W, opts({ now: () => now }));
    expect(h["X-Cad-Quota-Limit"]).toBe("2");
    expect(h["X-Cad-Quota-Remaining"]).toBe("2");
    expect(Number(h["X-Cad-Quota-Reset"])).toBe(Date.UTC(2026, 8, 12, 0, 0, 0) / 1000);
  });

  it("decrements remaining after an admitted request", () => {
    const a = acquireCadSlot(W, opts());
    expect(cadQuotaHeaders(W, opts())["X-Cad-Quota-Remaining"]).toBe("1");
    releaseCadSlot(W, a.token);
  });
});

describe("derived lock TTL (R16)", () => {
  /** Representative limit sets: the defaults, and tunings on both sides. */
  const LIMITS = [
    CAD_DEFAULT_REQUEST_LIMITS,
    { attempts: 1, providerTimeoutMs: 120000 },
    { attempts: 5, providerTimeoutMs: 30000 },
    { attempts: 2, providerTimeoutMs: 60000 },
  ];

  it("exceeds the worst-case request duration for every representative limits set", () => {
    for (const limits of LIMITS) {
      const worstCase = limits.attempts * limits.providerTimeoutMs;
      expect(lockTtlFor(limits)).toBeGreaterThan(worstCase);
    }
  });

  it("pins the defaults the derivation is built from", () => {
    expect(CAD_DEFAULT_REQUEST_LIMITS).toEqual({
      attempts: 3, providerTimeoutMs: 120000,
    });
    // The whole 3-attempt loop, not one 120s provider call: the defect R16 names.
    expect(lockTtlFor(CAD_DEFAULT_REQUEST_LIMITS)).toBeGreaterThan(120000 * 3);
    // No kernel term: the server runs static gates only, so a request is
    // bounded by provider calls alone. 3 x 120000 + 30000.
    expect(lockTtlFor(CAD_DEFAULT_REQUEST_LIMITS)).toBe(390000);
  });

  it("outlives the retry loop it guards", () => {
    let now = 0;
    const clock = () => now;
    const ttl = cadLockTtlMs(CAD_DEFAULT_REQUEST_LIMITS, {});
    const held = acquireCadSlot(W, opts({ lockTtlMs: ttl, now: clock }));
    expect(held.ok).toBe(true);

    now = 120001; // past the old hard-coded 120s TTL, still inside the real worst case
    expect(acquireCadSlot(W, opts({ lockTtlMs: ttl, now: clock })).reason).toBe("IN_PROGRESS");

    now = 3 * 120000; // the last attempt can still be running here
    expect(acquireCadSlot(W, opts({ lockTtlMs: ttl, now: clock })).reason).toBe("IN_PROGRESS");

    releaseCadSlot(W, held.token);
  });

  it("lets CAD_MAX_REQUEST_MS override the derived default", () => {
    expect(cadLockTtlMs(CAD_DEFAULT_REQUEST_LIMITS, { CAD_MAX_REQUEST_MS: "60000" })).toBe(60000);
  });

  it("falls back to the derived value when the override is absent or unusable", () => {
    const derived = lockTtlFor(CAD_DEFAULT_REQUEST_LIMITS);
    for (const env of [{}, { CAD_MAX_REQUEST_MS: "" }, { CAD_MAX_REQUEST_MS: "abc" },
      { CAD_MAX_REQUEST_MS: "0" }, { CAD_MAX_REQUEST_MS: "-1" }]) {
      expect(cadLockTtlMs(CAD_DEFAULT_REQUEST_LIMITS, env)).toBe(derived);
    }
  });

  it("derives from the caller's limits, so a tune-up moves the TTL with it", () => {
    const base = { attempts: 3, providerTimeoutMs: 30000 };
    const moreAttempts = { ...base, attempts: 5 };
    expect(cadLockTtlMs(base, {})).toBe(lockTtlFor(base));
    // Exactly one more attempt pair per extra attempt - no hidden constant.
    expect(cadLockTtlMs(moreAttempts, {}) - cadLockTtlMs(base, {}))
      .toBe(2 * base.providerTimeoutMs);
  });
});
