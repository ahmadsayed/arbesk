/**
 * A split pipe clamp: two bolted half-rings laid out for printing. First-party,
 * from ISO fastener dimensions; no permissively licensed source exists.
 *
 * Print frame: pipe axis along z, each half standing on its end face on z = 0
 * so the bolt load runs along the layers. Split faces are `gap` apart across
 * y = 0, the bolt-head half at +y and the nut half at -y; bolts run along y at
 * x = +-boltSpacing / 2, z = width / 2.
 */
import type { ManifoldModule } from "../../types.ts";

const PIPE_CLAMP_DEFAULTS = {
  /** Pipe outside diameter. */
  pipeDiameter: 25,
  /** Length along the pipe. */
  width: 20,
  wall: 5,
  /** "M3" | "M4" | "M5" | "M6" | "M8", or the nominal size as a number. */
  bolt: "M5" as string | number,
  /** Hex nut pockets in the -y half; false leaves plain clearance holes. */
  nutTrap: true,
  gap: 5,
  clearance: 0.2,
  /** Gap left between mating faces on the pipe, so tightening pinches it. */
  pinch: 1,
  /** 0 picks the tightest spacing that clears the bore. */
  boltSpacing: 0,
  segments: 64,
};

export type PipeClampOptions = Partial<typeof PIPE_CLAMP_DEFAULTS>;

/** [clearance hole, head dia, head height, nut across-flats, nut height], ISO, mm. */
const BOLTS: Record<string, [number, number, number, number, number]> = {
  M3: [3.4, 5.5, 3.0, 5.5, 2.4],
  M4: [4.5, 7.0, 4.0, 7.0, 3.2],
  M5: [5.5, 8.5, 5.0, 8.0, 4.7],
  M6: [6.6, 10.0, 6.0, 10.0, 5.2],
  M8: [9.0, 13.0, 8.0, 13.0, 6.8],
};

/** Least material between a head or nut pocket and the bore, mm. */
const BORE_MARGIN = 1.2;

function boltSizes(bolt: string | number) {
  const key = typeof bolt === "number" ? "M" + bolt : String(bolt).toUpperCase();
  const row = BOLTS[key];
  if (!row) {
    throw new Error("pipeClamp: bolt " + JSON.stringify(bolt) + " is not one of " +
      Object.keys(BOLTS).join(", ") + " - pass one of those");
  }
  const [hole, head, headH, flats, nutH] = row;
  return {
    hole,
    d: Number(key.slice(1)),
    cbR: (head + 0.4) / 2,
    cbDepth: headH + 0.2,
    nutCornerR: (flats + 0.2) / 2 / Math.cos(Math.PI / 6),
    nutDepth: nutH + 0.2,
  };
}

type Sizes = ReturnType<typeof boltSizes>;

function layout(p: typeof PIPE_CLAMP_DEFAULTS, b: Sizes) {
  const bore = p.pipeDiameter / 2 + p.clearance;
  const pocketR = Math.max(b.cbR, p.nutTrap ? b.nutCornerR : 0, b.hole / 2);
  const spacing = p.boltSpacing > 0
    ? p.boltSpacing
    : Math.ceil(2 * (bore + pocketR + BORE_MARGIN));
  const split = p.pinch / 2;
  const deepest = Math.max(b.cbDepth, p.nutTrap ? b.nutDepth : 0);
  return {
    bore,
    pocketR,
    spacing,
    split,
    outer: bore + p.wall,
    earEnd: spacing / 2 + pocketR + 2.5,
    // Split offset + deepest pocket + at least a bolt diameter (min 4mm) of solid ear.
    earThickness: split + deepest + Math.max(4, b.d),
  };
}

