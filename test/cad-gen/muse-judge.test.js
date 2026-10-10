import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CATEGORIES, JUDGE_MODEL, JudgeAbort, JudgeFormatError, SCORE_PROMPT,
  buildJudgeRequest, judgeCase, parseJudgeResponse,
} from "../../scripts/lib/muse-judge.mjs";

const items = (scores) => CATEGORIES.map((c, i) => ({ category_en: c, score: scores[i], rationale: "r" + i }));
const answer = (scores, normalized = scores.reduce((a, b) => a + b, 0) / 6) =>
  JSON.stringify({ overall_score_normalized: normalized, overall_summary: "s", items: items(scores) });

describe("SCORE_PROMPT", () => {
  it("is MUSE's scoring prompt, six categories and the JSON template", () => {
    expect(SCORE_PROMPT).toContain("strict CAD (Computer-Aided Design) evaluator");
    for (const c of CATEGORIES) expect(SCORE_PROMPT).toContain(c);
    expect(SCORE_PROMPT).toContain("overall_score_normalized = sum(category scores) / 6");
  });
});

describe("buildJudgeRequest", () => {
  const body = buildJudgeRequest({
    spec: "SPEC", rubric: "RUBRIC", referencePng: Buffer.from("ref"), generatedPng: Buffer.from("gen"),
  });

  it("sends MUSE's prompt as the system instruction, at temperature 0, as JSON", () => {
    expect(body.system_instruction.parts[0].text).toBe(SCORE_PROMPT);
    expect(body.generationConfig).toEqual({ temperature: 0, responseMimeType: "application/json" });
  });

  it("interleaves task, reference image, generated image and rubric in that order", () => {
    const parts = body.contents[0].parts;
    const kinds = parts.map((p) => (p.inline_data ? "img:" + Buffer.from(p.inline_data.data, "base64").toString() : "txt"));
    expect(kinds).toEqual(["txt", "img:ref", "txt", "img:gen", "txt"]);
    expect(parts[0].text).toContain("<Task_Doc>\nSPEC");
    expect(parts[2].text).toContain("<Generated_SVG>");
    expect(parts[4].text).toContain("<Evaluation_Rubric>\nRUBRIC");
    expect(parts[1].inline_data.mime_type).toBe("image/png");
  });
});

describe("parseJudgeResponse", () => {
  it("parses a valid answer and pairs the sub-scores like the paper", () => {
    const r = parseJudgeResponse(answer([1, 1, 1, 1, 0, 1]));
    expect(r.score).toBeCloseTo(5 / 6, 9);
    // Usage Stability failed: functionality = mean(Functional Adaptation, Usage Stability).
    expect(r.subScores).toEqual({ functionality: 0.5, manufacturability: 1, assemblability: 1 });
    expect(r.mismatch).toBe(false);
  });

  it("strips code fences", () => {
    expect(parseJudgeResponse("```json\n" + answer([1, 1, 1, 1, 1, 1]) + "\n```").score).toBe(1);
  });

  it("keeps its own score and flags a judge that summed wrong", () => {
    const r = parseJudgeResponse(answer([1, 0, 0, 0, 0, 0], 0.9));
    expect(r.score).toBeCloseTo(1 / 6, 9);
    expect(r.mismatch).toBe(true);
  });

  it("rejects a missing category or a score other than 0 or 1", () => {
    const missing = JSON.parse(answer([1, 1, 1, 1, 1, 1]));
    missing.items.pop();
    expect(() => parseJudgeResponse(JSON.stringify(missing))).toThrow(JudgeFormatError);
    expect(() => parseJudgeResponse(answer([2, 1, 1, 1, 1, 1]))).toThrow(JudgeFormatError);
    expect(() => parseJudgeResponse("not json")).toThrow(JudgeFormatError);
  });
});

describe("judgeCase", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "muse-judge-"));
  const ref = path.join(dir, "ref.png");
  const gen = path.join(dir, "gen.png");
  fs.writeFileSync(ref, "ref");
  fs.writeFileSync(gen, "gen");
  const kase = { id: "cup", spec: "S", rubric: "R", referencePng: ref };
  const ok = (text) => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 4700, candidatesTokenCount: 400, thoughtsTokenCount: 1000 },
  }), { status: 200 });
  const replies = (list) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      const next = list[Math.min(calls.length - 1, list.length - 1)];
      return typeof next === "number" ? new Response("{}", { status: next }) : ok(next);
    };
    return { calls, fetchImpl };
  };
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };

  it("scores a case, sending the key as a header and never in the URL", async () => {
    const { calls, fetchImpl } = replies([answer([1, 1, 1, 1, 1, 1])]);
    const r = await judgeCase({ apiKey: "KEY", kase, generatedPngFile: gen, fetchImpl, sleep });
    expect(r.score).toBe(1);
    expect(r.model).toBe(JUDGE_MODEL);
    expect(r.usage).toEqual({ prompt: 4700, completion: 400, thoughts: 1000 });
    expect(calls[0].url).toContain("/models/" + JUDGE_MODEL + ":generateContent");
    expect(calls[0].url).not.toContain("KEY");
    expect(calls[0].init.headers["x-goog-api-key"]).toBe("KEY");
  });

  it("retries 503s with backoff, then succeeds", async () => {
    sleeps.length = 0;
    const { calls, fetchImpl } = replies([503, 503, answer([0, 0, 0, 0, 0, 0])]);
    const r = await judgeCase({ apiKey: "K", kase, generatedPngFile: gen, fetchImpl, sleep });
    expect(r.score).toBe(0);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([15000, 30000]);
  });

  it("aborts the run on 402: every later call would fail the same way", async () => {
    const { fetchImpl } = replies([402]);
    await expect(judgeCase({ apiKey: "K", kase, generatedPngFile: gen, fetchImpl, sleep })).rejects.toThrow(JudgeAbort);
  });

  it("records a judge error after a malformed answer twice - never a zero", async () => {
    const { calls, fetchImpl } = replies(["garbage"]);
    const r = await judgeCase({ apiKey: "K", kase, generatedPngFile: gen, fetchImpl, sleep });
    expect(calls).toHaveLength(2);
    expect(r.judgeError).toBeDefined();
    expect(r.score).toBeUndefined();
  });
});
