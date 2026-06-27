import { test, expect } from "@playwright/test";
import { HARDHAT_ACCOUNTS } from "../fixtures/multi-wallet.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchTokenManifest,
  assertCollectionManifest,
} from "../helpers/manifest.mjs";
import {
  connectStudioAs,
  generateSaveAndPublish,
  addCollaborator,
  openSharedAsset,
  postComment,
  expectComment,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = uniqueAssetName("Comments Collab Asset");
const OWNER_COMMENT = "@editor please review the color";
const EDITOR_COMMENT = "@owner color updated in the latest version";

test.describe("collaborative comments", () => {
  test("owner comments, editor sees it, editor replies, owner sees reply", async ({
    browser,
  }) => {
    const ownerPage = await browser.newPage();
    try {
      // ── 1. Owner publishes an asset ───────────────────────────────────────
      await connectStudioAs(ownerPage, 0);
      const tokenIdHex = await generateSaveAndPublish(
        ownerPage,
        ASSET_NAME,
        PROMPT,
      );

      const firstCollection = await fetchTokenManifest(tokenIdHex);
      assertCollectionManifest(firstCollection, {
        expectedAssetIds: undefined,
      });
      expect(Object.keys(firstCollection.assets).length).toBeGreaterThanOrEqual(
        1,
      );

      const assetId = Object.keys(firstCollection.assets)[0];
      expect(assetId).toBeTruthy();

      // ── 2. Owner adds the editor wallet to the team ──────────────────────
      const editorAddress = HARDHAT_ACCOUNTS[1].address;
      await addCollaborator(ownerPage, editorAddress);

      // addCollaborator leaves the browser on the Library; return to Studio.
      await openSharedAsset(ownerPage, tokenIdHex, assetId);

      // ── 3. Owner posts a comment ─────────────────────────────────────────
      await postComment(ownerPage, OWNER_COMMENT);
      await expect(ownerPage.locator(SELECTORS.commentsCount)).toHaveText("1");

      // ── 4. Editor opens the shared asset and sees the owner's comment ────
      const editorPage = await browser.newPage();
      try {
        await connectStudioAs(editorPage, 1);
        await openSharedAsset(editorPage, tokenIdHex, assetId);

        await expectComment(editorPage, OWNER_COMMENT);
        await expect(editorPage.locator(SELECTORS.commentsCount)).toHaveText(
          "1",
        );

        // ── 5. Editor replies ─────────────────────────────────────────────
        await postComment(editorPage, EDITOR_COMMENT);
        await expect(editorPage.locator(SELECTORS.commentsCount)).toHaveText(
          "2",
        );
      } finally {
        await editorPage.close();
      }

      // ── 6. Owner sees the editor's reply live ───────────────────────────
      await expectComment(ownerPage, EDITOR_COMMENT);
      await expect(ownerPage.locator(SELECTORS.commentsCount)).toHaveText("2");
    } finally {
      await ownerPage.close();
    }
  });
});
