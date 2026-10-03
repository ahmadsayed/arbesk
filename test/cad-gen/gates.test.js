import { describe, expect, it } from "bun:test";
import {
  bodyAllowance, bodyFloor, evaluateStaticGates, evaluateKernelGates, SEPARATE_THRESHOLD,
} from "@arbesk/cad-gen/core/gates.js";
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

  it("fails the syntax gate for a script that does not parse", () => {
    // attempt#1 hinge: a live design redeclared a const and reached the client.
    const gates = evaluateStaticGates(
      design("const c = P.s; const c = 1; return box(c, c, c);"), PRELUDE);
    const syntax = gates.find((g) => g.gate === "syntax");
    expect(syntax.ok).toBe(false);
    expect(syntax.error).toContain("does not parse");
  });

  it("checks syntax without running the script", () => {
    const gates = evaluateStaticGates(
      design("throw new Error('ran'); return box(P.s, P.s, P.s);"), PRELUDE);
    expect(gates.find((g) => g.gate === "syntax").ok).toBe(true);
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

  it("fails the connected gate when the part came apart, naming each piece", () => {
    const bodies = { count: 2, boxes: [
      { min: [0, 0, 0], max: [10, 10, 2] }, { min: [0, 0, 5], max: [2, 2, 9] },
    ] };
    const connected = evaluateKernelGates({ ...stats, bodies }, LIMITS)
      .find((g) => g.gate === "connected");
    expect(connected.ok).toBe(false);
    expect(connected.error).toContain("2 separate bodies");
    expect(connected.error).toContain("[0.0, 0.0, 5.0] to [2.0, 2.0, 9.0]");
    expect(connected.error).toContain("OUTSIDE the main body");
  });

  it("tells a piece resting inside a cavity apart from one floating away", () => {
    // attempt#10 gf-bin: the base's top sat in the cavity, touching the floor.
    const bodies = { count: 2, boxes: [
      { min: [-41.8, -62.8, 0], max: [41.8, 62.8, 42] }, { min: [-40.3, -61.3, 1.5], max: [40.3, 61.3, 3.2] },
    ] };
    const connected = evaluateKernelGates({ ...stats, bodies }, LIMITS)
      .find((g) => g.gate === "connected");
    expect(connected.error).toContain("INSIDE the main body's bounds");
    expect(connected.error).toContain("only TOUCHES");
  });

  it("passes as many bodies as the request implies, and fails one more", () => {
    const at = (count, maxBodies) => evaluateKernelGates(
      { ...stats, bodies: { count, boxes: [{ min: [0, 0, 0], max: [1, 1, 1] }] } }, { ...LIMITS, maxBodies },
    ).find((g) => g.gate === "connected");
    expect(at(2, 2).ok).toBe(true);
    // attempt#17: a two-half clamp shipped as 6 bodies under a yes/no "separate".
    expect(at(6, 2).ok).toBe(false);
    expect(at(6, 2).error).toContain("at most 2");
  });

  it("allows a multi-body helper its own bodies whatever the count says", () => {
    expect(bodyAllowance("return printInPlaceHinge({});", 1)).toBe(2);
    expect(bodyAllowance("return pipeClamp({ pipeDiameter: 25 });", 1)).toBe(2);
    expect(bodyAllowance("return box(1, 1, 1);", undefined)).toBe(1);
    expect(bodyAllowance("return box(1, 1, 1);", 3)).toBe(3);
    expect(bodyAllowance("return box(1, 1, 1);", 5)).toBe(Number.POSITIVE_INFINITY);
  });

  it("fails the pieces gate when separate pieces came out fused", () => {
    // attempt#4: a two-half pipe clamp came back as one block and passed.
    const at = (count, minBodies) => evaluateKernelGates(
      { ...stats, bodies: { count, boxes: [{ min: [0, 0, 0], max: [1, 1, 1] }] } },
      { ...LIMITS, maxBodies: 2, minBodies },
    ).find((g) => g.gate === "pieces");
    expect(at(1, 2).ok).toBe(false);
    expect(at(1, 2).error).toContain("1 body, but the request needs 2 SEPARATE pieces");
    expect(at(1, 2).error).toContain("at least 2mm");
    expect(at(2, 2).ok).toBe(true);
    expect(at(1, undefined).ok).toBe(true);
    expect(evaluateKernelGates(stats, { ...LIMITS, minBodies: 4 })
      .find((g) => g.gate === "pieces").ok).toBe(true);
  });

  it("asks for a floor only when Jev judged fused pieces wrong, and fails open", () => {
    expect(bodyFloor(2, 0.95)).toBe(2);
    expect(bodyFloor(4, SEPARATE_THRESHOLD)).toBe(4);
    // A hinged box can be one piece with a living hinge: Jev 0.65.
    expect(bodyFloor(2, 0.65)).toBe(1);
    expect(bodyFloor(1, 0.95)).toBe(1);
    expect(bodyFloor(2, undefined)).toBe(1);
    expect(bodyFloor(undefined, 0.95)).toBe(1);
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
