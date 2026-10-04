/**
 * Geometry metrics for the CADPrompt benchmark. Pure maths: no I/O, no Manifold.
 * @remarks Reproduces section 5 of Alrashedy et al., ICLR 2025 ("Generating CAD
 *   Code with Vision-Language Models for 3D Designs"): ICP alignment, unit-cube
 *   normalisation, Point Cloud (Chamfer) distance, Hausdorff distance and
 *   bounding-box IoGT. One deliberate deviation: both clouds are first
 *   normalised by centroid and RMS radius, because our parts are ~100x the
 *   ground truth and ICP from raw coordinates cannot converge. That scale is
 *   rotation-invariant, so a rotated copy of a part gets the same scale; a
 *   bounding-box scale would not. See the spec's deviations list.
 */

/** @typedef {{ positions: ArrayLike<number>, indices: ArrayLike<number> }} Mesh */
/** @typedef {{ min: number[], max: number[] }} Box */
/** Maps p to (p - center) * scale. @typedef {{ center: number[], scale: number }} Normaliser */
/** Maps p to R p + t, R row-major 3x3. @typedef {{ R: number[], t: number[] }} Rigid */
/** @typedef {Normaliser | Rigid} Step */

/** Distance a failed sample scores: the diagonal of the unit cube (paper section 5). */
export const PENALTY_DISTANCE = Math.sqrt(3);

/**
 * Axis-aligned bounds of a flat xyz array.
 * @param {ArrayLike<number>} points
 * @returns {Box}
 */
export function boundsOf(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = points[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/**
 * Normaliser that puts a box in the unit cube, centred, longest side 1.
 * @param {Box} box
 * @returns {Normaliser}
 */
export function boxNormaliser(box) {
  const center = [0, 1, 2].map((a) => (box.min[a] + box.max[a]) / 2);
  const extent = Math.max(...[0, 1, 2].map((a) => box.max[a] - box.min[a]));
  return { center, scale: extent > 0 ? 1 / extent : 1 };
}

/**
 * Rotation-invariant normaliser: centroid to the origin, RMS radius to 1.
 * @param {ArrayLike<number>} points Surface samples (not vertices: vertex
 *   density follows tessellation, not area).
 * @returns {Normaliser}
 */
export function momentNormaliser(points) {
  const n = points.length / 3;
  const center = [0, 0, 0];
  for (let i = 0; i < points.length; i += 3) for (let a = 0; a < 3; a++) center[a] += points[i + a] / n;
  let sum = 0;
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a++) sum += (points[i + a] - center[a]) ** 2;
  }
  const rms = Math.sqrt(sum / n);
  return { center, scale: rms > 0 ? 1 / rms : 1 };
}

/**
 * Applies a sequence of normalisers and rigid motions to a flat xyz array.
 * @param {ArrayLike<number>} points
 * @param {Step[]} steps Applied in order.
 * @returns {Float64Array} A new array.
 */
export function applySteps(points, steps) {
  const out = Float64Array.from(points);
  for (const step of steps) {
    if ("R" in step) {
      const { R, t } = step;
      for (let i = 0; i < out.length; i += 3) {
        const x = out[i], y = out[i + 1], z = out[i + 2];
        out[i] = R[0] * x + R[1] * y + R[2] * z + t[0];
        out[i + 1] = R[3] * x + R[4] * y + R[5] * z + t[1];
        out[i + 2] = R[6] * x + R[7] * y + R[8] * z + t[2];
      }
    } else {
      const { center, scale } = step;
      for (let i = 0; i < out.length; i += 3) {
        for (let a = 0; a < 3; a++) out[i + a] = (out[i + a] - center[a]) * scale;
      }
    }
  }
  return out;
}

/**
 * mulberry32: a small seeded PRNG, so a run's samples are reproducible.
 * @param {number} seed
 * @returns {() => number} Uniform in [0, 1).
 */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Area-weighted uniform samples on a mesh surface.
 * @param {Mesh} mesh
 * @param {number} n Sample count.
 * @param {number} seed PRNG seed.
 * @returns {Float64Array} 3n coordinates.
 * @throws {Error} When the mesh has no surface area.
 */
export function samplePoints(mesh, n, seed) {
  const { positions: p, indices: ix } = mesh;
  const triangles = ix.length / 3;
  const cumulative = new Float64Array(triangles);
  let total = 0;
  for (let t = 0; t < triangles; t++) {
    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    total += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    cumulative[t] = total;
  }
  if (!(total > 0)) throw new Error("mesh has no surface area");
  const rand = prng(seed);
  const out = new Float64Array(n * 3);
  for (let k = 0; k < n; k++) {
    const r = rand() * total;
    let lo = 0, hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1; else hi = mid;
    }
    const a = ix[lo * 3] * 3, b = ix[lo * 3 + 1] * 3, c = ix[lo * 3 + 2] * 3;
    let u = rand(), v = rand();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    for (let ax = 0; ax < 3; ax++) {
      out[k * 3 + ax] = p[a + ax] + u * (p[b + ax] - p[a + ax]) + v * (p[c + ax] - p[a + ax]);
    }
  }
  return out;
}

