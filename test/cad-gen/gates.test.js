import { evaluateStaticGates, evaluateKernelGates } from "@arbesk/cad-gen/core/gates.js";
import { validateDesign } from "@arbesk/cad-gen/backend/validate.js";

const PRELUDE = ["box", "hole"];
const design = (code, parameters = { s: { value: 10, unit: "mm" } }) =>
  ({ code, parameters, summary: "" });
const LIMITS = { timeoutMs: 20000, maxTriangles: 200000 };

describe("evaluateStaticGates", () => {
  it("passes a well-formed design", () => {
    const gates = evaluateStaticGates(design("return box(P.s, P.s, P.s);"), PRELUDE);
    expect(gates.every((g) => g.ok)).toBe(true);
  });

  it("fails the guard gate for a denied construct", () => {
    const gates = evaluateStaticGates(design("process.exit(0); return box(1,1,1);"), PRELUDE);
    expect(gates.find((g) => g.gate === "guard").ok).toBe(false);
  });

  it("fails the parameters gate when the script ignores PARAMETERS", () => {
    const gates = evaluateStaticGates(design("return box(1, 1, 1);"), PRELUDE);
    expect(gates.find((g) => g.gate === "parameters").ok).toBe(false);
  });
});

describe("evaluateKernelGates", () => {
  const stats = {
    triangles: 100, vertices: 60, volumeMm3: 1000,
    bboxMm: { min: [0, 0, 0], max: [10, 10, 10] },
  };

  it("passes sane stats", () => {
    expect(evaluateKernelGates(stats, LIMITS).every((g) => g.ok)).toBe(true);
  });

  it("fails on a degenerate volume", () => {
    const gates = evaluateKernelGates({ ...stats, volumeMm3: 0 }, LIMITS);
    expect(gates.find((g) => g.gate === "volume").ok).toBe(false);
  });

  it("fails on an empty mesh", () => {
    const gates = evaluateKernelGates({ ...stats, triangles: 0 }, LIMITS);
    expect(gates.find((g) => g.gate === "nonempty").ok).toBe(false);
  });

  it("fails on a triangle budget overrun", () => {
    const gates = evaluateKernelGates({ ...stats, triangles: 500000 }, LIMITS);
    expect(gates.find((g) => g.gate === "budget").ok).toBe(false);
  });

  // The nonempty message is the whole repair instruction the model gets back,
  // so it has to name the cause, not just the symptom.
  it("tells the model what an empty mesh means", () => {
    const gates = evaluateKernelGates({ ...stats, triangles: 0, volumeMm3: 0 }, LIMITS);
    const nonempty = gates.find((g) => g.gate === "nonempty");
    expect(nonempty.ok).toBe(false);
    expect(nonempty.error).toMatch(/no triangles/i);
    expect(nonempty.error).toMatch(/whole part/i);
  });
});

describe("validateDesign", () => {
  it("validates a real solid end to end", async () => {
    const r = await validateDesign(design("return box(P.s, P.s, P.s);"), {
      preludeNames: PRELUDE, limits: LIMITS,
    });
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(1000, 0);
  }, 30000);

  it("stops before the kernel when a static gate fails", async () => {
    const r = await validateDesign(design("return 1;"), {
      preludeNames: PRELUDE, limits: LIMITS,
    });
    expect(r.ok).toBe(false);
    expect(r.gates.some((g) => g.gate === "kernel")).toBe(false);
  }, 30000);

  it("surfaces a script-level failure with the failing gate", async () => {
    const r = await validateDesign(design("throw new Error('boom'); return box(P.s,P.s,P.s);"), {
      preludeNames: PRELUDE, limits: LIMITS,
    });
    expect(r.ok).toBe(false);
    expect(r.gates.find((g) => g.gate === "kernel").ok).toBe(false);
    expect(r.error).toContain("boom");
  }, 30000);

  // A hole wider than the part removes the whole solid - a common model
  // mistake, not an exotic one. Manifold reports min = +Infinity / max =
  // -Infinity for a mesh with no triangles, JSON.stringify turns both into
  // null, and the parent's shape validator then rejected the *payload*: the
  // attempt came back as "kernel host produced an invalid result". That names
  // no cause the model can act on and reads like a server problem, so the
  // repair loop had nothing to work with and the nonempty gate never ran.
  it("reports an empty result as the nonempty gate, not a host fault", async () => {
    const r = await validateDesign(design("return hole(box(P.s, P.s, P.s), { diameter: 40 });"), {
      preludeNames: PRELUDE, limits: LIMITS,
    });

    expect(r.ok).toBe(false);
    // The kernel ran and its payload was well formed, so the kernel gate is a
    // pass: the fault is the script's geometry, not the host's.
    expect(r.gates.find((g) => g.gate === "kernel").ok).toBe(true);
    expect(r.stats.triangles).toBe(0);

    const nonempty = r.gates.find((g) => g.gate === "nonempty");
    expect(nonempty.ok).toBe(false);
    expect(nonempty.error).toMatch(/no triangles/i);
    expect(nonempty.error).toMatch(/whole part/i);

    expect(r.error).toBe(nonempty.error);
    expect(r.error).not.toMatch(/host|invalid result/i);
  }, 30000);
});
