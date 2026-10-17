import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  assertCollectionManifest,
  findAssetCidByName,
} from "../helpers/manifest.mjs";
import {
  connectStudio,
  generate,
  saveDraft,
  generateSaveAndPublish,
  assetCardLocator,
  insertAssetCard,
  startEmptyAsset,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const CHILD_NAME = uniqueAssetName("Fork Child");
const LIVE_CHILD_NAME = uniqueAssetName("Live Child");
const PARENT_NAME_FORK = "Fork Parent";
const PARENT_NAME_LIVE = "Live Parent";

test.describe("fork vs live-reference", () => {
  test("forking another collection's asset freezes its CID", async ({
    page,
  }) => {
    // startNewAsset() uses a native confirm(); auto-accept native dialogs.
    page.on("dialog", (d) => d.accept());

    await connectStudio(page);

    // 1. Publish the world that will become the linked reference.
    const childTokenHex = await generateSaveAndPublish(
      page,
      CHILD_NAME,
      PROMPT,
    );
    const childTokenDec = BigInt(childTokenHex).toString();

    // 2. Start a fresh parent draft.
    await startEmptyAsset(page);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, PARENT_NAME_FORK);
    await page.click(SELECTORS.dialogConfirmBtn);

    // 3. Generate the parent's own content.
    const parentGenCid = await generate(page, PROMPT);

    // 4. Open gallery, find the child's card, insert it from the ⋯ menu.
    await page.click(SELECTORS.gallerySwitcherBtn);
    const childCard = assetCardLocator(page, childTokenDec, CHILD_NAME);
    await expect(childCard).toHaveCount(1, { timeout: 5000 });
    await insertAssetCard(childCard, "fork");

    // 6. Save the draft. The forked child is baked into the manifest as a
    //    source node with a frozen CID (no child_ref).
    const parentCid = await saveDraft(page, parentGenCid);
    const parentManifest = await fetchManifest(parentCid);

    // The "other" node (not the generated root node) should be the forked one.
    const forkNode = parentManifest.scene.nodes.find(
      (n) => n.node_id && n.node_id.startsWith("linked_"),
    );
    expect(forkNode).toBeTruthy();
    expect(forkNode.transform_matrix).toHaveLength(16);
    expect(forkNode.source).toBeTruthy();
    expect(typeof forkNode.source.cid).toBe("string");
    expect(forkNode.child_ref).toBeUndefined();
    // Fork nodes have no local history - the CID is a frozen snapshot.
    expect(forkNode.history).toBeUndefined();

    // The copy freezes the child's MODEL file (not its manifest CID) and
    // carries the model node's post_processor (scale compensation / colour)
    // and transform.
    const childCollection = await fetchTokenManifest(childTokenHex);
    const childAssetCid = await findAssetCidByName(childCollection, CHILD_NAME);
    expect(childAssetCid).toBeTruthy();
    const childModelNode = (await fetchManifest(childAssetCid)).scene.nodes[0];
    expect(forkNode.source.cid).not.toBe(childAssetCid);
    expect(forkNode.source).toEqual(childModelNode.source);
    expect(childModelNode.post_processor?.scale).toBeTruthy();
    expect(forkNode.post_processor).toEqual(childModelNode.post_processor);
    expect(forkNode.transform_matrix).toEqual(childModelNode.transform_matrix);
  });

  test("live-referencing another collection's asset creates a child_ref", async ({
    page,
  }) => {
    page.on("dialog", (d) => d.accept());

    await connectStudio(page);

    // 1. Publish the reference world.
    const childTokenHex = await generateSaveAndPublish(
      page,
      LIVE_CHILD_NAME,
      PROMPT,
    );
    const childTokenDec = BigInt(childTokenHex).toString();

    // Verify the published token's collection manifest is valid.
    const childManifest = await fetchTokenManifest(childTokenHex);
    assertCollectionManifest(childManifest);
    const firstAssetId = Object.keys(childManifest.assets)[0];
    expect(firstAssetId).toBeTruthy();

    // 2. Start a fresh parent draft.
    await startEmptyAsset(page);
    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, PARENT_NAME_LIVE);
    await page.click(SELECTORS.dialogConfirmBtn);

    // 3. Generate the parent's own content.
    const parentGenCid = await generate(page, PROMPT);

    // 4. Open gallery, find the child's card, insert it from the ⋯ menu.
    await page.click(SELECTORS.gallerySwitcherBtn);
    const childCard = assetCardLocator(page, childTokenDec, LIVE_CHILD_NAME);
    await expect(childCard).toHaveCount(1, { timeout: 5000 });
    await insertAssetCard(childCard);

    // 6. Save the draft. The live-ref child is baked into the manifest as a
    //    child_ref node (points at the collection, no frozen CID).
    const parentCid = await saveDraft(page, parentGenCid);
    const parentManifest = await fetchManifest(parentCid);

    const refNode = parentManifest.scene.nodes.find(
      (n) => n.node_id && n.node_id.startsWith("linked_"),
    );
    expect(refNode).toBeTruthy();
    expect(refNode.transform_matrix).toHaveLength(16);

    // Live-ref node must have a child_ref pointing at the collection.
    expect(refNode.child_ref).toBeTruthy();
    expect(refNode.child_ref.collection).toBeTruthy();
    expect(typeof refNode.child_ref.collection.chainId).toBe("number");
    expect(typeof refNode.child_ref.collection.contractAddress).toBe("string");
    expect(refNode.child_ref.collection.contractAddress.startsWith("0x")).toBe(
      true,
    );
    expect(refNode.child_ref.collection.tokenId).toBe(String(childTokenDec));
    expect(refNode.child_ref.assetID).toBeTruthy();
    expect(typeof refNode.child_ref.assetID).toBe("string");

    // Live-ref node must NOT have a source (source is for frozen forks).
    expect(refNode.source).toBeUndefined();

    // No local history - the live-ref resolves the collection every load.
    expect(refNode.history).toBeUndefined();
  });
});
