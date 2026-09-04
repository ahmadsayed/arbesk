import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectStudio,
  generate,
  saveDraft,
  generateSaveAndPublish,
  editFirstNodeColor,
  assetCardLocator,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";

test.describe("live scene updates", () => {
  test("republishing a referenced child reloads it in the open parent scene", async ({ page }) => {
    page.on("dialog", (d) => d.accept());
    await connectStudio(page);

    const childName = uniqueAssetName("Live Child");
    const parentName = uniqueAssetName("Live Parent");

    // 1. Publish the child into the default collection.
    const childTokenHex = await generateSaveAndPublish(page, childName, PROMPT);
    const childTokenDec = BigInt(childTokenHex).toString();

    // 2. Start a parent draft and link the child as a live reference.
    await page.click(SELECTORS.newAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, parentName);
    await page.click(SELECTORS.dialogConfirmBtn);
    const parentGenCid = await generate(page, PROMPT);
    await page.click(SELECTORS.gallerySwitcherBtn);
    const childCard = assetCardLocator(page, childTokenDec, childName);
    await expect(childCard).toHaveCount(1, { timeout: 5000 });
    await childCard.getByRole("button", { name: "Add to Scene" }).click();
    await expect(page.locator(SELECTORS.dialogLiveRefBtn)).toBeVisible({ timeout: 30000 });
    await page.click(SELECTORS.dialogLiveRefBtn);
    await saveDraft(page, parentGenCid);

    // 3. Subscribe to the live-update bus events before republishing.
    await page.evaluate(() => {
      const { on, EVENTS } = window.__arbeskBus;
      window.__liveUpdates = [];
      on(EVENTS.ASSET_URI_CHANGED, (p) =>
        window.__liveUpdates.push(["changed", String(p?.tokenId)]),
      );
      on(EVENTS.ASSET_URI_UPDATED, (p) =>
        window.__liveUpdates.push(["updated", String(p?.tokenId)]),
      );
    });

    // 4. Dive into the child, edit it, and republish (same token, new version).
    await page.click(SELECTORS.outlinerSwitcherBtn);
    const childNode = page
      .locator(SELECTORS.outlinerNode)
      .filter({ hasText: childTokenDec });
    await expect(childNode).toHaveCount(1, { timeout: 30000 });
    await childNode.click();
    await expect(page.locator(SELECTORS.inspectorDiveBtn)).toBeVisible();
    await page.click(SELECTORS.inspectorDiveBtn);
    await editFirstNodeColor(page, "#00aa55");
    await page.click(SELECTORS.publishAssetBtn);

    // 5. The live-update path must fire: local publish (ASSET_URI_CHANGED) then
    //    the reload trigger (ASSET_URI_UPDATED).
    await expect
      .poll(
        async () => {
          const events = await page.evaluate(() => window.__liveUpdates);
          return events.some((e) => e[0] === "updated");
        },
        { timeout: 30000, intervals: [500, 1000, 1000] },
      )
      .toBe(true);
  });
});
