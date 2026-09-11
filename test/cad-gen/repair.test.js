import { parseDesign } from "@arbesk/cad-gen";
import { generateWithRepair } from "@arbesk/cad-gen/backend/repair.js";
import { buildRepairMessages } from "@arbesk/cad-gen/backend/prompt.js";
import { ProviderError } from "@arbesk/cad-gen/backend/deepseek.js";

const VALID_TEXT = JSON.stringify({
  code: "return box(P.s, P.s, P.s);",
  parameters: { s: { value: 10, unit: "mm", min: 1, max: 100 } },
  summary: "a 10mm cube",
});

const BASE = [{ role: "user", content: "a 10mm cube" }];

// A client stub that records every message list it is handed.
function stubClient(replies) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async complete(messages) {
      calls.push(messages);
      const text = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return { text, usage: { prompt: 50, completion: 10 } };
    },
  };
}

const deps = (client, validate) => ({ client, parseDesign, buildRepairMessages, validate });

describe("generateWithRepair with a throwing validator", () => {
  it("records the throw as a failed attempt and repairs it", async () => {
    let seen = 0;
    const validate = async () => {
      seen += 1;
      if (seen === 1) throw new Error("kernel host exploded");
      return { ok: true, gates: [{ gate: "kernel", ok: true }], stats: { triangles: 12 } };
    };
    const client = stubClient([VALID_TEXT]);

    const outcome = await generateWithRepair(deps(client, validate), BASE, 3);

    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts[0]).toMatchObject({ index: 0, ok: false, error: "kernel host exploded" });
    expect(outcome.attempts[0].gates[0]).toMatchObject({
      gate: "validator", ok: false, error: "kernel host exploded",
    });
    expect(outcome.attempts[1]).toMatchObject({ index: 1, ok: true });
    expect(outcome.design.code).toContain("box(P.s");
    expect(outcome.tokens).toEqual({ prompt: 100, completion: 20 });

    // The throw was fed back as a repair turn, like any other failure.
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].length).toBeGreaterThan(client.calls[0].length);
    expect(JSON.stringify(client.calls[1])).toContain("kernel host exploded");
  });

  it("throws CadGenerationFailed with one record per attempt when it always throws", async () => {
    const client = stubClient([VALID_TEXT]);
    const validate = async () => { throw new Error("boom"); };

    const failed = generateWithRepair(deps(client, validate), BASE, 2);
    await expect(failed).rejects.toMatchObject({
      name: "CadGenerationFailed",
      diagnostics: {
        attempts: [{ index: 0, ok: false }, { index: 1, ok: false }],
        tokens: { prompt: 100, completion: 20 },
      },
    });
  });

  it("reports a whole-loop duration on the failure diagnostics", async () => {
    const client = stubClient([VALID_TEXT]);
    const validate = async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { ok: false, gates: [{ gate: "kernel", ok: false, error: "bad" }], error: "bad" };
    };

    const err = await generateWithRepair(deps(client, validate), BASE, 3).catch((e) => e);

    expect(err.name).toBe("CadGenerationFailed");
    expect("durationMs" in err.diagnostics).toBe(true);
    expect(Number.isFinite(err.diagnostics.durationMs)).toBe(true);
    expect(err.diagnostics.durationMs).toBeGreaterThanOrEqual(0);
    // Three 120ms attempts: the value covers the whole loop, not just the last one.
    expect(err.diagnostics.durationMs).toBeGreaterThanOrEqual(300);
    // ...and coexists with the diagnostics Task 12 already reads.
    expect(err.diagnostics.attempts).toHaveLength(3);
    expect(err.diagnostics.tokens).toEqual({ prompt: 150, completion: 30 });
  });

  it("survives a validator that throws a non-Error", async () => {
    const client = stubClient([VALID_TEXT]);
    const validate = async () => { throw "plain string fault"; };

    await expect(generateWithRepair(deps(client, validate), BASE, 1)).rejects.toMatchObject({
      name: "CadGenerationFailed",
      diagnostics: { attempts: [{ index: 0, ok: false, error: "plain string fault" }] },
    });
  });

  it("lets a provider failure propagate instead of recording an attempt", async () => {
    const client = {
      complete: async () => {
        throw new ProviderError("deepseek 429: slow down", 429, "PROVIDER_RATE_LIMITED");
      },
    };
    const validate = async () => ({ ok: true, gates: [] });

    await expect(generateWithRepair(deps(client, validate), BASE, 3)).rejects.toMatchObject({
      name: "ProviderError",
      code: "PROVIDER_RATE_LIMITED",
      status: 429,
    });
  });
});
