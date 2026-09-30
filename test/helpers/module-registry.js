/**
 * Stand-in for jest.resetModules().
 *
 * @remarks Bun's module registry is shared between require() and import(), and
 *   deleting an entry from require.cache evicts the module for both. Evicting
 *   every loaded module except the test harness itself (files under test/)
 *   makes the next import re-evaluate the whole graph against the mocks
 *   registered at that moment, which is what Jest's resetModules() did. Mocks
 *   registered with mock.module() are unaffected, as in Jest.
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const TEST_DIR = path.resolve(import.meta.dir, "..") + path.sep;

/** Forget every loaded non-test module so the next import re-evaluates it. */
export function resetModules() {
  for (const key of Object.keys(require.cache)) {
    if (!key.startsWith(TEST_DIR)) delete require.cache[key];
  }
}
