// Reference: BOSL2 gears.scad worm_gear(), module 2, 30 teeth, mating a 30 mm one-start worm,
// default worm_arc and crowning, centred, axis on Z.
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
worm_gear(mod=2, teeth=30, worm_diam=30, worm_starts=1);
