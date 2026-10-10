// Reference: BOSL2 gears.scad spur_gear(), module 2, 16 teeth, 8 mm thick, 5 mm bore,
// profile_shift=0 (BOSL2 otherwise auto-shifts small gears; spurGear is the unshifted standard).
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
spur_gear(mod=2, teeth=16, thickness=8, shaft_diam=5, profile_shift=0, $fn=64);