/** A static 3-d tree over a flat xyz array, for nearest-neighbour queries. */
export class KdTree {
  /** @param {Float64Array} points */
  constructor(points) {
    this.points = points;
    this.order = Uint32Array.from({ length: points.length / 3 }, (_, i) => i);
    this.#build(0, this.order.length, 0);
  }

  /**
   * Median-splits order[lo, hi) on axis depth % 3, recursively.
   * @param {number} lo @param {number} hi @param {number} depth
   */
  #build(lo, hi, depth) {
    if (hi - lo <= 1) return;
    const axis = depth % 3, p = this.points;
    const sorted = Array.from(this.order.subarray(lo, hi)).sort((i, j) => p[i * 3 + axis] - p[j * 3 + axis]);
    this.order.set(sorted, lo);
    const mid = (lo + hi) >> 1;
    this.#build(lo, mid, depth + 1);
    this.#build(mid + 1, hi, depth + 1);
  }

  /**
   * Nearest stored point to (x, y, z).
   * @param {number} x @param {number} y @param {number} z
   * @returns {[number, number]} [point index, squared distance]
   */
  nearest(x, y, z) {
    const p = this.points, order = this.order, q = [x, y, z];
    let best = Infinity, bestIndex = -1;
    /** @param {number} lo @param {number} hi @param {number} depth */
    const visit = (lo, hi, depth) => {
      if (lo >= hi) return;
      const mid = (lo + hi) >> 1, i = order[mid], axis = depth % 3;
      const dx = p[i * 3] - x, dy = p[i * 3 + 1] - y, dz = p[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bestIndex = i; }
      const diff = q[axis] - p[i * 3 + axis];
      if (diff < 0) {
        visit(lo, mid, depth + 1);
        if (diff * diff < best) visit(mid + 1, hi, depth + 1);
      } else {
        visit(mid + 1, hi, depth + 1);
        if (diff * diff < best) visit(lo, mid, depth + 1);
      }
    };
    visit(0, order.length, 0);
    return [bestIndex, best];
  }
}

/**
 * Eigen-decomposition of a symmetric 4x4 matrix by cyclic Jacobi rotations.
 * @param {number[][]} m Symmetric 4x4; not modified.
 * @returns {{ values: number[], vectors: number[][] }} vectors[k][i] is
 *   component k of eigenvector i.
 */
function jacobiEigen4(m) {
  const a = m.map((row) => row.slice());
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const kp = a[k][p], kq = a[k][q];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < 4; k++) {
          const pk = a[p][k], qk = a[q][k];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < 4; k++) {
          const kp = v[k][p], kq = v[k][q];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
    }
  }
  return { values: [0, 1, 2, 3].map((i) => a[i][i]), vectors: v };
}

/**
 * Least-squares rigid motion taking P onto Q (pairs by index), by Horn's
 * closed-form quaternion method.
 * @remarks Horn rather than SVD/Kabsch because a 4x4 symmetric eigenproblem
 *   is a few dozen lines of Jacobi, where a 3x3 SVD with reflection handling
 *   is not; the quaternion is always a proper rotation.
 * @param {Float64Array} P @param {Float64Array} Q Same length.
 * @returns {Rigid}
 */
export function bestRigid(P, Q) {
  const n = P.length / 3;
  const cp = [0, 0, 0], cq = [0, 0, 0];
  for (let i = 0; i < P.length; i += 3) {
    for (let a = 0; a < 3; a++) { cp[a] += P[i + a] / n; cq[a] += Q[i + a] / n; }
  }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < P.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) S[a][b] += (P[i + a] - cp[a]) * (Q[i + b] - cq[b]);
    }
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const { values, vectors } = jacobiEigen4(N);
  const top = values.indexOf(Math.max(...values));
  const [w, x, y, z] = [0, 1, 2, 3].map((k) => vectors[k][top]);
  const R = [
    w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z,
  ];
  const t = [0, 1, 2].map((r) => cq[r] - (R[r * 3] * cp[0] + R[r * 3 + 1] * cp[1] + R[r * 3 + 2] * cp[2]));
  return { R, t };
}

/**
 * Point-to-point ICP from identity, as the paper does.
 * @param {Float64Array} source Moved onto target.
 * @param {Float64Array} target
 * @param {{ iterations?: number, tolerance?: number }} [options]
 * @returns {Rigid} The accumulated motion taking source onto target.
 */
