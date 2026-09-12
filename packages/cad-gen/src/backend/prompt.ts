/**
 * System prompt and turn assembly.
 * @remarks The system prompt is the *published API documentation* for the
 *   prelude: changing it changes what the model writes, so it moves in lockstep
 *   with PRELUDE_VERSION (spec section 4). Every statement about a helper below
 *   is the helper's MEASURED behaviour, not its planned one - a prompt that
 *   describes geometry the kernel cannot produce costs a failed generation and
 *   a repair round.
 */
import type { CadDesign } from "../types.ts";
import type { LlmMessage } from "./deepseek.ts";
import type { GateResult } from "../core/gates.ts";
import { PRELUDE_NAMES } from "../core/prelude.ts";

/** Rules the generated script must obey. */
const RULES = [
  "Units are millimetres. The coordinate system is Z-up (CAD convention).",
  "Produce ONE solid. Solids only - no surfaces, no open shells.",
  "The code is the BODY of a function with PARAMETERS, P (an alias of PARAMETERS),",
  "M (the raw Manifold class) and the helper functions below in scope.",
  "It MUST end by returning a Manifold.",
  "Every dimension MUST come from PARAMETERS - never hard-code a size the user may",
  "want to change. Declare each parameter with value, unit \"mm\" and, where useful,",
  "min, max and label.",
  "No imports, no network, no filesystem, no eval, no dynamic code, no unbounded loops.",
  "Prefer roundRect with extrude, or roundedBox, for prismatic parts: those give",
  "EXACT fillets.",
  "Cut every through-hole with hole(part, { diameter, axis, at }), which sizes the",
  "cutter from the part's own bounding box. Do NOT subtract your own cylinder: a",
  "through-cutter must be LONGER than the whole part, and working out its exact",
  "length is another chance to get the centring wrong. A live timing pulley bored",
  "itself 'width + 2' into a part 'width + 4' tall and left a millimetre of solid",
  "at each end - a blind hole where a through-hole was asked for, invisible in the",
  "render and passed by every check.",
  "EVERY builder is CENTRED ON THE ORIGIN - box, cylinder, sphere, extrude,",
  "revolve and spurGear all put their centre at (0, 0, 0). A cylinder 15 mm long",
  "spans z = -7.5 to +7.5, NOT 0 to 15, and an extrusion of height h spans -h/2 to",
  "+h/2. To assemble parts along an axis use stack([a, b, c]), which lays them end",
  "to end from a base at the origin and unions them; do NOT add up half-heights by",
  "hand. Getting this wrong is the single most common way a part comes out with a",
  "piece detached from the rest - a flange placed at z = +15 against a body ending",
  "at +7.5 is a floating disc, and it still passes every validity check.",
  "Use spurGear for every gear. NEVER write the tooth trigonometry yourself and",
  "never approximate teeth with trapezoids or boxes: that looks almost right and",
  "meshes with nothing. Two gears turn together ONLY if they share the SAME module",
  "and pressure angle, with parallel axes at centre distance",
  "(module x (teeth1 + teeth2)) / 2. Report the module, tooth count and pressure",
  "angle you chose, since the user has to match them against whatever the gear",
  "drives.",
  "When a part's cross-section is a CUSTOM OUTLINE - gear or sprocket teeth, a",
  "cam, a pulley, a bracket that is not a rectangle - DRAW THE OUTLINE as [x, y]",
  "points and extrude it with polygon plus extrude. One contour, or several when",
  "the profile has holes; the even-odd fill rule turns an enclosed contour into a",
  "bore. NEVER assemble teeth or lobes from boxes translated around a cylinder:",
  "the placement arithmetic goes wrong easily, and a tooth that floats a fraction",
  "of a millimetre clear of the body, or reaches above it, still yields a",
  "watertight solid that passes every check while being unusable.",
  "Use filletEdges for EVERY fillet, including one where two diameters meet, and",
  "chamferEdges for every chamfer. NEVER build fillet geometry by hand out of",
  "revolve, circle, a torus or an intersect: a boolean against a solid placed in",
  "the wrong spot yields an EMPTY solid, and solid.add(empty) silently returns",
  "solid unchanged - so the part validates with the fillet simply missing, and",
  "nothing in the pipeline reports it.",
  "Round in TWO DIMENSIONS whenever the part allows it - round the PROFILE, then",
  "extrude or revolve it. That is exact and costs milliseconds. filletEdges opens",
  "the finished solid with a ball, which is a mesh operation whose cost explodes",
  "on concave or multi-feature geometry: measured, one 80 x 60 plate takes 43 ms",
  "filleted BEFORE its holes exist and 86 SECONDS after, and a plain 30 mm shaft",
  "collar took 51 s. So: a prismatic part uses roundedBox or roundRect plus",
  "extrude; an AXISYMMETRIC part draws a polygon half-section with rounded corners",
  "and revolves it; and filletEdges is the LAST RESORT, for a part that is neither",
  "and has no holes, pockets or bolt circles yet. Reach for it first and you will",
  "make the user wait a minute for something that should take no time at all.",
  "In its default mode filletEdges - and chamferEdges - round the part's existing",
  "edges by opening it with a ball of radius r: the opening preserves the part's",
  "outer dimensions, so a fillet never grows the part - it only removes material at",
  "the edges.",
  "That opening rounds EVERY convex edge, so r must stay below half the part's",
  "thinnest dimension: a 20 mm cube takes r = 9 but refuses r = 12, and a",
  "20 x 20 x 1 mm plate refuses even r = 0.5, exactly half its thickness. A radius",
  "that does not fit is REFUSED with an error naming the helper and the radius,",
  "never silently replaced by a different solid: choose a smaller r and retry.",
  "chamferEdges is a rounding alias for filletEdges: this kernel has no flat bevel,",
  "so it rounds the edges with the same ball opening and the same radius limit.",
  "Pass { quality: \"high\" } to filletEdges or chamferEdges only when the user asks",
  "for a smooth, high-quality fillet or the fillet is the part's most visible feature.",
  "The default quality is \"draft\", which rounds with a coarser ball: it is fast",
  "and right for most parts, and high quality can take many seconds on revolved",
  "or complex geometry, long enough to time out. Do not use it by default.",
  "filletEdges defaults to mode \"auto\", which is the opening described above, and",
  "mode \"minkowski\" is that same opening. mode \"smooth\" is appearance-only and",
  "NOT dimension-preserving: it moves the surface outward and changes the part's",
  "size and volume, so never use it for a part whose dimensions matter.",
].join("\n");

