import { test, expect } from "../fixtures/coverage.mjs";
import {
  MANIFEST_URL_REGEX,
  fetchManifest,
  manifestCidFromUrl,
} from "../helpers/manifest.mjs";
import { connectStudio, generateToChatBubble } from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT_A = "provenance cabin";
const PROMPT_B = "provenance tower";

test.describe("chat provenance", () => {
  test("auto-saved prompts carry version-scoped provenance and older bubbles stay live restore paths", async ({
    page,
  }) => {
    await connectStudio(page);

    // The typed-prompt refine indicator is Tripo3D-only: hidden for the mock.
    await expect(page.locator(SELECTORS.refineIndicator)).toBeHidden();

    // Two generations, each auto-saved by Show in Studio. Provenance is
    // version-scoped: each auto-save anchors the prompt(s) accepted since
    // the previous save, and the "Saved" pill is the durable signal that
    // the auto-save (and its URL flip) completed.
    const firstSend = await generateToChatBubble(page, PROMPT_A);
    await firstSend.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);
    await expect(
      page.locator(`${SELECTORS.assetBubbleSaved} .chat-asset-saved-pill`),
    ).toHaveText("Saved");
    const saveCidA = manifestCidFromUrl(page.url());

    const secondSend = await generateToChatBubble(page, PROMPT_B);
    await secondSend.click();
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(2);
    const saveCidB = manifestCidFromUrl(page.url());
    expect(saveCidB).not.toBe(saveCidA);

    // Each auto-saved version records the prompt that produced it; the
    // chain walk reconstructs the full conversation.
    const savedB = await fetchManifest(saveCidB);
    expect(savedB.metadata?.chat?.map((e) => e.prompt)).toEqual([PROMPT_B]);
    const savedA = await fetchManifest(saveCidA);
    expect(savedA.metadata?.chat?.map((e) => e.prompt)).toEqual([PROMPT_A]);
    for (const entry of [...savedA.metadata.chat, ...savedB.metadata.chat]) {
      expect(entry.provider).toBe("mock");
      expect(entry.task).toBe("model");
      expect(typeof entry.timestamp).toBe("number");
    }

    // The first generation manifest (chain root) carries no chat records —
    // provenance is anchored by saves. Later generation manifests may inherit
    // prior chat entries (history preservation), so only the root is asserted.
    const genA = await fetchManifest(savedA.prev_asset_manifest_cid);
    expect(genA.metadata?.chat).toBeUndefined();

    // Saving fires ASSET_DRAFT_SAVED for the new tip: history renders live.
    await expect(page.locator(SELECTORS.chatHistoryBubbles)).toHaveCount(4); // header + 2 prompts + divider

    // Re-clicking the first bubble's Show in Studio restores that version
    // to the Studio (the preview itself is orbit-only): the URL flips to a
    // different manifest and the send tail runs again. Auto-save is
    // idempotent on the bubble (still 2 saved pills).
    const firstBubble = page.locator(SELECTORS.assetBubble).first();
    await firstBubble.locator(".chat-asset-send").click();
    await page.waitForURL(
      (url) => {
        const cid = manifestCidFromUrl(url.toString());
        return Boolean(cid) && cid !== saveCidB;
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
        return Boolean(cid) && cid !== saveCidB && cid !== restoredCid;
      },
      { timeout: 30000 },
    );
    const newTipCid = manifestCidFromUrl(page.url());
    const newTip = await fetchManifest(newTipCid);
    expect(newTip.prev_asset_manifest_cid).toBe(saveCidB);

    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(2);

    // Cold reopen: boot's loadFromParams() reads ?manifest= and the chain
    // walk renders the history again.
    await page.reload();
    await page.waitForURL(MANIFEST_URL_REGEX);
    expect(manifestCidFromUrl(page.url())).toBe(newTipCid);
    await expect(page.locator(SELECTORS.chatHistoryBubbles)).toHaveCount(4);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT_A);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT_B);
  });
});
