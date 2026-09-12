import { runValidation } from "@arbesk/cad-gen/backend/validate-runner.js";

// These assert the prelude's GEOMETRY PRECISION, so they run at delivery
// fidelity rather than at the validation profile: validation trades
// tessellation for speed on purpose, and an 8-segment 4mm hole is about 10%
// off the analytic volume by design. The validation profile has its own test.
const OPTS = {
  timeoutMs: 20000,
  maxTriangles: 200000,
  segments: 64,
  minAngle: 10,
  minEdgeLength: 1,
};
const design = (code) => ({ code, parameters: { s: { value: 10, unit: "mm" } }, summary: "" });
const run = (code) => runValidation(design(code), OPTS);

/** Asserts two bounding boxes agree per axis, in mm. */
const expectSameBbox = (actual, expected, digits = 1) => {
  for (const axis of [0, 1, 2]) {
    expect(actual.min[axis]).toBeCloseTo(expected.min[axis], digits);
    expect(actual.max[axis]).toBeCloseTo(expected.max[axis], digits);
  }
};

describe("prelude geometry", () => {
  it("box has the requested volume", async () => {
    const r = await run("return box(10, 20, 30);");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(6000, 0);
  }, 30000);

  it("cylinder has the requested volume", async () => {
    const r = await run("return cylinder(5, 10, { segments: 256 });");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(Math.PI * 25 * 10, -2);
  }, 30000);

  it("hole subtracts a through-hole", async () => {
    const r = await run("const b = box(20, 20, 10);\nreturn hole(b, { diameter: 6, axis: 'z' });");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(4000 - Math.PI * 9 * 10, -1);
  }, 30000);

  it("hole along x is subtractive too", async () => {
    const r = await run("const b = box(20, 20, 10);\nreturn hole(b, { diameter: 6, axis: 'x' });");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeLessThan(4000);
  }, 30000);

  it("boltCircle removes four holes", async () => {
    const r = await run(
      "const b = box(40, 40, 10);\n" +
      "return boltCircle(b, { count: 4, diameter: 4, circleDiameter: 30, axis: 'z' });",
    );
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(16000 - 4 * Math.PI * 4 * 10, -1);
  }, 30000);

  it("roundedBox is watertight and smaller than the sharp box", async () => {
    const sharp = await run("return box(20, 20, 20);");
    const round = await run("return roundedBox(20, 20, 20, 2);");
    expect(round.ok).toBe(true);
    expect(round.stats.volumeMm3).toBeLessThan(sharp.stats.volumeMm3);
    expect(round.stats.volumeMm3).toBeGreaterThan(sharp.stats.volumeMm3 * 0.85);
    expect(round.stats.filletMode).toBe("exact");
  }, 30000);

  it("filletEdges reports the strategy it used", async () => {
    const r = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5, { mode: 'minkowski' });");
    expect(r.ok).toBe(true);
    expect(r.stats.filletMode).toBe("minkowski");
  }, 30000);

  // A fillet rounds the edges that are already there. Plain Minkowski dilation
  // is a *rounded offset*: it grows the part by r on every face, so a 20 mm box
  // came back as 23 mm and no longer fits its mating geometry. The opening
  // (erode by the ball, then dilate by the same ball) keeps the outer
  // dimensions and rounds the edges instead - the 3D counterpart of the
  // square(w - 2r, d - 2r) + offset(r, "Round") pattern roundRect already uses.
  it("filletEdges keeps the outer dimensions and removes material", async () => {
    const sharp = await run("return box(20, 20, 20);");
    const filleted = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5, { mode: 'minkowski' });");

    expect(filleted.ok).toBe(true);
    expectSameBbox(filleted.stats.bboxMm, sharp.stats.bboxMm);
    expect(filleted.stats.volumeMm3).toBeLessThan(sharp.stats.volumeMm3);
    expect(filleted.stats.filletMode).toBe("minkowski");
  }, 30000);

  it("chamferEdges keeps the outer dimensions and removes material", async () => {
    const sharp = await run("return box(20, 20, 20);");
    const chamfered = await run("const b = box(20, 20, 20);\nreturn chamferEdges(b, 1);");

    expect(chamfered.ok).toBe(true);
    expectSameBbox(chamfered.stats.bboxMm, sharp.stats.bboxMm);
    expect(chamfered.stats.volumeMm3).toBeLessThan(sharp.stats.volumeMm3);
  }, 30000);

  it("filletEdges rounds a thin plate without growing it", async () => {
    const plate = await run("return box(20, 20, 1);");
    const filleted = await run("const p = box(20, 20, 1);\nreturn filletEdges(p, 0.4, { mode: 'minkowski' });");

    expect(filleted.ok).toBe(true);
    expectSameBbox(filleted.stats.bboxMm, plate.stats.bboxMm);
    expect(filleted.stats.volumeMm3).toBeLessThan(plate.stats.volumeMm3);
  }, 30000);

  // Erosion is the half of an opening that can vanish a part: a body thinner
  // than 2r erodes to nothing. Dilating an empty manifold returns the ball
  // rather than nothing, so without an explicit refusal an impossible radius
  // would silently hand back a bare sphere of radius r. The caller has to hear
  // that r does not fit - and the fillet is applied to *every* convex edge, so
  // on a 1 mm plate even r = 0.5 (half the thickness) is already too much.
  it("filletEdges refuses a radius the part cannot take", async () => {
    const huge = await run("const p = box(20, 20, 1);\nreturn filletEdges(p, 5, { mode: 'minkowski' });");
    expect(huge.ok).toBe(false);
    expect(huge.error).toMatch(/filletEdges: radius 5 is too large/);

    const boundary = await run("const p = box(20, 20, 1);\nreturn filletEdges(p, 0.5, { mode: 'minkowski' });");
    expect(boundary.ok).toBe(false);
    expect(boundary.error).toMatch(/too large/);
  }, 30000);

  it("chamferEdges refuses a radius the part cannot take", async () => {
    const r = await run("const p = box(20, 20, 1);\nreturn chamferEdges(p, 5);");

    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chamferEdges: radius 5 is too large/);
  }, 30000);

  it("bbox reports the true extent", async () => {
    const r = await run("const b = box(30, 20, 10);\nreturn b;");
    expect(r.ok).toBe(true);
    expect(r.stats.bboxMm.min[0]).toBeCloseTo(-15, 5);
    expect(r.stats.bboxMm.max[0]).toBeCloseTo(15, 5);
    expect(r.stats.bboxMm.max[2]).toBeCloseTo(5, 5);
  }, 30000);

  // Regression: the kernel reads a scalar scaleTop as {x: s, y: 0}, which
  // collapses the top face and silently halves every extrusion's volume.
  it("extrude keeps its full volume for the default and for a scalar scaleTop", async () => {
    const prism = await run("return extrude(rect(10, 10), 5);");
    expect(prism.ok).toBe(true);
    expect(prism.stats.volumeMm3).toBeCloseTo(500, 6);

    const taper = await run("return extrude(rect(10, 10), 5, { scaleTop: 0.5 });");
    expect(taper.ok).toBe(true);
    // Uniform 0.5 scale: h/3 * (A + A' + sqrt(A * A')) = 5/3 * (100 + 25 + 50).
    expect(taper.stats.volumeMm3).toBeCloseTo((5 / 3) * 175, 3);
  }, 30000);
});