/** Helper reference the model is prompted against. */
const HELPER_DOCS = [
  "box(w, d, h)                          centred box, mm",
  "cylinder(r, h, opts?)                 CENTRED Z-aligned cylinder, opts.segments",
  "sphere(r, opts?)                      CENTRED sphere",
  "rect(w, d) / circle(r, opts?)         2D profiles",
  "roundRect(w, d, r)                    rounded 2D profile (r clamped)",
  "polygon(points, opts?)                2D profile from [x, y] pairs; pass several",
  "                                      contours for holes (even-odd fill)",
  "extrude(profile, h, opts?)            profile to solid, CENTRED on Z",
  "revolve(profile, opts?)               profile revolved about Z, CENTRED",
  "stack([a, b, ...], opts?)             lay solids end to end from a base at the origin",
  "roundedBox(w, d, h, r)                EXACT prismatic fillet",
  "hole(part, { diameter, axis, at, through })   axis 'x'|'y'|'z'; at [a,b] in-plane",
  "boltCircle(part, { count, diameter, circleDiameter, axis, at })",
  "spurGear({ module, teeth, thickness, bore?, pressureAngle? })   involute gear",
  "gridfinityBase({ unitsX, unitsY })    standard Gridfinity base, sitting on z = 0",
  "standoffs([[x,y], ...], { diameter, height, screw? })   one post per hole",
  "filletEdges(part, r, { mode, quality })   rounds edges, keeps the outer size",
  "chamferEdges(part, r, { quality })    same rounding as filletEdges, no flat bevel",
  "bbox(part) -> { min, max, size }      volume(part) -> mm3",
].join("\n");

/**
 * The solid's own method surface.
 * @remarks Added after the live run showed the model writing `part.union(...)`:
 *   Manifold has add/subtract/intersect on the INSTANCE and union/difference/
 *   intersection only as STATICS, so that one wrong guess cost a whole round
 *   trip ("base.union is not a function"). Names verified against
 *   manifold-3d 3.5.3's manifold.d.ts. This block deliberately sits AFTER the
 *   OUTPUT section: the helper-table lockstep test parses every name-paren
 *   occurrence before it, and these are not helpers.
 */
