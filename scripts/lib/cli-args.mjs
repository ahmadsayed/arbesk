/**
 * Minimal flag-parser skeleton shared by the bench harnesses (cad-bench,
 * cad-bench-fn, muse-bench). Each script keeps its own flags and validation;
 * this is only the argv walk, value consumption and the common validators.
 */

/**
 * Walks argv, dispatching each flag to its handler.
 * @param {string[]} argv Arguments after the script path.
 * @param {Record<string, (value: () => string) => void>} handlers One handler
 *   per flag. A handler calls value() to consume the flag's argument (never
 *   for a boolean switch); value() may be called more than once.
 */
export function parseFlags(argv, handlers) {
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const handler = handlers[flag];
    if (!handler) throw new Error("unknown argument " + flag);
    let consumed = 0;
    const value = () => {
      const v = argv[i + ++consumed];
      if (v === undefined) throw new Error(flag + " needs a value");
      return v;
    };
    handler(value);
    i += consumed;
  }
}

/**
 * @param {string} flag The flag being parsed (for the error message).
 * @param {string} raw The flag's argument.
 * @returns {number} A positive integer.
 */
export function positiveInt(flag, raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(flag + " must be a positive integer, got " + raw);
  return n;
}

/**
 * @param {string} raw Comma-separated list argument.
 * @returns {string[]} Trimmed, non-empty entries.
 */
export function commaList(raw) {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
