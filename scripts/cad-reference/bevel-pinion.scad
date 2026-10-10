// Reference: BOSL2 bevel_gear(), a 16-tooth straight pinion for a 28-tooth gear, 5 mm shaft.
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
bevel_gear(mod=2, teeth=16, mate_teeth=28, shaft_diam=5, spiral=0, cutter_radius=0, $fn=64);
