import { test, expect } from "../fixtures/coverage.mjs";
import { MANIFEST_URL_REGEX, fetchManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateToChatBubble,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT_A = "provenance cabin";
const PROMPT_B = "provenance tower";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("chat provenance", () => {
  test("auto-save on Show in Studio records accepted prompts in metadata.chat and reopen renders history", async ({
    page,
  }) => {
    await connectStudio(page);

    // Two generations, each auto-saved by Show in Studio. Provenance is
    // version-scoped: each auto-save anchors the prompt(s) accepted since
    // the previous save, and the "Saved" pill is the durable signal that
    // the auto-save (and its URL flip) completed.
    const firstSend = await generateToChatBubble(page, PROMPT_A);
    await firstSend.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);
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

    // Cold reopen: boot's loadFromParams() reads ?manifest= and the chain
    // walk renders the history again.
    await page.reload();
    await expect(page.locator(SELECTORS.chatHistoryBubbles)).toHaveCount(4);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT_A);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT_B);
  });
});
