import { describe, expect, test } from "bun:test";
import { identiconSvg } from "../../frontend/src/js/utils/identicon.js";

const A = "0x1234567890abcdef1234567890abcdef12345678";
const B = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

function cells(svg) {
  return [...svg.matchAll(/<rect x="(\d)" y="(\d)"/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

describe("identiconSvg", () => {
  test("is deterministic and case-insensitive", () => {
    expect(identiconSvg(A)).toBe(
      identiconSvg(A.toUpperCase().replace("0X", "0x"))
    );
  });

  test("differs between addresses", () => {
    expect(identiconSvg(A)).not.toBe(identiconSvg(B));
  });

  test("is mirrored left-right on a 5x5 grid", () => {
    const set = new Set(cells(identiconSvg(A)).map(([x, y]) => `${x},${y}`));
    for (const key of set) {
      const [x, y] = key.split(",").map(Number);
      expect(set.has(`${4 - x},${y}`)).toBe(true);
    }
  });

  test("rejects non-addresses", () => {
    expect(identiconSvg("")).toBe("");
    expect(identiconSvg("hello")).toBe("");
    expect(identiconSvg("0x123")).toBe("");
  });

  test("is decorative (aria-hidden) and sized", () => {
    const svg = identiconSvg(A, 28);
    expect(svg).toMatch(/aria-hidden="true"/);
    expect(svg).toMatch(/width="28" height="28"/);
  });
});
