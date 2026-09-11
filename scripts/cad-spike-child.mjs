import Module from "manifold-3d";
const wasm = await Module();
// manifold-3d 3.5.3 requires setup() before the JS API exists (see cad-spike.mjs).
wasm.setup();
const { Manifold } = wasm;
Manifold.cube([1, 1, 1], true); // hold a live solid
console.log("CHILD_READY");
while (true) {
  // Deliberate hostile spin loop — the parent must be able to kill this process.
}
