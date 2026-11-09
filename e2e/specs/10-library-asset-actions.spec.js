import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  ensureLibraryConnected,
  ensureStudioConnected,
  libraryAssetLocator,
  openLibraryCollection,
  generateSaveAndPublish,
  seedDefaultCollection,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const PROMPT = "a simple sphere";

// Asset action tests mutate the shared default collection; run serially.
// They self-seed in beforeAll so they can run in isolation.
test.describe.serial("Library asset actions", () => {
  test.beforeAll(async ({ browser }) => {
    await seedDefaultCollection(browser);
  });

  test("renames an asset and warns when Send to Collection has no target", async ({
    page,
  }) => {
    const originalName = uniqueAssetName("Rename Me");
    const renamedName = uniqueAssetName("Renamed Asset");
    await connectLibrary(page);

    // Publish a target asset from Studio.
    await page.goto("/studio");
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, originalName, PROMPT);

    await page.goto("/library");
    await ensureLibraryConnected(page);
    await openLibraryCollection(page, "Default");
    const card = libraryAssetLocator(page, originalName).first();
    await expect(card).toBeVisible();

    await card.click({ button: "right" });
    await page
      .locator(`${SELECTORS.contextMenuItem}:text-is("Rename")`)
      .click();

    await expect(page.locator(SELECTORS.dialogInput)).toBeVisible();
    await page.fill(SELECTORS.dialogInput, renamedName);
    await page.click(SELECTORS.dialogConfirmBtn);

    await expect(libraryAssetLocator(page, renamedName).first()).toBeVisible();
    await expect(libraryAssetLocator(page, originalName)).toHaveCount(0);

    // Renaming keeps the asset actionable; Send to Collection… on it warns
    // because only the default collection exists.
    const renamedCard = libraryAssetLocator(page, renamedName).first();
    await renamedCard.click({ button: "right" });
    await page
      .locator(`${SELECTORS.contextMenuItem}:text-is("Send to Collection…")`)
      .click();

    await expect(
      page.locator(
        ".notyf__message:has-text('Create or own another collection first.')",
      ),
    ).toBeVisible();
  });

  test("deletes an asset from the context menu after confirmation", async ({
    page,
  }) => {
    const deleteMeName = uniqueAssetName("Delete Me");
    await connectLibrary(page);

    await page.goto("/studio");
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, deleteMeName, PROMPT);

    await page.goto("/library");
    await ensureLibraryConnected(page);
    await openLibraryCollection(page, "Default");
    const card = libraryAssetLocator(page, deleteMeName).first();
    await expect(card).toBeVisible();

    await card.click({ button: "right" });
    await page
      .locator(`${SELECTORS.contextMenuItem}:text-is("Delete")`)
      .click();

    // Confirm deletion in the GNOME dialog.
    await expect(page.locator(SELECTORS.dialogDeleteBtn)).toBeVisible();
    await page.click(SELECTORS.dialogDeleteBtn);

    await expect(libraryAssetLocator(page, deleteMeName)).toHaveCount(0);
  });
});
