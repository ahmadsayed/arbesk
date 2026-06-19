/**
 * glTF worker pool fallback tests
 *
 * Verifies that the workerpool-based pool reports itself unavailable when
 * Web Workers are not present (e.g. Node/Jest), so callers fall back to the
 * main-thread implementations.
 */

import {
  getGlTFWorkerPool,
  isWorkerPoolAvailable,
  terminateGlTFWorkerPool,
} from "../../frontend/src/js/workers/gltf-worker-pool.js";

describe("gltf-worker-pool", () => {
  afterEach(() => {
    terminateGlTFWorkerPool();
  });

  test("returns false (not throwing) when Worker is undefined", async () => {
    expect(typeof Worker).toBe("undefined");
    await expect(isWorkerPoolAvailable()).resolves.toBe(false);
  });

  test("getGlTFWorkerPool exposes a workerpool Pool with exec()", () => {
    const pool = getGlTFWorkerPool();
    expect(pool).toBeDefined();
    expect(typeof pool.exec).toBe("function");
    expect(typeof pool.terminate).toBe("function");
  });
});
