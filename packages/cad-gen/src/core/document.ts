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
 * Collects identifiers that are *called* in the script, so static gates can
 * reject calls to prelude helpers that do not exist.
 * @remarks Deliberately lexical rather than a full parse: the gate only needs
 *   candidate names, and the kernel run is the real arbiter.
 */
export function referencedIdentifiers(code: string): Set<string> {
  const names = new Set<string>();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) names.add(m[1]);
  return names;
}
