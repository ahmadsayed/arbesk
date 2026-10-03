import { describe, expect, it } from "bun:test";
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
// Gridfinity is a COMPATIBILITY standard - a base a hundredth of a millimetre
// out does not seat in anyone else's baseplate - so the envelope is pinned here
// rather than left to the model.
describe("gridfinityBase", () => {
  it("is 41.5mm across for one cell and 4.75mm tall", async () => {
    const r = await run("return gridfinityBase({ unitsX: 1, unitsY: 1 });");
    expect(r.ok).toBe(true);
    expect(r.stats.bboxMm.max[0]).toBeCloseTo(20.75, 4); // (42 - 0.5) / 2
    expect(r.stats.bboxMm.min[2]).toBeCloseTo(0, 4);
    expect(r.stats.bboxMm.max[2]).toBeCloseTo(4.75, 4); // 0.8 + 1.8 + 2.15
  }, 40000);

  it("scales by whole 42mm cells", async () => {
    const r = await run("return gridfinityBase({ unitsX: 2, unitsY: 3 });");
    expect(r.stats.bboxMm.max[0]).toBeCloseTo((2 * 42 - 0.5) / 2, 4);
    expect(r.stats.bboxMm.max[1]).toBeCloseTo((3 * 42 - 0.5) / 2, 4);
    expect(r.stats.bboxMm.max[2]).toBeCloseTo(4.75, 4);
  }, 40000);

  it("tapers, so it is lighter than a straight prism of the top footprint", async () => {
    const r = await run("return gridfinityBase({ unitsX: 1, unitsY: 1 });");
    const topPrism = 41.5 * 41.5 * 4.75;
    const bottomPrism = 35.6 * 35.6 * 4.75;
    expect(r.stats.volumeMm3).toBeLessThan(topPrism);
    expect(r.stats.volumeMm3).toBeGreaterThan(bottomPrism);
  }, 40000);

  // Both builders are CENTRED, so a hand-assembled bin leaves a gap - the base
  // ends at 4.75 and a box placed at z = 5 starts at 0. stack() is the fix.
  it("stacks a wall on the base without a gap", async () => {
    const handRolled = await run([
      "const base = gridfinityBase({ unitsX: 1, unitsY: 1 });",
      "const wall = box(41.5, 41.5, 10).translate([0, 0, 10]);",
      "return base.add(wall);",
    ].join("\n"));
    // Valid, and 5.25mm of daylight between the two pieces.
    expect(handRolled.ok).toBe(true);
    expect(handRolled.stats.bboxMm.max[2]).toBeCloseTo(15, 3);

    const stacked = await run([
      "const base = gridfinityBase({ unitsX: 1, unitsY: 1 });",
      "const wall = box(41.5, 41.5, 10);",
      "return stack([base, wall]);",
    ].join("\n"));
    expect(stacked.ok).toBe(true);
    expect(stacked.stats.bboxMm.min[2]).toBeCloseTo(0, 4);
    expect(stacked.stats.bboxMm.max[2]).toBeCloseTo(14.75, 3); // 4.75 base + 10 wall
  }, 40000);

  it("refuses a fractional cell count", async () => {
    const r = await run("return gridfinityBase({ unitsX: 0, unitsY: 1 });");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least 1/);
  }, 40000);
});

