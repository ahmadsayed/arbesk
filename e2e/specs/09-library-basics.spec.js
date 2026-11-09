import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  libraryCollectionLocator,
  openLibraryCollection,
  waitForLibraryItemCount,
  seedDefaultCollection,
} from "../helpers/flows.mjs";

// Library tests mutate the shared default collection, so run them serially.
// They self-seed in beforeAll so they can run in isolation.
test.describe.serial("Library basics", () => {
  test.beforeAll(async ({ browser }) => {
    await seedDefaultCollection(browser);
  });

  test("navigates, searches and switches layout in the collection browser", async ({
    page,
  }) => {
    await connectLibrary(page);

    // ── Breadcrumb + Up navigation ────────────────────────────────────
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

    // ── Search filters collections and assets ─────────────────────────
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

    // ── Grid / list view toggle ───────────────────────────────────────
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
});
