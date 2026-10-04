import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectStudio,
  generate,
  saveDraft,
  enterEditMode,
  firstAnchorState,
  perturbFirstAnchor,
} from "../helpers/flows.mjs";

test.describe("view / edit mode", () => {
  test("view by default; edit grounds, resets, and marks unsaved until saved", async ({ page }) => {
    await connectStudio(page);
    // No asset open → nothing to edit.
    await expect(page.locator(SELECTORS.editModeButton)).toBeHidden();

    const cid = await generate(page, "cowboy");
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();

    // View mode: selection shows no placement tools.
    await expect(page.locator(SELECTORS.editModeButton)).toBeVisible();
    await expect(page.locator(SELECTORS.dropToFloorButton)).toBeHidden();
    await expect(page.locator(SELECTORS.timeModeButton)).toBeVisible();

    await enterEditMode(page);
    await expect(page.locator(SELECTORS.lockFloorToggle)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(SELECTORS.timeModeButton)).toBeHidden();

    // Drop to floor: a floating model lands on Y = 0 and the asset is dirty.
    await perturbFirstAnchor(page, { dy: 5 });
    await page.click(SELECTORS.dropToFloorButton);
    expect((await firstAnchorState(page)).minY).toBeCloseTo(0, 3);
    await expect(page.locator(SELECTORS.assetMeta)).toContainText("Unsaved changes");
    await expect(page.locator(SELECTORS.unsavedMarker)).toBeVisible();

    // Reset: rotation identity, centred on X/Z, grounded, scale kept.
    const before = await firstAnchorState(page);
    await perturbFirstAnchor(page, { dx: 3, rotateZ: 0.6 });
    await page.click(SELECTORS.resetTransformButton);
    const reset = await firstAnchorState(page);
    expect(reset.qw).toBeCloseTo(1, 4);
    expect(reset.cx).toBeCloseTo(0, 3);
    expect(reset.cz).toBeCloseTo(0, 3);
    expect(reset.minY).toBeCloseTo(0, 3);
    expect(reset.sx).toBeCloseTo(before.sx, 6);

    // Leaving Edit keeps the staged edits; Save draft clears the marker.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("e");
    await expect(page.locator(SELECTORS.editModeButton)).toHaveText("Edit");
    await expect(page.locator(SELECTORS.assetMeta)).toContainText("Unsaved changes");

    await saveDraft(page, cid);
    await expect(page.locator(SELECTORS.assetMeta)).not.toContainText("Unsaved changes");
    await expect(page.locator(SELECTORS.unsavedMarker)).toHaveCount(0);
  });
});
