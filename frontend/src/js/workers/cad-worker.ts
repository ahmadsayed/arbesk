/**
 * CAD render worker: loads the Manifold WASM module, then renders designs
 * (guard → kernel → 3MF) on demand. Self-contained bundle — module workers
 * get no import map. `manifold.wasm` is staged next to this bundle by
 * frontend/scripts/bundle.js.
 */
// @ts-ignore TS2307 - ESM-only dependency; types are not resolved under the
// frontend's CommonJS-facing NodeNext config, but this is a browser module worker.
import Module from "manifold-3d";
import { CadRenderError, renderCadDesign } from "./cad-render-core.ts";

// locateFile is declared zero-arity upstream but Emscripten passes the file
// name — keep the options bag `any` (same ruling as scripts/lib/cad-harness.mjs).
// @ts-ignore TS1470 - browser-native ESM import.meta, see gltf-worker-pool.ts
const locateWasm = (f: string) => new URL(f, import.meta.url).href;
const modulePromise = Module({
  locateFile: locateWasm,
} as any).then((module: any) => {
  // Manifold registers its JS API lazily; without setup() Manifold.cube is
  // undefined and every script dies with "Manifold.cube is not a function".
  module.setup();
  return module;
});

self.onmessage = async (event: MessageEvent) => {
  const { design, runtime } = event.data ?? {};
  const module = await modulePromise;
  try {
    const out = renderCadDesign(design, module, runtime ?? {});
    (self as unknown as Worker).postMessage(
      { type: "ok", bytes: out.bytes, summary: out.summary, stats: out.stats },
      [out.bytes.buffer],
    );
  } catch (err) {
    const code = err instanceof CadRenderError ? err.code : "CAD_KERNEL_FAILED";
    const message = err instanceof Error ? err.message : "CAD rendering failed.";
    (self as unknown as Worker).postMessage({ type: "error", code, message });
  }
};
