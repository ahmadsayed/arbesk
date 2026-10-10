import { describe, expect, it } from "bun:test";
import path from "node:path";
import { parseArgs } from "../../scripts/muse-bench.mjs";

describe("muse-bench parseArgs", () => {
  it("defaults to every case, judged, four at a time", () => {
    expect(parseArgs([])).toMatchObject({
      limit: Infinity, ids: null, method: null, concurrency: 4, judge: true, judgeOnly: null, resume: null,
    });
    expect(parseArgs([]).out).toMatch(/test-results[\\/]muse-bench$/);
  });

  it("reads every flag", () => {
    const o = parseArgs(["--limit", "5", "--ids", "pen_holder, stool", "--concurrency", "2", "--method", "print",
      "--no-judge", "--out", "x/y"]);
    expect(o).toMatchObject({ limit: 5, ids: ["pen_holder", "stool"], concurrency: 2, method: "print", judge: false });
    expect(o.out).toBe(path.resolve("x/y"));
    expect(parseArgs(["--resume", "r/run#2"]).resume).toBe(path.resolve("r/run#2"));
    expect(parseArgs(["--judge-only", "r/run#2"]).judgeOnly).toBe(path.resolve("r/run#2"));
  });

  it("is filtered whenever the run is restricted", () => {
    expect(parseArgs([]).filtered).toBe(false);
    for (const argv of [["--limit", "3"], ["--ids", "stool"], ["--method", "cnc"]]) expect(parseArgs(argv).filtered).toBe(true);
  });

  it("rejects bad values and contradictory flags", () => {
    expect(() => parseArgs(["--concurrency", "many"])).toThrow(/--concurrency/);
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--method", "welding"])).toThrow(/--method/);
    expect(() => parseArgs(["--ids", " , "])).toThrow(/--ids/);
    expect(() => parseArgs(["--no-judge", "--judge-only", "r"])).toThrow(/contradict/);
    expect(() => parseArgs(["--resume", "a", "--judge-only", "b"])).toThrow(/contradict/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--limit"])).toThrow(/needs a value/);
  });
});