export function icp(source, target, { iterations = 50, tolerance = 1e-9 } = {}) {
  const tree = new KdTree(target);
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1], t = [0, 0, 0];
  /** @type {Float64Array} */
  let current = Float64Array.from(source);
  let previous = Infinity;
  for (let it = 0; it < iterations; it++) {
    const matched = new Float64Array(current.length);
    let error = 0;
    for (let i = 0; i < current.length; i += 3) {
      const [j, d] = tree.nearest(current[i], current[i + 1], current[i + 2]);
      matched[i] = target[j * 3]; matched[i + 1] = target[j * 3 + 1]; matched[i + 2] = target[j * 3 + 2];
      error += d;
    }
    error /= current.length / 3;
    if (previous - error < tolerance) break;
    previous = error;
    const step = bestRigid(current, matched);
    current = applySteps(current, [step]);
    // Compose: the new total is step after (R, t).
    const Rs = step.R;
    R = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) =>
      Rs[r * 3] * R[c] + Rs[r * 3 + 1] * R[3 + c] + Rs[r * 3 + 2] * R[6 + c]));
    t = [0, 1, 2].map((r) => Rs[r * 3] * t[0] + Rs[r * 3 + 1] * t[1] + Rs[r * 3 + 2] * t[2] + step.t[r]);
  }
  return { R, t };
}

/**
 * Nearest-neighbour distances from every point of A to the cloud in tree.
 * @param {Float64Array} A @param {KdTree} tree
 * @returns {Float64Array}
 */
function distancesTo(A, tree) {
  const out = new Float64Array(A.length / 3);
  for (let i = 0; i < A.length; i += 3) out[i / 3] = Math.sqrt(tree.nearest(A[i], A[i + 1], A[i + 2])[1]);
  return out;
}

/**
 * Point Cloud distance, paper Eq. 8: the mean of both directed mean
 * nearest-neighbour distances.
 * @param {Float64Array} P @param {Float64Array} Q
 * @returns {number}
 */
export function chamfer(P, Q) {
  const mean = (/** @type {Float64Array} */ d) => d.reduce((s, x) => s + x, 0) / d.length;
  return 0.5 * mean(distancesTo(P, new KdTree(Q))) + 0.5 * mean(distancesTo(Q, new KdTree(P)));
}

/**
 * Hausdorff distance, paper Eq. 9.
 * @param {Float64Array} P @param {Float64Array} Q
 * @returns {number}
 */
export function hausdorff(P, Q) {
  const max = (/** @type {Float64Array} */ d) => d.reduce((m, x) => Math.max(m, x), 0);
  return Math.max(max(distancesTo(P, new KdTree(Q))), max(distancesTo(Q, new KdTree(P))));
}

/**
 * IoGT, paper Eq. 10, computed as the paper does: on bounding boxes.
 * @param {Box} generated @param {Box} truth
 * @returns {number} |gen ∩ truth| / |truth|
 */
export function iogt(generated, truth) {
  let inter = 1, vol = 1;
  for (let a = 0; a < 3; a++) {
    inter *= Math.max(0, Math.min(generated.max[a], truth.max[a]) - Math.max(generated.min[a], truth.min[a]));
    vol *= truth.max[a] - truth.min[a];
  }
  return vol > 0 ? inter / vol : 0;
}

/**
 * The whole protocol: sample, normalise, align, normalise, measure.
 * @param {Mesh} generated
 * @param {Mesh} truth
 * @param {{ samples?: number, seed?: number }} [options]
 * @returns {{ metrics: { chamfer: number, hausdorff: number, iogt: number },
 *   generatedSteps: Step[], truthSteps: Step[] }} The steps map each mesh's
 *   vertices into the shared frame the metrics were taken in; exact IoU
 *   (bench-iou.mjs) applies them so it measures the same alignment.
 */
export function alignAndScore(generated, truth, { samples = 8192, seed = 1 } = {}) {
  const rawP = samplePoints(generated, samples, seed);
  const rawQ = samplePoints(truth, samples, seed);
  const genPre = momentNormaliser(rawP);
  const truthPre = momentNormaliser(rawQ);
  const rigid = icp(applySteps(rawP, [genPre]), applySteps(rawQ, [truthPre]));
  const genPost = boxNormaliser(boundsOf(applySteps(generated.positions, [genPre, rigid])));
  const truthPost = boxNormaliser(boundsOf(applySteps(truth.positions, [truthPre])));
  const generatedSteps = [genPre, rigid, genPost];
  const truthSteps = [truthPre, truthPost];
  const P = applySteps(rawP, generatedSteps);
  const Q = applySteps(rawQ, truthSteps);
  return {
    metrics: {
      chamfer: chamfer(P, Q),
      hausdorff: hausdorff(P, Q),
      iogt: iogt(boundsOf(applySteps(generated.positions, generatedSteps)),
        boundsOf(applySteps(truth.positions, truthSteps))),
    },
    generatedSteps,
    truthSteps,
  };
}
