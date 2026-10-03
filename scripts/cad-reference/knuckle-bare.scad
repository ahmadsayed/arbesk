// Reference: BOSL2 hinges.scad knuckle_hinge(), bare, exercising even segs,
// inner, arm_height, arm_angle and clip. BSD-2-Clause,
// https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/hinges.scad>
$fn=64;
knuckle_hinge(length=35, segs=6, offset=5, inner=true, arm_height=2, arm_angle=60, clip=1);
