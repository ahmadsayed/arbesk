import {
  runValidation,
  parseRunnerResult,
} from "@arbesk/cad-gen/backend/validate-runner.js";

const design = (code) => ({
  code,
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "",
});

const OPTS = { timeoutMs: 20000, maxTriangles: 200000 };

describe("runValidation", () => {
  it("kills a runaway script on the timeout", async () => {
    const r = await runValidation(design("while(true){}\nreturn 1;"), {
      ...OPTS, timeoutMs: 3000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/i);
  }, 20000);
});

const MAX = 200000;
const STATS = {
  triangles: 12,
  vertices: 8,
  volumeMm3: 1000,
  bboxMm: { min: [-5, -5, -5], max: [5, 5, 5] },
};
const claiming = (stats) => ({ ok: true, stats });

/** Asserts the result was rejected as unreadable, i.e. failed closed. */
const expectInvalid = (raw, maxTriangles = MAX) => {
  const r = parseRunnerResult(raw, maxTriangles);
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/invalid result/i);
};

describe("parseRunnerResult", () => {
  it("accepts a well-formed stats result", () => {
    expect(parseRunnerResult(claiming(STATS), MAX)).toEqual({ ok: true, stats: STATS });
  });

  it("accepts a well-formed error result", () => {
    expect(parseRunnerResult({ ok: false, error: "script threw: boom" }, MAX)).toEqual({
      ok: false,
      error: "script threw: boom",
    });
  });

  it("rejects a non-numeric triangle count", () => {
    expectInvalid(claiming({ ...STATS, triangles: "many" }));
  });

  it("rejects a bounding box that is not three numbers", () => {
    expectInvalid(claiming({ ...STATS, bboxMm: { min: [0, 0], max: [5, 5, 5] } }));
    expectInvalid(claiming({ ...STATS, bboxMm: { min: [0, 0, 0], max: [5, 5, Infinity] } }));
  });

  it("rejects a result with no stats", () => {
    expectInvalid({ ok: true });
    expectInvalid({ ok: true, stats: null });
  });

  it("rejects negative and absent counts", () => {
    expectInvalid(claiming({ ...STATS, volumeMm3: -1 }));
    expectInvalid(claiming({ ...STATS, vertices: undefined }));
  });

  it("rejects a malformed error result", () => {
    expectInvalid({ ok: false });
    expectInvalid({ ok: false, error: 42 });
  });

  it("rejects values that are not objects at all", () => {
    for (const raw of [null, undefined, "ok", 7, [1, 2, 3]]) expectInvalid(raw);
  });

  it("enforces the triangle budget parent-side, not just in the child", () => {
    const r = parseRunnerResult(claiming({ ...STATS, triangles: 500000 }), MAX);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/budget/i);
    expect(r.error).toContain("500000");
  });

  it("does not enforce the budget on a result that is already a failure", () => {
    expect(parseRunnerResult({ ok: false, error: "script threw: boom" }, 1)).toEqual({
      ok: false,
      error: "script threw: boom",
    });
  });
});
