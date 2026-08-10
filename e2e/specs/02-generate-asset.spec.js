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

    // After sending, the bubble collapses to the sent state — snapshot
    // replaces the canvas — but the button stays live: re-clicking it is
    // the explicit restore path (the preview is orbit-only).
    await expect(sendButton).toBeEnabled();
    await expect(sendButton).toHaveText("Show in Studio");
    await expect(page.locator(SELECTORS.assetBubble)).toHaveClass(
      /chat-bubble-asset-sent/,
    );
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

    // Sending the first leaves both bubbles actionable: the second is still
    // pending, and the first's button stays live as its restore path.
    await first.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(first).toBeEnabled();
    await expect(page.locator(SELECTORS.assetBubble).first()).toHaveClass(
      /chat-bubble-asset-sent/,
    );
    await expect(second).toBeEnabled();
  });
});
