import { test, expect } from "@playwright/test";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  assertCollectionManifest,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  generate,
  saveDraft,
  generateSaveAndPublish,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const CHILD_NAME = "Child World";
const PARENT_NAME = "Parent World";

test.describe("nesting / linked child worlds", () => {
  test("links a collection asset as a child world, then dives and ascends", async ({
    page,
  }) => {
    // startNewAsset() uses a native confirm(); auto-accept native dialogs.
    page.on("dialog", (d) => d.accept());

    await connectStudio(page);

    // ── 1. Generate and publish the child ────────────────────────────
    // Publishes into the default collection; the gallery card caches
    // firstAssetId for drag-drop / "Add to Scene" routing.
    const childTokenHex = await generateSaveAndPublish(
      page,
      CHILD_NAME,
      PROMPT,
    );
    const childTokenDec = BigInt(childTokenHex).toString();

    // The on-chain tokenURI now returns a collection manifest.
    const childCollection = await fetchTokenManifest(childTokenHex);
    assertCollectionManifest(childCollection);

    // ── 2. Start a fresh parent draft ────────────────────────────────
    await page.click(SELECTORS.newAssetBtn);
    // startNewAsset() shows a native confirm() (auto-accepted) followed
    // by a GNOME HIG dialog for the name.
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, PARENT_NAME);
    await page.click(SELECTORS.dialogConfirmBtn);

    // ── 3. Generate the parent's own content ─────────────────────────
    const parentGenCid = await generate(page, PROMPT);

    // ── 4. Link the child into the parent scene ─────────────────────
    // The gallery card's dataset.firstAssetId carries the collection's
    // first asset ID, so buildLinkedAssetPayload includes assetID.
    // handleLinkedAssetDropped sees assetID → shows fork/live-ref dialog.
    await page.click(SELECTORS.gallerySwitcherBtn);
    const childCard = page.locator(
      `${SELECTORS.assetCard}[data-token-id="${childTokenDec}"]`,
    );
    await expect(childCard).toHaveCount(1);
    await childCard.getByRole("button", { name: "Add to Scene" }).click();

    // Choose "Live reference" for the new {collection, assetID} format.
    const liveRefBtn = page.locator(
      '.dialog-action-btn[data-value="live-ref"]',
    );
    await expect(liveRefBtn).toBeVisible();
    await liveRefBtn.click();

    // handleLinkedAssetDropped resolves the collection token on-chain
    // and fetches the manifest from IPFS before pushing the child_ref to
    // the pending list.  Wait for the dialog to disappear and give the
    // handler time to finish the resolution.
    await expect(liveRefBtn).toBeHidden({ timeout: 10000 });
    await page.waitForTimeout(3000);

    // ── 5. Save the parent draft ─────────────────────────────────────
    // The save bakes pending child_ref(s) into the scene manifest.
    await page.click(SELECTORS.saveAssetBtn);
    await page.waitForURL(/[?&]manifest=Qm[\w]+/);
    const parentCid = new URL(page.url()).searchParams.get("manifest");

    // ── 6. Verify the new child_ref format ────────────────────────────
    const parentManifest = await fetchManifest(parentCid);
    const refNode = parentManifest.scene.nodes.find((n) => n.child_ref);
    expect(refNode).toBeTruthy();
    expect(refNode.transform_matrix).toHaveLength(16);
    // New collection-based child_ref:
    //   { collection: {chainId, contractAddress, tokenId}, assetID }
    expect(refNode.child_ref.collection).toBeTruthy();
    expect(refNode.child_ref.collection.chainId).toBeDefined();
    expect(BigInt(refNode.child_ref.collection.tokenId)).toBe(
      BigInt(childTokenHex),
    );
    expect(typeof refNode.child_ref.assetID).toBe("string");
    expect(refNode.child_ref.assetID.length).toBeGreaterThan(0);
    expect(refNode.history).toBeUndefined();

    // ── 7. Dive into the child world ──────────────────────────────────
    // Subscribe to the mitt nesting bus so we can assert the
    // depth-change events.
    await page.evaluate(async () => {
      const { on, EVENTS } = await import("/js/events/bus.js");
      window.__nesting = [];
      on(EVENTS.NESTING_DID_DIVE, ({ depth }) =>
        window.__nesting.push(["dive", depth]),
      );
      on(EVENTS.NESTING_DID_ASCEND, ({ depth }) =>
        window.__nesting.push(["ascend", depth]),
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

    // ── 8. Ascend back to the parent ──────────────────────────────────
    await page.click(SELECTORS.backBtn);
    await expect(page.locator(SELECTORS.backBtn)).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.__nesting))
      .toContainEqual(["ascend", 0]);
  });
});
