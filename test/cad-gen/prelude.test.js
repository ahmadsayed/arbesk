import { runValidation } from "@arbesk/cad-gen/backend/validate-runner.js";

const OPTS = { timeoutMs: 20000, maxTriangles: 200000 };
const design = (code) => ({ code, parameters: { s: { value: 10, unit: "mm" } }, summary: "" });
const run = (code) => runValidation(design(code), OPTS);

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
