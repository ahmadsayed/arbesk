// THROWAWAY SPIKE — proves manifold-3d loads under Bun and produces a solid.
//
// Two deviations from the task brief, both discovered by running it:
// 1. manifold-3d 3.5.3 needs `wasm.setup()` before the JS API exists; without it
//    Manifold.cube is undefined even though the WASM itself loaded fine.
// 2. `locateFile` must point at a REAL filesystem path. The brief's
//    `path.resolve(here, "..", "node_modules", "manifold-3d")` (here =
//    dirname(import.meta.url)) works under `bun` but not in a compiled binary:
//    there import.meta.url is virtual (/$bunfs/root/cad-spike), so the path
//    becomes /$bunfs/node_modules/manifold-3d. The compiled server must resolve
//    from PROJECT_ROOT, exactly like the brotli-wasm shim — here that is
//    process.env.CAD_MANIFOLD_WASM_DIR || path.resolve(process.cwd(), ...).
import path from "node:path";
import { fileURLToPath } from "node:url";
import Module from "manifold-3d";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = process.env.CAD_MANIFOLD_WASM_DIR ??
  path.resolve(process.cwd(), "node_modules", "manifold-3d");

// The loader contract: an absolute wasm directory handed to Emscripten.
const wasm = await Module({ locateFile: (file) => path.join(wasmDir, file) });
wasm.setup();
const { Manifold } = wasm;

const box = Manifold.cube([60, 40, 10], true);
const hole = Manifold.cylinder(20, 3, 3, 32, true);
const part = box.subtract(hole);

console.log(JSON.stringify({
  status: part.status(),
  numTri: part.numTri(),
  numVert: part.numVert(),
  volume: part.volume(),
  bbox: part.boundingBox(),
}, null, 2));

const mesh = part.getMesh();
console.log("mesh numProp=" + mesh.numProp +
  " vertProperties=" + mesh.vertProperties.length +
  " triVerts=" + mesh.triVerts.length);
console.log("wasmDir=" + wasmDir +
  " cwd=" + process.cwd() +
  " importMetaUrl=" + import.meta.url +
  " (import.meta.url dirname=" + here + ")");
