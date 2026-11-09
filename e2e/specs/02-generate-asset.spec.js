import { test, expect } from "../fixtures/coverage.mjs";
import {
  fetchManifest,
  assertGenerationManifest,
  manifestCidFromUrl,
  MANIFEST_URL_REGEX,
} from "../helpers/manifest.mjs";
import { connectStudio, generateToChatBubble } from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "cowboy";

test.describe("asset generation", () => {
  test("generations stay in chat until sent and produce valid manifests", async ({
    page,
  }) => {
    await connectStudio(page);

    // Two pending generations: each lands as its own chat bubble with a live
    // preview and an independent send button. The Studio scene and URL stay
    // untouched until the user sends one.
    const first = await generateToChatBubble(page, PROMPT);
    const second = await generateToChatBubble(page, "second robot");

    await expect(page.locator(SELECTORS.assetBubble)).toHaveCount(2);
    await expect(
      page.locator(SELECTORS.assetBubbleCanvas).first(),
    ).toBeVisible();
    expect(MANIFEST_URL_REGEX.test(page.url())).toBe(false);
    await expect(first).toBeEnabled();
    await expect(second).toBeEnabled();

    // Sending the first only affects that bubble: the history records the
    // generation, the URL flips, the bubble collapses to its sent state, and
    // the button stays live as the explicit restore path (the preview is
    // orbit-only). The second bubble remains actionable.
    await first.click();
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    await expect(first).toBeEnabled();
    await expect(first).toHaveText("Show in Studio");
    await expect(page.locator(SELECTORS.assetBubble).first()).toHaveClass(
      /chat-bubble-asset-sent/,
    );
    await expect(second).toBeEnabled();

    const cid = manifestCidFromUrl(page.url());
    expect(cid).toBeTruthy();
    const manifest = await fetchManifest(cid);
    assertGenerationManifest(manifest, { prompt: PROMPT, provider: "mock" });
  });
});
