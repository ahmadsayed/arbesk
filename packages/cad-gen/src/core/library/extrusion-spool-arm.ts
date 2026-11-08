/**
 * A filament spool arm that bolts onto 2020 extrusion. First-party, from
 * published dimensions (Misumi HFS5-2020, ISO M5, 1 kg spool sizes); no
 * permissively licensed source exists.
 *
 * Frame: the extrusion runs vertically, the plate's face is on y = 0 with the
 * key toward -y, and the rod points along +y tilted up by `tilt`.
 */
import type { ManifoldModule } from "../../types.ts";

const SPOOL_ARM_DEFAULTS = {
  spoolBore: 52,
  spoolWidth: 70,
  extrusionWidth: 20,
  plateHeight: 80,
  plateThickness: 8,
  holeSpacing: 60,
  holeDiameter: 5.5,
  /** Key into the 6mm slot; 0 omits it. */
  keyWidth: 5.8,
  keyDepth: 1.4,
  /** Degrees. */
  tilt: 5,
  /** Height above the rod's surface. */
  lipHeight: 6,
  lipThickness: 4,
  segments: 64,
};

export type SpoolArmOptions = Partial<typeof SPOOL_ARM_DEFAULTS>;

const M5_HEAD = 8.5;

/** The spool rides on top of the rod: 6mm under the bore, capped at 32mm to save material. */
function rodDiameterFor(bore: number): number {
  return Math.min(bore - 6, 32);
}

function check(p: typeof SPOOL_ARM_DEFAULTS): void {
  const rod = rodDiameterFor(p.spoolBore);
  const rules: [boolean, string][] = [
    [p.spoolBore >= 20, "spoolBore must be at least 20mm"],
    [p.spoolWidth > 0, "spoolWidth must be positive"],
    [p.plateThickness >= 5, "plateThickness must be at least 5mm to carry a spool"],
    [p.holeSpacing / 2 - M5_HEAD / 2 > rod / 2 + 1,
      "holeSpacing " + p.holeSpacing + " puts the screw heads under the " + rod.toFixed(1) +
      "mm rod; use at least " + Math.ceil(rod + M5_HEAD + 2) + "mm"],
    [p.plateHeight >= p.holeSpacing + M5_HEAD + 4,
      "plateHeight must be at least holeSpacing + 12.5mm so the holes stay on the plate"],
    [p.keyWidth === 0 || (p.keyWidth < p.extrusionWidth && p.keyDepth > 0 && p.keyDepth < 1.6),
      "the slot key must be narrower than the extrusion and shallower than its 1.6mm slot lip"],
  ];
  const failed = rules.find(([ok]) => !ok);
  if (failed) throw new Error("extrusionSpoolArm: " + failed[1]);
}

export function extrusionSpoolArm(module: ManifoldModule, opts: SpoolArmOptions = {}): any {
  const { Manifold } = module as any;
  const p = { ...SPOOL_ARM_DEFAULTS, ...opts };
  check(p);
  const d = rodDiameterFor(p.spoolBore);
  const length = p.spoolWidth + 10 + p.lipThickness;
  const zMid = p.plateHeight / 2;

  const plate = Manifold.cube([p.extrusionWidth, p.plateThickness, p.plateHeight])
    .translate([-p.extrusionWidth / 2, -p.plateThickness, 0]);
  // The rod starts inside the plate so the union is one body.
  const rod = Manifold.cylinder(length + p.plateThickness / 2, d / 2, d / 2, p.segments)
    .add(Manifold.cylinder(p.lipThickness, d / 2 + p.lipHeight, d / 2 + p.lipHeight, p.segments)
      .translate([0, 0, length + p.plateThickness / 2 - p.lipThickness]))
    .translate([0, 0, -p.plateThickness / 2])
    .rotate([-90 + p.tilt, 0, 0])
    .translate([0, 0, zMid]);
  // Two side ribs rather than a full gusset, which would bury the lower screw head.
  const gussetDepth = Math.min(30, length / 2);
  const access = M5_HEAD + 1.5;
  const gusset = Manifold.hull([
    Manifold.cube([p.extrusionWidth, 1, d / 2 + 12]).translate([-p.extrusionWidth / 2, -1, zMid - d / 2 - 12]),
    Manifold.cylinder(gussetDepth, d / 2, d / 2, p.segments).rotate([-90 + p.tilt, 0, 0])
      .translate([0, 0, zMid]),
  ]).subtract(Manifold.cube([access, gussetDepth + 2, d / 2 + 14])
    .translate([-access / 2, -0.5, zMid - d / 2 - 13]));
  let arm = plate.add(rod).add(gusset);
  if (p.keyWidth > 0) {
    arm = arm.add(Manifold.cube([p.keyWidth, p.keyDepth + 0.5, p.plateHeight])
      .translate([-p.keyWidth / 2, -p.plateThickness - p.keyDepth, 0]));
  }
  for (const z of [zMid - p.holeSpacing / 2, zMid + p.holeSpacing / 2]) {
    arm = arm.subtract(Manifold.cylinder(p.plateThickness + p.keyDepth + 2, p.holeDiameter / 2,
      p.holeDiameter / 2, 32, true).rotate([90, 0, 0]).translate([0, -p.plateThickness / 2, z]));
  }
  return arm;
}
