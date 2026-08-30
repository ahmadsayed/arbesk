/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

const { getPendingAnnotations, setPendingAnnotations, clearPendingAnnotations } =
  await import("../../frontend/src/js/services/asset-save/annotations.js");

describe("pending annotations store", () => {
  beforeEach(() => clearPendingAnnotations());

  test("starts null and round-trips", () => {
    expect(getPendingAnnotations()).toBeNull();
    setPendingAnnotations({ character_name: "Knight" });
    expect(getPendingAnnotations()).toEqual({ character_name: "Knight" });
    clearPendingAnnotations();
    expect(getPendingAnnotations()).toBeNull();
  });
});
