// Reference: BOSL2 gears.scad worm(), module 2, 30 mm pitch diameter, 50 mm long, one start,
// right-handed, centred on its axis (Z).
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
worm(mod=2, d=30, l=50, starts=1, $fn=72);
