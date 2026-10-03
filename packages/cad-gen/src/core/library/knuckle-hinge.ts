/**
 * Knuckle hinges, ported from BOSL2's `hinges.scad`.
 * @remarks PORT of `knuckle_hinge()` and `_knuckle_hinge_profile()` from BOSL2
 *   (https://github.com/BelfrySCAD/BOSL2), BSD-2-Clause, by Adrian Mariano
 *   (https://github.com/adrianVmariano) and Revar Desmera
 *   (https://github.com/revarbat), with the BOSL2 contributors. Credited to
 *   the user through ATTRIBUTED_HELPERS in ../attribution.ts.
 *
 *   The SCAD arithmetic is kept as close to verbatim as the language allows, so
 *   a reader can check each line against the original. Verified against
 *   OpenSCAD's own render of BOSL2's print-in-place example (hinges.scad,
 *   "positioned for printing"): see scripts/cad-reference/hinge-pip.scad.
 *
 *   Not ported, deliberately: screw-pin holes (`pin_diam` as a screw spec),
 *   `teardrop`, `clear_top`, `round_top`, `knuckle_clearance` and the
 *   attachment framework.
 */
import type { ManifoldModule } from "../../types.ts";

/** Options for one hinge half, mirroring BOSL2's argument names in camelCase. */
export interface KnuckleHingeOptions {
  length: number;
  segs: number;
  offset: number;
  inner?: boolean;
  armHeight?: number;
  armAngle?: number;
  gap?: number;
  segRatio?: number;
  knuckleDiam?: number;
  pinDiam?: number;
  fill?: boolean;
  clearance?: number;
  inPlace?: boolean;
  clip?: number;
  roundBot?: number;
  segments?: number;
}

const EXTRA = 0.01;
const DEG = Math.PI / 180;

/** BOSL2's `circum=true`: a polygon whose flats, not corners, sit on the circle. */
function circumCircle(CrossSection: any, d: number, n: number): any {
  return CrossSection.circle(d / 2 / Math.cos(Math.PI / n), n);
}

/**
 * One straight stroke of width w from a to b.
 * @param startX When set, the start end is cut on the vertical line x = startX
 *   (BOSL2's `os_flat(abs_angle=90)`) instead of square to the stroke.
 */
function stroke(a: number[], b: number[], w: number, startX?: number): number[][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const n = [-dy / len * w / 2, dx / len * w / 2];
  const side = (s: number) => {
    const p = [a[0] + s * n[0], a[1] + s * n[1]];
    if (startX === undefined || dx === 0) return p;
    const t = (startX - p[0]) / dx;
    return [startX, p[1] + t * dy];
  };
  return [side(1), side(-1), [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]]];
}

/** A point on the Bezier curve with control points P at parameter t. */
function bezierPoint(P: number[][], t: number): number[] {
  const n = P.length - 1;
  const out = [0, 0];
  let c = 1;
  for (let i = 0; i <= n; i++) {
    const w = c * (1 - t) ** (n - i) * t ** i;
    out[0] += w * P[i][0];
    out[1] += w * P[i][1];
    c = c * (n - i) / (i + 1);
  }
  return out;
}

/**
 * The outward flare BOSL2's `os_round(cut=-c, k)` puts where a stroke meets its
 * flat end - `_stroke_end`'s "roundover" branch for a NEGATIVE cut.
 * @param q The stroke's corner on the end line. @param along Unit vector up the
 *   stroke side. @param across Unit vector along the end line, into the stroke.
 * @returns The region between the curve and the sharp corner, to union on.
 */
function flare(q: number[], along: number[], across: number[], cut: number, k: number, n: number): number[][] {
  const theta = Math.acos(along[0] * across[0] + along[1] * across[1]);
  // leftangle = 90 - vector_angle(...)/2 for an outside corner; joint = 8*cut/cos/(1+4k)
  const half = Math.PI / 2 - theta / 2;
  const joint = 8 * cut / Math.cos(half) / (1 + 4 * k);
  const p0 = [q[0] + joint * along[0], q[1] + joint * along[1]];
  const p2 = [q[0] - joint * across[0], q[1] - joint * across[1]];
  const lerp = (a: number[], b: number[]) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  // _smooth_bez_fill([p0, q, p2], k)
  const ctrl = [p0, lerp(q, p0), q, lerp(q, p2), p2];
  const curve = Array.from({ length: n }, (_, i) => bezierPoint(ctrl, i / (n - 1)));
  return [...curve, q];
}

