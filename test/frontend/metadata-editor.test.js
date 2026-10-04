// @test-env dom

import { beforeEach, describe, expect, test } from "bun:test";
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

const { assetStore, _resetForTesting } = await import(
  "@arbesk/asset-core/domain/asset-store.js"
);
const { initMetadataEditor } = await import(
  "../../frontend/src/js/ui/metadata-editor.js"
);

const FIXTURE = `
  <section id="metadataSection" hidden></section>
  <dl id="metadataComputedList"></dl>
  <input id="metaLicence" />
  <input id="metaMaterial" />
  <select id="metaUnits">
    <option value="m">meters</option>
    <option value="cm">centimetres</option>
    <option value="mm">millimetres</option>
  </select>
  <textarea id="metaPrintNotes"></textarea>
  <input id="metaSource" />
  <div id="metadataAnnotationsList"></div>
  <button id="metadataAddBtn"></button>`;

describe("Print & Provenance typed fields", () => {
  beforeEach(() => {
    _resetForTesting();
    clearPendingAnnotations();
    document.body.innerHTML = FIXTURE;
  });

  test("typed fields seed from annotations; foreign keys stay free-form", () => {
    assetStore.set({
      activeAssetManifestCid: "bafyX",
      currentManifest: {
        metadata: {
          annotations: {
            licence: "CC0",
            material: "PLA",
            units: "mm",
            print_notes: "brim",
            source: "https://example.com",
            custom_key: "kept",
          },
        },
      },
    });
    initMetadataEditor();
    expect(document.getElementById("metaLicence").value).toBe("CC0");
    expect(document.getElementById("metaUnits").value).toBe("mm");
    expect(document.getElementById("metaPrintNotes").value).toBe("brim");
    expect(
      [...document.querySelectorAll("#metadataAnnotationsList .metadata-kv-key")]
        .map((i) => i.value)
    ).toEqual(["custom_key"]);
  });

  test("typing a typed field writes the annotation; clearing deletes it", () => {
    assetStore.set({
      activeAssetManifestCid: "bafyX",
      currentManifest: { metadata: { annotations: {} } },
    });
    initMetadataEditor();
    const lic = document.getElementById("metaLicence");
    lic.value = "CC-BY-4.0";
    lic.dispatchEvent(new Event("input"));
    expect(getPendingAnnotations().licence).toBe("CC-BY-4.0");
    lic.value = "";
    lic.dispatchEvent(new Event("input"));
    expect(getPendingAnnotations().licence).toBeUndefined();
  });

  test("dimensions render unit-aware from the units annotation", () => {
    assetStore.set({
      activeAssetManifestCid: "bafyX",
      currentManifest: {
        metadata: {
          computed: {
            format: "gltf",
            dimensions: { width: 0.085, height: 0.054, depth: 0.012, unit: "meters" },
          },
          annotations: { units: "mm" },
        },
      },
    });
    initMetadataEditor();
    expect(document.getElementById("metadataComputedList").textContent)
      .toContain("85 × 54 × 12 mm");
  });
});
