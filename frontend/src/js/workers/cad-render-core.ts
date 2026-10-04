/**
 * Pure CAD render pipeline shared by the browser worker and its unit tests.
 * @remarks Imports only @arbesk/cad-gen core (browser-safe). The Manifold
 *   module is injected by the host — the kernel owns no loader by design.
 */
import {
  createCadKernel,
  guardScript,
  meshTo3mf,
  PRELUDE_NAMES,
  PRELUDE_VERSION,
} from "@arbesk/cad-gen";
import type { CadDesign } from "@arbesk/cad-gen";

/** Stable error codes mapped to user copy in the render service. */
export class CadRenderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CadRenderError";
    this.code = code;
  }
}

export interface CadRenderOutput {
  bytes: Uint8Array;
  summary: string;
  stats: unknown;
}

/**
 * Guard → kernel → 3MF export for one design document.
 * @param manifoldModule - initialized Manifold module (setup() already called)
 * @param runtime - the design's runtime contract; a prelude version newer or
 *   older than this build's refuses to run (the prelude API may have moved)
 */
export function renderCadDesign(
  design: CadDesign,
  manifoldModule: unknown,
  runtime: { preludeVersion?: string } = {},
): CadRenderOutput {
  if (runtime.preludeVersion && runtime.preludeVersion !== PRELUDE_VERSION) {
    throw new CadRenderError(
      "CAD_PRELUDE_MISMATCH",
      `CAD runtime mismatch (design ${runtime.preludeVersion}, app ${PRELUDE_VERSION}) — refresh the page.`,
    );
  }
  const guard = guardScript(design.code, PRELUDE_NAMES);
  if (!guard.ok) {
    throw new CadRenderError(
      "CAD_GUARD_REJECTED",
      `Design rejected by the client-side safety guard (${guard.reason}) — try rephrasing the request.`,
    );
  }
  try {
    const kernel = createCadKernel(manifoldModule as any, { segments: 64 });
    const { mesh, stats } = kernel.run(design);
    const bytes = meshTo3mf(mesh, design);
    return { bytes, summary: design.summary, stats };
  } catch (err) {
    if (err instanceof CadRenderError) throw err;
    throw new CadRenderError(
      "CAD_KERNEL_FAILED",
      `CAD kernel failed: ${(err as Error).message ?? "unknown error"}`,
    );
  }
}
