/**
 * The library catalog: everything the system prompt says about ONE part family
 * or ONE body of reference knowledge, kept together so it can be selected.
 * @remarks Two-stage generation (see select.ts) shows the model only the
 *   entries a request needs: a selector call reads each entry's one-line
 *   `summary`, and the generation call then receives the chosen entries' helper
 *   rows and guidance in full. The core rules and helpers in prompt.ts are
 *   always sent. So adding a ported part means adding an entry here - never a
 *   paragraph in prompt.ts - and the prompt stays the size of what is asked.
 *
 *   Every prelude helper is either a CORE helper (prompt.ts) or belongs to
 *   exactly one entry here; test/cad-gen/catalog.test.js holds that line.
 *
 * PROVENANCE, checked 2026-09-12. The numbers below are physical facts about
 * real hardware - a board's outline, a connector's shell - and facts are not
 * copyrightable, so quoting them creates no derivative work. The check that
 * matters is that we copy NUMBERS and never EXPRESSION (names, structure,
 * comments), and that is what happened here.
 *
 * The licences of every source consulted, so the next person does not have to
 * redo this:
 *   - Raspberry Pi board, hole pattern and connector sizes: cross-checked
 *     against process1183/openscad-library, which is GPL-3.0. NO code, names or
 *     comments were taken from it - the facts are also in Raspberry Pi's own
 *     mechanical drawings, which is the correct primary citation. Treat that
 *     repository as off-limits for anything expressive.
 *   - Arduino Uno R3 hole pattern: KiCad's footprint library (CC-BY-SA-4.0 with
 *     a design exception) and Arduino's published drawing, which agree exactly.
 *     Used to VERIFY, not to copy.
 *   - Gridfinity: the published specification's grid and base profile.
 *   - BOSL2 gear proportions and hinges: BSD-2-Clause. Credited in
 *     ATTRIBUTED_HELPERS.
 *   - Matthew Burke's spool holder: MIT. Credited in ATTRIBUTED_HELPERS.
 *   - Maciej Małecki's knobs: MIT. Credited in ATTRIBUTED_HELPERS.
 *   - GT2 pulley dimensions (2mm pitch, 0.254mm pitch factor, 0.76mm groove):
 *     Gates PowerGrip GT standard, cross-checked against a Gates-licensee
 *     catalog (CMT 2MR: pitch dia - outside dia = 0.020" at every size).
 *     Dimensions are facts and carry no credit, as Gridfinity's do.
 */

/** One selectable block of prompt documentation. */
export interface CatalogEntry {
  /** Stable id the selector returns. */
  id: string;
  /** Prelude helpers this entry documents; empty for a knowledge-only entry. */
  helpers: string[];
  /** One line for the selector: what requests this entry is for. */
  summary: string;
  /** Rows for the AVAILABLE HELPERS table, in its two-column format. */
  helperRows: string[];
  /** Rules, frames and reference numbers, sent when the entry is selected. */
  guidance: string[];
  /**
   * Helpers a request of this kind MUST call - a static gate in the repair loop.
   * @remarks Guidance alone is not enough: the model calls a helper when it
   *   believes it cannot do the job itself, and a hand-drawn part can still be
   *   one watertight body that passes every geometric gate. This turns the rule
   *   into a failed attempt whose error is the repair instruction.
   */
  requires?: HelperRequirement[];
}

/** One "this request must call that helper" rule. */
export interface HelperRequirement {
  /** True when the request (the user's prompt) is of this kind. */
  when: (prompt: string) => boolean;
  helper: string;
  /** The repair instruction handed back to the model when the helper is missing. */
  error: string;
}

