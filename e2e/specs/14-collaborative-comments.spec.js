import { test, expect } from "../fixtures/coverage.mjs";
import { HARDHAT_ACCOUNTS } from "../fixtures/multi-wallet.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchTokenManifest,
  assertCollectionManifest,
  findAssetIdByName,
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
const OWNER_COMMENT = "@editor please review the color";
const EDITOR_COMMENT = "@owner color updated in the latest version";

test.describe("collaborative comments", () => {
  test("owner and editor see replies live, and comments stay scoped to their asset", async ({
    browser,
  }) => {
    // Two wallet connects, two asset publishes and a live relay round-trip
    // exceed the 90s default under load (same class as 13/23/24).
    test.setTimeout(240_000);
    // Computed per attempt, not at module scope: a retry reusing the same name
    // would collide on the same Nostr asset tag and replay attempt 1's comment
    // backlog, corrupting the count assertions.
    const assetAName = uniqueAssetName("Comments Collab Asset A");
    const assetBName = uniqueAssetName("Comments Collab Asset B");
    const ownerPage = await browser.newPage();
    try {
      // ── 1. Owner publishes asset A ───────────────────────────────────────
      await connectStudioAs(ownerPage, 0);
      const tokenIdHex = await generateSaveAndPublish(
        ownerPage,
        assetAName,
        PROMPT,
      );

      const firstCollection = await fetchTokenManifest(tokenIdHex);
      assertCollectionManifest(firstCollection, {
        expectedAssetIds: undefined,
      });
      expect(Object.keys(firstCollection.assets).length).toBeGreaterThanOrEqual(
        1,
      );

      const assetIdA = await findAssetIdByName(firstCollection, assetAName);
      expect(assetIdA).toBeTruthy();

      // ── 2. Owner adds the editor wallet to the team ──────────────────────
      const editorAddress = HARDHAT_ACCOUNTS[1].address;
      await addCollaborator(ownerPage, editorAddress);

      // addCollaborator leaves the browser on the Library; return to Studio.
      await openSharedAsset(ownerPage, tokenIdHex, assetIdA);

      // ── 3. Owner posts a comment ─────────────────────────────────────────
      await postComment(ownerPage, OWNER_COMMENT);
      await expect(ownerPage.locator(SELECTORS.commentsCount)).toHaveText("1");

      // ── 4. Editor opens the shared asset and sees the owner's comment ────
      const editorPage = await browser.newPage();
      try {
        await connectStudioAs(editorPage, 1);
        await openSharedAsset(editorPage, tokenIdHex, assetIdA);

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

      // ── 7. Publish a sibling asset B in the same collection ─────────────
      // A separate page keeps the nonce sequence clean while the owner page
      // stays connected.
      const assetBPage = await browser.newPage();
      try {
        await connectStudioAs(assetBPage, 0);
        const tokenIdB = await generateSaveAndPublish(
          assetBPage,
          assetBName,
          PROMPT,
        );
        expect(tokenIdB.toLowerCase()).toBe(tokenIdHex.toLowerCase());
      } finally {
        await assetBPage.close();
      }

      const collection = await fetchTokenManifest(tokenIdHex);
      const assetIdB = await findAssetIdByName(collection, assetBName);
      expect(assetIdB).toBeTruthy();
      expect(assetIdB).not.toBe(assetIdA);

      // ── 8. Asset B must not inherit asset A's comment thread ────────────
      await openSharedAsset(ownerPage, tokenIdHex, assetIdB);
      await expect(ownerPage.locator(SELECTORS.commentsSection)).not.toContainText(
        OWNER_COMMENT,
        { timeout: 5000 },
      );
      await expect(ownerPage.locator(SELECTORS.commentsCount)).toHaveText("0");

      // ── 9. Back on asset A the full thread is still there ───────────────
      await openSharedAsset(ownerPage, tokenIdHex, assetIdA);
      await expectComment(ownerPage, OWNER_COMMENT);
      await expectComment(ownerPage, EDITOR_COMMENT);
      await expect(ownerPage.locator(SELECTORS.commentsCount)).toHaveText("2");
    } finally {
      await ownerPage.close();
    }
  });
});