// The centring bug, in the form the live timing pulley hit it three times: a
// flange stacked at z = +width against a body spanning -7.5..7.5 lands clear of
// the part. stack() lays solids end to end instead of relying on the model's
// half-height arithmetic, so the pieces cannot come apart.
describe("stack", () => {
  it("lays solids end to end from a base at the origin", async () => {
    const code = [
      "const a = box(20, 20, 10);",
      "const b = box(10, 10, 4);",
      "return stack([a, b]);",
    ].join("\n");
    const r = await run(code);
    expect(r.ok).toBe(true);
    // 10 then 4 tall, starting at 0.
    expect(r.stats.bboxMm.min[2]).toBeCloseTo(0, 4);
    expect(r.stats.bboxMm.max[2]).toBeCloseTo(14, 4);
    expect(r.stats.volumeMm3).toBeCloseTo(20 * 20 * 10 + 10 * 10 * 4, 4);
  }, 40000);

  it("closes the gap a hand-stacked assembly leaves", async () => {
    // The pulley's exact mistake: body centred, flange placed past its end.
    const wrong = await run([
      "const body = cylinder(10, 15);",
      "const flange = cylinder(14, 2);",
      "return body.add(flange.translate([0, 0, 15]));",
    ].join("\n"));
    const right = await run([
      "const body = cylinder(10, 15);",
      "const flange = cylinder(14, 2);",
      "return stack([body, flange]);",
    ].join("\n"));
    // Both are valid solids; only one is attached.
    expect(wrong.ok).toBe(true);
    expect(right.ok).toBe(true);
    expect(right.stats.bboxMm.max[2]).toBeCloseTo(17, 4); // 15 then 2
    expect(wrong.stats.bboxMm.max[2]).toBeCloseTo(16, 4); // 15, from -7.5..7.5
    expect(wrong.stats.bboxMm.min[2]).toBeCloseTo(-7.5, 4);
  }, 40000);

  it("honours an axis other than Z", async () => {
    const code = [
      "const a = box(10, 10, 10);",
      "const b = box(4, 4, 4);",
      "return stack([a, b], { axis: 'x' });",
    ].join("\n");
    const r = await run(code);
    expect(r.ok).toBe(true);
    expect(r.stats.bboxMm.min[0]).toBeCloseTo(0, 4);
    expect(r.stats.bboxMm.max[0]).toBeCloseTo(14, 4);
  }, 40000);

  it("refuses an empty list", async () => {
    const r = await run("return stack([]);");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non-empty list of solids/);
  }, 40000);
});

// A gear is only correct if its geometry is: the tip circle is pitch + module,
// and the material between the teeth is gone. Both are checked here, because a
// gear whose teeth are trapezoids passes every "is it a valid solid" test and
// meshes with nothing.
describe("spurGear", () => {
  it("puts the tip circle at pitch radius plus the module", async () => {
    const r = await run("return spurGear({ module: P.m, teeth: P.z, thickness: 10 });");
    // The default parameters are { s: 10 }, so drive this through a literal.
    void r;
    const a = await run("return spurGear({ module: 2, teeth: 20, thickness: 10 });");
    expect(a.ok).toBe(true);
    expect(a.stats.bboxMm.max[0]).toBeCloseTo(22, 4); // 2 x 20 / 2 + 2

    const b = await run("return spurGear({ module: 3, teeth: 20, thickness: 10 });");
    expect(b.ok).toBe(true);
    expect(b.stats.bboxMm.max[0]).toBeCloseTo(33, 4); // 3 x 20 / 2 + 3
  }, 40000);

  it("has material removed between the teeth", async () => {
    const gear = await run("return spurGear({ module: 2, teeth: 20, thickness: 10 });");
    const full = await run("return cylinder(22, 10, { segments: 256 });");
    expect(gear.stats.volumeMm3).toBeLessThan(full.stats.volumeMm3 * 0.95);
  }, 40000);

  it("extends past the root circle", async () => {
    const gear = await run("return spurGear({ module: 2, teeth: 20, thickness: 10 });");
    // Root radius is pitch - 1.25 x module = 17.5.
    expect(gear.stats.volumeMm3).toBeGreaterThan(Math.PI * 17.5 * 17.5 * 10);
  }, 40000);

  it("subtracts a bore without changing the envelope", async () => {
    const solid = await run("return spurGear({ module: 2, teeth: 20, thickness: 10 });");
    const bored = await run("return spurGear({ module: 2, teeth: 20, thickness: 10, bore: 8 });");
    expect(bored.stats.bboxMm.max[0]).toBeCloseTo(22, 4);
    expect(bored.stats.volumeMm3).toBeLessThan(solid.stats.volumeMm3);
    expect(solid.stats.volumeMm3 - bored.stats.volumeMm3).toBeCloseTo(Math.PI * 16 * 10, -1);
  }, 40000);

  it("refuses a spec it cannot build", async () => {
    const noTeeth = await run("return spurGear({ module: 2, teeth: 2, thickness: 10 });");
    expect(noTeeth.ok).toBe(false);
    expect(noTeeth.error).toMatch(/at least 3 teeth/);

    const noModule = await run("return spurGear({ module: 0, teeth: 20, thickness: 10 });");
    expect(noModule.ok).toBe(false);
    expect(noModule.error).toMatch(/positive module/);

    const badBore = await run("return spurGear({ module: 2, teeth: 20, thickness: 10, bore: 40 });");
    expect(badBore.ok).toBe(false);
    expect(badBore.error).toMatch(/does not fit inside the root diameter/);
  }, 40000);
});

