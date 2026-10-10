// Reference: BOSL2 gears.scad worm_gear(), module 1.5, 24 teeth, mating a 20 mm two-start
// left-handed worm, centred, axis on Z.
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
worm_gear(mod=1.5, teeth=24, worm_diam=20, worm_starts=2, left_handed=true);
