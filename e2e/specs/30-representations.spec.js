/**
 * Asset representations survive a Studio save (spec R3,
 * docs/superpowers/specs/2026-11-10-asset-representations-design.md): an
 * asset version written outside the Studio (as `besk attach` does) carries a
 * `representations` list; opening it in the Studio, editing and saving must
 * keep the list in the next version — and the G-code derived from the model
 * becomes stale once the edit changes the model's source.
 */
import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { addToIpfs, fetchManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  editFirstNodeColor,
  ensureStudioConnected,
  generate,
  saveDraft,
} from "../helpers/flows.mjs";

test.describe("asset representations", () => {
  test("a Studio save keeps the representations a besk attach added", async ({ page }) => {
    await connectStudio(page);

    // 1. Generate → Show in Studio auto-saves v2.
    const autoSaveCid = await generate(page, "cowboy");
    const v2 = await fetchManifest(autoSaveCid);
    const modelCid = v2.scene.nodes[0].source.cid;

    // 2. Outside the Studio: attach a G-code derived from the model and a
    // source file, writing v3 the way besk does (version + 1, prev link).
    const gcodeCid = await addToIpfs("G28\nG1 Z0.2\n", "part.gcode");
    const blendCid = await addToIpfs(new Uint8Array([66, 76, 69, 78, 68]), "part.blend");
    const representations = [
      {
        id: "gcode-mk4-petg", role: "machine", format: "gcode", name: "part.gcode",
        cid: gcodeCid, bytes: 12, encoding: "raw",
        derived_from: { ref: "primary", cid: modelCid },
        profile: { printer: "MK4", material: "PETG" }, created_at: 1,
      },
      {
        id: "source", role: "source", format: "blend", name: "part.blend",
        cid: blendCid, bytes: 5, encoding: "raw", created_at: 1,
      },
    ];
    const v3Cid = await addToIpfs(
      JSON.stringify({
        ...v2,
        version: 3,
        prev_asset_manifest_cid: autoSaveCid,
        timestamp: Date.now(),
        representations,
      }),
      "manifest.json",
    );

    // 3. Open v3 in the Studio, change the model's colour and save (v4).
    await page.goto(`/studio?manifest=${v3Cid}`);
    await ensureStudioConnected(page);
    // The chain walk v3 → v2 → v1 puts the timeline on the opened version.
    await expect(page.locator(SELECTORS.vtActiveTick)).toHaveText("3");
    await editFirstNodeColor(page, "#ff0000");
    const v4Cid = await saveDraft(page, v3Cid);

    // 4. The saved version keeps the list unchanged; the colour bake gave the
    // model a new source CID, so the G-code is now stale (computed by clients).
    const v4 = await fetchManifest(v4Cid);
    expect(v4.version).toBe(4);
    expect(v4.prev_asset_manifest_cid).toBe(v3Cid);
    expect(v4.representations).toEqual(representations);
    expect(v4.scene.nodes[0].source.cid).not.toBe(modelCid);
  });
});
