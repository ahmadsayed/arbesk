import { describe, expect, it } from "bun:test";
import { CATALOG, CATALOG_IDS, catalogEntries, entriesUsedBy } from "@arbesk/cad-gen/backend/catalog.js";
import { buildSystemPrompt, SYSTEM_PROMPT } from "@arbesk/cad-gen/backend/prompt.js";
import { PRELUDE_NAMES } from "@arbesk/cad-gen/core/prelude.js";

/** The AVAILABLE HELPERS table of a prompt, as the model receives it. */
const helperTable = (prompt) =>
  prompt.slice(prompt.indexOf("AVAILABLE HELPERS"), prompt.indexOf("\nOUTPUT\n"));

/** Names that open a row of the helper table (same rule as prompt.test.js). */
const rowNames = (table) => new Set(
  [...table.matchAll(/(?:^[ \t]*|\/\s*|\s{2,})([a-zA-Z_$][\w$]*)\s*\(/gm)].map((m) => m[1]),
);

// The catalog is what makes the prompt selectable, so its partition of the
// prelude has to be exact: a helper in no entry and not core is never
// documented, and a helper in two entries is documented twice or not at all
// depending on what the selector picked.
describe("CATALOG", () => {
  it("has unique ids", () => {
    expect(new Set(CATALOG_IDS).size).toBe(CATALOG_IDS.length);
  });

  it("names only helpers the prelude injects, each in at most one entry", () => {
    const seen = new Map();
    for (const entry of CATALOG) {
      for (const h of entry.helpers) {
        expect(PRELUDE_NAMES).toContain(h);
        expect({ helper: h, alsoIn: seen.get(h) }).toEqual({ helper: h, alsoIn: undefined });
        seen.set(h, entry.id);
      }
    }
  });

  it("documents each entry's helpers in its own rows, and only those", () => {
    for (const entry of CATALOG) {
      const documented = rowNames(entry.helperRows.join("\n"));
      expect({ id: entry.id, rows: [...documented].sort() })
        .toEqual({ id: entry.id, rows: [...entry.helpers].sort() });
    }
  });

  it("gives every entry a one-line summary and some guidance", () => {
    for (const entry of CATALOG) {
      expect(entry.summary).toMatch(/^[^\n]{10,140}$/);
      expect(entry.guidance.length).toBeGreaterThan(0);
    }
  });
});

describe("buildSystemPrompt", () => {
  const libraryHelpers = CATALOG.flatMap((e) => e.helpers);

  it("documents no library helper when nothing is selected", () => {
    const documented = rowNames(helperTable(buildSystemPrompt([])));
    expect(libraryHelpers.filter((h) => documented.has(h))).toEqual([]);
  });

  it("documents every core helper whatever is selected", () => {
    const core = PRELUDE_NAMES.filter((h) => !libraryHelpers.includes(h));
    const documented = rowNames(helperTable(buildSystemPrompt([])));
    expect(core.filter((h) => !documented.has(h))).toEqual([]);
  });

  it("adds exactly the selected entry's rows and guidance", () => {
    const prompt = buildSystemPrompt(["hinge"]);
    const documented = rowNames(helperTable(prompt));
    expect(documented.has("printInPlaceHinge")).toBe(true);
    expect(documented.has("boardCase")).toBe(false);
    expect(prompt).toContain("A hinge is ALWAYS printInPlaceHinge");
    expect(prompt).not.toContain("RASPBERRY PI model B");
  });

  it("is the full prompt when every entry is selected", () => {
    expect(buildSystemPrompt(CATALOG_IDS)).toBe(SYSTEM_PROMPT);
  });
});

describe("catalog lookups", () => {
  it("ignores unknown ids and keeps catalog order", () => {
    expect(catalogEntries(["fasteners", "nope", "hinge"]).map((e) => e.id))
      .toEqual(["hinge", "fasteners"]);
  });

  it("maps referenced helpers back to their entries", () => {
    expect(entriesUsedBy(new Set(["box", "knuckleHinge", "spurGear"]))).toEqual(["hinge", "gear"]);
  });
});
