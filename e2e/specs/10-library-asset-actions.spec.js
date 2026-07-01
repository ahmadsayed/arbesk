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
  test("renames an asset from the context menu", async ({ page }) => {
    const originalName = uniqueAssetName("Rename Me");
    const renamedName = uniqueAssetName("Renamed Asset");
    await connectLibrary(page);

    // Publish a target asset from Studio.
    await page.goto("/studio.html");
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, originalName, PROMPT);

    await page.goto("/library.html");
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
  });

  test("deletes an asset from the context menu after confirmation", async ({
    page,
  }) => {
    const deleteMeName = uniqueAssetName("Delete Me");
    await connectLibrary(page);

    await page.goto("/studio.html");
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, deleteMeName, PROMPT);

    await page.goto("/library.html");
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

  test("opens an asset in Studio from the context menu", async ({ page }) => {
    const openName = uniqueAssetName("Open From Menu");
    await connectLibrary(page);

    await page.goto("/studio.html");
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, openName, PROMPT);

    await page.goto("/library.html");
    await ensureLibraryConnected(page);
    await openLibraryCollection(page, "Default");
    const card = libraryAssetLocator(page, openName).first();
    await expect(card).toBeVisible();

    await card.click({ button: "right" });
    await page
      .locator(`${SELECTORS.contextMenuItem}:text-is("Open in Studio")`)
      .click();

    await page.waitForURL(/\/studio\.html\?asset=.*&assetId=/, {
      timeout: 10000,
    });
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.assetStatusName)).toContainText(
      openName,
    );
  });

  test("Send to Collection menu warns when no other collection exists", async ({
    page,
  }) => {
    const sendName = uniqueAssetName("Send Test");
    await connectLibrary(page);

    await page.goto("/studio.html");
    await ensureStudioConnected(page);
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, sendName, PROMPT);

    await page.goto("/library.html");
    await ensureLibraryConnected(page);
    await openLibraryCollection(page, "Default");
    const card = libraryAssetLocator(page, sendName).first();
    await expect(card).toBeVisible();

    await card.click({ button: "right" });
    await page
      .locator(`${SELECTORS.contextMenuItem}:text-is("Send to Collection…")`)
      .click();

    // Without a second collection, the UI shows a warning toast instead of a dialog.
    await expect(
      page.locator(".notyf__message:has-text('Create or own another collection first.')"),
    ).toBeVisible();
  });
});
