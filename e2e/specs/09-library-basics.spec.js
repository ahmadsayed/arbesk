import { test, expect } from "../fixtures/coverage.mjs";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  libraryCollectionLocator,
  libraryAssetLocator,
  openLibraryCollection,
  waitForLibraryItemCount,
  libraryItemNames,
  generateSaveAndPublish,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const ASSET_NAME_BASE = "Library Basics Asset";
const PROMPT = "a glowing cube";

// Library tests mutate the shared default collection, so run them serially.
test.describe.serial("Library basics", () => {
  test("shows wallet gate until connected", async ({ page }) => {
    await page.goto("/library.html");
    await expect(page.locator(SELECTORS.libraryGate)).toBeVisible();
    await expect(page.locator(SELECTORS.libraryMain)).toBeHidden();
    await expect(page.locator(SELECTORS.libraryConnectBtn)).toBeVisible();

    await injectHardhatProvider(page);
    await page.goto("/library.html");
    await expect(page.locator(SELECTORS.libraryGate)).toBeHidden();
    await expect(page.locator(SELECTORS.libraryMain)).toBeVisible();
  });

  test("displays the wallet-derived default collection as Default after a publish", async ({
    page,
  }) => {
    const assetName = uniqueAssetName(ASSET_NAME_BASE);
    await connectLibrary(page);

    // Publish an asset from Studio to mint the default collection.
    await page.goto("/studio.html");
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, assetName, PROMPT);

    await page.goto("/library.html");
    await waitForLibraryItemCount(page, 1);

    const defaultCollection = libraryCollectionLocator(page, "Default");
    await expect(defaultCollection).toBeVisible();
    await expect(
      defaultCollection.locator(SELECTORS.libraryItemName),
    ).toHaveText("Default");
  });

  test("opens the default collection and lists its assets", async ({ page }) => {
    const assetName = uniqueAssetName(ASSET_NAME_BASE);
    await connectLibrary(page);
    // Ensure there is at least one asset by publishing from Studio first.
    await page.goto("/studio.html");
    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await generateSaveAndPublish(page, assetName, PROMPT);

    await page.goto("/library.html");
    await expect(page.locator(SELECTORS.libraryMain)).toBeVisible();

    await openLibraryCollection(page, "Default");
    const assetCard = libraryAssetLocator(page, assetName).first();
    await expect(assetCard).toBeVisible();
  });

  test("breadcrumb and Up button navigate back to collections", async ({
    page,
  }) => {
    await connectLibrary(page);
    await openLibraryCollection(page, "Default");

    await expect(page.locator(SELECTORS.libraryBreadcrumb)).toContainText(
      "Default",
    );

    await page.click(SELECTORS.libraryUpBtn);
    await expect(page.locator(SELECTORS.libraryBreadcrumb)).not.toContainText(
      "Default",
    );
    await expect(libraryCollectionLocator(page, "Default")).toBeVisible();

    // Breadcrumb home segment also works.
    await openLibraryCollection(page, "Default");
    await page.click(SELECTORS.libraryBreadcrumbHome);
    await expect(libraryCollectionLocator(page, "Default")).toBeVisible();
  });

  test("search filters collections and assets", async ({ page }) => {
    await connectLibrary(page);

    // Search for the default collection by name.
    await page.fill(SELECTORS.librarySearchInput, "Defaul");
    await waitForLibraryItemCount(page, 1);
    await expect(libraryCollectionLocator(page, "Default")).toBeVisible();

    await page.fill(SELECTORS.librarySearchInput, "no-such-item-xyz");
    await expect(page.locator(SELECTORS.libraryItem)).toHaveCount(0);
    await expect(
      page.locator(`${SELECTORS.libraryItems} .empty-state-title`),
    ).toContainText("No items match your search");

    await page.fill(SELECTORS.librarySearchInput, "");
    await waitForLibraryItemCount(page, 1);
  });

  test("grid and list view toggle switch the layout", async ({ page }) => {
    await connectLibrary(page);
    await waitForLibraryItemCount(page, 1);

    // Default is grid: items are direct children of #libraryItems.
    await expect(
      page.locator(`${SELECTORS.libraryItems} ${SELECTORS.libraryItem}`),
    ).toHaveCount(1);

    await page.click(SELECTORS.libraryListViewBtn);
    await expect(page.locator(".library-list-table")).toBeVisible();
    await expect(page.locator(".library-list-table tbody tr")).toHaveCount(1);

    await page.click(SELECTORS.libraryGridViewBtn);
    await expect(page.locator(".library-list-table")).toHaveCount(0);
    await expect(
      page.locator(`${SELECTORS.libraryItems} ${SELECTORS.libraryItem}`),
    ).toHaveCount(1);
  });

  test("sort by name orders items alphabetically", async ({ page }) => {
    await connectLibrary(page);
    // With only the Default collection, the name order is trivial but still
    // deterministic.
    await page.selectOption(SELECTORS.librarySortSelect, "name");
    const names = await libraryItemNames(page);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
