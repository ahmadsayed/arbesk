/**
 * Animation preview: an uploaded GLB containing a glTF animation shows the
 * inspector "Animations" section; picking the clip selects it in the
 * dropdown, "None" resets. (Playback wiring is unit-tested in
 * test/frontend/animation-preview.test.js.)
 */
import { test, expect } from "../fixtures/coverage.mjs";
import path from "node:path";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  createLibraryCollection,
  openLibraryCollection,
  uploadLibraryFile,
  openLibraryAssetInStudio,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const GLB_FIXTURE = path.resolve("e2e/fixtures/animated-triangle.glb");
const ASSET_NAME = "animated-triangle";

test("inspector lists model animations and previews the selected clip", async ({
  page,
}) => {
  await connectLibrary(page);
  const collectionName = uniqueAssetName("Animation Collection");
  await createLibraryCollection(page, collectionName);
  await openLibraryCollection(page, collectionName);
  await uploadLibraryFile(page, GLB_FIXTURE, ASSET_NAME);
  await openLibraryAssetInStudio(page, ASSET_NAME);

  await page.click(SELECTORS.outlinerSwitcherBtn);
  await page.locator(SELECTORS.outlinerNode).first().click();

  const section = page.locator(SELECTORS.animationsSection);
  await expect(section).toBeVisible();

  const select = page.locator(SELECTORS.animationSelect);
  await expect(select.locator("option")).toHaveText(["None", "spin"]);

  await select.selectOption("0");
  await expect(select).toHaveValue("0");

  await select.selectOption("");
  await expect(select).toHaveValue("");
});
