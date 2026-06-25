import { test, expect } from "@playwright/test";
import path from "path";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  libraryAssetLocator,
  createLibraryCollection,
  uploadLibraryFile,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const GLB_FIXTURE = path.resolve("mock-gltf-assets/howdy.glb");
const UPLOADED_ASSET_NAME = "howdy";

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
    // Newly created collection is empty.
    await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(0);

    await uploadLibraryFile(page, GLB_FIXTURE, UPLOADED_ASSET_NAME);
    await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(1);

    const assetCard = libraryAssetLocator(page, UPLOADED_ASSET_NAME).first();
    await expect(assetCard).toBeVisible();

    // The upload should be openable in Studio.
    await assetCard.dblclick();
    await page.waitForURL(/\/studio\.html\?asset=/, { timeout: 10000 });
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      UPLOADED_ASSET_NAME,
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
