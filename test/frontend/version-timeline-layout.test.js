/**
 * Version time strip helpers: gap weights between saves, grouping versions
 * into local calendar days, and the save-time label. Pure — no DOM.
 */

import { expect, test } from "bun:test";
import {
  gapWeights,
  savedLabel,
  splitDays,
} from "../../frontend/src/js/ui/version-timeline-layout.js";

// Local-time constructors keep these independent of the runner's time zone.
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = new Date(2026, 10, 15, 20, 3); // Sun 15 Nov 2026 20:03

test("gap weight grows with the log of the minutes between saves", () => {
  expect(
    gapWeights([at(2026, 11, 14, 10, 0), at(2026, 11, 14, 10, 5), at(2026, 11, 14, 13, 5)])
  ).toEqual([0, 1.792, 5.198]);
});

test("unusable or out-of-order timestamps get the minimum gap", () => {
  expect(
    gapWeights([at(2026, 11, 14, 10, 0), undefined, at(2026, 11, 14, 11, 0)])
  ).toEqual([0, 0, 0]);
  expect(gapWeights([at(2026, 11, 14, 10, 0), "nope"])).toEqual([0, 0]);
  expect(gapWeights([at(2026, 11, 14, 11, 0), at(2026, 11, 14, 10, 0)])).toEqual([0, 0]);
  expect(gapWeights([])).toEqual([]);
});

test("ISO strings count the same as epoch milliseconds", () => {
  const iso = (ms) => new Date(ms).toISOString();
  expect(
    gapWeights([iso(at(2026, 11, 14, 10, 0)), iso(at(2026, 11, 14, 10, 5))])
  ).toEqual([0, 1.792]);
});

test("versions split into runs per local day, labelled relative to now", () => {
  const ts = [
    at(2026, 11, 13, 21, 10),
    at(2026, 11, 13, 21, 40),
    at(2026, 11, 14, 10, 5),
    at(2026, 11, 15, 19, 20),
    at(2026, 11, 15, 20, 1),
  ];
  expect(splitDays(ts, NOW)).toEqual([
    { label: "Fri 13 Nov", start: 0, end: 2 },
    { label: "Yesterday", start: 2, end: 3 },
    { label: "Today", start: 3, end: 5 },
  ]);
});

test("two minutes across midnight are two days", () => {
  expect(
    splitDays([at(2026, 11, 14, 23, 59), at(2026, 11, 15, 0, 1)], NOW).map((d) => d.label)
  ).toEqual(["Yesterday", "Today"]);
});

test("another year shows the year; a future day is never Today", () => {
  expect(splitDays([at(2025, 12, 31, 23, 0)], NOW)[0].label).toBe("Wed 31 Dec 2025");
  expect(splitDays([at(2026, 11, 16, 8, 0)], NOW)[0].label).toBe("Mon 16 Nov");
});

test("undated versions never start a day", () => {
  expect(
    splitDays(
      [at(2026, 11, 14, 10, 0), undefined, at(2026, 11, 14, 11, 0), undefined, at(2026, 11, 15, 9, 0)],
      NOW
    )
  ).toEqual([
    { label: "Yesterday", start: 0, end: 4 },
    { label: "Today", start: 4, end: 5 },
  ]);
  expect(splitDays([undefined, at(2026, 11, 15, 9, 0)], NOW)).toEqual([
    { label: "Today", start: 0, end: 2 },
  ]);
  expect(splitDays([undefined, null, "nope"], NOW)).toEqual([
    { label: "", start: 0, end: 3 },
  ]);
  expect(splitDays([], NOW)).toEqual([]);
});

test("savedLabel is the day label plus zero-padded local time", () => {
  expect(savedLabel(at(2026, 11, 15, 9, 5), NOW)).toBe("Today 09:05");
  expect(savedLabel(at(2026, 11, 14, 16, 45), NOW)).toBe("Yesterday 16:45");
  expect(savedLabel(at(2026, 11, 13, 21, 40), NOW)).toBe("Fri 13 Nov 21:40");
  expect(savedLabel(undefined, NOW)).toBe("");
});
