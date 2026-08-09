/**
 * New asset flow: clicking "+ New" and typing a name in the dialog must show
 * that name in the header. Regression: startNewAsset emitted SCENE_EMPTY
 * after writing the title, and the SCENE_EMPTY listener reset the header to
 * "No asset open".
 */
import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { connectStudio } from "../helpers/flows.mjs";

test("New asset shows the typed name in the header", async ({ page }) => {
  await connectStudio(page);

  await page.click(SELECTORS.newAssetBtn);
  await page.fill(SELECTORS.dialogInput, "My Test Asset");
  await page.click(SELECTORS.dialogConfirmBtn);

  await expect(page.locator(SELECTORS.assetStatusName)).toHaveText(
    "My Test Asset"
  );
});
