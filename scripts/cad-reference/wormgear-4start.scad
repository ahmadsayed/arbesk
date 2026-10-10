// Reference: BOSL2 gears.scad worm_gear(), module 2, 36 teeth, mating a 30 mm four-start worm
// (a steep lead, so the helix hand is visible), centred, axis on Z.
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
worm_gear(mod=2, teeth=36, worm_diam=30, worm_starts=4);
