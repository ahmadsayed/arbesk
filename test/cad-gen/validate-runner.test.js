import os from "node:os";
import path from "node:path";
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

describe("runValidation hardening", () => {
  // The guard permits bounded loops and allows console, so a design may legally
  // flood stdout. Buffering that unboundedly is a denial of service against the
  // *server*: before the runner capped its capture window a flood like this one
  // cost the parent ~2 GB of heap - measured in Task 5 - and ended in a
  // RangeError thrown inside the stream handler. The flood is 150k lines of
  // 4 KB (~614 MB), deliberately more than V8's maximum string length (~512 MB),
  // so an uncapped parent cannot merely lose the result: it throws. A tail is
  // all the protocol needs, because the stats line is written last.
  // 4 KB lines also keep the flood inside what a node child actually delivers
  // through a pipe; node drops the whole stream on a single oversize write
  // (ENOBUFS), which is a property of the child's runtime, not of this cap.
  it("caps a flooding child's stdout instead of buffering it", async () => {
    const r = await runValidation(
      design(
        "for (let i = 0; i < 150000; i++) console.log('x'.repeat(4096));\n" +
          "return box(10, 20, 30);",
      ),
      OPTS,
    );
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(6000, 0);
  }, 180000);

  // A kernel that cannot load is a *host* fault, exactly like a missing child
  // entry or an unwritable tmpdir: the child exits non-zero and the runner must
  // resolve, never reject, or one bad wasm path takes the server down.
  it("reports a missing kernel as a host fault instead of throwing", async () => {
    const missing = path.join(os.tmpdir(), "cad-gen-no-such-wasm-dir");
    const r = await runValidation(design("return box(1, 1, 1);"), {
      ...OPTS,
      wasmDir: missing,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/kernel host failed/i);

    // The caller survived it: the runner is still usable afterwards.
    const after = await runValidation(design("return box(2, 2, 2);"), OPTS);
    expect(after.ok).toBe(true);
  }, 60000);
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