// Regression, from the live timing pulley: the model assembled the teeth from
// boxes placed around a cylinder, leaving them 0.75mm clear of the body and
// reaching 7.5mm above it. Watertight, one connected solid, every gate passed,
// and unusable. A toothed profile is ONE contour, so the teeth cannot detach.
describe("polygon", () => {
  it("extrudes a closed contour to the expected volume", async () => {
    const r = await run("return extrude(polygon([[0,0],[10,0],[10,10],[0,10]]), 5);");
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo(500, 6);
  });

  it("cuts a bore from an enclosed contour", async () => {
    const code = [
      "const outer = [[0,0],[20,0],[20,20],[0,20]];",
      "const bore = [[5,5],[15,5],[15,15],[5,15]];",
      "return extrude(polygon([outer, bore]), 5);",
    ].join("\n");
    const r = await run(code);
    expect(r.ok).toBe(true);
    expect(r.stats.volumeMm3).toBeCloseTo((400 - 100) * 5, 6);
  });

  it("reaches the outer radius for a toothed outline", async () => {
    const code = [
      "const pts = [];",
      "const step = (2 * Math.PI) / 20;",
      "for (let i = 0; i < 20; i++) {",
      "  const a0 = i * step;",
      "  for (const frac of [0, 0.25, 0.5, 0.75]) {",
      "    const r = (frac === 0.25 || frac === 0.5) ? 15 : 13.5;",
      "    pts.push([r * Math.cos(a0 + step * frac), r * Math.sin(a0 + step * frac)]);",
      "  }",
      "}",
      "return extrude(polygon(pts), 10);",
    ].join("\n");
    const r = await run(code);
    expect(r.ok).toBe(true);
    // A 20-tooth outline of rOut 15 / rIn 13.5 has area ~637.28.
    expect(r.stats.volumeMm3).toBeCloseTo(637.28 * 10, -1);
    expect(r.stats.bboxMm.max[0]).toBeCloseTo(15, 1);
  });

  it("refuses a contour with fewer than three points", async () => {
    const r = await run("return extrude(polygon([[0,0],[10,0]]), 5);");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at least 3 points/);
  });
});

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

describe("boardCase cutouts", () => {
  const PI = "boardLength: 85, boardWidth: 56, holes: [[3.5,3.5],[3.5,52.5],[61.5,52.5],[61.5,3.5]]";

  it("cuts a port that lies on its wall", async () => {
    const r = await run("P.s; return boardCase({ " + PI +
      ", cutouts: [{ wall: 'y-', at: 30, width: 8, height: 4, z: 2 }] });");
    expect(r.ok).toBe(true);
  });

  it("refuses a port placed past the end of its wall", async () => {
    // attempt#1 rpi4-case: HDMI at 75 and power at 90 on the 56 mm x+ wall
    // were silently cut into thin air - a valid case with no HDMI opening.
    const r = await run("P.s; return boardCase({ " + PI +
      ", cutouts: [{ wall: 'x+', at: 75, width: 15, height: 12, z: 5 }] });");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("56");
    expect(r.error).toContain("x+");
  });
});

