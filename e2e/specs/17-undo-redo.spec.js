import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { connectStudio, generate } from "../helpers/flows.mjs";

test.describe("undo/redo", () => {
  test("inspector scale edit undoes via Ctrl+Z and redoes via toolbar", async ({
    page,
  }) => {
    await connectStudio(page);
    await generate(page, "cowboy");

    // Select the first node in the Outliner → inspector opens with scale fields.
    await page.click(SELECTORS.outlinerSwitcherBtn);
    await page.locator(SELECTORS.outlinerNode).first().click();
    // The Scale inspector section starts collapsed — expand it to reveal the field.
    await page.click("#scaleSection summary");
    const scaleInput = page.locator(SELECTORS.scaleFactorInput);
    await expect(scaleInput).toBeVisible();
    const original = await scaleInput.inputValue();

    // Undo/redo start disabled.
    await expect(page.locator(SELECTORS.undoButton)).toBeDisabled();
    await expect(page.locator(SELECTORS.redoButton)).toBeDisabled();

    // Commit a scale edit through the inspector field (change event).
    await scaleInput.evaluate((el) => {
      el.value = "2";
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(scaleInput).toHaveValue("2");
    await expect(page.locator(SELECTORS.undoButton)).toBeEnabled();

    // Ctrl+Z restores the original scale. Blur first: the shortcut is
    // intentionally blocked while a text input is focused.
    await scaleInput.evaluate((el) => el.blur());
    await page.keyboard.press("Control+z");
    await expect(scaleInput).toHaveValue(original);
    await expect(page.locator(SELECTORS.redoButton)).toBeEnabled();

    // Toolbar redo re-applies the edit.
    await page.locator(SELECTORS.redoButton).click();
    await expect(scaleInput).toHaveValue("2");
  });
});
