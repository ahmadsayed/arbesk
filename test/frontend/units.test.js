import { describe, expect, test } from "bun:test";
import {
  readUnits,
  formatDimensions,
  formatCountCompact,
} from "../../frontend/src/js/utils/units.js";

const D = { width: 1.846, height: 0.62, depth: 0.5499, unit: "meters" };
const DMM = { width: 85, height: 54, depth: 12.4, unit: "mm" };

describe("readUnits", () => {
  test("defaults to m and rejects junk", () => {
    expect(readUnits(null)).toBe("m");
    expect(readUnits({})).toBe("m");
    expect(readUnits({ units: "furlongs" })).toBe("m");
  });
  test("accepts m/cm/mm", () => {
    expect(readUnits({ units: "mm" })).toBe("mm");
    expect(readUnits({ units: "cm" })).toBe("cm");
    expect(readUnits({ units: "m" })).toBe("m");
  });
});

describe("formatDimensions", () => {
  test("meters stay meters at 2 decimals, trailing zeros stripped", () => {
    expect(formatDimensions(D, "m")).toBe("1.85 × 0.62 × 0.55 m");
  });
  test("converts meters to cm and mm", () => {
    expect(formatDimensions(D, "cm")).toBe("184.6 × 62 × 55 cm");
    expect(formatDimensions(D, "mm")).toBe("1846 × 620 × 550 mm");
  });
  test("mm-stored input (CAD) converts from mm", () => {
    expect(formatDimensions(DMM, "mm")).toBe("85 × 54 × 12 mm");
    expect(formatDimensions(DMM, "cm")).toBe("8.5 × 5.4 × 1.2 cm");
  });
  test("missing values dash out", () => {
    expect(formatDimensions({ width: 1 }, "m")).toBe("—");
  });
});

describe("formatCountCompact", () => {
  test("small counts are plain, thousands are k-compact", () => {
    expect(formatCountCompact(990)).toBe("990");
    expect(formatCountCompact(12400)).toBe("12.4k");
    expect(formatCountCompact(1000000)).toBe("1000k");
  });
});
