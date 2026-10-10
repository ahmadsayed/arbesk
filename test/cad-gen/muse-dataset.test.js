import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MUSE_REVISION, fetchMuse, loadCases, museUrl, parseSpec } from "../../scripts/lib/muse.mjs";

const spec = ({ method = "3D Printing", material = "PLA", qty = "1" } = {}) => [
  "# Design Specification", "", "## Design Goal", "A cup.", "",
  "## Material", material, "", "## Manufacturing Method", method, "",
  ...(qty === null ? [] : ["## Planned Component Quantity", qty, ""]),
  "## Component Names", "- cup",
].join("\n");

describe("parseSpec", () => {
  it("maps each manufacturing method spelling", () => {
    expect(parseSpec(spec({ method: "3D Printing" })).method).toBe("print");
    expect(parseSpec(spec({ method: "FDM 3D Printing" })).method).toBe("print");
    expect(parseSpec(spec({ method: "CNC Milling" })).method).toBe("cnc");
    expect(parseSpec(spec({ method: "Laser Cutting" })).method).toBe("laser");
    expect(parseSpec(spec({ method: "Hand carving" })).method).toBe("other");
  });

  it("reads the material, the raw method and the component count", () => {
    expect(parseSpec(spec({ method: "CNC Milling", material: "Timber", qty: "9" })))
      .toEqual({ method: "cnc", methodRaw: "CNC Milling", material: "Timber", components: 9 });
  });

  it("gives null components when the section is missing", () => {
    expect(parseSpec(spec({ qty: null })).components).toBeNull();
  });
});

describe("museUrl", () => {
  it("embeds the pinned revision", () => {
    expect(museUrl("cases/a/b.md"))
      .toBe("https://huggingface.co/datasets/dongxiaoyu/MUSE/resolve/" + MUSE_REVISION + "/cases/a/b.md");
  });
});

/** A dataset directory with the given case ids, every file present. */
function fixture(ids) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-"));
  const rows = ids.map((id) => ({
    case_id: id,
    design_description: `cases/${id}/design_description.md`,
    svg_png: `cases/${id}/${id}.png`,
    evaluation_rubric: `cases/${id}/evaluation_rubric.md`,
  }));
  fs.writeFileSync(path.join(root, "metadata.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  for (const id of ids) {
    const dir = path.join(root, "cases", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "design_description.md"), spec({ method: "CNC Milling", qty: "5" }));
    fs.writeFileSync(path.join(dir, "evaluation_rubric.md"), "rubric " + id);
    fs.writeFileSync(path.join(dir, id + ".png"), "png");
  }
  return root;
}

describe("loadCases", () => {
  it("returns cases in metadata order with their strata", () => {
    const root = fixture(["stool", "chair"]);
    const cases = loadCases(root);
    expect(cases.map((c) => c.id)).toEqual(["stool", "chair"]);
    expect(cases[0].rubric).toBe("rubric stool");
    expect(cases[0].strata).toEqual({ method: "cnc", material: "PLA", components: 5 });
    expect(cases[0].referencePng).toBe(path.join(root, "cases", "stool", "stool.png"));
  });

  it("fails at load, naming the missing file", () => {
    const root = fixture(["stool"]);
    const missing = path.join(root, "cases", "stool", "evaluation_rubric.md");
    fs.rmSync(missing);
    expect(() => loadCases(root)).toThrow(missing);
  });
});

describe("fetchMuse", () => {
  const meta = JSON.stringify({
    case_id: "cup", design_description: "cases/cup/design_description.md",
    svg_png: "cases/cup/cup.png", evaluation_rubric: "cases/cup/evaluation_rubric.md",
  }) + "\n";
  const stub = (status = 200) => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (status !== 200) return new Response("no", { status });
      return new Response(url.endsWith("metadata.jsonl") ? meta : "x", { status: 200 });
    };
    return { urls, fetchImpl };
  };

  it("downloads metadata and every case file, then skips what is on disk", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-fetch-"));
    const first = stub();
    await fetchMuse(root, { fetchImpl: first.fetchImpl });
    expect(first.urls).toHaveLength(4);
    expect(fs.existsSync(path.join(root, "cases", "cup", "cup.png"))).toBe(true);
    const second = stub();
    await fetchMuse(root, { fetchImpl: second.fetchImpl });
    expect(second.urls).toHaveLength(0);
  });

  it("throws naming the URL on a non-200", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-fetch-"));
    await expect(fetchMuse(root, { fetchImpl: stub(404).fetchImpl })).rejects.toThrow(museUrl("metadata.jsonl"));
  });
});
