import { test, expect } from "@playwright/test";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { fetchManifest } from "../helpers/manifest.mjs";
import { connectStudio, generate, saveDraft, generateSaveAndPublish } from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const CHILD_NAME = "Child World";
const PARENT_NAME = "Parent World";

test.describe("nesting / linked child worlds", () => {
  test("links a published token as a child world, then dives and ascends", async ({
    page,
  }) => {
    // startNewAsset() uses a native confirm(); auto-accept native dialogs.
    page.on("dialog", (d) => d.accept());

    await connectStudio(page);

    // 1. Publish the world that will become the child reference.
    const childTokenHex = await generateSaveAndPublish(page, CHILD_NAME, PROMPT);
    const childTokenDec = BigInt(childTokenHex).toString();

    // 2. Start a fresh parent draft (New asset resets the active token id, so the
    //    next generation is its own draft rather than a version of the child).
    await page.click(SELECTORS.newAssetBtn);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, PARENT_NAME);
    await page.click(SELECTORS.dialogConfirmBtn);

    // 3. Generate the parent's own content.
    const parentGenCid = await generate(page, PROMPT);

    // 4. Link the published child into the parent scene via the gallery card.
    await page.click(SELECTORS.gallerySwitcherBtn);
    const childCard = page.locator(
      `${SELECTORS.assetCard}[data-token-id="${childTokenDec}"]`
    );
    await expect(childCard).toHaveCount(1);
    await childCard.getByRole("button", { name: "Add to Scene" }).click();

    // 5. Save the parent. This bakes the child into the manifest as a child_ref
    //    node (identity transform, no local history — history lives in the
    //    referenced token), and refreshes the outliner to show the new node.
    const parentCid = await saveDraft(page, parentGenCid);
    const parentManifest = await fetchManifest(parentCid);
    const refNode = parentManifest.scene.nodes.find((n) => n.child_ref);
    expect(refNode).toBeTruthy();
    expect(refNode.transform_matrix).toHaveLength(16);
    expect(BigInt(refNode.child_ref.tokenId)).toBe(BigInt(childTokenHex));
    expect(refNode.history).toBeUndefined();

    // 6. Dive into the child world. A child node is labelled "Token #<id>", so
    //    locate it by token id. Capture the nesting lifecycle events first.
    await page.evaluate(() => {
      window.__nesting = [];
      document.addEventListener("nesting:didDive", (e) =>
        window.__nesting.push(["dive", e.detail?.depth])
      );
      document.addEventListener("nesting:didAscend", (e) =>
        window.__nesting.push(["ascend", e.detail?.depth])
      );
    });

    await page.click(SELECTORS.outlinerSwitcherBtn);
    const childNode = page
      .locator(SELECTORS.outlinerNode)
      .filter({ hasText: childTokenDec });
    await expect(childNode).toHaveCount(1, { timeout: 10000 });
    await childNode.click();
    await expect(page.locator(SELECTORS.inspectorDiveBtn)).toBeVisible();
    await page.click(SELECTORS.inspectorDiveBtn);

    // Back button reveals at depth > 0; the dive event fires with depth 1.
    await expect(page.locator(SELECTORS.backBtn)).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__nesting))
      .toContainEqual(["dive", 1]);

    // 7. Ascend back to the parent.
    await page.click(SELECTORS.backBtn);
    await expect(page.locator(SELECTORS.backBtn)).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.__nesting))
      .toContainEqual(["ascend", 0]);
  });
});