// The opening's cost is driven by the rounding ball's facet count, and the
// effect is large: on a stepped shaft the dilation takes 1.0s with 8 segments,
// 3.2s with 16 and 15.6s with 32, while the volume moves well under 1%. Draft
// is the default so ordinary fillets fit the kernel timeout; high is an
// explicit request, and the quality actually used is reported either way.
// The validation pass deliberately runs coarse. What it must still get right is
// everything validation actually asks: a valid, non-empty solid of the right
// size. What it must NOT be trusted for is precision - see the caveat on
// VALIDATION_FIDELITY.
describe("validation fidelity profile", () => {
  const coarse = (code) => runValidation(design(code), {
    timeoutMs: 20000,
    maxTriangles: 200000,
    segments: 0,
    minAngle: 20,
    minEdgeLength: 2,
  });

  it("keeps the outer dimensions exactly", async () => {
    const r = await coarse("const b = box(80, 60, 8);\nreturn hole(b, { diameter: 5, axis: 'z' });");
    expect(r.ok).toBe(true);
    expect(r.stats.bboxMm.min[0]).toBeCloseTo(-40, 6);
    expect(r.stats.bboxMm.max[0]).toBeCloseTo(40, 6);
    expect(r.stats.bboxMm.max[2]).toBeCloseTo(4, 6);
  });

  it("reports a plausible volume", async () => {
    const r = await coarse("const b = box(80, 60, 8);\nreturn hole(b, { diameter: 5, axis: 'z' });");
    const exact = 80 * 60 * 8 - Math.PI * 2.5 * 2.5 * 8;
    // Within 2%: a coarse hole is a polygon, not a circle.
    expect(Math.abs(r.stats.volumeMm3 - exact) / exact).toBeLessThan(0.02);
  });

  it("still refuses an impossible radius", async () => {
    const r = await coarse("const p = box(20, 20, 1);\nreturn filletEdges(p, 5);");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/);
  });
});

describe("fillet quality", () => {
  it("defaults to draft and reports it", async () => {
    const r = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5);");
    expect(r.ok).toBe(true);
    expect(r.stats.filletMode).toBe("minkowski");
    expect(r.stats.filletQuality).toBe("draft");
  }, 30000);

  it("reports high when high is requested", async () => {
    const r = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5, { quality: 'high' });");
    expect(r.ok).toBe(true);
    expect(r.stats.filletQuality).toBe("high");
  }, 30000);

  it("draft and high agree on the outer dimensions", async () => {
    const sharp = await run("return box(20, 20, 20);");
    const draft = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5);");
    const high = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5, { quality: 'high' });");

    expect(draft.ok).toBe(true);
    expect(high.ok).toBe(true);
    expectSameBbox(draft.stats.bboxMm, sharp.stats.bboxMm);
    expectSameBbox(high.stats.bboxMm, sharp.stats.bboxMm);
    // A coarser ball is a slightly different solid, not a different part:
    // measured at 0.099% of the volume on this 20 mm cube with r = 1.5.
    const relative = Math.abs(draft.stats.volumeMm3 - high.stats.volumeMm3) /
      high.stats.volumeMm3;
    expect(relative).toBeLessThan(0.01);
  }, 60000);

  it("chamferEdges takes the same option", async () => {
    const r = await run("const b = box(20, 20, 20);\nreturn chamferEdges(b, 1.5, { quality: 'high' });");
    expect(r.ok).toBe(true);
    expect(r.stats.filletQuality).toBe("high");
  }, 30000);

  // A caller that asked for high and silently got draft has no way to tell.
  it("refuses an unknown quality instead of downgrading quietly", async () => {
    const r = await run("const b = box(20, 20, 20);\nreturn filletEdges(b, 1.5, { quality: 'ultra' });");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/quality must be "draft" or "high"/);
  }, 30000);

  it("reports no opening quality when no opening ran", async () => {
    const r = await run("return roundedBox(20, 20, 20, 2);");
    expect(r.stats.filletMode).toBe("exact");
    expect(r.stats.filletQuality).toBeUndefined();
  }, 30000);
});
