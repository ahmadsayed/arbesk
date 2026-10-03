/**
 * Verifies a ported library part against OpenSCAD's render of the original.
 *
 * NOT part of the server. This is the acceptance test for growing the prelude
 * library: a port is done when OUR solid and OPENSCAD's solid agree on size,
 * volume and body count, and the two renders - drawn by the same renderer -
 * look the same.
 *
 * Usage:
 *   bun scripts/cad-reference.mjs <case>        (a case name from CASES below)
 *   bun scripts/cad-reference.mjs --all
 *
 * Each case names a .scad under scripts/cad-reference/ and a script body that
 * builds the port through the real prelude. OpenSCAD renders the .scad (its
 * libraries are cloned into test-results/reference/, which is gitignored), and
 * both meshes are rendered to PNG by scripts/cad-eval.mjs --stl.
 *
 * Requires `openscad` on PATH and the reference library checked out:
 *   git clone --depth 1 https://github.com/BelfrySCAD/BOSL2 test-results/reference/BOSL2
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildPrelude, PRELUDE_NAMES } from "../packages/cad-gen/src/core/prelude.ts";
import { PROJECT_ROOT, loadCadKernel } from "./lib/cad-harness.mjs";

const OUT = path.join(PROJECT_ROOT, "test-results", "reference");
const SCAD_DIR = path.join(PROJECT_ROOT, "scripts", "cad-reference");

/** Port cases: the reference .scad and the prelude call that should match it. */
/**
 * @typedef {{ scad?: string, repo?: string, file?: string,
 *   defines?: Record<string, string>, code: string }} RefCase
 * `scad` is a file under scripts/cad-reference/; `repo` + `file` render a
 * cloned repository's OWN file, unmodified, with OpenSCAD -D overrides - so a
 * permissively licensed reference never has to be copied into this repo.
 */
/** @type {Record<string, RefCase>} */
const CASES = {
  "hinge-pip": { scad: "hinge-pip.scad", code: "return printInPlaceHinge({});" },
  ...Object.fromEntries(["side_frame", "crossbar", "axle", "axle_cap"].map((part) => [
    "spool-" + part.replace("_", "-"), {
      repo: "Burke9077/3dthings-filament-spool-holder", file: "filament_spool_holder.scad",
      defines: { part: JSON.stringify(part) },
      code: "return spoolHolder({ part: " + JSON.stringify(part) + " });",
    }])),
  "spool-side-frame-big": {
    repo: "Burke9077/3dthings-filament-spool-holder", file: "filament_spool_holder.scad",
    defines: { part: "\"side_frame\"", spool_max_diameter: "300", spool_max_width: "70", base_depth: "220" },
    code: "return spoolHolder({ part: 'side_frame', spoolMaxDiameter: 300, spoolMaxWidth: 70, baseDepth: 220 });",
  },
  ...Object.fromEntries(Object.entries({
    "gf-cup-default": [{}, "{}"],
    "gf-cup-2x3x6": [{ width: "2", depth: "3", height: "6" }, "{ width: 2, depth: 3, height: 6 }"],
    "gf-cup-full": [
      { width: "3", depth: "2", height: "4", chambers: "3", withLabel: "\"left\"",
        magnet_diameter: "6.5", screw_depth: "6" },
      "{ width: 3, depth: 2, height: 4, chambers: 3, withLabel: 'left', magnetDiameter: 6.5, screwDepth: 6 }",
    ],
    "gf-cup-reduced": [
      { width: "1", depth: "1", height: "2", lip_style: "\"reduced\"", fingerslide: "false" },
      "{ width: 1, depth: 1, height: 2, lipStyle: 'reduced', fingerslide: false }",
    ],
    "gf-cup-half-nolip": [
      { width: "0.5", depth: "2", height: "3", lip_style: "\"none\"", withLabel: "\"center\"" },
      "{ width: 0.5, depth: 2, height: 3, lipStyle: 'none', withLabel: 'center' }",
    ],
  }).map(([name, [defines, args]]) => [name, {
    repo: "vector76/gridfinity_openscad", file: "gridfinity_basic_cup.scad", defines,
    code: "return gridfinityCup(" + args + ");",
  }])),
  "knuckle-bare": {
    scad: "knuckle-bare.scad",
    code: "return knuckleHinge({ length: 35, segs: 6, offset: 5, inner: true, armHeight: 2, armAngle: 60, clip: 1 });",
  },
};

/**
 * @param {string} file ASCII STL path.
 * @returns {number[][][]} Triangles as three [x, y, z] points.
 */
function readStl(file) {
  const tris = [];
  let tri = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.trim().match(/^vertex\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (!m) continue;
    tri.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    if (tri.length === 3) { tris.push(tri); tri = []; }
  }
  return tris;
}

/**
 * Size, volume and connected body count of a triangle soup.
 * @param {number[][][]} tris Triangles.
 */
