import { test, expect } from "../fixtures/coverage.mjs";
import {
  fetchManifest,
  assertGenerationManifest,
  MANIFEST_URL_REGEX,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  generate,
  generateToChatBubble,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "cowboy";

test.describe("asset generation", () => {
  test("generates a mock asset and produces a valid manifest", async ({
    page,
  }) => {
    await connectStudio(page);

    const cid = await generate(page, PROMPT);

    const manifest = await fetchManifest(cid);
    assertGenerationManifest(manifest, { prompt: PROMPT, provider: "mock" });
  });

  test("generation lands in the chat and only enters the Studio on send", async ({
    page,
  }) => {
    await connectStudio(page);

    const sendButton = await generateToChatBubble(page, PROMPT);

    // The result is a chat bubble with a live preview; the Studio scene and
    // URL stay untouched until the user sends it.
    await expect(page.locator(SELECTORS.assetBubble)).toHaveCount(1);
    await expect(page.locator(SELECTORS.assetBubbleCanvas)).toBeVisible();
    expect(MANIFEST_URL_REGEX.test(page.url())).toBe(false);

    await sendButton.click();
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);

    // After sending, the bubble collapses to the sent state.
    await expect(sendButton).toBeDisabled();
    await expect(sendButton).toHaveText("Shown in Studio");
  });

  test("multiple pending generations keep independent send buttons", async ({
    page,
  }) => {
    await connectStudio(page);

    const first = await generateToChatBubble(page, "first robot");
    const second = await generateToChatBubble(page, "second robot");

    await expect(page.locator(SELECTORS.assetBubble)).toHaveCount(2);
    await expect(first).toBeEnabled();
    await expect(second).toBeEnabled();

    // Sending the first leaves the second bubble actionable.
    await first.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(first).toBeDisabled();
    await expect(second).toBeEnabled();
  });
});