export const CATALOG: CatalogEntry[] = [
  {
    id: "board-case",
    helpers: ["boardCase", "boardCaseLid"],
    summary: "enclosure for a Raspberry Pi, Arduino or any PCB - standoffs, port cutouts, board dimensions",
    helperRows: [
      "boardCase({ boardLength, boardWidth, holes, cutouts, wall?, ... })   PCB enclosure",
      "boardCaseLid({ ...the same options })   its friction-fit lid, laid beside it",
    ],
    guidance: [
      "A case WITH A LID is boardCase(o).add(boardCaseLid(o)) - the SAME options object o",
      "for both. NEVER build the lid yourself with box() or roundedBox(): those are",
      "centred on the origin, but boardCase's origin is the board's corner, so a live",
      "hand-built lid landed half off the case and fused into its rim. boardCaseLid",
      "lays the lid beside the case for printing; two bodies is correct.",
      "A Raspberry Pi, Arduino or any other PCB case is ALWAYS boardCase({...}). This is",
      "not a suggestion: it owns ONE frame - the board's lower-left corner is the",
      "origin - so a standoff cannot land outside the wall. Every hand-built case",
      "failed exactly there, with two of four posts outside the box and every validity",
      "check passing. Pass the board's own numbers and its mounting holes:",
      "  Raspberry Pi model B (3B, 3B+, 4B, 5): boardLength 85, boardWidth 56, holes",
      "  [[3.5,3.5],[3.5,52.5],[61.5,52.5],[61.5,3.5]], and cutouts for USB, Ethernet,",
      "  HDMI and power - the Ethernet socket is 21.2 x 16mm and the plugs need",
      "  clearance outside the wall, so cut right through it.",
      "Each cutout is { wall, at, width, height, z }: it names its wall as 'x-' (the",
      "  edge at x = 0), 'x+' (at",
      "  boardLength), 'y-' or 'y+'; 'left' and 'right' are not accepted because they",
      "  do not say which axis is meant. \"at\" is the position along that wall.",
      "  Arduino Uno R3: boardLength 68.58, boardWidth 53.34, holes",
      "  [[13.97,2.54],[15.24,50.8],[66.04,7.62],[66.04,35.56]] - NOT the corners of a",
      "  rectangle - plus cutouts on one short edge for the USB-B and the barrel jack.",
      "RASPBERRY PI model B (3B, 3B+, 4B, 5). Take x across the 85mm side and y across",
      "the 56mm side, with the origin at one corner of the board: board 85 x 56 x",
      "1.5mm with a 3mm corner radius. Four 2.75mm mounting holes inset 3.5mm from two",
      "edges, on a 58 x 49mm rectangle - at (3.5,3.5), (3.5,52.5), (61.5,52.5), and",
      "(61.5,3.5). Put a standoff on every one; there are four, not two. The 40-pin",
      "GPIO header is 51 x 5.1 x 8.5mm, runs along the y = 56 edge centred 32.5mm from",
      "the left, and stands 8.5mm above the board. The Ethernet socket is 21.2 x 16 x",
      "13.5mm and the micro SD card 11.5 x 12mm; both sit on an edge, so they need",
      "openings. PI 4B PORTS, by wall (positions are the connector CENTRE along that",
      "wall; an x wall is only 56mm long and a y wall 85mm):",
      "  'x+' (x = 85): USB pairs at y 9 and 27 (each 13 x 16mm), Ethernet at y 45.75.",
      "  'y-' (y = 0): USB-C power at x 11.2, micro-HDMI at x 26 and 39.5 (each about",
      "  7 x 3.5mm - cut 11 x 7 for the plug), 3.5mm audio at x 53.5.",
      "  'x-' (x = 0): micro SD, under the board, centred near y 28.",
      "HDMI and power are NOT on the USB edge - they are on a LONG side. A wall closed",
      "across any of those makes the case useless - cut them, and remember the plugs",
      "need clearance OUTSIDE the wall too, so the opening must go right through.",
      "Zero and Zero 2 W: board 65 x 30mm, same 3.5mm inset and 2.75mm holes on a",
      "58 x 23mm rectangle.",
      "ARDUINO UNO R3. Board 68.58 x 53.34mm, four 3.2mm mounting holes measured from",
      "one corner: (13.97,2.54), (15.24,50.8), (66.04,7.62), (66.04,35.56) - note they",
      "are NOT at the corners of a rectangle, so passing them straight to standoffs()",
      "is the only reliable way to get the posts right. The USB-B socket and the barrel",
      "jack are on one short edge and both need openings through the wall; the headers",
      "stand about 8.5mm above the board, so the lid needs that much clearance or a",
      "cutout over the header area.",
    ],
  },
  {
    id: "phone-stand",
    helpers: ["phoneStand"],
    summary: "desk stand or holder for a phone or tablet",
    helperRows: [
      "phoneStand({ thickness, lift, width })  desk stand that holds a phone at a lean",
    ],
    guidance: [
      "A phone stand is ALWAYS phoneStand({ thickness, lift, width }). This is not a",
      "suggestion and not a fallback: its profile is a ported reference design of 91",
      "hand-tuned points, and a profile you draw yourself will NOT reproduce it. Five",
      "attempts were made to have a model draw this shape by hand; every one produced",
      "something that was a single valid solid and still not a stand. Call the helper.",
      "For a stand phoneStand does not cover - a tablet, a laptop - the shape is ONE",
      "SOLID, NOT AN ASSEMBLY: a single 2D side profile extruded across the width of",
      "the thing it holds, with everything else subtracted from it. The phone or",
      "tablet sits in the channel; anything else is SUBTRACTED from that one body.",
      "This is how the well-regarded open-source holders do it: DrLex0's",
      "SmartPhoneHolder is literally linear_extrude(width) extrusionProfile() with",
      "slots cut out of it. Do NOT build a base plate plus a leaning back plate and",
      "union them - separate plates come apart, cannot be printed as one piece, and",
      "are how three attempts at a phone stand each produced a disconnected body. A",
      "profile cannot come apart, because there was never a join. Typical numbers for",
      "a phone: hold across 60-75mm of width, 10-14mm of body thickness, a channel",
      "wide enough for the phone plus a case, and a front lip 12mm or more so it",
      "cannot slide out.",
      "PHONES have no standard, so pick sensible numbers and state them: a modern",
      "handset is 70-80mm wide and 8-11mm thick with a case. Build a stand as ONE",
      "extruded profile, per the RULES above - a reference design that works holds the",
      "phone across 60mm of width in a channel cut through a 12mm-thick body, leaning",
      "back about 15-20 degrees from vertical, with a front lip so it cannot slide out",
      "and a slot underneath so a charging cable can pass. If charging access matters,",
      "leave the bottom of the channel open rather than closed.",
    ],
  },
  {
    id: "hinge",
    helpers: ["printInPlaceHinge", "knuckleHinge"],
    summary: "hinges - a standalone print-in-place hinge, or a hinged lid, door or flap on a part",
    helperRows: [
      "printInPlaceHinge({ length?, leafWidth?, thickness?, segs?, knuckleDiam?, leafGap? })",
      "                                      two-leaf hinge, printed assembled",
      "knuckleHinge({ length, segs, offset, inner?, knuckleDiam?, armAngle?, gap?, inPlace? })",
      "                                      one hinge half to add to your own part",
    ],
    guidance: [
      "A hinge is ALWAYS printInPlaceHinge({...}) or knuckleHinge({...}). This is not a",
      "suggestion: both are ports of BOSL2's hinges, verified against OpenSCAD's own",
      "render, with cone-tipped captive pins and the segment gaps a printer needs. Two",
      "live attempts at a hand-drawn hinge failed - one did not even parse, one threw.",
      "A standalone hinge is printInPlaceHinge: it returns TWO bodies on purpose, the",
      "only exception to the one-solid rule, because leaves that fuse are not a hinge.",
      "Its defaults are a 25mm-long hinge with two 20 x 25 x 2mm leaves; set length,",
      "leafWidth and thickness from the request, and leave offset unset - it scales",
      "with knuckleDiam so the knuckle clears the other leaf. Its FRAME, exactly: the",
      "pin runs along Y and length is along Y (y from -length/2 to +length/2); the",
      "left leaf spans x from -leafWidth/2 to +leafWidth/2, the right leaf from",
      "leafWidth/2 + leafGap to 3*leafWidth/2 + leafGap (leafGap defaults to 0.4); both",
      "leaves span z from -thickness/2 to +thickness/2 and the knuckle sits above",
      "them. So a screw hole in a leaf is hole(part, { axis: 'z', at: [x, y] }) with",
      "x inside that leaf's span and y along the length - keep it clear of the",
      "knuckle, which occupies about knuckleDiam either side of x = leafWidth/2 + leafGap/2.",
      "To hinge a lid or a door of the",
      "user's own part, add knuckleHinge({ inner: false }) to one piece and",
      "knuckleHinge({ inner: true }) to the other, with the same length, segs and",
      "offset: its mounting face is z = 0, the pin runs along X at height offset, and",
      "the arm reaches toward -y; rotate and translate it onto the face.",
    ],
  },
  {
    id: "gear",
    helpers: ["spurGear", "ringGear", "rack"],
    summary: "spur, helical and herringbone gears, gear pairs, ring (internal) gears, planetary gearboxes, racks and rack-and-pinion drives - anything with involute teeth",
    helperRows: [
      "spurGear({ module, teeth, thickness, bore?, pressureAngle?, helical?, herringbone? })",
      "                                      involute gear; helical = helix angle in degrees",
      "ringGear({ module, teeth, thickness, backing?, outerDiameter?, pressureAngle?, helical?, herringbone? })",
      "                                      internal (ring) gear: teeth on the inside",
      "rack({ module, teeth, thickness, pressureAngle?, backing? })     straight gear rack",
    ],
    guidance: [
      "Use spurGear for every gear. NEVER write the tooth trigonometry yourself and",
      "never approximate teeth with trapezoids or boxes: that looks almost right and",
      "meshes with nothing. Two gears turn together ONLY if they share the SAME module",
      "and pressure angle, with parallel axes at centre distance",
      "(module x (teeth1 + teeth2)) / 2. Report the module, tooth count and pressure",
      "angle you chose, since the user has to match them against whatever the gear",
      "drives.",
      "A helical or herringbone gear is ALWAYS spurGear({ ..., helical: angle }) (add",
      "herringbone: true for a herringbone / double-helical gear); never twist one",
      "yourself. module is the NORMAL module. Two helical gears mesh only with the SAME",
      "helix angle and OPPOSITE hand (helical: 20 with helical: -20) at centre distance",
      "module x (teeth1 + teeth2) / (2 x cos(helical)); two herringbones mesh the same",
      "way. A herringbone needs no thrust bearing and prints without a seam fight, so",
      "prefer it when the user asks for quiet or strong printed gears.",
      "An internal gear, ring gear or the outer gear of a planetary set is ALWAYS",
      "ringGear(...). A planet of z_p teeth meshes inside a ring of z_r at centre",
      "distance module x (z_r - z_p) / 2. A planetary gearbox needs z_r = z_s + 2 x z_p",
      "(sun z_s), every gear the same module and pressure angle, and - for equally",
      "spaced planets - (z_r + z_s) divisible by the number of planets.",
      "A rack - any linear gear, toothed bar or rack-and-pinion - is ALWAYS",
      "rack(...). This is not a suggestion: never draw rack teeth with boxes or a",
      "polygon. rack() lays its teeth along X with the tips toward +Z, face width",
      "along Y and the base at z = -bottom; a pinion meshes with it when it has the",
      "same module and pressure angle and its pitch circle touches the rack's pitch",
      "line at z = 0.",
    ],
  },
  {
    id: "gridfinity",
    helpers: ["gridfinityBase", "gridfinityBaseplate", "gridfinityCup"],
    summary: "Gridfinity bins, cups, boxes and baseplates - anything that must fit the Gridfinity grid",
    helperRows: [
      "gridfinityBaseplate({ unitsX, unitsY })  the BASEPLATE: open grid frame bins plug into",
      "gridfinityBase({ unitsX, unitsY })    the FOOT under a bin, sitting on z = 0 - NOT a baseplate",
      "gridfinityCup({ width, depth, height, chambers?, withLabel?, magnetDiameter?, ... })",
      "                                      a COMPLETE Gridfinity bin",
    ],
    requires: [{
      // "fits on a baseplate" is a part that SITS on one - a bin or a custom
      // holder, built on gridfinityCup or gridfinityBase - not a baseplate.
      when: (prompt) => /gridfinity/i.test(prompt) &&
        /base[\s-]*plat|grid[\s-]*plate/i.test(prompt) &&
        !/\b(?:fits?|sits?|for|on|onto|into|in|compatible with)\s+(?:an?\s+|the\s+|my\s+)?(?:gridfinity\s+)?(?:base[\s-]*plat|grid[\s-]*plate)/i.test(prompt),
      helper: "gridfinityBaseplate",
      error: "the request is a Gridfinity BASEPLATE, and this script does not call " +
        "gridfinityBaseplate. A hand-drawn baseplate does not fit real bins (one came " +
        "back as raised bumps on a slab - the inverse of a baseplate), and gridfinityBase " +
        "is the FOOT under a bin, not a baseplate. Replace the geometry with " +
        "return gridfinityBaseplate({ unitsX: P.unitsX, unitsY: P.unitsY }); with unitsX " +
        "and unitsY as whole-number cell-count parameters.",
    }],
    guidance: [
      "A Gridfinity BASEPLATE (base plate, grid, the frame bins plug into) is ALWAYS",
      "gridfinityBaseplate({ unitsX, unitsY }). Never draw it yourself and never use",
      "gridfinityBase for it: a baseplate is POCKETS cut down into a plate, not bumps",
      "on top of one. It is 42mm x units on each side and 4.65mm tall, open at the",
      "bottom, centred on the origin on z = 0; return it as it is. Its only",
      "parameters are unitsX and unitsY, whole cell counts.",
      "A Gridfinity bin, cup or box is ALWAYS gridfinityCup({...}). This is not a",
      "suggestion: it is a port of vector76's gridfinity_openscad basic_cup(), verified",
      "against OpenSCAD's own render - feet, walls, stacking lip, finger slide, dividers",
      "and label tab included. A hand-built bin came back as two bodies, its base",
      "resting loose inside the cavity. Use gridfinityBase only for a custom part that",
      "is NOT a bin and must sit on a Gridfinity baseplate.",
      "  width and depth are grid units (42mm each; width may also be 0.5); height is",
      "  in 7mm units, so a '6 units tall' bin is height 6. chambers splits it along x.",
      "  withLabel: 'disabled' (default), 'left', 'right', 'center', or 'leftchamber',",
      "  'rightchamber', 'centerchamber' for one tab per chamber; labelWidth in units.",
      "  magnetDiameter 6.5 and screwDepth 6 add the standard magnet and screw holes",
      "  (default 0, none). lipStyle 'normal', 'reduced' or 'none'. fingerslide true",
      "  rounds the inside front so items scoop out. Its frame: the first cell is",
      "  centred on the origin, the bin extends +x and +y, feet on z = 0.",
      "GRIDFINITY. Compatibility is exact - a base a hundredth out does not seat in",
      "someone else's baseplate, so use these and do not round them: 42mm grid pitch;",
      "0.25mm clearance per side, so a 1x1 footprint is 41.5mm; height unit 7mm; bin",
      "corner radius 3.75mm; base profile 4.75mm tall (0.8mm 45-degree taper, 1.8mm",
      "riser, 2.15mm taper); magnet holes 6.5mm dia x 2.4mm deep and M3 screw holes",
      "3mm dia x 6mm deep, on a 26mm square inside each cell. gridfinityBase gives",
      "the base sitting on z = 0 - build the floor and walls directly on top of it.",
      "The stacking lip that lets one bin carry another is the base profile mirrored,",
      "4.75mm tall, around the top rim, and it ADDS to the nominal height.",
    ],
  },
  {
    id: "rail-hook",
    helpers: ["railHook"],
    summary: "a hook that hangs over a rail, rod, bar or pipe",
    helperRows: [
      "railHook({ railDiameter, wall?, width?, drop? })   hook that clips over a rail",
    ],
    guidance: [
      "A hook that goes over a rail is ALWAYS railHook({ railDiameter, ... }). Do not",
      "draw one: a live attempt drew a rail hook as an assembly and it came back as SIX",
      "disconnected pieces. Its ring wraps 300 degrees by construction, which is what",
      "stops it coming off - a hand-drawn C open at the side drops its load the moment",
      "it swings.",
    ],
  },
  {
    id: "cup-rack",
    helpers: ["cupRack"],
    summary: "a rack, stand or holder for mugs or cups",
    helperRows: [
      "cupRack({ cupDiameter, columns?, rows?, pocketDepth? })   rack of cup pockets",
    ],
    guidance: [
      "A rack for mugs or cups is ALWAYS cupRack({ cupDiameter, ... }). A live attempt",
      "produced a 6mm-thick plate with four holes: the right footprint, one valid",
      "solid, every check passed, and it cannot hold a mug that is 95mm tall. The",
      "pockets are deep by construction, so a cup sits down inside the rack.",
    ],
  },
  {
    id: "spool-holder",
    helpers: ["spoolHolder"],
    summary: "filament spool holders, spool stands and spool frames - a free-standing frame that holds a spool on an axle",
    helperRows: [
      "spoolHolder({ part, spoolMaxDiameter?, spoolMaxBoreDiameter?, spoolMaxWidth?, ... })",
      "                                      one print part of a free-standing spool stand",
    ],
    guidance: [
      "A filament spool holder or spool stand is ALWAYS spoolHolder({...}). This is not a",
      "suggestion: it is a port of Matthew Burke's parametric spool holder, verified",
      "against OpenSCAD's own render. A hand-drawn spool holder came back as a plain",
      "bracket that could not hold a spool. The frame is several printed parts; ONE call",
      "returns ONE part, in print orientation, lying on z = 0. Return the part the user",
      "asked for; when they asked for 'a spool holder', return part 'side_frame' and say",
      "in the summary that the full set is side_frame x2, crossbar x2, axle x1,",
      "axle_cap x2, plus four M3 x 10 screws and four M3 nuts.",
      "  part: 'side_frame' (A-frame side with the axle cradle), 'crossbar' (rail with",
      "  tenons and nut traps), 'axle' (faceted, prints on its flat), 'axle_cap'.",
      "  Size it from the spool: spoolMaxDiameter (default 220, a 1 kg spool is about",
      "  200), spoolMaxBoreDiameter (default 60, the centre hole, about 52-57 on most",
      "  spools) and spoolMaxWidth (default 115, about 65-70 for a 1 kg spool). Pass the",
      "  SAME values for every part so they fit together. Leave the other options unset.",
      "  It refuses impossible sizes with a message naming the fix.",
      "spoolHolder is a STAND. For an arm that bolts to 2020 aluminium extrusion, use",
      "extrusionSpoolArm instead.",
    ],
  },
  {
    id: "wall-hook",
    helpers: ["wallHook"],
    summary: "wall hooks, coat hooks, towel, bag and key hooks screwed to a wall or door",
    helperRows: [
      "wallHook({ width?, d?, height?, theight?, thick? })   screw-mounted J hook",
    ],
    guidance: [
      "A hook screwed to a wall or a door - a coat hook, towel hook, bag or key hook - is",
      "ALWAYS wallHook({...}). This is not a suggestion: it is a port of AaronVerDow's",
      "parametric wall hook, verified against OpenSCAD's own render, with the J-curve,",
      "the tip that stops a load sliding off and two countersunk screw holes. A",
      "hand-drawn coat hook came back as a block with holes in it.",
      "  width: extrusion width, default 12 (a sturdy coat hook is 14-18). d: the curve's",
      "  centre-line diameter, default 33 + width (a coat or bag needs 40-60). height: the",
      "  wall plate, default 70; theight: the tip, default 30. thick defaults to width.",
      "  Its frame: the curve is centred on the origin, the plate runs up +y, and it lies",
      "  flat on z = 0 to z = width - print orientation, screw holes along x.",
      "For a hook that hangs OVER a rail or a door top instead of screwing on, use railHook.",
    ],
  },
  {
    id: "knobs",
    helpers: ["knob"],
    summary: "control knobs - amplifier, potentiometer and appliance knobs with a star or round grip profile",
    helperRows: [
      "knob({ d?, h?, shape?, chamfer?, stemD?, stemH?, starPoints?, center? })  control knob",
    ],
    guidance: [
      "A control knob - an amplifier or potentiometer knob, an appliance dial - is ALWAYS",
      "knob({...}). This is not a suggestion: it is a port of Maciej Małecki's parametric",
      "knob, verified against OpenSCAD's own render. A hand-drawn knob came back as a",
      "smooth cylinder with dots subtracted around it - no grip, and it does not look",
      "like a knob. The star profile is what fingers grip: rounded points around a",
      "central body, one call.",
      "  d: head diameter, default 32 (a small pot knob is 15-20, an amp knob 30-40).",
      "  h: head height, default 10. shape: \"star\" (default) or \"round\". chamfer:",
      "  edge chamfer, default 0.5. stemD/stemH: a spacer stem below the head for the",
      "  shaft and nut (0 means none), default 15 x 5. starPoints: default 4 (3-6 are",
      "  common). A knob is face down on z = 0 with its axis on the origin.",
      "The helper returns the UNCUTOFF knob: subtract the shaft bore from the returned",
      "solid, where h is the head height used in the call. A round bore:",
      "k.subtract(cylinder(3, h + 2, { segments: 24 }).translate([0, 0, h / 2])). A D-shaft",
      "bore is the round bore plus a flat cut on one side: for a 6 mm shaft with a",
      "0.9 mm flat, the flat plane sits 2.1 mm from the axis, so",
      "k.subtract(box(2, 8, h + 2).translate([3.1, 0, h / 2])) leaves exactly that flat.",
      "Both cutters must pass through the head and out the other side - a blind bore",
      "whose cutter stops inside the head fails the build.",
    ],
  },
  {
    id: "gt2-pulley",
    helpers: ["gt2Pulley"],
    summary: "GT2 timing pulleys, belt pulleys - 2mm-pitch toothed pulleys for 3D-printer and motion belts",
    helperRows: [
      "gt2Pulley({ teeth?, beltWidth?, bore?, flanges?, flangeDiameter?, flangeThickness?, setScrew? })",
      "                                      GT2 timing pulley with flanges",
    ],
    guidance: [
      "A GT2 timing pulley is ALWAYS gt2Pulley({...}). This is not a suggestion: it is",
      "built from the Gates PowerGrip GT standard dimensions, and a hand-drawn one came",
      "back toothless twice and as 21 detached teeth once. The sizes are NOT derivable:",
      "a 20-tooth pulley is 12.73 mm pitch diameter but only 12.22 mm across the teeth,",
      "with 0.76 mm grooves - three different numbers the model has never guessed.",
      "  teeth: default 20 (10-40 common). beltWidth: default 6. bore: shaft diameter,",
      "  default 5 (NEMA 17). flanges: belt-retaining discs, default on. setScrew:",
      "  \"none\" (default), \"M3\" or \"M4\" - a radial clearance hole through the hub;",
      "  pick M3 for a motor shaft and mention it in the summary. Lies on z = 0, axis",
      "  on the origin, flange-to-flange - print orientation, no support.",
      "The groove is the straight-flanked printable approximation of the curvilinear",
      "Gates profile; it meshes with standard GT2 belts. For an idler on a smooth",
      "bearing, still use gt2Pulley with a bore that clears the bearing.",
    ],
  },
  {
    id: "extrusion-spool-arm",
    helpers: ["extrusionSpoolArm"],
    summary: "filament spool arms that bolt onto 2020 aluminium extrusion or a printer frame",
    helperRows: [
      "extrusionSpoolArm({ spoolBore?, spoolWidth?, holeSpacing?, tilt?, ... })",
      "                                      spool arm for 2020 extrusion",
    ],
    guidance: [
      "A spool arm or spool holder that mounts on aluminium extrusion (2020, V-slot, a",
      "printer frame) is ALWAYS extrusionSpoolArm({...}). This is not a suggestion: a",
      "hand-drawn arm came back with a 6mm rod for a 55mm spool hole - one valid solid",
      "that would snap under a 1 kg spool - and twice as two loose bodies.",
      "  spoolBore: the spool's centre hole, default 52 (1 kg spools are 52-57); the rod",
      "  is sized from it. spoolWidth: across the flanges, default 70. The plate is keyed",
      "  into the 6mm slot (keyWidth 0 for a smooth face), with two M5 clearance holes",
      "  holeSpacing apart (default 60) for M5 T-nuts, placed clear of the rod and the",
      "  gusset so a driver reaches them. tilt (default 5 degrees) keeps the spool from",
      "  walking off. Leave the other options unset; it refuses a layout that buries a",
      "  screw head, naming the spacing that works.",
      "  Its frame: the extrusion runs vertically, the plate's mounting face is y = 0",
      "  with the key toward -y, and the rod points out along +y.",
    ],
  },
  {
    id: "pipe-clamp",
    helpers: ["pipeClamp"],
    summary: "split pipe clamps, tube and rod clamps, shaft collars - two halves bolted together around a pipe",
    helperRows: [
      "pipeClamp({ pipeDiameter, width?, wall?, bolt?, nutTrap?, gap?, ... })",
      "                                      split clamp, two bolted halves",
    ],
    guidance: [
      "A split clamp around a pipe, tube, rod or bar - a pipe clamp, tube clamp, split",
      "collar - is ALWAYS pipeClamp({...}). This is not a suggestion: a hand-drawn clamp",
      "came back as ONE fused block that could never open, and once as 12 loose pieces",
      "after two repairs. The helper returns BOTH halves as TWO separate bodies, laid out",
      "to print - that is correct, never join them. Return its result as it is.",
      "  pipeDiameter: the pipe's OUTSIDE diameter (default 25). width: along the pipe,",
      "  default 20. wall: ring thickness, default 5. bolt: \"M3\", \"M4\", \"M5\" (default),",
      "  \"M6\" or \"M8\". nutTrap: hex nut pockets in one half, default true; false for",
      "  plain holes and a loose nut. gap: space between the halves, default 5. The bore",
      "  gets 0.2mm of print clearance and the halves stop 1mm short of touching, so the",
      "  bolts pinch the pipe. Leave the other options unset; it refuses a bolt spacing",
      "  that breaks into the bore or a width the head will not fit, naming what works.",
      "  Its frame: PRINT orientation, pipe axis along z, both halves standing on z = 0",
      "  and width tall. The halves face each other across y = 0, their split faces gap",
      "  apart: the counterbored bolt-head half at +y, the nut half at -y. Both bolts run",
      "  along y at z = width / 2, either side of the bore on x.",
      "  Say in the summary which bolts and nuts it takes: two of the chosen size, long",
      "  enough to pass both ears.",
    ],
  },
  {
    id: "household",
    helpers: [],
    summary: "kitchen, bathroom and household items - drainage, hooks that hold, clearance, stability, typical sizes",
    helperRows: [
    ],
    guidance: [
      "KITCHEN AND HOUSEHOLD - no standard exists, so pick sensible numbers and STATE",
      "them. A mug is 80-90mm across and 95-100mm tall, so a cup pocket is the mug",
      "diameter plus 2-3mm. A kitchen sponge is about 110 x 70 x 40mm. A wardrobe rail",
      "is 25mm diameter (some are 20 or 30), a shelf is usually 18mm thick.",
      "For these, FUNCTION is the specification, and four things decide whether the",
      "part is any good:",
      "  DRAIN. Anything holding something wet - a sponge holder, a soap dish, a sink",
      "  caddy, a shower shelf - needs holes or slots in its floor and a slight fall,",
      "  or it holds a puddle and grows mould. Slots 4-5mm wide drain freely and still",
      "  carry a sponge.",
      "  DO NOT LET GO. A hook over a rail or a door top needs a closed loop, or a lip",
      "  reaching more than half the rail diameter down the far side; an open C drops",
      "  its load the moment it swings. A hook is loaded in shear, so thicken it where",
      "  the loop meets the body, and do not make the hook thinner than 6mm.",
      "  CLEARANCE AND REACH. Leave room for fingers to lift a mug in and out, and",
      "  keep a wall-mounted part's fixings reachable once it is loaded.",
      "  STABILITY. A part standing on a surface needs a footprint wide enough not to",
      "  tip - a wide base, never a narrow one under a high centre of mass. Round the",
      "  inside corner where a wall meets a floor: a sharp internal corner is both a",
      "  stress riser and a hard print.",
    ],
  },
  {
    id: "fasteners",
    helpers: [],
    summary: "ISO metric screws, nuts, clearance holes, nut traps, counterbores, heat-set inserts",
    helperRows: [
    ],
    guidance: [
      "FASTENERS, ISO metric, millimetres. Cut clearance holes and pockets - never try",
      "to model a thread, which this kernel cannot do and no printer can reproduce.",
      "  Socket head cap screws (ISO 4762), head DIAMETER / head HEIGHT:",
      "    M3 5.5 / 3.0, M4 7.0 / 4.0, M5 8.5 / 5.0, M6 10.0 / 6.0, M8 13.0 / 8.0.",
      "  Hex nuts (ISO 4032), across FLATS / height / thread pitch:",
      "    M3 5.5 / 2.4 / 0.5, M4 7.0 / 3.2 / 0.7, M5 8.0 / 4.7 / 0.8,",
      "    M6 10.0 / 5.2 / 1.0, M8 13.0 / 6.8 / 1.25. Across corners is about 15% more",
      "    than across flats.",
      "  Clearance holes to pass a screw through: M3 3.4, M4 4.5, M5 5.5, M6 6.6, M8 9.0.",
      "  A hex pocket that captures a nut is the across-flats size plus 0.2mm and the",
      "  nut's height plus 0.2mm; a counterbore for a screw head is the head diameter",
      "  plus 0.4mm and the head height plus 0.2mm.",
      "  Heat-set inserts in a printed part: bore DIAMETER / DEPTH -",
      "    M3 4.0 / 6.0, M4 5.6 / 8.0, M5 6.4 / 9.5.",
    ],
  },
];

/** Every catalog id, in catalog order. */
export const CATALOG_IDS: string[] = CATALOG.map((e) => e.id);

/** The entries for these ids, in catalog order; unknown ids are ignored. */
export function catalogEntries(ids: Iterable<string>): CatalogEntry[] {
  const wanted = new Set(ids);
  return CATALOG.filter((e) => wanted.has(e.id));
}

/** The ids of the entries owning any helper a script references. */
export function entriesUsedBy(referenced: Set<string>): string[] {
  return CATALOG.filter((e) => e.helpers.some((h) => referenced.has(h))).map((e) => e.id);
}

/**
 * The helpers this request must call that the script does not.
 * @remarks Checked against EVERY entry, not only the selected ones: the rule is
 *   about what was asked for, and Jev failing open must not switch it off.
 */
export function missingRequiredHelpers(
  prompt: string,
  referenced: Set<string>,
): HelperRequirement[] {
  return CATALOG.flatMap((e) => e.requires ?? [])
    .filter((r) => r.when(prompt) && !referenced.has(r.helper));
}
