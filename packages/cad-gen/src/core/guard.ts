/**
 * Static guard for model-written scripts.
 * @remarks Runs on BOTH hosts: the server gates before spawning a child, and the
 *   client gates before executing in its worker — the client must never trust
 *   that the server ran it. This is a deny-list plus a helper allow-list, not a
 *   sandbox; the process/worker boundary is the sandbox.
 */
import { referencedIdentifiers } from "./document.ts";

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

/** Constructs that can reach outside the kernel. */
const DENIED: { pattern: RegExp; label: string }[] = [
  { pattern: /\bimport\s*\(/, label: "dynamic import" },
  { pattern: /\bimport\b[^;]*\bfrom\b/, label: "static import" },
  { pattern: /\brequire\s*\(/, label: "require" },
  { pattern: /\beval\s*\(/, label: "eval" },
  { pattern: /\bnew\s+Function\b/, label: "Function constructor" },
  { pattern: /\bFunction\s*\(/, label: "Function constructor" },
  { pattern: /\bprocess\b/, label: "process" },
  { pattern: /\bglobalThis\b/, label: "globalThis" },
  { pattern: /\bglobal\b/, label: "global" },
  { pattern: /\bself\b/, label: "self" },
  { pattern: /\bwindow\b/, label: "window" },
  { pattern: /\bdocument\b/, label: "document" },
  { pattern: /\bfetch\s*\(/, label: "fetch" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bchild_process\b/, label: "child_process" },
  { pattern: /\bWebAssembly\b/, label: "WebAssembly" },
  { pattern: /\bconstructor\s*\.\s*constructor\b/, label: "constructor escape" },
  { pattern: /__proto__/, label: "__proto__" },
  { pattern: /\bwhile\s*\(\s*true\s*\)/, label: "unbounded loop" },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, label: "unbounded loop" },
];

/**
 * JS syntax keywords that are followed by a parenthesised expression.
 * @remarks Without this, the lexical scan below reports `if` and `for` as
 *   unknown helpers and rejects perfectly valid scripts - verified with the
 *   controller before Task 4 shipped.
 */
const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "try",
  "catch", "finally", "throw", "return", "typeof", "instanceof", "new",
  "delete", "void", "in", "of", "function", "await", "yield", "class",
  "super", "this", "with",
]);

/** Globals the kernel host legitimately provides. */
const ALLOWED_GLOBALS = new Set([
  "Math", "Number", "Array", "Object", "String", "Boolean", "JSON",
  "Map", "Set", "Symbol", "Error", "TypeError", "RangeError",
  "isFinite", "isNaN", "parseFloat", "parseInt", "console",
]);

/**
 * Validates a script before it is handed to the kernel.
 * @param code Script body (the inside of a function).
 * @param preludeNames Helper names the host will inject.
 */
export function guardScript(code: string, preludeNames: Iterable<string>): GuardResult {
  if (typeof code !== "string" || code.trim().length === 0) {
    return { ok: false, reason: "EMPTY_CODE" };
  }

  for (const { pattern, label } of DENIED) {
    if (pattern.test(code)) {
      return { ok: false, reason: "DENIED_CONSTRUCT", detail: label };
    }
  }

  if (!/\breturn\b/.test(code)) {
    return { ok: false, reason: "NO_RETURN", detail: "script must return a Manifold" };
  }

  const allowed = new Set<string>([...preludeNames, ...ALLOWED_GLOBALS, "PARAMETERS", "P", "M"]);
  for (const name of referencedIdentifiers(code)) {
    if (KEYWORDS.has(name)) continue;
    if (allowed.has(name)) continue;
    // Locally declared functions and variables are the script's own business.
    const declared = new RegExp("\\b(?:const|let|var|function)\\s+" + name + "\\b").test(code);
    if (declared) continue;
    // Method calls (xs.map(...)) are not bare prelude calls.
    const bare = new RegExp("(?:^|[^\\w.$])" + name + "\\s*\\(").test(code);
    if (!bare) continue;
    return { ok: false, reason: "UNKNOWN_HELPER", detail: name };
  }

  return { ok: true };
}
