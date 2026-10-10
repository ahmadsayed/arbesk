// Reference: BOSL2 bevel_gear(), the 28-tooth mate of bevel-pinion with 3 mm conical backing.
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
bevel_gear(mod=2, teeth=28, mate_teeth=16, backing=3, spiral=0, cutter_radius=0, $fn=64);
