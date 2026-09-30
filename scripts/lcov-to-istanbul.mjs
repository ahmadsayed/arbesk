// @ts-nocheck
/**
 * Merges per-process Bun lcov fragments into one Istanbul coverage map.
 *
 * @remarks Bun's coverage reporters are text and lcov only, but the coverage
 *   tooling here speaks Istanbul (scripts/merge-all-coverage.mjs,
 *   `fallow health --coverage coverage/js/coverage-final.json`). No installed
 *   package converts lcov to Istanbul, so this does the minimal mapping Bun's
 *   output supports: one statement per instrumented line (DA records). Bun
 *   emits no branch (BRDA) or named function (FN) records, so those maps stay
 *   empty. Counts from different processes add up per line.
 */
import fs from "node:fs";
import path from "node:path";
import libCoverage from "istanbul-lib-coverage";

const { createCoverageMap } = libCoverage;

/**
 * Parses one lcov file into { absolutePath: Map<line, hits> }.
 * @param {string} file lcov.info path.
 * @param {string} root Directory relative SF: paths resolve against.
 */
function parseLcov(file, root) {
  const result = new Map();
  let current = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("SF:")) {
      const source = path.resolve(root, line.slice(3));
      current = result.get(source) ?? new Map();
      result.set(source, current);
    } else if (line.startsWith("DA:") && current) {
      const [lineNo, hits] = line.slice(3).split(",").map(Number);
      current.set(lineNo, (current.get(lineNo) ?? 0) + hits);
    } else if (line === "end_of_record") {
      current = null;
    }
  }
  return result;
}

/**
 * Builds an Istanbul coverage map from every lcov.info under `fragmentsDir`.
 * @param {string} fragmentsDir Directory holding one sub-directory per process.
 * @param {string} root Repository root (lcov SF: paths are relative to it).
 * @param {(file: string) => boolean} include Keeps a source file when true.
 */
export function lcovFragmentsToCoverageMap(fragmentsDir, root, include) {
  const lines = new Map();
  const fragments = fs.existsSync(fragmentsDir) ? fs.readdirSync(fragmentsDir) : [];
  for (const name of fragments) {
    const file = path.join(fragmentsDir, name, "lcov.info");
    if (!fs.existsSync(file)) continue;
    for (const [source, hits] of parseLcov(file, root)) {
      if (!include(source)) continue;
      const merged = lines.get(source) ?? new Map();
      for (const [lineNo, count] of hits) merged.set(lineNo, (merged.get(lineNo) ?? 0) + count);
      lines.set(source, merged);
    }
  }

  const map = createCoverageMap();
  for (const [source, hits] of lines) {
    const statementMap = {};
    const s = {};
    [...hits.keys()].sort((a, b) => a - b).forEach((lineNo, i) => {
      statementMap[i] = { start: { line: lineNo, column: 0 }, end: { line: lineNo, column: Number.MAX_SAFE_INTEGER } };
      s[i] = hits.get(lineNo);
    });
    map.addFileCoverage({ path: source, statementMap, fnMap: {}, branchMap: {}, s, f: {}, b: {} });
  }
  return map;
}
