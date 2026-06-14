import { test, expect } from "@playwright/test";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { fetchTokenManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateSaveAndPublish,
  editFirstNodeColor,
  tokenIdHexFromUrl,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = "Cowboy Republish";
const EDIT_COLOR = "#00aa55";

test.describe("republish existing token", () => {
  test("editing a published asset updates its tokenURI without a new mint", async ({
    page,
  }) => {
    await connectStudio(page);

    // ── Reach a published token (proven generate → save → publish path) ──
    const tokenIdHex = await generateSaveAndPublish(page, ASSET_NAME, PROMPT);

    const firstManifest = await fetchTokenManifest(tokenIdHex);
    expect(firstManifest.name).toBe(ASSET_NAME);
    const firstVersion = firstManifest.version;
    expect(firstVersion).toBeGreaterThanOrEqual(1);

    // ── Edit the published asset (a real change so the save isn't a no-op) ──
    await editFirstNodeColor(page, EDIT_COLOR);

    // ── Republish: "Besk it" on an already-named token updates the tokenURI
    //    (no name dialog, no new mint — the ?asset token id stays the same). ──
    await page.click(SELECTORS.publishAssetBtn);

    // Durable signal: the on-chain tokenURI now resolves to a newer version.
    // expect.poll retries on a thrown error, so no fetch fallback is needed.
    await expect
      .poll(async () => (await fetchTokenManifest(tokenIdHex)).version, {
        timeout: 30000,
        intervals: [500, 1000, 1000],
      })
      .toBeGreaterThan(firstVersion);

    // Same token, same name — just a newer manifest version pinned to it.
    const republished = await fetchTokenManifest(tokenIdHex);
    expect(republished.name).toBe(ASSET_NAME);
    expect(republished.version).toBeGreaterThan(firstVersion);

    // URL still anchors to the same token (no remint).
    expect(BigInt(tokenIdHexFromUrl(page.url()))).toBe(BigInt(tokenIdHex));
  });
});
