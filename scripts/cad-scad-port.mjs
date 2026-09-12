/**
 * Ports an OpenSCAD part to Manifold JS by extracting its polygon profile.
 *
 * Reference designs are the only ground truth we have: everything else has been
 * judged against a description of what a part should be. This reads a .scad whose
 * geometry is a polygon(points, paths) profile extruded, resolves the SCAD
 * parameter expressions, re-orders the indices into contours, builds the solid
 * and writes it out as ASCII STL so cad-eval.mjs --stl can render it through the
 * SAME renderer as the reference - a comparison has to be of two parts, not of
 * two differently-framed pictures.
 *
 * Fetch the source first, into the gitignored reference directory:
 *   curl -sSL -o test-results/reference/SmartPhoneHolder.scad \
 *     https://raw.githubusercontent.com/DrLex0/print3d-customizable-smartphone-holder/master/SmartPhoneHolder.scad
 *
 * Verified against DrLex0's example STL: 66.79 x 49.89 x 60.00mm ported against
 * 66.79 x 49.82 x 60.00mm reference, missing only the subtracted slots and
 * corner cutters that this does not yet port.
 */
 * Ports DrLex0's SmartPhoneHolder extrusionProfile() to Manifold JS.
 * Reads the SCAD, pulls the 91-point polygon and its two closed paths, resolves
 * the SCAD parameter expressions, and extrudes the resulting contour.
 */
import fs from "node:fs";
import path from "node:path";
import Module from "manifold-3d";

const ROOT = "/home/ahmedh/Projects/arbesk/.worktrees/cad-gen";
const SCAD = path.join(ROOT, "test-results/reference/SmartPhoneHolder.scad");
const src = fs.readFileSync(SCAD, "utf8");

// The parameters this instance was exported with (drives the example STL).
const P = { thick: 12.0, lift: 40, width: 60.0, rearLip: 15 };
P.rear = P.rearLip + 14.495;
P.ox = P.thick * Math.cos((10 * Math.PI) / 180);
P.ox2 = P.ox + (P.thick * Math.sin((10 * Math.PI) / 180) + P.lift - 38.2967) * Math.tan((10 * Math.PI) / 180);
P.lift2 = P.lift + P.thick * Math.sin((10 * Math.PI) / 180);

/** Resolves a SCAD numeric expression against the parameter table. */
const evalExpr = (e) => {
  const body = e.replace(/\/\/[^\n]*/g, "").trim().replace(/,$/, "");
  if (!/^[-+*/().\d\sA-Za-z_]+$/.test(body)) throw new Error("unsupported expression: " + body);
  return Function(...Object.keys(P), "return (" + body + ");")(...Object.values(P));
};

// points = [ [x, y], ... ] inside extrusionProfile().
const profileAt = src.indexOf("module extrusionProfile()");
const pointsBlock = src.slice(src.indexOf("points = [", profileAt), src.indexOf("], paths = [", profileAt));
const points = [...pointsBlock.matchAll(/\[\s*([^\[\]]+?)\s*\]/g)]
  .map((m) => m[1].split(",").map((v) => evalExpr(v)));
console.log("points parsed: " + points.length);

const pathsBlock = src.slice(src.indexOf("paths = [", profileAt), src.indexOf("]);", src.indexOf("paths = [", profileAt)));
const paths = [...pathsBlock.matchAll(/\[([^\[\]]+)\]/g)]
  .map((m) => m[1].split(",").map((v) => Number(v.trim())).filter((v) => !Number.isNaN(v)));

console.log("paths: " + paths.map((p) => p.length).join(" + ") + " indices");
const contours = paths.map((ids) => ids.map((i) => points[i]));
console.log("contour sizes: " + contours.map((c) => c.length).join(", "));

// Emit the Manifold JS that reproduces it.
const js = [
  "const outer = " + JSON.stringify(contours[0]) + ";",
  "const inner = " + JSON.stringify(contours[1]) + ";",
  "return extrude(polygon([outer, inner]), " + P.width + ");",
].join("\n");
fs.writeFileSync(path.join(ROOT, "test-results/reference/ported-stand.json"), JSON.stringify({
  code: js,
  parameters: { width: { value: P.width, unit: "mm" } },
  summary: "ported from DrLex0 SmartPhoneHolder",
}, null, 2));

// Build it and render, to compare against the reference STL.
/** @type {any} */
const opts = { locateFile: (/** @type {string} */ f) => path.join(ROOT, "node_modules/manifold-3d", f) };
const m = await Module(opts);
m.setup();
const { CrossSection, Manifold } = m;
// The SCAD applies rotate([0,0,90]) after extruding; bake it into the profile
// so the ported part comes out in the same orientation as the reference STL.
const rotated = contours.map((c) => c.map(([x, y]) => [-y, x]));
const cs = CrossSection.ofPolygons(rotated, "EvenOdd");
console.log("profile area: " + cs.area().toFixed(1) + " mm2");
const solid = Manifold.extrude(cs, P.width, 0, 0, [1, 1], true);
const b = solid.boundingBox();
console.log("ported solid: " + solid.numTri() + " tri, " + solid.volume().toFixed(0) + " mm3");
console.log("  size mm  " + [0, 1, 2].map((a) => (b.max[a] - b.min[a]).toFixed(2)).join(" x "));
console.log("  bbox     " + [0, 1, 2].map((a) => b.min[a].toFixed(1) + ".." + b.max[a].toFixed(1)).join("  "));

// Export as ASCII STL so cad-eval.mjs --stl renders it through the SAME
// renderer as the reference: the comparison has to be of two parts, not two
// differently-framed pictures.
const mesh = solid.getMesh();
const lines = ["solid ported"];
for (let t = 0; t < mesh.triVerts.length; t += 3) {
  lines.push("facet normal 0 0 0", "  outer loop");
  for (let k = 0; k < 3; k++) {
    const v = mesh.triVerts[t + k];
    lines.push("    vertex " + mesh.vertProperties[v * mesh.numProp] + " " +
      mesh.vertProperties[v * mesh.numProp + 1] + " " +
      mesh.vertProperties[v * mesh.numProp + 2]);
  }
  lines.push("  endloop", "endfacet");
}
lines.push("endsolid ported");
fs.writeFileSync(path.join(ROOT, "test-results/reference/ported-stand.stl"), lines.join("\n"));
console.log("wrote ported-stand.stl");