// The numbers below are OpenSCAD's render of BOSL2's own examples (see
// scripts/cad-reference.mjs). A port that drifts from them is a different part.
describe("ported BOSL2 hinges", () => {
  it("printInPlaceHinge matches OpenSCAD's render of the BOSL2 example", async () => {
    const r = await run("P.s; return printInPlaceHinge({});");
    expect(r.ok).toBe(true);
    const size = [0, 1, 2].map((a) => r.stats.bboxMm.max[a] - r.stats.bboxMm.min[a]);
    expect(size[0]).toBeCloseTo(40.4, 1);
    expect(size[1]).toBeCloseTo(25.0, 1);
    expect(size[2]).toBeCloseTo(7.1, 1);
    expect(Math.abs(r.stats.volumeMm3 - 2499.7) / 2499.7).toBeLessThan(0.005);
  });

  it("knuckleHinge matches OpenSCAD's render of a bare inner half", async () => {
    const r = await run("P.s; return knuckleHinge({ length: 35, segs: 6, offset: 5, inner: true," +
      " armHeight: 2, armAngle: 60, clip: 1 });");
    expect(r.ok).toBe(true);
    expect(Math.abs(r.stats.volumeMm3 - 227.0) / 227.0).toBeLessThan(0.005);
  });

  it("refuses an offset smaller than the knuckle radius", async () => {
    const r = await run("P.s; return knuckleHinge({ length: 20, segs: 3, offset: 1 });");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("knuckle radius");
  });
});

describe("printInPlaceHinge refusals", () => {
  it("refuses segments too short to hold their pins, naming a count that works", async () => {
    // attempt#5 door-hinge: 32 segs over 50mm came out as 16 loose pieces.
    const r = await run("P.s; return printInPlaceHinge({ length: 50, segs: 32, knuckleDiam: 8 });");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at most \d+ segs/);
  });

  it("scales the default offset with the knuckle so the leaves stay apart", async () => {
    // A 6mm knuckle at BOSL2's literal offset 3.1 fuses the leaves into one body.
    const r = await run("P.s; return printInPlaceHinge({ knuckleDiam: 6 });");
    expect(r.ok).toBe(true);
  });
});

describe("body count", () => {
  it("reports two bodies for two boxes that do not touch, largest first", async () => {
    const r = await run("P.s; return box(10, 10, 10).add(box(2, 2, 2).translate([20, 0, 0]));");
    expect(r.ok).toBe(true);
    expect(r.stats.bodies.count).toBe(2);
    expect(r.stats.bodies.boxes[0].max[0]).toBeCloseTo(5, 3);
    expect(r.stats.bodies.boxes[1].min[0]).toBeCloseTo(19, 3);
  });

  it("reports one body when the pieces overlap", async () => {
    const r = await run("P.s; return box(10, 10, 10).add(box(2, 2, 2).translate([5.5, 0, 0]));");
    expect(r.stats.bodies.count).toBe(1);
  });
});

// OpenSCAD's render of Matthew Burke's filament_spool_holder.scad (MIT), part
// by part, with its default parameters - see scripts/cad-reference.mjs spool-*.
describe("ported spool holder", () => {
  const cases = [
    ["side_frame", [175.0, 177.31, 8.0], 80718.9],
    ["crossbar", [133.0, 20.0, 18.0], 45095.9],
    ["axle", [163.0, 17.91, 17.91], 41212.4],
    ["axle_cap", [27.0, 27.0, 11.0], 4208.7],
  ];
  for (const [part, size, volume] of cases) {
    it(part + " matches OpenSCAD's render", async () => {
      const r = await run("P.s; return spoolHolder({ part: '" + part + "' });");
      expect(r.ok).toBe(true);
      const got = [0, 1, 2].map((a) => r.stats.bboxMm.max[a] - r.stats.bboxMm.min[a]);
      for (const a of [0, 1, 2]) expect(got[a]).toBeCloseTo(size[a], 1);
      expect(Math.abs(r.stats.volumeMm3 - volume) / volume).toBeLessThan(0.001);
      expect(r.stats.bodies.count).toBe(1);
    });
  }

  it("refuses a bore bigger than the spool, with the SCAD's own message", async () => {
    const r = await run("P.s; return spoolHolder({ spoolMaxDiameter: 60, spoolMaxBoreDiameter: 58 });");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("4 mm of spool flange");
  });
});
