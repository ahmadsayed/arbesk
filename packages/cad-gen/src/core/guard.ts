/**
 * Static guard for model-written scripts, run on both server and client. A
 * deny-list plus a helper allow-list, not a sandbox: the worker boundary is.
 */
import { referencedIdentifiers, stripNonCode } from "./document.ts";

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
  // Globals require a member access, so a bare word (e.g. in prose) is not denied.
  { pattern: /\bprocess\s*\??\s*[.[]/, label: "process" },
  { pattern: /\bglobalThis\s*\??\s*[.[]/, label: "globalThis" },
  { pattern: /\bglobal\s*\??\s*[.[]/, label: "global" },
  { pattern: /\bself\s*\??\s*[.[]/, label: "self" },
  { pattern: /\bwindow\s*\??\s*[.[]/, label: "window" },
  { pattern: /\bdocument\s*\??\s*[.[]/, label: "document" },
  { pattern: /\bfetch\s*\(/, label: "fetch" },
  { pattern: /\bXMLHttpRequest\b/, label: "XMLHttpRequest" },
  { pattern: /\bchild_process\b/, label: "child_process" },
  { pattern: /\bWebAssembly\s*\??\s*[.[]/, label: "WebAssembly" },
  { pattern: /\bconstructor\s*\.\s*constructor\b/, label: "constructor escape" },
  { pattern: /__proto__/, label: "__proto__" },
  { pattern: /\bwhile\s*\(\s*true\s*\)/, label: "unbounded loop" },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, label: "unbounded loop" },
];

/** Keywords followed by parentheses, which the call scan would otherwise report as helpers. */
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

/** Identifiers may contain `$`, which is special in a RegExp. */
function escapeIdentifier(value: string): string {
  return value.replace(/[^\w]/g, "\\$&");
}

export function guardScript(code: string, preludeNames: Iterable<string>): GuardResult {
  if (typeof code !== "string" || code.trim().length === 0) {
    return { ok: false, reason: "EMPTY_CODE" };
  }

  // Scan with comments and strings blanked: prose cannot execute.
  const source = stripNonCode(code);

  for (const { pattern, label } of DENIED) {
    if (pattern.test(source)) {
      return { ok: false, reason: "DENIED_CONSTRUCT", detail: label };
    }
  }

  if (!/\breturn\b/.test(source)) {
    return { ok: false, reason: "NO_RETURN", detail: "script must return a Manifold" };
  }

  const allowed = new Set<string>([...preludeNames, ...ALLOWED_GLOBALS, "PARAMETERS", "P", "M"]);
  for (const name of referencedIdentifiers(source)) {
    if (KEYWORDS.has(name)) continue;
    if (allowed.has(name)) continue;
    // Locally declared functions and variables are the script's own business.
    const declared = new RegExp("\\b(?:const|let|var|function)\\s+" + escapeIdentifier(name) + "\\b").test(source);
    if (declared) continue;
    // Method calls (xs.map(...)) are not bare prelude calls.
    const bare = new RegExp("(?:^|[^\\w.$])" + escapeIdentifier(name) + "\\s*\\(").test(source);
    if (!bare) continue;
    return { ok: false, reason: "UNKNOWN_HELPER", detail: name };
  }

  return { ok: true };
}
