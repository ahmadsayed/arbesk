import { test, expect } from "../fixtures/coverage.mjs";
import { connectStudio, sendPendingGenerationToStudio } from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "cowboy";
const ENABLE_SCREENSHOTS = process.env.E2E_SCREENSHOTS === "1";

async function getCanvasState(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("renderCanvas");
    return canvas
      ? {
          css: {
            clientWidth: canvas.clientWidth,
            clientHeight: canvas.clientHeight,
          },
          buffer: { width: canvas.width, height: canvas.height },
        }
      : null;
  });
}

async function waitForCanvasStable(page, timeout = 10000) {
  const start = Date.now();
  let last = null;
  let stableSince = 0;

  while (Date.now() - start < timeout) {
    const info = await getCanvasState(page);
    if (!info) {
      await page.waitForTimeout(50);
      continue;
    }

    const matches =
      info.buffer.width === info.css.clientWidth &&
      info.buffer.height === info.css.clientHeight;

    if (matches) {
      const now = Date.now();
      if (last && last.buffer.width === info.buffer.width && last.buffer.height === info.buffer.height) {
        if (now - stableSince >= 150) {
          return info;
        }
      } else {
        stableSince = now;
      }
    } else {
      stableSince = 0;
    }

    last = info;
    await page.waitForTimeout(50);
  }

  throw new Error("Canvas did not stabilize within timeout");
}

async function logCanvasState(page, label) {
  const info = await getCanvasState(page);
  console.log(`[RESIZE-REGRESSION] ${label}:`, JSON.stringify(info));
  return info;
}

async function screenshot(page, label) {
  if (!ENABLE_SCREENSHOTS) return;
  const path = `e2e/test-results/resize-regression-${label}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`[RESIZE-REGRESSION] screenshot saved: ${path}`);
}

async function resizeAndCheck(page, label, size) {
  if (size) {
    await page.setViewportSize(size);
  }
  await waitForCanvasStable(page);
  await logCanvasState(page, label);
  await screenshot(page, label);
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
    await sendPendingGenerationToStudio(page);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via mock",
    );

    await page.waitForSelector("#renderCanvas");
    await waitForCanvasStable(page);

    await resizeAndCheck(page, "01-baseline");
    await resizeAndCheck(page, "02-wide", { width: 1400, height: 900 });
    await resizeAndCheck(page, "03-narrow", { width: 900, height: 700 });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click("#sidebarToggle");
    await resizeAndCheck(page, "04-sidebar-collapsed");

    await page.keyboard.press("Control+b");
    await resizeAndCheck(page, "05-sidebar-expanded");

    await page.keyboard.press("1");
    await resizeAndCheck(page, "06-ortho-baseline");
    await resizeAndCheck(page, "07-ortho-wide", { width: 1400, height: 900 });
    await resizeAndCheck(page, "08-ortho-narrow", { width: 900, height: 700 });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click("#sidebarToggle");
    await resizeAndCheck(page, "09-ortho-sidebar-collapsed");

    await page.keyboard.press("Control+b");
    await resizeAndCheck(page, "10-ortho-sidebar-expanded");

    const info = await logCanvasState(page, "final");
    if (info) {
      expect(info.buffer.width).toBe(info.css.clientWidth);
      expect(info.buffer.height).toBe(info.css.clientHeight);
    }
  });
});
