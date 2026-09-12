import fs from "node:fs";
import path from "node:path";
import {
  ATTRIBUTED_HELPERS, attributionsFor,
} from "@arbesk/cad-gen/core/attribution.js";
import { PRELUDE_NAMES } from "@arbesk/cad-gen/core/prelude.js";

describe("attributionsFor", () => {
  it("owes a credit when the script calls a ported helper", () => {
    const owed = attributionsFor("return phoneStand({ width: 60 });");
    expect(owed).toHaveLength(1);
    expect(owed[0].helper).toBe("phoneStand");
    expect(owed[0].work).toBe("SmartPhoneHolder");
    expect(owed[0].author).toBe("DrLex");
    expect(owed[0].licence).toBe("CC-BY");
  });

  // The link is the whole point of the field: a credit a user cannot follow is
  // not a credit. Asserted structurally rather than by exact URL so a moved
  // upstream repo does not break the contract, only the value.
  it("carries a link to the original", () => {
    const owed = attributionsFor("return phoneStand({});");
    expect(owed[0].url).toMatch(/^https:\/\//);
    expect(owed[0].url).toContain("DrLex0");
  });

  it("owes nothing when the script calls no ported helper", () => {
    expect(attributionsFor("const b = box(10, 10, 10);\nreturn spurGear({ module: 2, teeth: 20, thickness: 5 });")).toEqual([]);
    expect(attributionsFor("return gridfinityBase({ unitsX: 1, unitsY: 1 });")).toEqual([]);
  });

  it("cannot be over-claimed: mentioning the name in a comment earns nothing", () => {
    const code = "// a phoneStand would go here, but this is a plain box\nreturn box(10, 10, 10);";
    expect(attributionsFor(code)).toEqual([]);
  });

  it("is stable across runs", () => {
    const code = "return phoneStand({ width: 60 });";
    expect(attributionsFor(code)).toEqual(attributionsFor(code));
  });
});

// A credit that can be orphaned silently is a credit that will be. These two
// checks are the lockstep pair for this table, in the spirit of the prompt/
// prelude test: the first stops an entry pointing at a helper that no longer
// exists, the second stops an entry that cannot actually credit anyone.
describe("ATTRIBUTED_HELPERS", () => {
  const entries = Object.entries(ATTRIBUTED_HELPERS);

  it("names only helpers the prelude injects", () => {
    for (const [name, entry] of entries) {
      expect(PRELUDE_NAMES).toContain(name);
      expect(entry.helper).toBe(name);
    }
  });

  it("credits completely, with a URL", () => {
    // Reported as a list of what is missing per helper, so a failure names the
    // entry rather than just the field.
    const gaps = entries.map(([name, entry]) => ({
      helper: name,
      missing: [
        entry.work ? null : "work",
        entry.author ? null : "author",
        entry.licence ? null : "licence",
        /^https:\/\//.test(entry.url ?? "") ? null : "url",
      ].filter(Boolean),
    })).filter((g) => g.missing.length > 0);
    expect(gaps).toEqual([]);
  });

  // "Referenced in the code": someone reading the ported helper must be able to
  // see whose work it is without going hunting for this table.
  it("is referenced from the helper's own source", () => {
    const prelude = fs.readFileSync(
      path.join(import.meta.dirname, "../../packages/cad-gen/src/core/prelude.ts"), "utf8");
    for (const [name, entry] of entries) {
      const at = prelude.indexOf(name + ": (");
      const doc = at > -1 ? prelude.slice(Math.max(0, at - 2000), at) : "";
      expect({
        helper: name,
        defined: at > -1,
        namesAuthor: doc.includes(entry.author),
        namesLicence: doc.includes(entry.licence),
        pointsAtTable: doc.includes("ATTRIBUTED_HELPERS"),
      }).toEqual({
        helper: name, defined: true, namesAuthor: true, namesLicence: true, pointsAtTable: true,
      });
    }
  });
});
