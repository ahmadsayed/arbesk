// @test-env dom
import { describe, expect, test } from "bun:test";
import { renderCadDesignInWorker } from "../../frontend/src/js/services/cad-render.ts";

function mockWorker(impl) {
  return class {
    static instances = [];
    onmessage = null;
    onerror = null;
    terminated = false;
    constructor(url, opts) { this.url = url; this.opts = opts; this.constructor.instances.push(this); queueMicrotask(() => impl(this)); }
    postMessage(msg) { this.lastMessage = msg; }
    terminate() { this.terminated = true; }
  };
}

const DESIGN = { code: "return box(P.width, P.depth, P.height);", parameters: {}, summary: "box" };

describe("renderCadDesignInWorker", () => {
  test("spawns a module worker at /js/workers/cad-worker.js and resolves bytes", async () => {
    const Fake = mockWorker((w) => {
      expect(w.url).toContain("/js/workers/cad-worker.js?v=1");
      expect(w.opts).toEqual({ type: "module" });
      w.onmessage({ data: { type: "ok", bytes: new Uint8Array([1, 2, 3]), summary: "box", stats: { tris: 12 } } });
    });
    const orig = globalThis.Worker;
    globalThis.Worker = Fake;
    try {
      const out = await renderCadDesignInWorker(DESIGN, { preludeVersion: "x" }, { timeoutMs: 5000 });
      expect(out.bytes).toEqual(new Uint8Array([1, 2, 3]));
      expect(out.summary).toBe("box");
      expect(Fake.instances[0].lastMessage.type).toBe("render");
      expect(Fake.instances[0].lastMessage.design).toBe(DESIGN);
      expect(Fake.instances[0].terminated).toBe(true);
    } finally {
      globalThis.Worker = orig;
    }
  });

  test("rejects with the worker's error code and terminates", async () => {
    const Fake = mockWorker((w) => w.onmessage({ data: { type: "error", code: "CAD_GUARD_REJECTED", message: "nope" } }));
    const orig = globalThis.Worker;
    globalThis.Worker = Fake;
    try {
      await expect(renderCadDesignInWorker(DESIGN, {}, { timeoutMs: 5000 }))
        .rejects.toMatchObject({ code: "CAD_GUARD_REJECTED", message: "nope" });
    } finally {
      globalThis.Worker = orig;
    }
  });

  test("times out with CAD_RENDER_TIMEOUT and terminates the worker", async () => {
    const Fake = mockWorker(() => { /* never responds */ });
    const orig = globalThis.Worker;
    globalThis.Worker = Fake;
    try {
      await expect(renderCadDesignInWorker(DESIGN, {}, { timeoutMs: 20 }))
        .rejects.toMatchObject({ code: "CAD_RENDER_TIMEOUT" });
      expect(Fake.instances[0].terminated).toBe(true);
    } finally {
      globalThis.Worker = orig;
    }
  });
});
