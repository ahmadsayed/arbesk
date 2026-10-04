/**
 * Closed test meshes for the benchmark suites.
 * @remarks Winding is outward (verified: Manifold reports volume +1 for a unit
 *   box), so the same helper serves the pure metrics and the Manifold IoU tests.
 */

/**
 * An axis-aligned box as a closed 12-triangle mesh.
 * @param {number[]} size [x, y, z] side lengths.
 * @param {number[]} [at] Minimum corner.
 * @returns {{ positions: Float32Array, indices: Uint32Array }}
 */
export function box(size, at = [0, 0, 0]) {
  const positions = [];
  for (let i = 0; i < 8; i++) {
    positions.push(at[0] + (i & 1 ? size[0] : 0), at[1] + (i & 2 ? size[1] : 0), at[2] + (i & 4 ? size[2] : 0));
  }
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const indices = quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]);
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Rotates a mesh about Z by deg, then scales and translates it.
 * @param {{ positions: Float32Array, indices: Uint32Array }} mesh
 * @param {number} deg @param {number} scale @param {number[]} offset
 */
export function moved(mesh, deg, scale, offset) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const p = Float32Array.from(mesh.positions);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1];
    p[i] = (c * x - s * y) * scale + offset[0];
    p[i + 1] = (s * x + c * y) * scale + offset[1];
    p[i + 2] = p[i + 2] * scale + offset[2];
  }
  return { positions: p, indices: mesh.indices };
}
