import { test, expect } from "../fixtures/coverage.mjs";
import { connectStudio } from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "cowboy";

async function logCanvasState(page, label) {
  const info = await page.evaluate(() => {
    const canvas = document.getElementById("renderCanvas");
    return canvas
      ? {
          css: { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight },
          buffer: { width: canvas.width, height: canvas.height },
        }
      : null;
  });
  console.log(`[RESIZE-REGRESSION] ${label}:`, JSON.stringify(info));
  return info;
}

async function screenshot(page, label) {
  const path = `e2e/test-results/resize-regression-${label}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`[RESIZE-REGRESSION] screenshot saved: ${path}`);
}

test.describe("resize regression", () => {
  test.use({ colorScheme: "light" });

  test("canvas aspect stays correct across window resize and sidebar toggle", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await connectStudio(page);

    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );

    await page.waitForSelector("#renderCanvas");
    await page.waitForTimeout(2000);

    await logCanvasState(page, "baseline");
    await screenshot(page, "01-baseline");

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(1000);
    await logCanvasState(page, "wide");
    await screenshot(page, "02-wide");

    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(1000);
    await logCanvasState(page, "narrow");
    await screenshot(page, "03-narrow");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(1000);

    await page.click("#sidebarToggle");
    await page.waitForTimeout(1000);
    await logCanvasState(page, "sidebar-collapsed");
    await screenshot(page, "04-sidebar-collapsed");

    await page.keyboard.press("Control+b");
    await page.waitForTimeout(1000);
    await logCanvasState(page, "sidebar-expanded");
    await screenshot(page, "05-sidebar-expanded");

    await page.keyboard.press("1");
    await page.waitForTimeout(1000);
    await logCanvasState(page, "ortho-baseline");
    await screenshot(page, "06-ortho-baseline");

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.waitForTimeout(1000);
    await logCanvasState(page, "ortho-wide");
    await screenshot(page, "07-ortho-wide");

    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(1000);
    await logCanvasState(page, "ortho-narrow");
    await screenshot(page, "08-ortho-narrow");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(1000);
    await page.click("#sidebarToggle");
    await page.waitForTimeout(1000);
    await logCanvasState(page, "ortho-sidebar-collapsed");
    await screenshot(page, "09-ortho-sidebar-collapsed");

    await page.keyboard.press("Control+b");
    await page.waitForTimeout(1000);
    await logCanvasState(page, "ortho-sidebar-expanded");
    await screenshot(page, "10-ortho-sidebar-expanded");

    const info = await logCanvasState(page, "final");
    if (info) {
      expect(info.buffer.width).toBe(info.css.clientWidth);
      expect(info.buffer.height).toBe(info.css.clientHeight);
    }
  });
});
