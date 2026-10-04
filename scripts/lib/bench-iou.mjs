/**
 * Exact volumetric IoU through Manifold, and the per-sample scorer.
 * @remarks Our addition to the paper's metrics. The paper's IoGT is a
 *   bounding-box ratio, so two parts with the same box and different holes
 *   score alike; Manifold's booleans are exact, so intersect / union volume
 *   measures the solids themselves. Measured in the frame alignAndScore found,
 *   so IoU and the paper metrics describe the same alignment.
 */
import { alignAndScore, applySteps } from "./mesh-metrics.mjs";
import { readStl } from "./stl.mjs";

/** @typedef {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} Mesh */

/**
 * A Manifold from a triangle soup, coincident vertices welded.
 * @param {any} module Loaded manifold-3d module (setup() already called).
 * @param {Mesh} mesh
 * @returns {any} A Manifold; the caller deletes it.
 * @throws {Error} "Not manifold" when the mesh is not a closed 2-manifold.
 */
export function manifoldFrom(module, mesh) {
  const m = new module.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(mesh.positions),
    triVerts: Uint32Array.from(mesh.indices),
  });
  m.merge();
  return new module.Manifold(m);
}

/**
 * Intersection over union of two solids, after mapping each into the shared frame.
 * @param {any} module Loaded manifold-3d module.
 * @param {Mesh} generated
 * @param {Mesh} truth
 * @param {{ generatedSteps: import("./mesh-metrics.mjs").Step[],
 *   truthSteps: import("./mesh-metrics.mjs").Step[] }} frame From alignAndScore.
 * @returns {{ iou: number | null, reason: string | null }} iou is null when a
 *   mesh is not a closed solid; reason says which.
 */
export function exactIoU(module, generated, truth, frame) {
  /** @type {any[]} */
  const owned = [];
  const keep = (/** @type {any} */ x) => (owned.push(x), x);
  try {
    let a;
    try {
      a = keep(manifoldFrom(module, { positions: applySteps(generated.positions, frame.generatedSteps), indices: generated.indices }));
      keep(manifoldFrom(module, { positions: applySteps(truth.positions, frame.truthSteps), indices: truth.indices }));
    } catch (e) {
      return { iou: null, reason: (a ? "ground truth" : "generated") + " not manifold: " + (e instanceof Error ? e.message : String(e)) };
    }
    const [x, y] = owned;
    const union = keep(x.add(y)).volume();
    const inter = keep(x.intersect(y)).volume();
    return { iou: union > 0 ? inter / union : 0, reason: null };
  } finally {
    for (const m of owned) m.delete();
  }
}

/**
 * Builds the scorer one benchmark run uses for every sample.
 * @param {any} module Loaded manifold-3d module.
 * @param {(file: string) => Mesh} [readTruth] Ground-truth reader.
 * @returns {(mesh: Mesh, truthPath: string) => { chamfer: number, hausdorff: number,
 *   iogt: number, iou: number | null, iouReason: string | null }}
 */
export function createScorer(module, readTruth = readStl) {
  return (mesh, truthPath) => {
    const truth = readTruth(truthPath);
    const frame = alignAndScore(mesh, truth);
    const { iou, reason } = exactIoU(module, mesh, truth, frame);
    return { ...frame.metrics, iou, iouReason: reason };
  };
}