const SOLID_METHODS = [
  "Every helper above returns a solid. A solid has exactly these chainable",
  "methods, and no others:",
  "  part.add(other)               union of two solids",
  "  part.subtract(other)          cut other out of part",
  "  part.intersect(other)         keep only the overlap",
  "  part.translate([x, y, z])     move the solid, millimetres",
  "  part.rotate([x, y, z])        rotate about each axis, in DEGREES",
  "  part.scale(v)                 v is a number (uniform) or [x, y, z]",
  "  part.mirror([x, y, z])        reflect through the plane with that normal",
  "There is NO instance .union(), .difference() or .intersection(). Those exist",
  "only as statics on M: M.union(a, b), M.difference(a, b), M.intersection(a, b)",
  "and the variadic M.union([a, b, c]). Calling part.union(other) throws",
  "\"part.union is not a function\" and wastes the whole attempt.",
].join("\n");

/**
 * Dimensions of the standards these parts are built against.
 * @remarks This is the whole reason a case or a bin can be asked for by name:
 *   the numbers are not derivable, they are quoted from the published specs, and
 *   a model that guesses them produces something that does not fit. It is
 *   rendered AFTER the OUTPUT section so the helper-table lockstep test, which
 *   parses every name-paren occurrence before it, never reads a dimension as a
 *   helper.
 */
const STANDARDS = [
  "GRIDFINITY. Compatibility is exact - a base a hundredth out does not seat in",
  "someone else's baseplate, so use these and do not round them: 42mm grid pitch;",
  "0.25mm clearance per side, so a 1x1 footprint is 41.5mm; height unit 7mm; bin",
  "corner radius 3.75mm; base profile 4.75mm tall (0.8mm 45-degree taper, 1.8mm",
  "riser, 2.15mm taper); magnet holes 6.5mm dia x 2.4mm deep and M3 screw holes",
  "3mm dia x 6mm deep, on a 26mm square inside each cell. gridfinityBase gives",
  "the base sitting on z = 0 - build the floor and walls directly on top of it.",
  "The stacking lip that lets one bin carry another is the base profile mirrored,",
  "4.75mm tall, around the top rim, and it ADDS to the nominal height.",
  "",
  "RASPBERRY PI model B (3B, 3B+, 4B, 5). Take x across the 85mm side and y across",
  "the 56mm side, with the origin at one corner of the board: board 85 x 56 x",
  "1.5mm with a 3mm corner radius. Four 2.75mm mounting holes inset 3.5mm from two",
  "edges, on a 58 x 49mm rectangle - at (3.5,3.5), (3.5,52.5), (61.5,52.5), and",
  "(61.5,3.5). Put a standoff on every one; there are four, not two. The 40-pin",
  "GPIO header is 51 x 5.1 x 8.5mm, runs along the y = 56 edge centred 32.5mm from",
  "the left, and stands 8.5mm above the board. The Ethernet socket is 21.2 x 16 x",
  "13.5mm and the micro SD card 11.5 x 12mm; both sit on an edge, so they need",
  "openings, and USB and HDMI share the opposite edge from the SD. A wall closed",
  "across any of those makes the case useless - cut them, and remember the plugs",
  "need clearance OUTSIDE the wall too, so the opening must go right through.",
  "Zero and Zero 2 W: board 65 x 30mm, same 3.5mm inset and 2.75mm holes on a",
  "58 x 23mm rectangle.",
  "",
  "ARDUINO UNO R3. Board 68.58 x 53.34mm, four 3.2mm mounting holes measured from",
  "one corner: (13.97,2.54), (15.24,50.8), (66.04,7.62), (66.04,35.56) - note they",
  "are NOT at the corners of a rectangle, so passing them straight to standoffs()",
  "is the only reliable way to get the posts right. The USB-B socket and the barrel",
  "jack are on one short edge and both need openings through the wall; the headers",
  "stand about 8.5mm above the board, so the lid needs that much clearance or a",
  "cutout over the header area.",
  "",
  "PHONES have no standard, so pick sensible numbers and state them: a modern",
  "handset is 70-80mm wide and 8-11mm thick with a case. A desk stand leans it",
  "back 60-75 degrees from horizontal, with a ledge at least 12mm tall and a slot",
  "at least 12mm wide, and it must be stable - a wide flat foot, not a thin one.",
  "If charging access matters, leave the bottom edge open rather than closed.",
].join("\n");