function measure(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  /** @type {Map<string, number>} */
  const ids = new Map();
  /** @type {number[]} */
  const parent = [];
  /** @type {(i: number) => number} */
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  /** @type {(p: number[]) => number} */
  const id = (p) => {
    const k = p.map((v) => v.toFixed(4)).join(",");
    if (!ids.has(k)) { ids.set(k, parent.length); parent.push(parent.length); }
    return /** @type {number} */ (ids.get(k));
  };
  for (const [a, b, c] of tris) {
    for (const p of [a, b, c]) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const [ia, ib, ic] = [id(a), id(b), id(c)];
    parent[find(ib)] = find(ia);
    parent[find(ic)] = find(ia);
  }
  const bodies = new Set(parent.map((_, i) => find(i))).size;
  return { size: [0, 1, 2].map((i) => max[i] - min[i]), min, volume, bodies };
}

/**
 * @param {any} manifold A built solid.
 * @param {string} file Where to write it as ASCII STL.
 */
function writeStl(manifold, file) {
  const mesh = manifold.getMesh();
  /** @type {(i: number) => number[]} */
  const v = (i) => [0, 1, 2].map((k) => mesh.vertProperties[i * mesh.numProp + k]);
  const lines = ["solid port"];
  for (let t = 0; t < mesh.triVerts.length; t += 3) {
    lines.push(" facet normal 0 0 0", "  outer loop");
    for (let k = 0; k < 3; k++) lines.push("   vertex " + v(mesh.triVerts[t + k]).join(" "));
    lines.push("  endloop", " endfacet");
  }
  lines.push("endsolid port");
  fs.writeFileSync(file, lines.join("\n"));
}

/** @param {{ size: number[], volume: number, bodies: number }} m A measurement. */
const fmt = (m) => "size " + m.size.map((s) => s.toFixed(2)).join(" x ") +
  "  volume " + m.volume.toFixed(1) + "  bodies " + m.bodies;

/**
 * The .scad to render for a case, cloning its repository on first use.
 * @param {RefCase} c The case.
 * @returns {string} An absolute path.
 */
function scadPathOf(c) {
  if (c.scad) return path.join(SCAD_DIR, c.scad);
  const dir = path.join(OUT, /** @type {string} */ (c.repo).replace("/", "__"));
  if (!fs.existsSync(dir)) {
    execFileSync("git", ["clone", "-q", "--depth", "1", "https://github.com/" + c.repo, dir]);
  }
  return path.join(dir, /** @type {string} */ (c.file));
}

/**
 * Renders the reference, builds the port, and prints how far apart they are.
 * @param {string} name A key of CASES. @param {any} module Loaded manifold-3d.
 */
async function runCase(name, module) {
  const c = CASES[name];
  if (!c) throw new Error("unknown case " + name + "; known: " + Object.keys(CASES).join(", "));
  const refStl = path.join(OUT, name + ".ref.stl");
  const portStl = path.join(OUT, name + ".port.stl");
  if (!fs.existsSync(refStl)) {
    const defines = Object.entries(c.defines ?? {}).flatMap(([k, v]) => ["-D", k + "=" + v]);
    execFileSync("openscad", ["-o", refStl, ...defines, scadPathOf(c)], {
      env: { ...process.env, OPENSCADPATH: OUT }, stdio: "ignore",
    });
  }
  const helpers = buildPrelude(module, { segments: 64 });
  const fn = new Function("PARAMETERS", "P", "M", ...PRELUDE_NAMES, c.code);
  const part = fn({}, {}, module.Manifold, ...PRELUDE_NAMES.map((n) => helpers[n]));
  writeStl(part, portStl);

  const ref = measure(readStl(refStl));
  const port = measure(readStl(portStl));
  console.log("\n=== " + name + " ===");
  console.log("openscad  " + fmt(ref));
  console.log("port      " + fmt(port));
  const dSize = Math.max(...[0, 1, 2].map((i) => Math.abs(ref.size[i] - port.size[i])));
  const dVol = Math.abs(ref.volume - port.volume) / ref.volume * 100;
  console.log("delta     size " + dSize.toFixed(3) + " mm  volume " + dVol.toFixed(2) + " %  bodies " +
    (ref.bodies === port.bodies ? "match" : "DIFFER"));
  for (const [stl, tag] of [[refStl, "ref"], [portStl, "port"]]) {
    execFileSync("bun", [path.join(PROJECT_ROOT, "scripts", "cad-eval.mjs"), "--stl", stl,
      path.join(OUT, name + "." + tag + ".png")], { stdio: "ignore" });
  }
  console.log("png       " + path.join(OUT, name + ".{ref,port}.png"));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: bun scripts/cad-reference.mjs <case> | --all");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { module } = await loadCadKernel();
  for (const name of args[0] === "--all" ? Object.keys(CASES) : args) await runCase(name, module);
}

main().catch((e) => {
  console.error("REFERENCE_FATAL", e);
  process.exit(1);
});
