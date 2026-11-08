/**
 * Licence attribution for prelude helpers ported from someone else's work. The
 * credits are computed from the helpers a script calls, never taken from the
 * model. Policy (which sources need an entry, why copyleft is never ported):
 * packages/cad-gen/AGENTS.md, "Licence attribution".
 */
import { referencedIdentifiers } from "./document.ts";

export interface Attribution {
  helper: string;
  work: string;
  author: string;
  /** Required for every entry. */
  authorGithub: string[];
  licence: string;
  /** Required: a credit a user cannot follow is not one. */
  url: string;
}

export const ATTRIBUTED_HELPERS: Record<string, Attribution> = {
  boardCase: {
    helper: "boardCase",
    work: "OpenSCAD RPi 4 case (rpi/pi-case-body.stl, rpi_case.scad)",
    author: "raksahb",
    authorGithub: ["https://github.com/raksahb"],
    licence: "MIT",
    url: "https://github.com/raksahb/openscad",
  },
  spurGear: {
    helper: "spurGear",
    work: "BOSL2 (Belfry OpenSCAD Library v2), gears.scad",
    author: "Revar Desmera",
    authorGithub: ["https://github.com/revarbat"],
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  knuckleHinge: {
    helper: "knuckleHinge",
    work: "BOSL2 (Belfry OpenSCAD Library v2), hinges.scad knuckle_hinge()",
    author: "Adrian Mariano and Revar Desmera",
    authorGithub: ["https://github.com/adrianVmariano", "https://github.com/revarbat"],
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  // "Inspired by Leemon Baird, 2011" refers to a public-domain gear; the rest is BOSL2's.
  rack: {
    helper: "rack",
    work: "BOSL2 (Belfry OpenSCAD Library v2), gears.scad rack(); inspired by Leemon Baird's public-domain involute gear (2011)",
    author: "Adrian Mariano and Revar Desmera",
    authorGithub: ["https://github.com/adrianVmariano", "https://github.com/revarbat"],
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  bevelGear: {
    helper: "bevelGear",
    work: "BOSL2 (Belfry OpenSCAD Library v2), gears.scad bevel_gear(); inspired by Leemon Baird's public-domain involute gear (2011)",
    author: "Adrian Mariano and Revar Desmera",
    authorGithub: ["https://github.com/adrianVmariano", "https://github.com/revarbat"],
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  worm: {
    helper: "worm",
    work: "BOSL2 (Belfry OpenSCAD Library v2), gears.scad worm(); inspired by Leemon Baird's public-domain involute gear (2011)",
    author: "Adrian Mariano and Revar Desmera",
    authorGithub: ["https://github.com/adrianVmariano", "https://github.com/revarbat"],
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  wormGear: {
    helper: "wormGear",
    work: "BOSL2 (Belfry OpenSCAD Library v2), gears.scad worm_gear(); inspired by Leemon Baird's public-domain involute gear (2011)",
    author: "Adrian Mariano and Revar Desmera",
    authorGithub: ["https://github.com/adrianVmariano", "https://github.com/revarbat"],
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  printInPlaceHinge: {
    helper: "printInPlaceHinge",
    work: "BOSL2 (Belfry OpenSCAD Library v2), hinges.scad print-in-place hinge example",
    author: "Adrian Mariano and Revar Desmera",
    authorGithub: ["https://github.com/adrianVmariano", "https://github.com/revarbat"],
    licence: "BSD-2-Clause",
    url: "https://github.com/BelfrySCAD/BOSL2",
  },
  spoolHolder: {
    helper: "spoolHolder",
    work: "3dthings-filament-spool-holder (filament_spool_holder.scad)",
    author: "Matthew Burke",
    authorGithub: ["https://github.com/Burke9077"],
    licence: "MIT",
    url: "https://github.com/Burke9077/3dthings-filament-spool-holder",
  },
  gridfinityCup: {
    helper: "gridfinityCup",
    work: "gridfinity_openscad (gridfinity_basic_cup.scad, basic_cup())",
    author: "Jamie (vector76)",
    authorGithub: ["https://github.com/vector76"],
    licence: "MIT",
    url: "https://github.com/vector76/gridfinity_openscad",
  },
  wallHook: {
    helper: "wallHook",
    work: "parametrized_wall_hook.scad",
    author: "AaronVerDow",
    authorGithub: ["https://github.com/AaronVerDow"],
    licence: "Unlicense",
    url: "https://github.com/AaronVerDow/cad",
  },
  knob: {
    helper: "knob",
    work: "openscad-knobs (knob.scad)",
    author: "Maciej Małecki",
    authorGithub: ["https://github.com/mmalecki"],
    licence: "MIT",
    url: "https://github.com/mmalecki/openscad-knobs",
  },
  phoneStand: {
    helper: "phoneStand",
    work: "SmartPhoneHolder",
    author: "DrLex",
    authorGithub: ["https://github.com/DrLex0"],
    licence: "CC-BY",
    url: "https://github.com/DrLex0/print3d-customizable-smartphone-holder",
  },
};

/** The credits a script owes, sorted by helper name for a stable response. */
export function attributionsFor(code: string): Attribution[] {
  const called = referencedIdentifiers(code);
  return Object.keys(ATTRIBUTED_HELPERS)
    .filter((name) => called.has(name))
    .sort()
    .map((name) => ATTRIBUTED_HELPERS[name]);
}
