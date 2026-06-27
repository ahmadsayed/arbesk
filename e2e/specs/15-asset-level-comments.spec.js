import { test, expect } from "@playwright/test";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchTokenManifest,
  findAssetIdByName,
} from "../helpers/manifest.mjs";
import {
  connectStudioAs,
  generateSaveAndPublish,
  openSharedAsset,
  postComment,
  expectComment,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_A_NAME = uniqueAssetName("Comments Asset A");
const ASSET_B_NAME = uniqueAssetName("Comments Asset B");
const COMMENT_ON_A = "comment on asset A";

/**
 * Wait until the comments panel shows the requested count.
 * The count is updated asynchronously when the WebSocket connects and archives load.
 */
async function expectCommentCount(page, count) {
  await expect(page.locator(SELECTORS.commentsCount)).toHaveText(String(count), {
    timeout: 15000,
  });
}

test.describe("asset-level comments", () => {
  test("comments on one asset in a collection do not leak to another asset", async ({
    browser,
  }) => {
    const pageA = await browser.newPage();
    let tokenIdHex;
    try {
      // ── 1. Owner publishes asset A ────────────────────────────────────────
      await connectStudioAs(pageA, 0);
      tokenIdHex = await generateSaveAndPublish(pageA, ASSET_A_NAME, PROMPT);

      // ── 2. Same owner publishes asset B in a second page ──────────────────
      // Pages are used sequentially to avoid nonce collisions on the same account.
      const pageB = await browser.newPage();
      try {
        await connectStudioAs(pageB, 0);
        const tokenIdHexB = await generateSaveAndPublish(
          pageB,
          ASSET_B_NAME,
          PROMPT,
        );
        expect(tokenIdHexB.toLowerCase()).toBe(tokenIdHex.toLowerCase());
      } finally {
        await pageB.close();
      }

      // ── 3. Resolve both asset ids from the shared collection manifest ─────
      const collection = await fetchTokenManifest(tokenIdHex);
      const assetIdA = await findAssetIdByName(collection, ASSET_A_NAME);
      const assetIdB = await findAssetIdByName(collection, ASSET_B_NAME);
      expect(assetIdA).toBeTruthy();
      expect(assetIdB).toBeTruthy();
      expect(assetIdA).not.toBe(assetIdB);

      // ── 4. Post a comment on asset A ──────────────────────────────────────
      await openSharedAsset(pageA, tokenIdHex, assetIdA);
      await postComment(pageA, COMMENT_ON_A);
      await expectCommentCount(pageA, 1);

      // ── 5. Switch to asset B: the comment must not appear ─────────────────
      await openSharedAsset(pageA, tokenIdHex, assetIdB);
      await expect(pageA.locator(SELECTORS.commentsSection)).not.toContainText(
        COMMENT_ON_A,
        { timeout: 5000 },
      );
      await expectCommentCount(pageA, 0);

      // ── 6. Switch back to asset A: the comment must still be there ────────
      await openSharedAsset(pageA, tokenIdHex, assetIdA);
      await expectComment(pageA, COMMENT_ON_A);
      await expectCommentCount(pageA, 1);
    } finally {
      await pageA.close();
    }
  });
});
