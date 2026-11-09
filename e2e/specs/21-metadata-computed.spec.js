import { test, expect } from "../fixtures/coverage.mjs";
import {
  MANIFEST_URL_REGEX,
  fetchManifest,
  manifestCidFromUrl,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateToChatBubble,
  openInspector,
  saveDraft,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "cowboy";

test.describe("asset metadata", () => {
  test("save bakes computed metadata and typed fields persist across reopens", async ({
    page,
  }) => {
    await connectStudio(page);

    // Generate → Show in Studio (auto-saves the draft and bakes metadata).
    const send = await generateToChatBubble(page, PROMPT);
    await send.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);
    const saveCid = manifestCidFromUrl(page.url());
    expect(saveCid).toBeTruthy();

    // The saved manifest carries deterministic computed facts for the glTF root.
    const saved = await fetchManifest(saveCid);
    expect(saved.metadata?.computed).toBeTruthy();
    expect(saved.metadata.computed.format).toBe("gltf");

    // Cold reopen: boot re-reads ?manifest= and the metadata survives.
    await page.reload();
    await page.waitForURL(MANIFEST_URL_REGEX);
    expect(manifestCidFromUrl(page.url())).toBe(saveCid);

    // ── Typed metadata fields persist across save and reopen ──────────
    await openInspector(page);
    await page.locator(SELECTORS.metaLicence).fill("CC-BY-4.0");
    await page.locator(SELECTORS.metaUnits).selectOption("mm");

    const cid = await saveDraft(page, saveCid);
    await page.reload();
    await page.waitForURL(MANIFEST_URL_REGEX);
    expect(manifestCidFromUrl(page.url())).toBe(cid);

    await openInspector(page);
    await expect(page.locator(SELECTORS.metaLicence)).toHaveValue("CC-BY-4.0");
    await expect(page.locator(SELECTORS.metaUnits)).toHaveValue("mm");
  });
});
