/**
 * Validation child: loads the Manifold kernel, runs one script, prints a stats
 * JSON line on stdout.
 * @remarks The mesh is deliberately discarded here — only stats cross back. The
 *   server validates, it does not export (spec section 5).
 * @remarks Run as: bun src/backend/child.ts <request.json path>
 */
import fs from "node:fs";
import path from "node:path";
import Module from "manifold-3d";
import { createCadKernel } from "../core/kernel.ts";
import type { CadDesign, ManifoldModule } from "../types.ts";

interface ChildRequest {
  design: CadDesign;
  maxTriangles: number;
  wasmDir: string;
}

/**
 * Runs one design and prints exactly one JSON line.
 * @remarks Script-level failures are reported in-band with exit code 0, so the
 *   parent can distinguish "the script is bad" (a repair turn) from "the kernel
 *   could not start" (a server fault, non-zero exit).
 */
async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const req = JSON.parse(fs.readFileSync(requestPath, "utf8")) as ChildRequest;

  // manifold-3d's bundled manifold.d.ts declares `locateFile: () => string`
  // (zero arity) while Emscripten actually calls it WITH the filename, so the
  // typed config rejects a correct callback (TS2322). Cast the config object,
  // never the callback, and do not augment the upstream .d.ts - an upgrade
  // would silently drop it.
  const module = await Module({
    locateFile: (file: string) => path.join(req.wasmDir, file),
  } as unknown as Parameters<typeof Module>[0]);
  // manifold-3d registers its JS API lazily. Without setup(), Manifold.cube is
  // undefined and every script dies with "Manifold.cube is not a function".
  // Verified in Task 1 - see docs/superpowers/plans/cad-spike-results.md.
  (module as { setup: () => void }).setup();

  const kernel = createCadKernel(module as unknown as ManifoldModule);
  try {
    const { stats } = kernel.run(req.design);
    if (stats.triangles > req.maxTriangles) {
      process.stdout.write(JSON.stringify({
        ok: false,
        error: "triangle budget exceeded: " + stats.triangles + " > " + req.maxTriangles,
      }) + "\n");
      return;
    }
    process.stdout.write(JSON.stringify({ ok: true, stats }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }) + "\n");
  }
}

main().catch((e) => {
  process.stderr.write("CHILD_FATAL " + (e as Error).message + "\n");
  process.exit(2);
});
