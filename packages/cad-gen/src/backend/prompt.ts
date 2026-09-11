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
  "filletEdges defaults to mode \"auto\", which is the opening described above, and",
  "mode \"minkowski\" is that same opening. mode \"smooth\" is appearance-only and",
  "NOT dimension-preserving: it moves the surface outward and changes the part's",
  "size and volume, so never use it for a part whose dimensions matter.",
].join("\n");

/** Helper reference the model is prompted against. */
const HELPER_DOCS = [
  "box(w, d, h)                          centred box, mm",
  "cylinder(r, h, opts?)                 Z-aligned cylinder, opts.segments",
  "sphere(r, opts?)",
  "rect(w, d) / circle(r, opts?)         2D profiles",
  "roundRect(w, d, r)                    rounded 2D profile (r clamped)",
  "extrude(profile, h, opts?)            profile to solid",
  "revolve(profile, opts?)               profile revolved about Z",
  "roundedBox(w, d, h, r)                EXACT prismatic fillet",
  "hole(part, { diameter, axis, at, through })   axis 'x'|'y'|'z'; at [a,b] in-plane",
  "boltCircle(part, { count, diameter, circleDiameter, axis, at })",
  "filletEdges(part, r, { mode })        rounds edges, keeps the outer size",
  "chamferEdges(part, r)                 same rounding as filletEdges, no flat bevel",
  "bbox(part) -> { min, max, size }      volume(part) -> mm3",
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
