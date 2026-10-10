import { describe, expect, test } from "bun:test";

const { decideFollowup } = await import("../../frontend/src/js/ui/followup-route.js");

const ALL = ["retexture", "retopo", "auto-rig", "animate"];

function reading(action, confidence, extra = {}) {
  return { action, confidence, probabilities: { [action]: confidence }, animations: [], inPlace: true, ...extra };
}

describe("decideFollowup", () => {
  test("no reading keeps the old route: retexture", () => {
    expect(decideFollowup(null, ALL)).toEqual({ kind: "retexture" });
  });

  test("a confident retexture runs; an unsure one asks", () => {
    expect(decideFollowup(reading("retexture", 0.95), ALL)).toEqual({ kind: "retexture" });
    expect(decideFollowup(reading("retexture", 0.7), ALL).kind).toBe("ask");
  });

  test("dialog actions open at the lower bar", () => {
    expect(decideFollowup(reading("retopo", 0.65), ALL)).toEqual({ kind: "retopo" });
    expect(decideFollowup(reading("auto-rig", 0.9), ALL)).toEqual({ kind: "auto-rig" });
    expect(decideFollowup(reading("retopo", 0.55), ALL).kind).toBe("ask");
  });

  test("animate carries the motions and in-place flag", () => {
    const plan = decideFollowup(reading("animate", 1, { animations: ["preset:run"], inPlace: false }), ALL);
    expect(plan).toEqual({ kind: "animate", animations: ["preset:run"], inPlace: false });
  });

  test("a shape change offers a new model", () => {
    expect(decideFollowup(reading("new_model", 0.92), ALL)).toEqual({ kind: "new-model" });
  });

  test("an unavailable action asks among the available ones", () => {
    const plan = decideFollowup(reading("retopo", 1), ["animate"]);
    expect(plan).toEqual({ kind: "ask", options: ["animate", "new-model"], animations: [], inPlace: true });
  });

  test("a confident 'unclear' offers every option", () => {
    expect(decideFollowup(reading("unclear", 0.99), ALL))
      .toEqual({ kind: "ask", options: [...ALL, "new-model"], animations: [], inPlace: true });
  });

  test("ask offers the two likeliest options, best first", () => {
    const intent = {
      action: "retexture", confidence: 0.4, animations: [], inPlace: true,
      probabilities: { retexture: 0.3, animate: 0.25, new_model: 0.35, unclear: 0.1 },
    };
    expect(decideFollowup(intent, ALL))
      .toEqual({ kind: "ask", options: ["new-model", "retexture"], animations: [], inPlace: true });
  });

  test("ask carries Jev's motions, for when the user picks Animate", () => {
    const intent = {
      action: "animate", confidence: 0.5, animations: ["preset:biped:dance_01"], inPlace: false,
      probabilities: { animate: 0.5, retexture: 0.3 },
    };
    expect(decideFollowup(intent, ALL)).toEqual({
      kind: "ask", options: ["animate", "retexture"], animations: ["preset:biped:dance_01"], inPlace: false,
    });
  });
});
