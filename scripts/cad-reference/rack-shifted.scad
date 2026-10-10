// Reference: BOSL2 gears.scad rack() with 25 degree pressure angle, profile
// shift, backlash and an explicit backing. BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2.
include <BOSL2/std.scad>
include <BOSL2/gears.scad>
rack(mod=1.5, teeth=7, thickness=5, pressure_angle=25, profile_shift=0.3, backlash=0.1, backing=4);
