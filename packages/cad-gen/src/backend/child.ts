/**
 * Validation child: runs one script and prints one stats JSON line; the mesh is
 * discarded. Run as: bun src/backend/child.ts <request.json path>
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
  /** See VALIDATION_FIDELITY in validate-runner.ts. */
  segments?: number;
  minAngle?: number;
  minEdgeLength?: number;
}

/** Module-level defaults, so they must be set before the script builds anything. */
function applyResolution(module: ManifoldModule, req: ChildRequest): void {
  applyControl(module.setMinCircularAngle, req.minAngle);
  applyControl(module.setMinCircularEdgeLength, req.minEdgeLength);
}

function applyControl(
  set: ((value: number) => void) | undefined,
  value: number | undefined,
): void {
  if (value !== undefined) set?.(value);
}

/**
 * Script failures are reported in-band with exit 0; a non-zero exit means the
 * kernel could not start.
 */
async function main(): Promise<void> {
  const requestPath = process.argv[2];
  const req = JSON.parse(fs.readFileSync(requestPath, "utf8")) as ChildRequest;

  // manifold.d.ts types locateFile with zero arity but Emscripten passes the
  // filename, so cast the config object (not the callback).
  const module = await Module({
    locateFile: (file: string) => path.join(req.wasmDir, file),
  } as unknown as Parameters<typeof Module>[0]);
  // manifold-3d registers its JS API lazily; without setup() Manifold.cube is undefined.
  (module as { setup: () => void }).setup();

  const api = module as unknown as ManifoldModule;
  applyResolution(api, req);

  const kernel = createCadKernel(api, { segments: req.segments });
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
