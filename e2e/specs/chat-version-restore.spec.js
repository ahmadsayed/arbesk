import { test, expect } from "../fixtures/coverage.mjs";
import { MANIFEST_URL_REGEX, fetchManifest } from "../helpers/manifest.mjs";
import { connectStudio, generateToChatBubble } from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT_A = "box";
const PROMPT_B = "restore tower";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("chat version cards", () => {
  test("Show in Studio auto-saves a draft and clicking a bubble preview restores that version", async ({
    page,
  }) => {
    await connectStudio(page);

    // The typed-prompt refine indicator is Tripo3D-only: hidden for the mock.
    await expect(page.locator(SELECTORS.refineIndicator)).toBeHidden();

    // First generation → Show in Studio → auto-save annotates the bubble.
    const firstSend = await generateToChatBubble(page, PROMPT_A);
    await firstSend.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);
    await expect(
      page.locator(`${SELECTORS.assetBubbleSaved} .chat-asset-saved-pill`),
    ).toHaveText("Saved");

    // Second generation → Show in Studio → second bubble gets its own pill.
    const secondSend = await generateToChatBubble(page, PROMPT_B);
    await secondSend.click();
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(2);
    const secondCid = manifestCidFromUrl(page.url());
    expect(secondCid).toBeTruthy();

    // Clicking the first bubble's preview restores that version to the
    // Studio: the URL flips to a different manifest and the send tail runs
    // again. Auto-save is idempotent on the bubble (still 2 saved pills).
    const firstBubble = page.locator(SELECTORS.assetBubble).first();
    await firstBubble.locator(".chat-asset-preview").click();
    await page.waitForURL(
      (url) => {
        const cid = manifestCidFromUrl(url.toString());
        return Boolean(cid) && cid !== secondCid;
      },
      { timeout: 30000 },
    );
    const restoredCid = manifestCidFromUrl(page.url());
    expect(restoredCid).toBeTruthy();

    // Chain continuity: the restore auto-save must chain onto the
    // pre-restore tip, not fork at the restored (older) version. Wait for
    // the URL to move past the restored CID — the "Saved" pill/message
    // assertions can't gate this (both were already satisfied by the two
    // earlier sends).
    await page.waitForURL(
      (url) => {
        const cid = manifestCidFromUrl(url.toString());
        return Boolean(cid) && cid !== secondCid && cid !== restoredCid;
      },
      { timeout: 30000 },
    );
    const newTipCid = manifestCidFromUrl(page.url());
    const newTip = await fetchManifest(newTipCid);
    expect(newTip.prev_asset_manifest_cid).toBe(secondCid);

    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(2);
  });
});
