/**
 * Watertightness (manifold) check for print readiness.
 * @remarks Pure over typed arrays — no Babylon, no DOM — so it is testable
 *   in bun and portable to a worker or the CLI later. Vertices are welded by
 *   quantized position (1e-5 tolerance), not by index, so duplicated-corner
 *   meshes are judged by their true topology. A mesh set is watertight when
 *   every edge is shared by exactly 2 triangles.
 */

export interface MeshGeometry {
  positions: Float32Array | number[];
  indices: Uint32Array | number[];
}

export interface PrintabilityReport {
  manifold: boolean;
  triangleCount: number;
  /** edges shared by exactly 1 triangle (boundary) */
  openEdges: number;
  /** edges shared by 3+ triangles */
  nonManifoldEdges: number;
}

const WELD = 1e5;

function vertexKey(positions: Float32Array | number[], i: number): string {
  const o = i * 3;
  return (
    Math.round(positions[o] * WELD) + "," +
    Math.round(positions[o + 1] * WELD) + "," +
    Math.round(positions[o + 2] * WELD)
  );
}

/** Undirected edge key for one triangle side. */
function edgeKey(a: string, b: string): string {
  return a < b ? a + "|" + b : b + "|" + a;
}

/** Tally edge sharers across all meshes; returns the tallies + triangle count. */
function countEdges(meshes: MeshGeometry[]): {
  edgeCount: Map<string, number>;
  triangleCount: number;
} {
  const edgeCount = new Map<string, number>();
  let triangleCount = 0;
  for (const { positions, indices } of meshes) {
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = vertexKey(positions, indices[t]);
      const b = vertexKey(positions, indices[t + 1]);
      const c = vertexKey(positions, indices[t + 2]);
      if (a === b || b === c || a === c) continue; // degenerate
      triangleCount++;
      edgeCount.set(edgeKey(a, b), (edgeCount.get(edgeKey(a, b)) ?? 0) + 1);
      edgeCount.set(edgeKey(b, c), (edgeCount.get(edgeKey(b, c)) ?? 0) + 1);
      edgeCount.set(edgeKey(c, a), (edgeCount.get(edgeKey(c, a)) ?? 0) + 1);
    }
  }
  return { edgeCount, triangleCount };
}

export function analyzePrintability(meshes: MeshGeometry[]): PrintabilityReport {
  const { edgeCount, triangleCount } = countEdges(meshes);

  let openEdges = 0;
  let nonManifoldEdges = 0;
  for (const n of edgeCount.values()) {
    if (n === 1) openEdges++;
    else if (n > 2) nonManifoldEdges++;
  }

  return {
    manifold: triangleCount > 0 && openEdges === 0 && nonManifoldEdges === 0,
    triangleCount,
    openEdges,
    nonManifoldEdges,
  };
}
