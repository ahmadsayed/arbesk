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
 *   source's licence against these three classes:
 *     - facts and standards (a 42mm grid, a board's hole spacing) - no obligation,
 *       because dimensions are not creative works;
 *     - permissive code (MIT, BSD, Apache-2) - a notice in our source is enough;
 *     - attribution designs (CC-BY) - THIS TABLE, so the credit reaches the user.
 *   Copyleft (LGPL, GPL, AGPL) is never ported: translating is creating a
 *   derivative work, so the copyleft would attach to our code.
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
