/**
 * The design document: parse, validate and inspect it.
 * @remarks Environment-agnostic — no Node or browser globals.
 */
import type { CadDesign, CadParameter, CadParameterMap } from "../types.ts";
import { CadDesignError } from "../errors.ts";

const MAX_CODE_BYTES = 64 * 1024;
const MAX_PARAMETERS = 40;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates one entry of a design's PARAMETERS block.
 * @throws CadDesignError when the entry is not a millimetre-valued dimension.
 */
function parseParameter(name: string, p: unknown): CadParameter {
  if (!isPlainObject(p)) throw new CadDesignError("parameter " + name + " is not an object");
  if (typeof p.value !== "number" || !Number.isFinite(p.value)) {
    throw new CadDesignError("parameter " + name + " has a non-finite value");
  }
  if (p.unit !== "mm") {
    throw new CadDesignError("parameter " + name + ' must declare unit "mm"');
  }
  return {
    value: p.value,
    unit: "mm",
    ...(typeof p.min === "number" ? { min: p.min } : {}),
    ...(typeof p.max === "number" ? { max: p.max } : {}),
    ...(typeof p.label === "string" ? { label: p.label } : {}),
  };
}

/**
 * Parses and validates a design document received from the model.
 * @throws CadDesignError when the document is unusable.
 */
export function parseDesign(input: unknown): CadDesign {
  if (!isPlainObject(input)) {
    throw new CadDesignError("design document must be an object");
  }

  const code = input.code;
  if (typeof code !== "string" || code.trim().length === 0) {
    throw new CadDesignError("design document has no code");
  }
  if (code.length > MAX_CODE_BYTES) {
    throw new CadDesignError("design document code exceeds " + MAX_CODE_BYTES + " bytes");
  }

  const raw = input.parameters;
  if (!isPlainObject(raw)) {
    throw new CadDesignError("design document has no parameters object");
  }
  const names = Object.keys(raw);
  if (names.length === 0) {
    throw new CadDesignError("design document needs at least one parameter");
  }
  if (names.length > MAX_PARAMETERS) {
    throw new CadDesignError("design document exceeds " + MAX_PARAMETERS + " parameters");
  }

  const parameters: CadParameterMap = {};
  for (const name of names) parameters[name] = parseParameter(name, raw[name]);

  const summary = typeof input.summary === "string" ? input.summary : "";
  const turn = typeof input.turn === "number" && input.turn > 0 ? input.turn : 1;

  return { code, parameters, summary, turn };
}

/**
 * Checks numeric overrides against a design's declared parameters.
 * @returns the names that are NOT declared (empty when all are valid).
 */
export function validateParameterOverrides(
  design: CadDesign,
  overrides: Record<string, number>,
): string[] {
  return Object.keys(overrides).filter(
    (name) => !Object.prototype.hasOwnProperty.call(design.parameters, name),
  );
}

/**
 * Index of the quote closing the literal opened at `start`, or -1 when there
 * is none.
 * @remarks Template literals may span lines; the other two may not, so a
 *   newline before a closing quote means the opener was an apostrophe in
 *   prose, not a string.
 */
function stringEnd(code: string, start: number): number {
  const quote = code[start];
  for (let i = start + 1; i < code.length; i++) {
    if (code[i] === "\\") { i++; continue; }
    if (code[i] === quote) return i;
    if (quote !== "`" && code[i] === "\n") return -1;
  }
  return -1;
}

/** A half-open [from, to) span of source that is not code. */
interface NonCodeSpan {
  from: number;
  to: number;
}

/** Quote characters that open a string literal. */
const QUOTES = ["\"", "'", "`"];

/** The span of a line comment, which runs to the end of the line. */
function lineCommentSpan(code: string, i: number): NonCodeSpan {
  const end = code.indexOf("\n", i);
  return { from: i, to: end === -1 ? code.length : end };
}

/** The span of a block comment, or null when it is never closed. */
function blockCommentSpan(code: string, i: number): NonCodeSpan | null {
  const end = code.indexOf("*/", i + 2);
  return end === -1 ? null : { from: i, to: end + 2 };
}

/** The span of a string literal, or null when it is never closed. */
function stringSpan(code: string, i: number): NonCodeSpan | null {
  const end = stringEnd(code, i);
  return end === -1 ? null : { from: i, to: end + 1 };
}

/**
 * The non-code span opening at `i`, or null when `i` is ordinary code.
 * @remarks Every helper here fails closed: an unterminated block comment or
 *   string returns null, so its remainder stays visible to the scanners rather
 *   than being hidden behind a missing terminator.
 */
function nonCodeSpanAt(code: string, i: number): NonCodeSpan | null {
  if (code.startsWith("//", i)) return lineCommentSpan(code, i);
  if (code.startsWith("/*", i)) return blockCommentSpan(code, i);
  return QUOTES.includes(code[i]) ? stringSpan(code, i) : null;
}

/** Overwrites a span with spaces, leaving line breaks in place. */
function blank(out: string[], span: NonCodeSpan): void {
  for (let k = span.from; k < span.to; k++) {
    if (out[k] !== "\n") out[k] = " ";
  }
}

/**
 * Blanks out comments and string literals, preserving every length and line
 * break.
 * @remarks Every lexical scan in this package is looking for *code*, and prose
 *   cannot execute. Without this, `// hole through the vertical leg (normal =
 *   X)` reads as a call to a helper named `leg`, and the guard rejects a valid
 *   script. Measured against the live model: it diagnosed the false positive
 *   and repaired it by deleting its own comments, so the artifact we ship lost
 *   its documentation. Length is preserved so offsets and line breaks still
 *   line up.
 */
export function stripNonCode(code: string): string {
  const out = code.split("");
  let i = 0;

  while (i < code.length) {
    const span = nonCodeSpanAt(code, i);
    if (span === null) {
      i++;
      continue;
    }
    blank(out, span);
    i = span.to;
  }

  return out.join("");
}

/**
 * Collects identifiers that are *called* in the script, so static gates can
 * reject calls to prelude helpers that do not exist.
 * @remarks Deliberately lexical rather than a full parse: the gate only needs
 *   candidate names, and the kernel run is the real arbiter. Comments and
 *   string literals are blanked first - they are not code.
 */
export function referencedIdentifiers(code: string): Set<string> {
  const names = new Set<string>();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  const source = stripNonCode(code);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.add(m[1]);
  return names;
}