/** `_knuckle_hinge_profile`: the 2D section one knuckle segment is extruded from. */
function hingeProfile(module: ManifoldModule, o: Required<KnuckleHingeOptions>): any {
  const { CrossSection } = module as any;
  const { offset, armHeight, armAngle, knuckleDiam, pinDiam, clearance, segments } = o;
  // turtle(["left", 90-arm_angle, "untilx", offset+extra, "left", arm_angle, "move", arm_height])
  const p1 = [offset + EXTRA, (offset + EXTRA) * Math.tan((90 - armAngle) * DEG)];
  const skel = armHeight > 0 ? [[0, 0], p1, [p1[0], p1[1] + armHeight]] : [[0, 0], p1];
  const ofs = armHeight + offset / Math.tan(armAngle * DEG);

  // fwd(ofs) { left(extra) offset_stroke(skel, width=knuckle_diam, start=os_flat(abs_angle=90)) }
  const path = skel.map(([x, y]) => [x - EXTRA, y - ofs]);
  const first = stroke(path[0], path[1], knuckleDiam, -EXTRA);
  let body = CrossSection.ofPolygons([first], "NonZero");
  if (o.roundBot > 0) {
    // start=os_round(abs_angle=90, cut=[-round_top,-round_bot], k=.8): only the
    // side facing away from the pin flares; the other is buried in the fill.
    const len = Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1]);
    const along = [(path[1][0] - path[0][0]) / len, (path[1][1] - path[0][1]) / len];
    const span = Math.hypot(first[0][0] - first[1][0], first[0][1] - first[1][1]);
    const across = [(first[0][0] - first[1][0]) / span, (first[0][1] - first[1][1]) / span];
    body = body.add(CrossSection.ofPolygons(
      [flare(first[1], along, across, o.roundBot, 0.8, segments)], "NonZero"));
  }
  for (let i = 1; i < path.length - 1; i++) {
    body = body
      .add(CrossSection.ofPolygons([stroke(path[i], path[i + 1], knuckleDiam)], "NonZero"))
      .add(CrossSection.circle(knuckleDiam / 2, segments).translate(path[i]));
  }
  if (o.fill) {
    // polygon([each list_head(skel,-2), fwd(clearance,last(skel)), [-extra,ofs-clearance]]), then fwd(ofs)
    const last = skel[skel.length - 1];
    const fill = [...skel.slice(0, -1), [last[0], last[1] - clearance], [-EXTRA, ofs - clearance]]
      .map(([x, y]) => [x, y - ofs]);
    body = body.add(CrossSection.ofPolygons([fill], "EvenOdd"));
  }
  if (Number.isFinite(o.clip)) {
    // fwd(clip) left(.1) rect([offset+knuckle_diam, ofs+round_bot+knuckle_diam+abs(clip)], anchor=BACK+LEFT)
    const h = ofs + knuckleDiam + Math.abs(o.clip);
    body = body.subtract(CrossSection.square([offset + knuckleDiam, h]).translate([-0.1, -o.clip - h]));
  }
  body = body.add(circumCircle(CrossSection, knuckleDiam, segments).translate([offset, 0]));
  // back(clearance) difference() { ...; right(offset) ellipse(d=pin_diam, circum=true) }
  return body
    .subtract(circumCircle(CrossSection, pinDiam, segments).translate([offset, 0]))
    .translate([0, clearance]);
}

/**
 * The captive pin stub one in-place segment carries: a male cone on one end and
 * a female socket on the other, so neighbouring segments of the OTHER half
 * interlock without ever touching.
 */
function inPlacePin(
  module: ManifoldModule, o: Required<KnuckleHingeOptions>, len: number, idx: number, numsegs: number,
): any {
  const { Manifold, CrossSection } = module as any;
  const r = o.pinDiam / 2;
  const coneH = r * Math.tan(45 * DEG);
  const odd = o.segs % 2 === 1;
  const flatBottom = (!o.inner && odd && idx === 0) || (idx === numsegs - 1 && o.inner && !odd);
  const flatTop = idx === numsegs - 1 && !o.inner;
  const pts = [
    [0, -len / 2 + (flatBottom ? 0 : coneH)],
    [r, -len / 2], [r + 0.01, -len / 2], [r + 0.01, len / 2], [r, len / 2],
    ...(flatTop ? [[0, len / 2]] : [[o.pinDiam * 0.1, len / 2 + coneH * 0.8], [0, len / 2 + coneH * 0.8]]),
  ].map(([x, y]) => [x, o.inner ? -y : y]);
  return Manifold.revolve(CrossSection.ofPolygons([pts], "EvenOdd"), o.segments)
    .translate([o.offset, o.clearance, 0]);
}

