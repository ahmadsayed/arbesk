/** The design document: parse, validate and inspect it. */
import type {
  CadColorParameter, CadDesign, CadLengthParameter, CadParameter, CadParameterMap,
} from "../types.ts";
import { CadDesignError } from "../errors.ts";

const MAX_CODE_BYTES = 64 * 1024;
const MAX_PARAMETERS = 40;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isColorParameter(p: CadParameter): p is CadColorParameter {
  return p.type === "color";
}

/** A colour entry: a #rrggbb value and an optional label, nothing else. */
function parseColorParameter(name: string, p: Record<string, unknown>): CadColorParameter {
  if (typeof p.value !== "string" || !HEX_COLOR.test(p.value)) {
    throw new CadDesignError("parameter " + name + " must be a #rrggbb colour");
  }
  for (const key of ["unit", "min", "max"]) {
    if (key in p) throw new CadDesignError("parameter " + name + " is a colour and takes no " + key);
  }
  return {
    type: "color",
    value: p.value.toLowerCase(),
    ...(typeof p.label === "string" ? { label: p.label } : {}),
  };
}

function parseParameter(name: string, p: unknown): CadParameter {
  if (!isPlainObject(p)) throw new CadDesignError("parameter " + name + " is not an object");
  if (p.type === "color") return parseColorParameter(name, p);
  if (p.type !== undefined && p.type !== "length") {
    throw new CadDesignError("parameter " + name + " has an unknown type");
  }
  return parseLengthParameter(name, p);
}

/** A millimetre dimension; the output never carries `type`. */
function parseLengthParameter(name: string, p: Record<string, unknown>): CadLengthParameter {
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

/** The override names that are undeclared or the wrong kind; empty when all are valid. */
export function validateParameterOverrides(
  design: CadDesign,
  overrides: Record<string, number | string>,
): string[] {
  return Object.keys(overrides).filter((name) => {
    if (!Object.prototype.hasOwnProperty.call(design.parameters, name)) return true;
    const expected = isColorParameter(design.parameters[name]) ? "string" : "number";
    return typeof overrides[name] !== expected;
  });
}

/**
 * Index of the closing quote, or -1. Only template literals span lines, so a
 * newline means the opener was an apostrophe in prose.
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

interface NonCodeSpan {
  from: number;
  to: number;
}

const QUOTES = ["\"", "'", "`"];

function lineCommentSpan(code: string, i: number): NonCodeSpan {
  const end = code.indexOf("\n", i);
  return { from: i, to: end === -1 ? code.length : end };
}

/** Null when never closed. */
function blockCommentSpan(code: string, i: number): NonCodeSpan | null {
  const end = code.indexOf("*/", i + 2);
  return end === -1 ? null : { from: i, to: end + 2 };
}

/** Null when never closed. */
function stringSpan(code: string, i: number): NonCodeSpan | null {
  const end = stringEnd(code, i);
  return end === -1 ? null : { from: i, to: end + 1 };
}

/** Fails closed: an unterminated comment or string stays visible to the scanners. */
function nonCodeSpanAt(code: string, i: number): NonCodeSpan | null {
  if (code.startsWith("//", i)) return lineCommentSpan(code, i);
  if (code.startsWith("/*", i)) return blockCommentSpan(code, i);
  return QUOTES.includes(code[i]) ? stringSpan(code, i) : null;
}

function blank(out: string[], span: NonCodeSpan): void {
  for (let k = span.from; k < span.to; k++) {
    if (out[k] !== "\n") out[k] = " ";
  }
}

/**
 * Blanks comments and string literals, preserving offsets and line breaks, so
 * prose cannot trip the lexical scans.
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

/** Identifiers called in the script. Lexical on purpose: the kernel run is the real arbiter. */
export function referencedIdentifiers(code: string): Set<string> {
  const names = new Set<string>();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  const source = stripNonCode(code);
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.add(m[1]);
  return names;
}

export interface UsedParameters {
  names: string[];
  /** PARAMETERS/P read by a computed key or passed around whole. */
  dynamic: boolean;
}

const PARAMETER_ROOT = /(?<![\w$.]\s*)\b(?:P|PARAMETERS)\b/g;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The keys of a `{ a, b: alias, c = 1 } =` pattern ending right before `at`, or null. */
function destructuredKeys(source: string, at: number): string[] | null {
  const m = /\{([^{}]*)\}\s*=\s*$/.exec(source.slice(0, at));
  if (!m) return null;
  const keys = m[1].split(",").map((e) => e.split(/[:=]/)[0].trim()).filter(Boolean);
  return keys.every((k) => IDENTIFIER.test(k)) ? keys : null;
}

/** `source` is the blanked script; `code` the original, for bracket-key literals. */
function namesAt(source: string, code: string, at: number, end: number): string[] | null {
  const dot = /^\s*\.\s*([A-Za-z_$][\w$]*)/.exec(source.slice(end));
  if (dot) return [dot[1]];
  const bracket = /^\s*\[\s*(["'])([A-Za-z_$][\w$]*)\1\s*\]/.exec(code.slice(end));
  if (bracket) return [bracket[2]];
  return destructuredKeys(source, at);
}

/**
 * The parameters a script reads, in first-read order. Any read that cannot be
 * named sets `dynamic`, and the caller then treats every parameter as used.
 */
export function usedParameterNames(code: string): UsedParameters {
  const source = stripNonCode(code);
  const names = new Set<string>();
  let dynamic = false;
  for (const m of source.matchAll(PARAMETER_ROOT)) {
    const found = namesAt(source, code, m.index, m.index + m[0].length);
    if (found) found.forEach((n) => names.add(n));
    else dynamic = true;
  }
  return { names: [...names], dynamic };
}
