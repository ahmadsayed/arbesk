import { test, expect } from "../fixtures/coverage.mjs";
import { MANIFEST_URL_REGEX, fetchManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateToChatBubble,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "cowboy";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("asset metadata", () => {
  test("save bakes metadata.computed into the manifest and it survives reopen", async ({
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
  });
});