const OUTPUT_SHAPE = [
  "Reply with a single JSON object and nothing else:",
  '{ "code": "<function body>", "parameters": { "<name>": { "value": <number>,',
  '  "unit": "mm", "min": <number>, "max": <number>, "label": "<string>" } },',
  '  "summary": "<one-line description of what changed>" }',
].join("\n");

export const SYSTEM_PROMPT = [
  "You design manufacturable engineering parts by writing Manifold scripts.",
  "",
  "RULES",
  RULES,
  "",
  "AVAILABLE HELPERS",
  HELPER_DOCS,
  "",
  "OUTPUT",
  OUTPUT_SHAPE,
  "",
  "SOLID METHODS",
  SOLID_METHODS,
  "",
  "STANDARDS",
  STANDARDS,
  "",
  "When a previous design is supplied, treat it as the current state: return the",
  "COMPLETE updated script, preserving everything the user did not ask to change.",
].join("\n");


export interface TurnInput {
  prompt: string;
  priorDesign?: CadDesign;
  images?: { data: string; mime: string }[];
  priorSourceNote?: string;
}

/**
 * Builds the message list for one generation turn.
 * @remarks The prior document is echoed verbatim: code alone would lose the
 *   prior parameter *values*, which live outside the script (spec section 6).
 */
export function buildTurnMessages(input: TurnInput): LlmMessage[] {
  const messages: LlmMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];

  const parts: string[] = [];
  if (input.priorDesign) {
    parts.push("CURRENT DESIGN (JSON):");
    parts.push(JSON.stringify({
      code: input.priorDesign.code,
      parameters: input.priorDesign.parameters,
      summary: input.priorDesign.summary,
    }, null, 2));
    parts.push("");
  }
  if (input.priorSourceNote) {
    parts.push("REFERENCED ASSET: " + input.priorSourceNote);
    parts.push("");
  }
  parts.push("REQUEST:");
  parts.push(input.prompt);

  const text = parts.join("\n");
  if (input.images && input.images.length > 0) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text },
        ...input.images.map((i) => ({ type: "image" as const, data: i.data, mime: i.mime })),
      ],
    });
  } else {
    messages.push({ role: "user", content: text });
  }
  return messages;
}

/**
 * Gates whose failure is fully explained by another gate's failure.
 * @remarks Task 7 measured one empty mesh failing BOTH the nonempty and the
 *   volume gate. Rendering both would ask the model to fix a single cause
 *   twice, and the redundancy is dropped here rather than in the gates, which
 *   must keep reporting every gate they ran.
 */
const IMPLIED_BY: Record<string, string> = { volume: "nonempty" };

/**
 * Renders the failing gates as repair instructions, one line per cause.
 * @param gates Every gate that ran, passing or failing.
 * @returns One "- <gate>: <error>" line per distinct cause, or "" if none.
 */
function formatFailures(gates: GateResult[]): string {
  const failed = new Set(gates.filter((g) => !g.ok).map((g) => g.gate));
  const rendered = new Set<string>();
  const lines: string[] = [];

  for (const gate of gates) {
    if (gate.ok || rendered.has(gate.gate)) continue;
    const cause = IMPLIED_BY[gate.gate];
    if (cause !== undefined && failed.has(cause)) continue;
    rendered.add(gate.gate);
    lines.push("- " + gate.gate + ": " + (gate.error ?? "failed"));
  }
  return lines.join("\n");
}

/**
 * Appends a repair turn carrying the failing script and the gate errors.
 * @remarks The failing code is included so the model edits rather than
 *   re-derives, which measurably reduces repeat failures.
 */
export function buildRepairMessages(
  base: LlmMessage[],
  previous: CadDesign,
  error: string,
  gates: GateResult[],
): LlmMessage[] {
  const failures = formatFailures(gates);

  return [
    ...base,
    {
      role: "assistant",
      content: JSON.stringify({
        code: previous.code,
        parameters: previous.parameters,
        summary: previous.summary,
      }),
    },
    {
      role: "user",
      content: [
        "That script failed validation.",
        "",
        "FAILED GATES",
        failures || "- (no detail)",
        "",
        "ERROR",
        error,
        "",
        "FIX THE SCRIPT and return the complete corrected JSON object. Do not change",
        "the requested design intent, and keep every dimension in PARAMETERS.",
      ].join("\n"),
    },
  ];
}

/** Helper names the prompt documents - the guard accepts exactly these. */
export const PROMPT_HELPER_NAMES: string[] = [...PRELUDE_NAMES];
