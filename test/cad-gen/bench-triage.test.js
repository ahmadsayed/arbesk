import { describe, expect, it } from "bun:test";
import {
  FAILURE_CAUSES, needsTriage, questionsFor, readTriage, triage, triageState,
} from "../../scripts/lib/bench-triage.mjs";

const base = {
  id: "00000007", prompt: "Create a cube of 50 mm.", variant: "measured",
  groundTruth: { Width_mm: 0.5, Height_mm: 0.5, Depth_mm: 0.5, Volume_cubic_mm: 0.125, Is_Solid: true },
  design: { code: "return cube(50)", parameters: { side: { value: 50 } }, summary: "a cube" },
  diagnostics: { attempts: [{ index: 0, ok: false, gates: [{ gate: "guard", ok: false, error: "fs denied" }] }] },
  clientFailures: [], error: null, stats: null,
  metrics: { chamfer: 1.732, hausdorff: 1.732, iogt: 0, iou: 0 },
};
const built = {
  ...base, outcome: "built",
  stats: { triangles: 12, volumeMm3: 250000, bboxMm: { min: [0, 0, 0], max: [100, 50, 50] }, bodies: { count: 1, boxes: [] } },
  metrics: { chamfer: 0.2, hausdorff: 0.5, iogt: 0.6, iou: 0.4 },
};
const gateFailed = {
  ...base, outcome: "gate_failed", error: "connected: 2 bodies",
  clientFailures: [{ gate: "connected", error: "connected: 2 bodies" }],
};

describe("needsTriage", () => {
  it("triages every failure and low-IoU builds; IoGT stands in when IoU is null", () => {
    expect(needsTriage(gateFailed)).toBe(true);
    expect(needsTriage(built)).toBe(true);
    expect(needsTriage({ ...built, metrics: { ...built.metrics, iou: 0.9 } })).toBe(false);
    expect(needsTriage({ ...built, metrics: { ...built.metrics, iou: null, iogt: 0.95 } })).toBe(false);
  });
});

describe("triageState", () => {
  it("puts ground truth in mm, generated size and volume ratio, and every round", () => {
    const s = /** @type {any} */ (triageState(built));
    expect(s.ground_truth_mm).toEqual({ width: 50, height: 50, depth: 50, volume_mm3: 125000, is_solid: true });
    expect(s.generated).toEqual({ size_mm: [100, 50, 50], volume_ratio_to_ground_truth: 2, bodies: 1, triangles: 12 });
    expect(s.rounds).toEqual([{ stage: "server", error: "guard: fs denied" }]);
    expect(s.code_excerpt).toBe("return cube(50)");
  });

  it("says when sizes are not comparable (abstract prompts give none)", () => {
    expect(/** @type {any} */ (triageState({ ...built, variant: "abstract" })).scale_note).toContain("proportions");
  });
});

describe("questionsFor", () => {
  it("asks failure_cause, gate_false_positive and prompt_fixable for a gate failure", () => {
    expect(Object.keys(questionsFor(gateFailed)).sort()).toEqual(["failure_cause", "gate_false_positive", "prompt_fixable"]);
    expect(/** @type {any} */ (questionsFor(gateFailed)).failure_cause.criteria).toEqual(FAILURE_CAUSES);
  });

  it("asks shape_mismatch and prompt_fixable for a low-scoring build", () => {
    expect(Object.keys(questionsFor(built)).sort()).toEqual(["prompt_fixable", "shape_mismatch"]);
  });
});

describe("readTriage", () => {
  it("reads labels, flags low confidence as unsure, and reads usage", () => {
    const t = readTriage({
      answers: {
        failure_cause: { type: "choice", choice: "helper_misuse", confidence: 0.55 },
        gate_false_positive: { type: "noul", noul: 0.2 },
        prompt_fixable: { type: "noul", noul: 0.8 },
      },
      usage: { input_tokens: 900, output_tokens: 0 },
    });
    expect(t).toEqual({
      failureCause: { label: "helper_misuse", confidence: 0.55, unsure: true },
      gateFalsePositive: 0.2, promptFixable: 0.8, usage: { prompt: 900, completion: 0 },
    });
  });
});

describe("triage", () => {
  it("posts state and questions to Jev and reads the answer", async () => {
    /** @type {any} */
    let sent;
    const fetchImpl = async (/** @type {string} */ _url, /** @type {any} */ init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({
        answers: { shape_mismatch: { choice: "orientation", confidence: 0.9 }, prompt_fixable: { noul: 0.3 } },
        usage: { input_tokens: 10, output_tokens: 0 },
      }));
    };
    const t = await triage({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, built);
    expect(Object.keys(sent.questions).sort()).toEqual(["prompt_fixable", "shape_mismatch"]);
    expect(sent.state.prompt_sent).toBe("Create a cube of 50 mm.");
    expect(t).toMatchObject({ shapeMismatch: { label: "orientation", unsure: false }, promptFixable: 0.3 });
  });

  it("returns an error record instead of throwing", async () => {
    const fetchImpl = async () => new Response("nope", { status: 401 });
    const t = await triage({ apiKey: "k", fetchImpl: /** @type {any} */ (fetchImpl) }, built);
    expect(t).toEqual({ error: expect.stringContaining("401") });
  });
});