/**
 * The most segments (2..limit) whose shortest knuckle still holds a captive pin.
 * @returns 2 when even two segments are too short - the caller then refuses.
 */
export function maxSegsForPins(
  length: number, gap: number, segRatio: number, pinDiam: number, limit: number,
): number {
  let most = 2;
  for (let n = 2; n <= limit; n++) {
    const u = (length - (n - 1) * gap) / (Math.ceil(n / 2) + Math.floor(n / 2) * segRatio);
    if (Math.min(u, u * segRatio) >= pinDiam / 2) most = n;
  }
  return most;
}

/**
 * Refuses in-place segments too short to hold their captive pins.
 * @remarks Not in BOSL2, which trusts the caller. Each segment's female socket
 *   is pinDiam/2 deep, so a shorter segment is pierced right through by the
 *   neighbour's cone and the hinge falls apart: a live request for 32 segments
 *   over 50mm came out as 16 loose pieces.
 */
function assertSegmentsHoldPins(o: Required<KnuckleHingeOptions>, shortest: number): void {
  // The socket is exactly pinDiam/2 deep; BOSL2's own example clears it by 0.09mm.
  const need = o.pinDiam / 2;
  if (shortest >= need) return;
  const most = maxSegsForPins(o.length, o.gap, o.segRatio, o.pinDiam, o.segs);
  throw new Error(
    "knuckleHinge: with " + o.segs + " segs over " + o.length + "mm the shortest knuckle is " +
    shortest.toFixed(2) + "mm, but a captive pin of diameter " + o.pinDiam + " needs at least " +
    need.toFixed(2) + "mm. Use at most " + most + " segs, or a smaller knuckleDiam.",
  );
}

/**
 * Fills BOSL2's defaults and applies its argument checks.
 * @throws Error naming the bad argument, as BOSL2's asserts do.
 */