function check(p: typeof PIPE_CLAMP_DEFAULTS, b: Sizes, l: ReturnType<typeof layout>): void {
  const needSpacing = Math.ceil(2 * (l.bore + l.pocketR + BORE_MARGIN));
  const needWidth = Math.ceil(2 * l.pocketR + 3);
  const rules: [boolean, string][] = [
    [p.pipeDiameter > 0, "pipeDiameter must be positive - it is the pipe's OUTSIDE diameter"],
    [p.wall >= 2, "wall must be at least 2mm to hold a bolt load"],
    [p.clearance >= 0 && p.clearance < 2, "clearance must be between 0 and 2mm"],
    [p.pinch >= 0 && p.pinch < p.wall, "pinch must be between 0 and the wall"],
    [p.gap >= 1, "gap must be at least 1mm or the two halves print fused together"],
    [p.width >= needWidth,
      "width " + p.width + " is narrower than the " + b.hole + "mm bolt's head or nut pocket; " +
      "use at least " + needWidth + "mm"],
    [l.spacing >= needSpacing,
      "boltSpacing " + p.boltSpacing + " puts the bolt holes into the " + (2 * l.bore).toFixed(1) +
      "mm bore; use at least " + needSpacing + "mm, or leave it 0 to pick it"],
  ];
  const failed = rules.find(([ok]) => !ok);
  if (failed) throw new Error("pipeClamp: " + failed[1]);
}

/** The +y half. Rounded as a full ring-with-ears profile, then cut, so the mating faces stay flat. */
function halfProfile(module: ManifoldModule, l: ReturnType<typeof layout>, segments: number): any {
  const { CrossSection } = module as any;
  const ears = CrossSection.square([2 * l.earEnd, 2 * l.earThickness], true);
  const full = CrossSection.circle(l.outer, segments).add(ears)
    .offset(3, "Round", 2, segments).offset(-3, "Round", 2, segments)
    .offset(-1.5, "Round", 2, segments).offset(1.5, "Round", 2, segments)
    .subtract(CrossSection.circle(l.bore, segments));
  const keep = CrossSection.square([4 * l.earEnd, 2 * l.outer + 2 * l.earThickness])
    .translate([-2 * l.earEnd, l.split]);
  return full.intersect(keep);
}

/** A pocket along y from y0 outward, open past the part so walls cannot bury a head or nut. */
function pocket(module: ManifoldModule, r: number, sides: number, y0: number, reach: number): any {
  const { Manifold } = module as any;
  // The hex is turned corner-up so its 60-degree roof prints without support.
  return Manifold.cylinder(reach, r, r, sides).rotate([0, 0, sides === 6 ? 90 : 0])
    .rotate([-90, 0, 0]).translate([0, y0, 0]);
}

function half(
  module: ManifoldModule, p: typeof PIPE_CLAMP_DEFAULTS, b: Sizes,
  l: ReturnType<typeof layout>, nutSide: boolean,
): any {
  const reach = 2 * (l.outer + l.earThickness);
  let part = halfProfile(module, l, p.segments).extrude(p.width);
  for (const x of [-l.spacing / 2, l.spacing / 2]) {
    const at = (m: any) => m.translate([x, 0, p.width / 2]);
    part = part.subtract(at(pocket(module, b.hole / 2, 32, -1, reach)));
    if (!nutSide) {
      part = part.subtract(at(pocket(module, b.cbR, 32, l.earThickness - b.cbDepth, reach)));
    } else if (p.nutTrap) {
      part = part.subtract(at(pocket(module, b.nutCornerR, 6, l.earThickness - b.nutDepth, reach)));
    }
  }
  return part;
}

export function pipeClamp(module: ManifoldModule, opts: PipeClampOptions = {}): any {
  const p = { ...PIPE_CLAMP_DEFAULTS, ...opts };
  const b = boltSizes(p.bolt);
  const l = layout(p, b);
  check(p, b, l);
  const shift = p.gap / 2 - l.split;
  const head = half(module, p, b, l, false).translate([0, shift, 0]);
  const nut = half(module, p, b, l, true).translate([0, shift, 0]).mirror([0, 1, 0]);
  return head.add(nut);
}
