/**
 * CAD provider: design-on-the-wire lifecycle over an injected CadGenerator.
 */
import { describe, expect, it, jest } from "bun:test";
import { CadRequestUnsuitable } from "@arbesk/cad-gen";
import { createCadProvider } from "@arbesk/ai-asset-gen/index.js";

const DESIGN = {
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm" } },
  summary: "cube",
  turn: 1,
};

const RESULT = {
  design: DESIGN,
  runtime: { contractVersion: 1, preludeVersion: "2026-09-16" },
  provider: { id: "deepseek", model: "deepseek-flash" },
  attribution: [],
  diagnostics: {
    selection: { libraries: [], fit: {}, jevTokens: {} },
    attempts: [],
    durationMs: 5,
    tokens: { prompt: 1, completion: 1 },
  },
};

const CONFIG = { id: "cad", capabilities: ["text-to-3d"] };

/** A generator whose single call the test gates manually. */
function gatedGenerator() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const generate = jest.fn(async (_input) => {
    await gate;
    return RESULT;
  });
  return { generate, release };
}

async function until(predicate, what = "condition") {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(what + " never became true");
}

describe("createCadProvider", () => {
  it("runs the full lifecycle: running → success with the design in output", async () => {
    const { generate, release } = gatedGenerator();
    const onSettle = jest.fn();
    const provider = createCadProvider({ config: CONFIG, generator: { generate }, onSettle });

    const taskId = await provider.textToModel({ prompt: "a 10mm cube" });
    expect(taskId).toMatch(/^cad-/);

    const running = await provider.poll(taskId);
    expect(running.status).toBe("running");

    release();
    await until(() => onSettle.mock.calls.length === 1, "settle");
    const settled = await provider.poll(taskId);
    expect(settled.status).toBe("success");
    expect(settled.format).toBe("cad-design");
    expect(settled.output.design.code).toBe(DESIGN.code);
    expect(settled.output.provider.id).toBe("deepseek");

    const bytes = await provider.download(taskId);
    const wire = JSON.parse(new TextDecoder().decode(bytes));
    expect(wire.design).toEqual(DESIGN);
    expect(wire.runtime).toEqual(RESULT.runtime);
    expect(wire.attribution).toEqual([]);
    expect(wire.diagnostics).toEqual(RESULT.diagnostics);

    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle.mock.calls[0][0]).toBe(taskId);
    expect(onSettle.mock.calls[0][1].ok).toBe(true);
  });

  it("passes an AbortSignal to the generator and aborts it on cancel", async () => {
    const generate = jest.fn(async (input) => {
      await new Promise((resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return RESULT;
    });
    const provider = createCadProvider({ config: CONFIG, generator: { generate } });
    const taskId = await provider.textToModel({ prompt: "x" });
    expect(generate.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);

    expect(await provider.cancel(taskId)).toBe(true);
    expect(generate.mock.calls[0][0].signal.aborted).toBe(true);
    expect(await provider.cancel(taskId)).toBe(false);
    expect((await provider.poll(taskId)).status).toBe("failed");
  });

  it("maps CadRequestUnsuitable to a coded failure", async () => {
    const generate = jest.fn(async () => {
      throw new CadRequestUnsuitable("organic subject", 0.12);
    });
    const onSettle = jest.fn();
    const provider = createCadProvider({ config: CONFIG, generator: { generate }, onSettle });

    const taskId = await provider.textToModel({ prompt: "a dragon" });
    await until(() => onSettle.mock.calls.length === 1, "settle");
    const poll = await provider.poll(taskId);
    expect(poll.status).toBe("failed");
    expect(poll.output.code).toBe("CAD_REQUEST_UNSUITABLE");
    expect(poll.output.suitability).toBe(0.12);
    expect(poll.output.alternative).toEqual({ kind: "organic-mesh", provider: "tripo3d" });
    expect(onSettle.mock.calls[0][1].ok).toBe(false);
    expect(onSettle.mock.calls[0][1].error.code).toBe("CAD_REQUEST_UNSUITABLE");
  });

  it("maps a generic failure to a message-only failure", async () => {
    const generate = jest.fn(async () => { throw new Error("provider down"); });
    const onSettle = jest.fn();
    const provider = createCadProvider({ config: CONFIG, generator: { generate }, onSettle });
    const taskId = await provider.textToModel({ prompt: "x" });
    await until(() => onSettle.mock.calls.length === 1, "settle");
    const poll = await provider.poll(taskId);
    expect(poll.status).toBe("failed");
    expect(poll.error).toBe("provider down");
    expect(poll.output.code).toBeUndefined();
  });

  it("reports failed for an unknown taskId", async () => {
    const provider = createCadProvider({ config: CONFIG, generator: { generate: jest.fn() } });
    expect((await provider.poll("cad-missing")).status).toBe("failed");
    await expect(provider.download("cad-missing")).rejects.toThrow("unknown task");
  });

  it("gates undeclared capabilities", async () => {
    const provider = createCadProvider({ config: CONFIG, generator: { generate: jest.fn() } });
    expect(() => provider.retexture({ prompt: "x", source: { kind: "buffer", buffer: new Uint8Array(), mime: "model/gltf-binary" } }))
      .toThrow(/text-to-3d|retexture|capability/i);
    expect(() => provider.uploadSource({ kind: "buffer", buffer: new Uint8Array(), mime: "model/gltf-binary" }))
      .toThrow("cad provider has no source upload");
  });
});
