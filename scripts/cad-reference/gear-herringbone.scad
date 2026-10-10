// Reference: BOSL2 gears.scad spur_gear(), module 2, 16 teeth, 8 mm thick, helical=20, herringbone=true,
// profile_shift=0. BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
spur_gear(mod=2, teeth=16, thickness=8, helical=20, herringbone=true, profile_shift=0, $fn=64);
