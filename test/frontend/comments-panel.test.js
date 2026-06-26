/**
 * Comments Panel - unit tests for helpers
 */

import {
  formatRelativeTime,
  getInitials,
  isMentioned,
} from "../../frontend/src/js/ui/comments-panel.js";

describe("Comments Panel helpers", () => {
  describe("formatRelativeTime", () => {
    test("returns 'just now' for recent timestamps", () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe("just now");
    });

    test("returns minutes for recent past", () => {
      const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatRelativeTime(ts)).toBe("5m ago");
    });

    test("returns hours for recent past", () => {
      const ts = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(ts)).toBe("3h ago");
    });

    test("returns days for older timestamps", () => {
      const ts = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(ts)).toBe("2d ago");
    });
  });

  describe("getInitials", () => {
    test("returns first two hex chars uppercase", () => {
      expect(getInitials("0x3aF1…e92c")).toBe("3A");
    });

    test("strips leading 0x", () => {
      expect(getInitials("0x7B2c")).toBe("7B");
    });

    test("returns '?' for empty input", () => {
      expect(getInitials("")).toBe("?");
    });
  });

  describe("isMentioned", () => {
    test("detects mention of current wallet by truncated display", () => {
      const text = "@0x7B2c…A9B0 please review";
      expect(isMentioned(text, "0x7B2c3D4e5F6a7B8c9D0E1F2a3B4C5D6E7F8A9B0")).toBe(true);
    });

    test("returns false when not mentioned", () => {
      const text = "@0x3aF1…e92c please review";
      expect(isMentioned(text, "0x7B2c3D4e5F6a7B8c9D0E1F2a3B4C5D6E7F8A9B0")).toBe(false);
    });

    test("returns false when wallet is empty", () => {
      expect(isMentioned("@0x7B2c…11a4", "")).toBe(false);
    });
  });
});
