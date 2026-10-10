/**
 * Building blocks for parts swept as rings of vertices and closed by hand.
 * @remarks Shared by the gear ports that build their own triangle soup
 *   (bevel-gear.ts, worm-gear.ts) rather than extrude a CrossSection.
 */
export type Vec3 = [number, number, number];

/**
 * Quads between consecutive rings of `ringSize` vertices, wrapping round each ring.
 * @param alt Split each quad along its other diagonal (BOSL2's style="alt"):
 *   on a helix whose rings climb with the thread, that diagonal runs along the
 *   thread instead of across it, so the flanks do not facet into a sawtooth.
 */
export function sideFaces(rings: number, ringSize: number, alt = false): number[][] {
  const faces: number[][] = [];
  for (let k = 0; k + 1 < rings; k++) {
    for (let i = 0; i < ringSize; i++) {
      const a = k * ringSize + i;
      const b = k * ringSize + ((i + 1) % ringSize);
      if (alt) faces.push([a, a + ringSize, b], [b, a + ringSize, b + ringSize]);
      else faces.push([a, b + ringSize, b], [a, a + ringSize, b + ringSize]);
    }
  }
  return faces;
}

/** Signed volume of a closed triangle soup; negative means it is wound inside out. */
export function signedVolume(verts: Vec3[], faces: number[][]): number {
  let v = 0;
  for (const [a, b, c] of faces) {
    const [p, q, r] = [verts[a], verts[b], verts[c]];
    v += p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  return v / 6;
}
