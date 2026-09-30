/**
 * glTF worker pool fallback tests
 *
 * Verifies that the workerpool-based pool reports itself unavailable when
 * Web Workers are not present (e.g. Node/Jest), so callers fall back to the
 * main-thread implementations.
 */

import { afterEach, describe, expect, test } from "bun:test";
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
    // Bun defines a global Worker (Jest's node environment did not); remove it
    // for this case so the pool sees a Worker-less runtime.
    const savedWorker = globalThis.Worker;
    delete globalThis.Worker;
    try {
      expect(typeof Worker).toBe("undefined");
      await expect(isWorkerPoolAvailable()).resolves.toBe(false);
    } finally {
      globalThis.Worker = savedWorker;
    }
  });

  test("getGlTFWorkerPool exposes a workerpool Pool with exec()", () => {
    const pool = getGlTFWorkerPool();
    expect(pool).toBeDefined();
    expect(typeof pool.exec).toBe("function");
    expect(typeof pool.terminate).toBe("function");
  });
});
