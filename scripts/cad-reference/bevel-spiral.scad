// Reference: BOSL2 bevel_gear(), a right-handed 35-degree spiral pinion, 5 slices.
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
bevel_gear(mod=2, teeth=16, mate_teeth=28, spiral=35, right_handed=true, slices=5, $fn=64);
