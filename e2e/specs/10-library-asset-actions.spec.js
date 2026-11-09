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

  test("renames, warns on Send to Collection, then deletes from the context menu", async ({
    page,
  }) => {
    const originalName = uniqueAssetName("Rename Me");
    const renamedName = uniqueAssetName("Renamed Asset");
    await connectLibrary(page);

    // Publish one target asset; rename and delete both act on it.
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

    // Delete the same renamed asset after confirming in the GNOME dialog.
    await renamedCard.click({ button: "right" });
    await page
      .locator(`${SELECTORS.contextMenuItem}:text-is("Delete")`)
      .click();

    await expect(page.locator(SELECTORS.dialogDeleteBtn)).toBeVisible();
    await page.click(SELECTORS.dialogDeleteBtn);

    await expect(libraryAssetLocator(page, renamedName)).toHaveCount(0);
  });
});
