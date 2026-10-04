import { describe, expect, it } from "bun:test";
import path from "node:path";
import { parseArgs, pool } from "../../scripts/cad-bench.mjs";

describe("parseArgs", () => {
  it("defaults to the measured variant with Jev and triage on", () => {
    expect(parseArgs([])).toMatchObject({
      variants: ["measured"], limit: Infinity, ids: null, concurrency: 4, jev: true, triage: true,
      resume: null, compare: null, agreement: null,
    });
  });

  it("reads every flag", () => {
    const o = parseArgs(["--variant", "both", "--limit", "5", "--ids", "7,633", "--concurrency", "2",
      "--no-jev", "--no-triage", "--resume", "r", "--compare", "c", "--out", "o"]);
    expect(o).toMatchObject({
      variants: ["measured", "abstract"], limit: 5, ids: ["00000007", "00000633"], concurrency: 2,
      jev: false, triage: false, resume: path.resolve("r"), compare: path.resolve("c"), out: path.resolve("o"),
    });
  });

  it("rejects unknown flags and bad variants", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown argument --nope");
    expect(() => parseArgs(["--variant", "x"])).toThrow("--variant");
  });
});

describe("pool", () => {
  it("runs every item with bounded concurrency and stops when asked", async () => {
    let active = 0, peak = 0;
    const seen = [];
    await pool([1, 2, 3, 4, 5], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n); active--;
    }, () => false);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);

    const done = [];
    await pool([1, 2, 3, 4], 1, async (n) => { done.push(n); }, () => done.length >= 2);
    expect(done).toEqual([1, 2]);
  });
});
