import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { distinctRunStamps, parseArgs, pool, readResults } from "../../scripts/cad-bench.mjs";

describe("parseArgs", () => {
  it("defaults to the measured variant with Jev and triage on", () => {
    expect(parseArgs([])).toMatchObject({
      variants: ["measured"], limit: Infinity, ids: null, concurrency: 8, jev: true, triage: true, render: true, report: true,
      thinking: null, resume: null, compare: null, agreement: null,
    });
  });

  it("reads every flag", () => {
    const o = parseArgs(["--variant", "both", "--limit", "5", "--ids", "7,633", "--concurrency", "2",
      "--thinking", "on", "--no-jev", "--no-triage", "--resume", "r", "--compare", "c", "--out", "o"]);
    expect(o).toMatchObject({
      variants: ["measured", "abstract"], limit: 5, ids: ["00000007", "00000633"], concurrency: 2,
      thinking: "on", jev: false, triage: false, resume: path.resolve("r"), compare: path.resolve("c"),
      out: path.resolve("o"),
    });
  });

  it("reads --thinking on and off, and rejects anything else", () => {
    expect(parseArgs(["--thinking", "on"]).thinking).toBe("on");
    expect(parseArgs(["--thinking", "off"]).thinking).toBe("off");
    expect(() => parseArgs(["--thinking", "maybe"])).toThrow("--thinking");
    expect(() => parseArgs(["--thinking"])).toThrow("needs a value");
  });

  it("refuses values that would quietly run nothing or the wrong set", () => {
    expect(() => parseArgs(["--concurrency", "abc"])).toThrow("--concurrency");
    expect(() => parseArgs(["--concurrency", "0"])).toThrow("--concurrency");
    expect(() => parseArgs(["--limit", "NaN"])).toThrow("--limit");
    expect(() => parseArgs(["--limit", "-3"])).toThrow("--limit");
    expect(() => parseArgs(["--ids", ""])).toThrow("--ids");
    expect(() => parseArgs(["--ids", "7,x"])).toThrow("--ids");
    expect(parseArgs(["--limit", "3"]).limit).toBe(3);
  });

  it("takes a model override, and refuses an empty one", () => {
    expect(parseArgs([]).model).toBeNull();
    expect(parseArgs(["--model", "deepseek-v4-pro"]).model).toBe("deepseek-v4-pro");
    expect(() => parseArgs(["--model", "  "])).toThrow("--model");
  });

  it("writes the HTML report by default and can be told not to", () => {
    expect(parseArgs([]).report).toBe(true);
    expect(parseArgs(["--no-report"]).report).toBe(false);
  });

  it("renders by default and can be told not to", () => {
    expect(parseArgs([]).render).toBe(true);
    expect(parseArgs(["--no-render"]).render).toBe(false);
    expect(parseArgs(["--no-render", "--render"]).render).toBe(true);
  });

  it("rejects unknown flags and bad variants", () => {
    expect(() => parseArgs(["--nope"])).toThrow("unknown argument --nope");
    expect(() => parseArgs(["--variant", "x"])).toThrow("--variant");
  });
});

describe("readResults", () => {
  it("describes the directory, not the current selection, and flags mixed run configs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cad-bench-cli-"));
    const write = (/** @type {string} */ name, /** @type {any} */ body) =>
      fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
    write("00000002.json", { id: "00000002", run: { thinking: false } });
    write("00000001.json", { id: "00000001", run: { thinking: false } });
    write("summary.json", { config: {} });
    write("00000003.json.tmp", { id: "00000003" });
    expect(readResults(dir).map((r) => r.id)).toEqual(["00000001", "00000002"]);
    expect(distinctRunStamps(readResults(dir))).toBe(1);
    write("00000004.json", { id: "00000004", run: { thinking: true } });
    expect(distinctRunStamps(readResults(dir))).toBe(2);
    expect(readResults(path.join(dir, "missing"))).toEqual([]);
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
