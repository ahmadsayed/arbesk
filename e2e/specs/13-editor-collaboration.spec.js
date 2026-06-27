import { test, expect } from "../fixtures/coverage.mjs";
import { HARDHAT_ACCOUNTS } from "../fixtures/multi-wallet.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchTokenManifest,
  assertCollectionManifest,
  findAssetCidByName,
  fetchManifest,
} from "../helpers/manifest.mjs";
import {
  connectStudioAs,
  generateSaveAndPublish,
  editFirstNodeColor,
  addCollaborator,
  openSharedAsset,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const ASSET_NAME = uniqueAssetName("Editor Collab Asset");
const EDITOR_COLOR = "#00aa55";
const OUTSIDER_COLOR = "#5500aa";

test.describe("editor collaboration", () => {
  test("owner adds editor → editor republishes → non-editor is rejected", async ({
    browser,
  }) => {
    function logPageConsole(page, label) {
      page.on("console", (msg) => {
        const text = msg.text();
        if (
          msg.type() === "error" ||
          /Publish|PUBLISH|editor|Editor|Merkle|proof|failed|\[LIBRARY\]|\[PUBLISH\]/i.test(
            text,
          )
        ) {
          console.log(`[${label}] ${msg.type()}: ${text}`);
        }
      });
      page.on("pageerror", (err) => {
        console.log(`[${label}] pageerror: ${err.message}`);
      });
    }

    // ── 1. Owner publishes an asset ───────────────────────────────────────
    const ownerPage = await browser.newPage();
    logPageConsole(ownerPage, "owner");
    try {
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
      expect(Object.keys(firstCollection.assets).length).toBeGreaterThanOrEqual(1);
      const firstVersion = firstCollection.version;
      expect(firstVersion).toBeGreaterThanOrEqual(1);

      const firstAssetCid = await findAssetCidByName(
        firstCollection,
        ASSET_NAME,
      );
      expect(firstAssetCid).toBeTruthy();
      const firstAsset = await fetchManifest(firstAssetCid);
      expect(firstAsset.type).toBe("asset");
      expect(firstAsset.name).toBe(ASSET_NAME);
      const firstAssetVersion = firstAsset.version;
      const firstAssetId = firstAsset.asset_id;

      // ── 2. Owner adds the editor wallet to the team ──────────────────────
      const editorAddress = HARDHAT_ACCOUNTS[1].address;
      await addCollaborator(ownerPage, editorAddress);

      // ── 3. Editor opens the shared asset and republishes a color edit ────
      const editorPage = await browser.newPage();
      logPageConsole(editorPage, "editor");
      try {
        await connectStudioAs(editorPage, 1);
        await openSharedAsset(editorPage, tokenIdHex, firstAssetId);

        await editFirstNodeColor(editorPage, EDITOR_COLOR);
        await editorPage.click(SELECTORS.publishAssetBtn);

        await expect
          .poll(async () => (await fetchTokenManifest(tokenIdHex)).version, {
            timeout: 30000,
            intervals: [500, 1000, 1000],
          })
          .toBeGreaterThan(firstVersion);

        const editorCollection = await fetchTokenManifest(tokenIdHex);
        const editorAssetCid = await findAssetCidByName(
          editorCollection,
          ASSET_NAME,
        );
        expect(editorAssetCid).toBeTruthy();
        const editorAsset = await fetchManifest(editorAssetCid);
        expect(editorAsset.type).toBe("asset");
        expect(editorAsset.name).toBe(ASSET_NAME);
        expect(editorAsset.version).toBeGreaterThan(firstAssetVersion);

        // ── 4. Non-editor tries to republish and is rejected ───────────────
        const outsiderPage = await browser.newPage();
        logPageConsole(outsiderPage, "outsider");
        try {
          await connectStudioAs(outsiderPage, 2);
          await openSharedAsset(outsiderPage, tokenIdHex, firstAssetId);

          await editFirstNodeColor(outsiderPage, OUTSIDER_COLOR);
          await outsiderPage.click(SELECTORS.publishAssetBtn);

          await expect(outsiderPage.locator(SELECTORS.srStatus)).toContainText(
            "Not an authorized editor",
            { timeout: 15000 },
          );

          // On-chain version must not advance from the editor's republish.
          const finalCollection = await fetchTokenManifest(tokenIdHex);
          expect(finalCollection.version).toBe(editorCollection.version);
        } finally {
          await outsiderPage.close();
        }
      } finally {
        await editorPage.close();
      }
    } finally {
      await ownerPage.close();
    }
  });
});