function hingeOptions(opts: KnuckleHingeOptions): Required<KnuckleHingeOptions> {
  const kd = opts.knuckleDiam ?? 4;
  const o = {
    inner: false, armHeight: 0, armAngle: 45, gap: 0.2, segRatio: 1, knuckleDiam: kd,
    pinDiam: opts.inPlace ? kd - 1 : 1.75, fill: true, clearance: 0, inPlace: false,
    clip: Number.NaN, roundBot: 0, segments: 64,
    ...opts,
  } as Required<KnuckleHingeOptions>;
  const checks: [boolean, string][] = [
    [o.length > 0, "length must be a positive number"],
    [Number.isInteger(o.segs) && o.segs >= 2, "segs must be an integer 2 or greater"],
    [o.offset >= kd / 2, "offset " + o.offset + " is smaller than the knuckle radius " + kd / 2],
    [o.armAngle > 0 && o.armAngle <= 90, "armAngle must be in (0, 90]"],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error("knuckleHinge: " + failed[1]);
  return o;
}

/**
 * One half of a knuckle hinge, in BOSL2's frame after `anchor=BOT`: the mounting
 * face is z = 0, the pin axis runs along X at y = clearance, z = offset, and the
 * arm reaches back toward -y.
 */
export function knuckleHinge(module: ManifoldModule, opts: KnuckleHingeOptions): any {
  const o = hingeOptions(opts);
  const { Manifold } = module as any;
  const segs1 = Math.ceil(o.segs / 2);
  const segs2 = Math.floor(o.segs / 2);
  const unit = (o.length - (o.segs - 1) * o.gap) / (segs1 + segs2 * o.segRatio);
  const seglen1 = o.gap + unit;
  const seglen2 = o.gap + unit * o.segRatio;
  const numsegs = o.inner ? segs2 : segs1;
  const zAdjust = o.segs % 2 === 1 ? 0 : o.inner ? seglen1 / 2 : seglen2 / 2;
  const len = (o.inner ? seglen2 : seglen1) - o.gap;
  const spacing = seglen1 + seglen2;
  if (o.inPlace) assertSegmentsHoldPins(o, Math.min(seglen1, seglen2) - o.gap);

  const profile = hingeProfile(module, o);
  const segment = Manifold.extrude(profile, len, 0, 0, [1, 1], true);
  let part: any;
  for (let i = 0; i < numsegs; i++) {
    let piece = segment;
    if (o.inPlace) piece = piece.add(inPlacePin(module, o, len, i, numsegs));
    piece = piece.translate([0, 0, (i - (numsegs - 1) / 2) * spacing]);
    part = part ? part.add(piece) : piece;
  }
  // multmatrix(down(offset) * yrot(-90) * zmove(z_adjust)), then anchor=BOT lifts by offset.
  return part.translate([0, 0, zAdjust]).rotate([0, -90, 0]);
}

/** Options for the complete two-leaf print-in-place hinge. */
export interface PrintInPlaceHingeOptions {
  length?: number;
  leafWidth?: number;
  thickness?: number;
  leafGap?: number;
  segGap?: number;
  segs?: number;
  offset?: number;
  knuckleDiam?: number;
  segRatio?: number;
  cornerRadius?: number;
  roundBot?: number;
  segments?: number;
}

/** A leaf plate whose two OUTER corners are rounded, centred on the origin. */
function leaf(module: ManifoldModule, w: number, l: number, t: number, r: number, side: -1 | 1, n: number): any {
  const { Manifold, CrossSection } = module as any;
  const rr = Math.min(r, w / 2, l / 2);
  const cx = side * (w / 2 - rr);
  const cy = l / 2 - rr;
  const edge = CrossSection.square([EXTRA, l], true).translate([-side * (w / 2 - EXTRA / 2), 0]);
  const outline = CrossSection.hull([
    CrossSection.circle(rr, n).translate([cx, cy]),
    CrossSection.circle(rr, n).translate([cx, -cy]),
    edge,
  ]);
  return Manifold.extrude(outline, t, 0, 0, [1, 1], true);
}

/**
 * BOSL2's print-in-place hinge example: two rounded leaves side by side, each
 * carrying one half of a knuckle hinge, captured on cone-tipped pins.
 * @remarks Deliberately TWO bodies: the leaves must never fuse, or it is not a
 *   hinge. Laid flat for printing, leaves on z = -thickness/2 .. +thickness/2.
 */
export function printInPlaceHinge(module: ManifoldModule, opts: PrintInPlaceHingeOptions = {}): any {
  const knuckleDiam = opts.knuckleDiam ?? 4;
  const o = {
    length: 25, leafWidth: 20, thickness: 2, leafGap: 0.4, segGap: 0.2, segs: 7,
    // BOSL2's example pairs a 4mm knuckle with offset 3.1. The ratio is kept
    // rather than the number: measured, a 6mm knuckle at offset 3.1 FUSES the two
    // leaves, and the clearance it needs grows with the knuckle (~0.18 x diam).
    offset: knuckleDiam * 0.775, segRatio: 1 / 3, cornerRadius: 7, roundBot: 0.5, segments: 64,
    ...opts,
    knuckleDiam,
  };
  // Unspecified segs: BOSL2's 7, or fewer when the knuckle is too fat for 7 to
  // hold their pins. Odd, so both ends belong to the same leaf, as in BOSL2.
  if (opts.segs === undefined) {
    const most = maxSegsForPins(o.length, o.segGap, o.segRatio, knuckleDiam - 1, 7);
    o.segs = Math.max(3, most % 2 === 1 ? most : most - 1);
  }
  const half = (inner: boolean) => knuckleHinge(module, {
    length: o.length, segs: o.segs, offset: o.offset, inner, inPlace: true,
    clearance: o.leafGap / 2, gap: o.segGap, segRatio: o.segRatio,
    knuckleDiam: o.knuckleDiam, roundBot: o.roundBot, segments: o.segments,
  });
  const w = o.leafWidth;
  const top = o.thickness / 2;
  // position(TOP+RIGHT) orient(UP,-90): the hinge axis turns onto Y.
  const left = leaf(module, w, o.length, o.thickness, o.cornerRadius, -1, o.segments)
    .add(half(false).rotate([0, 0, -90]).translate([w / 2, 0, top]));
  // align(RIGHT) right(leaf_gap), then position(TOP+LEFT) orient(UP,90).
  const rightX = w + o.leafGap;
  const right = leaf(module, w, o.length, o.thickness, o.cornerRadius, 1, o.segments)
    .translate([rightX, 0, 0])
    .add(half(true).rotate([0, 0, 90]).translate([rightX - w / 2, 0, top]));
  const hinge = left.add(right);
  // A hinge whose leaves touch is a plate. Checked here, exactly, because the
  // render cannot show it: fused and free leaves are pixel-identical.
  const bodies = hinge.decompose().length;
  if (bodies !== 2) {
    throw new Error(
      "printInPlaceHinge: came out as " + bodies + " bodies, not 2. " + (bodies < 2
        ? "The knuckle touches the other leaf: raise offset (now " + o.offset + ") to at least " +
          (o.knuckleDiam * 0.775).toFixed(2) + " for a " + o.knuckleDiam + "mm knuckle."
        : "Parts of the hinge are detached: use fewer segs or a smaller knuckleDiam."),
    );
  }
  return hinge;
}
