/**
 * The curated CAD prelude injected into every script.
 * @remarks This module defines the *published API* the model is prompted
 *   against. Adding, removing or renaming a helper is a breaking change to
 *   PRELUDE_VERSION (spec section 4).
 */
import type { ManifoldModule } from "../types.ts";

/** Helper names injected into every script, in injection order. */
export const PRELUDE_NAMES = [
  "box", "cylinder", "sphere",
  "rect", "circle", "roundRect", "extrude", "revolve",
  "roundedBox", "hole", "boltCircle", "filletEdges", "chamferEdges",
  "bbox", "volume",
] as const;

export interface PreludeHelpers {
  /** Fillet strategy actually used, for stats reporting. */
  readonly lastFilletMode?: "exact" | "minkowski" | "smooth";
  [name: string]: unknown;
}

/**
 * Builds the helper set bound to a loaded Manifold module.
 * @remarks Implemented in Task 6. This task fixes only the names, so the kernel
 *   and the guard agree on the surface before the bodies exist.
 * @remarks DEVIATION (Task 5, reported): the stub is a map of *throwing
 *   placeholders* rather than an immediate `throw`. An immediate throw makes the
 *   mandated timeout test unreachable, because `createCadKernel().run()` builds
 *   the prelude BEFORE it evaluates the script — so a `while(true){}` design
 *   never loops and no runaway child exists to kill (measured: the child answers
 *   in-band in ~119 ms). Placeholders keep the prelude unimplemented (calling any
 *   helper still throws the documented message) while leaving the process
 *   boundary testable. Task 6 deletes this stub wholesale.
 */
export function buildPrelude(_module: ManifoldModule): PreludeHelpers {
  const helpers: PreludeHelpers = {};
  for (const name of PRELUDE_NAMES) {
    helpers[name] = () => {
      throw new Error("buildPrelude not implemented: " + name);
    };
  }
  return helpers;
}
