import { test, expect } from "../fixtures/coverage.mjs";
import path from "path";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  ensureStudioConnected,
  libraryAssetLocator,
  openLibraryCollection,
  createLibraryCollection,
  uploadLibraryFile,
  uniqueAssetName,
} from "../helpers/flows.mjs";
import {
  fetchManifest,
  fetchTokenManifest,
  findAssetCidByName,
} from "../helpers/manifest.mjs";

const GLB_FIXTURE = path.resolve("mock-gltf-assets/howdy.glb");
const UPLOADED_ASSET_NAME = "howdy";
const THREEMF_FIXTURE = path.resolve("mock-gltf-assets/box.3mf");
const UPLOADED_3MF_ASSET_NAME = "box";

/**
 * Fetch the on-chain stored asset manifest for a library asset card.
 * Card `data-id`s follow `asset-${tokenId}-${assetId}` (library-controller.js),
 * so the token id is recoverable from the DOM; the collection manifest then
 * maps asset name → asset manifest CID.
 */
async function fetchUploadedAssetManifest(page, assetName) {
  const cardId = await libraryAssetLocator(page, assetName)
    .first()
    .getAttribute("data-id");
  const tokenId = cardId.split("-")[1];
  const collectionManifest = await fetchTokenManifest(tokenId);
  const assetCid = await findAssetCidByName(collectionManifest, assetName);
  if (!assetCid) {
    throw new Error(`Asset "${assetName}" not found in collection manifest`);
  }
  return fetchManifest(assetCid);
}

// Creating collections and uploading into them mutates on-chain state; run serially.
test.describe.serial("Library create collection and upload", () => {
  test("creates a named collection and uploads a desktop GLB file into it", async ({
    page,
  }) => {
    const collectionName = uniqueAssetName("Upload Collection");
    await connectLibrary(page);

    await expect(
      page.locator(SELECTORS.libraryCreateCollectionBtn),
    ).toBeVisible();
    await expect(page.locator(SELECTORS.libraryUploadBtn)).toBeVisible();

    await createLibraryCollection(page, collectionName);
    // The newly created collection appears at the collections list level.
    // Earlier serial tests may have left the Default collection on-chain, so
    // assert presence rather than an exact total count.
    await expect(
      page.locator(`${SELECTORS.libraryCollectionItem}:has(${SELECTORS.libraryItemName}:text-is("${collectionName}"))`),
    ).toBeVisible();

    await openLibraryCollection(page, collectionName);
    // Opened collection is empty.
    await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(0);

    await uploadLibraryFile(page, GLB_FIXTURE, UPLOADED_ASSET_NAME);
    await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(1);

    const assetCard = libraryAssetLocator(page, UPLOADED_ASSET_NAME).first();
    await expect(assetCard).toBeVisible();

    // The upload is decomposed at upload time into the canonical stored form,
    // exactly as a Studio save would store it.
    const uploadedManifest = await fetchUploadedAssetManifest(
      page,
      UPLOADED_ASSET_NAME,
    );
    expect(uploadedManifest.scene.nodes[0].source.path).toBe("composite.gltf");
    expect(uploadedManifest.scene.nodes[0].source.format).toBe("gltf");

    // The upload should be openable in Studio.
    await assetCard.dblclick();
    await page.waitForURL(/\/studio\?asset=/, { timeout: 10000 });
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      UPLOADED_ASSET_NAME,
    );
  });

  test("uploads a 3MF file and stores it decomposed", async ({ page }) => {
    const collectionName = uniqueAssetName("3MF Upload Collection");
    await connectLibrary(page);

    await createLibraryCollection(page, collectionName);
    await openLibraryCollection(page, collectionName);
    await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(0);

    await uploadLibraryFile(page, THREEMF_FIXTURE, UPLOADED_3MF_ASSET_NAME);
    await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(1);

    // Decomposed at upload into the canonical composite-3MF stored form.
    const uploadedManifest = await fetchUploadedAssetManifest(
      page,
      UPLOADED_3MF_ASSET_NAME,
    );
    expect(uploadedManifest.scene.nodes[0].source.path).toBe(
      "composite.3mf.json",
    );
    expect(uploadedManifest.scene.nodes[0].source.format).toBe("3mf");

    // The decomposed upload is openable in Studio (compose-on-load).
    const assetCard = libraryAssetLocator(
      page,
      UPLOADED_3MF_ASSET_NAME,
    ).first();
    await assetCard.dblclick();
    await page.waitForURL(/\/studio\?asset=/, { timeout: 10000 });
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      UPLOADED_3MF_ASSET_NAME,
    );
  });

  test("warns when uploading without an open collection", async ({ page }) => {
    await connectLibrary(page);
    // If at the collection root, the upload button still exists but the handler
    // shows a warning toast instead of opening the file picker.
    await page.click(SELECTORS.libraryUploadBtn);

    await expect(
      page.locator(
        ".notyf__message:has-text('Open or create a collection first')",
      ),
    ).toBeVisible();
  });
});
