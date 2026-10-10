// Reference: BOSL2 gears.scad bevel_gear(), module 2, 20 teeth meshing 20, straight teeth
// (cutter_radius=0; bevelGear's spiral: 0), default backing, pitchbase anchor.
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
bevel_gear(mod=2, teeth=20, mate_teeth=20, spiral=0, cutter_radius=0, $fn=64);
