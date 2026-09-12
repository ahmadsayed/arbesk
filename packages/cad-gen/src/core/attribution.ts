/**
 * Licence attribution for prelude helpers that derive from someone else's work.
 * @remarks When a helper is a PORT of a published design, the part a user builds
 *   with it is a derivative work, so the credit has to reach that user - not just
 *   sit in this source tree. The set is COMPUTED from the helpers a script
 *   actually calls, never taken from the model: a model cannot be relied on to
 *   remember a licence, and an attribution that depends on remembering is one
 *   that goes missing the first time the prompt is trimmed. Computing it also
 *   stops it being over-claimed - a script that never calls the helper earns no
 *   credit for it.
 *
 *   Licence gate, per the spec's section 8.1. Before adding an entry, check the
 *   source's licence against these classes:
 *     - facts and standards (a 42mm grid, a board's hole spacing) - NO entry.
 *       Dimensions are not creative works, so there is nothing to credit.
 *     - permissive code (MIT, BSD, Apache-2) - ENTRY HERE, even though the
 *       licence only asks for a notice. A notice buried in our source is not a
 *       credit the person holding the printed part can see, and crediting costs
 *       nothing but the truth.
 *     - attribution designs (CC-BY) - ENTRY HERE, and required.
 *   Copyleft (LGPL, GPL, AGPL) is never ported at all: translating is creating a
 *   derivative work, so the copyleft would attach to our code.
 *
 *   ONE SHARP EDGE, found while checking this table's sources. Facts are not
 *   copyrightable, so reading a GPL-licensed file to learn that a board is 85mm
 *   long creates no derivative work - only copying its EXPRESSION would (names,
 *   structure, comments, and a fortiori code). That distinction is what makes
 *   the board dimensions in SYSTEM_PROMPT safe to quote even though one of the
 *   files they were cross-checked against is GPL-3.0. It is a narrow line:
 *   quote numbers from a primary source, never lift code or prose from a
 *   copyleft file, and prefer the primary source so the question does not arise.
 *
 *   So the table is not a compliance form. It is the record of whose work a part
 *   rests on, and it covers permissive sources because that is the honest thing,
 *   not because the licence compels it.
 */
import { referencedIdentifiers } from "./document.ts";

/** One credit owed to the author of a work a prelude helper derives from. */
export interface Attribution {
  /** The prelude helper the credit attaches to. */
  helper: string;
  /** Title of the source work. */
  work: string;
  /** Who made it, as the source states it. */
  author: string;
  /** The licence as the source states it. */
  licence: string;
  /** Link to the original. Required: a credit a user cannot follow is not one. */
  url: string;
}

/**
 * Helper name to the credit it owes.
 * @remarks Every entry should also be named in the helper's own docstring, so
 *   someone reading the port cannot miss why it is there.
 */
export const ATTRIBUTED_HELPERS: Record<string, Attribution> = {
  // MIT: the shell structure - an open tray, ports grouped on one edge, standoffs
  // on the floor - was worked out against this case body rather than invented.
  boardCase: {
    helper: "boardCase",
    work: "OpenSCAD RPi 4 case (rpi/pi-case-body.stl, rpi_case.scad)",
    author: "raksahb",
    licence: "MIT",
    url: "https://github.com/raksahb/openscad",
  },
  // BSD-2-Clause: a notice would satisfy it, and a notice is not a credit the
  // user can see. Credited for the gear profile's proportions and construction,
  // which were checked against this library rather than invented.
  spurGear: {
    helper: "spurGear",
    work: "BOSL2 (Belfry OpenSCAD Library v2), gears.scad",
    author: "Revar Desmera",
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  phoneStand: {
    helper: "phoneStand",
    work: "SmartPhoneHolder",
    author: "DrLex",
    licence: "CC-BY",
    url: "https://github.com/DrLex0/print3d-customizable-smartphone-holder",
  },
};

/**
 * The credits a script owes, from the helpers it actually calls.
 * @remarks Sorted by helper name so the response is stable run to run: the
 *   underlying scan returns a Set, and an unstable order would make otherwise
 *   identical responses differ for no reason.
 * @param code A design's script body.
 * @returns One entry per attributed helper the script calls; empty otherwise.
 */
export function attributionsFor(code: string): Attribution[] {
  const called = referencedIdentifiers(code);
  return Object.keys(ATTRIBUTED_HELPERS)
    .filter((name) => called.has(name))
    .sort()
    .map((name) => ATTRIBUTED_HELPERS[name]);
}
