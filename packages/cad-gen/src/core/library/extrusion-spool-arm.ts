/**
 * A filament spool arm that bolts onto 2020 aluminium extrusion.
 * @remarks FIRST-PARTY, from published facts - no portable OpenSCAD source
 *   exists. Searched: robinolejnik/spool-holder is CC0 but FreeCAD only;
 *   rcarmo's arms are MIT but fit a Prusa frame or a KP3S; jsconan/things is
 *   GPL-3.0; avolkov's is share-alike. So, as with spurGear and gt2Pulley, the
 *   part is built from standards rather than ported:
 *     - 2020 profile (Misumi HFS5-2020): 20 x 20mm, 6mm slot, 1.6mm slot lip -
 *       the key below is 5.8 wide (0.1 clearance a side) and 1.4 deep.
 *     - ISO metric: M5 clearance 5.5mm, socket head 8.5mm (the STANDARDS table).
 *     - Spools: a 1 kg spool's centre hole is 52-57mm and it is 65-70mm wide.
 *   attempt#4 (iteration 9) drew this arm by hand with a 6mm rod for a 55mm
 *   spool hole - one valid solid, and a pencil that would snap under the load.
 *
 *   Frame: the extrusion runs vertically and the plate sits on its face in the
 *   y = 0 plane, key toward -y into the slot; the rod points out along +y,
 *   tilted up by `tilt` so the spool rolls back toward the plate, not off.
 */
import type { ManifoldModule } from "../../types.ts";

export const SPOOL_ARM_DEFAULTS = {
  /** Spool centre-hole diameter; the rod is sized from it. */
  spoolBore: 52,
  /** Spool width across its flanges; the rod is this plus clearance long. */
  spoolWidth: 70,
  /** Extrusion face width - the plate matches it. */
  extrusionWidth: 20,
  /** Plate height along the extrusion. */
  plateHeight: 80,
  plateThickness: 8,
  /** Centre distance of the two M5 holes along the extrusion. */
  holeSpacing: 60,
  /** M5 clearance hole. */
  holeDiameter: 5.5,
  /** Key into the 6mm slot; 0 to omit (a smooth-faced extrusion). */
  keyWidth: 5.8,
  keyDepth: 1.4,
  /** Upward tilt of the rod, degrees. */
  tilt: 5,
  /** Height of the end lip above the rod's surface. */
  lipHeight: 6,
  lipThickness: 4,
  segments: 64,
};

export type SpoolArmOptions = Partial<typeof SPOOL_ARM_DEFAULTS>;

const M5_HEAD = 8.5;

/**
 * The rod diameter for a spool bore.
 * @remarks A spool rides on TOP of its rod, so the rod need not fill the hole:
 *   6mm under the bore for a free fit, capped at 32mm - filling a 55mm bore
 *   made a 128 cm3 arm, three times the plastic for no extra strength where it
 *   matters (the root, which the gusset carries).
 */
function rodDiameterFor(bore: number): number {
  return Math.min(bore - 6, 32);
}

/** Refuses an arm that would not hold its spool or reach its screws. */
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

/** One arm, as described in the module remarks. */
export function extrusionSpoolArm(module: ManifoldModule, opts: SpoolArmOptions = {}): any {
  const { Manifold } = module as any;
  const p = { ...SPOOL_ARM_DEFAULTS, ...opts };
  check(p);
  const d = rodDiameterFor(p.spoolBore);
  const length = p.spoolWidth + 10 + p.lipThickness;
  const zMid = p.plateHeight / 2;

  const plate = Manifold.cube([p.extrusionWidth, p.plateThickness, p.plateHeight])
    .translate([-p.extrusionWidth / 2, -p.plateThickness, 0]);
  // The rod starts INSIDE the plate so the union is one body, then tilts up
  // about its root on the plate face.
  const rod = Manifold.cylinder(length + p.plateThickness / 2, d / 2, d / 2, p.segments)
    .add(Manifold.cylinder(p.lipThickness, d / 2 + p.lipHeight, d / 2 + p.lipHeight, p.segments)
      .translate([0, 0, length + p.plateThickness / 2 - p.lipThickness]))
    .translate([0, 0, -p.plateThickness / 2])
    .rotate([-90 + p.tilt, 0, 0])
    .translate([0, 0, zMid]);
  // A hulled gusset from the plate below the rod to the rod's first stretch,
  // split into two side ribs: the screws sit on the slot's centre line, so a
  // full-width gusset would bury the lower screw head and block the driver.
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
