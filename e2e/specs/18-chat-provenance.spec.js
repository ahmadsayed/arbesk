import { test, expect } from "../fixtures/coverage.mjs";
import { MANIFEST_URL_REGEX, fetchManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateToChatBubble,
  saveDraft,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT_A = "provenance cabin";
const PROMPT_B = "provenance tower";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("chat provenance", () => {
  test("save records accepted prompts in metadata.chat and reopen renders history", async ({
    page,
  }) => {
    await connectStudio(page);

    // Two generations, both accepted into the Studio before one save.
    const firstSend = await generateToChatBubble(page, PROMPT_A);
    await firstSend.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    const genCid = manifestCidFromUrl(page.url());

    const secondSend = await generateToChatBubble(page, PROMPT_B);
    await secondSend.click();
    await page.waitForURL((url) => {
      const cid = manifestCidFromUrl(url.toString());
      return Boolean(cid) && cid !== genCid;
    });

    // Save anchors both prompts into a single new manifest version.
    const saveCid = await saveDraft(page, manifestCidFromUrl(page.url()));
    const saved = await fetchManifest(saveCid);
    expect(saved.metadata?.chat?.map((e) => e.prompt)).toEqual([
      PROMPT_A,
      PROMPT_B,
    ]);
    for (const entry of saved.metadata.chat) {
      expect(entry.provider).toBe("mock");
      expect(entry.task).toBe("model");
      expect(typeof entry.timestamp).toBe("number");
    }

    // Generation manifests themselves carry no chat records (save-anchored).
    const gen = await fetchManifest(genCid);
    expect(gen.metadata?.chat).toBeUndefined();

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
