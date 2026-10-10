/**
 * Run-directory plumbing shared by the benchmark CLIs.
 * @remarks Moved out of scripts/cad-bench.mjs so scripts/muse-bench.mjs uses the
 *   same pool, run#N numbering and atomic writes instead of a copy.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Runs fn over items with at most `concurrency` in flight.
 * @remarks The kernel runs synchronously in process, so concurrency overlaps
 *   provider latency rather than geometry - which is where the time is: measured,
 *   raising concurrency from 1 to 12 took 20 identical prompts from 63 s to 13 s.
 * @template T
 * @param {T[]} items @param {number} concurrency
 * @param {(item: T) => Promise<void>} fn @param {() => boolean} shouldStop
 */
export async function pool(items, concurrency, fn, shouldStop) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/**
 * Creates the next free run#N directory, like cad-eval's attempt#N.
 * @param {string} root
 * @returns {string}
 */
export function nextRunDir(root) {
  fs.mkdirSync(root, { recursive: true });
  const taken = new Set(fs.readdirSync(root));
  let n = 1;
  while (taken.has("run#" + n)) n++;
  const dir = path.join(root, "run#" + n);
  fs.mkdirSync(dir);
  return dir;
}

/**
 * Writes JSON via a temp file and rename, so an interrupted run never leaves a
 * half-written result that --resume would then skip.
 * @param {string} file @param {unknown} value
 */
export function writeJsonAtomic(file, value) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** @param {string} file @returns {any} */
export const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
