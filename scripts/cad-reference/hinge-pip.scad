// Reference: BOSL2 hinges.scad, print-in-place example ("positioned for printing").
// BSD-2-Clause, https://github.com/BelfrySCAD/BOSL2 - rendered by scripts/cad-reference.mjs.
include <BOSL2/std.scad>
include <BOSL2/hinges.scad>
$fn=64;
leaf_gap = 0.4;
seg_gap = 0.2;
module myhinge(inner)
   knuckle_hinge(length=25, segs=7, offset=3.1, inner=inner, in_place=true,
                 clearance=leaf_gap/2, round_bot=0.5, gap=seg_gap, seg_ratio=1/3);
cuboid([20,25,2],rounding=7,edges=[LEFT+FWD,LEFT+BACK]){
  position(TOP+RIGHT) orient(UP,-90) myhinge(false);
  align(RIGHT) right(leaf_gap) cuboid([20,25,2],rounding=7,edges=[RIGHT+FWD,RIGHT+BACK])
    position(TOP+LEFT) orient(UP,90) myhinge(true);
}
