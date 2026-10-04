import { test, expect } from "../fixtures/coverage.mjs";
import { MANIFEST_URL_REGEX, fetchManifest } from "../helpers/manifest.mjs";
import {
  connectStudio,
  generateToChatBubble,
  openInspector,
  saveDraft,
} from "../helpers/flows.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";

const PROMPT = "cowboy";

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("asset metadata", () => {
  test("save bakes metadata.computed into the manifest and it survives reopen", async ({
    page,
  }) => {
    await connectStudio(page);

    // Generate → Show in Studio (auto-saves the draft and bakes metadata).
    const send = await generateToChatBubble(page, PROMPT);
    await send.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);
    const saveCid = manifestCidFromUrl(page.url());
    expect(saveCid).toBeTruthy();

    // The saved manifest carries deterministic computed facts for the glTF root.
    const saved = await fetchManifest(saveCid);
    expect(saved.metadata?.computed).toBeTruthy();
    expect(saved.metadata.computed.format).toBe("gltf");

    // Cold reopen: boot re-reads ?manifest= and the metadata survives.
    await page.reload();
    await page.waitForURL(MANIFEST_URL_REGEX);
    expect(manifestCidFromUrl(page.url())).toBe(saveCid);
  });

  test("status bar shows unit-aware facts after save", async ({ page }) => {
    await connectStudio(page);

    const send = await generateToChatBubble(page, "cowboy");
    await send.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);

    // Mock glTF stats are meter-scale — the readout appears with an m suffix.
    const info = page.locator(SELECTORS.bottomBarAssetInfo);
    await expect(info).toBeVisible();
    await expect(info).toContainText("m ·");
    await expect(info).toContainText("tris");
  });

  test("printability check reports the mock model honestly (not watertight)", async ({
    page,
  }) => {
    await connectStudio(page);
    const send = await generateToChatBubble(page, "cowboy");
    await send.click();
    await page.waitForURL(MANIFEST_URL_REGEX);

    // The button lives in Properties → Metadata → Auto-detected (collapsed).
    await openInspector(page);
    await page
      .locator(".metadata-section summary", { hasText: "Auto-detected" })
      .click();
    await page.locator(SELECTORS.printCheckBtn).click();
    // AI-generated characters have open clothing shells — the badge reports
    // the real topology, count included (not pinned: fixture may change).
    await expect(page.locator(SELECTORS.printBadge)).toHaveText(
      /^Not watertight · \d+ open edges$/,
    );
  });

  test("typed metadata fields persist across save and reopen", async ({
    page,
  }) => {
    await connectStudio(page);
    const send = await generateToChatBubble(page, "cowboy");
    await send.click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(page.locator(SELECTORS.assetBubbleSaved)).toHaveCount(1);

    await openInspector(page);
    await page.locator(SELECTORS.metaLicence).fill("CC-BY-4.0");
    await page.locator(SELECTORS.metaUnits).selectOption("mm");

    const cid = await saveDraft(page, manifestCidFromUrl(page.url()));
    await page.reload();
    await page.waitForURL(MANIFEST_URL_REGEX);
    expect(manifestCidFromUrl(page.url())).toBe(cid);

    await openInspector(page);
    await expect(page.locator(SELECTORS.metaLicence)).toHaveValue("CC-BY-4.0");
    await expect(page.locator(SELECTORS.metaUnits)).toHaveValue("mm");
  });

  test("CAD save stamps mm units end-to-end (status bar + fields)", async ({
    page,
  }) => {
    await connectStudio(page);

    // Mock CAD is on in the e2e stack — the canned box needs no DeepSeek key.
    await page.locator(SELECTORS.providerSelect).selectOption("cad");
    await page.fill(SELECTORS.promptInput, "a 40 by 30 by 20 mm box");
    await page.click(SELECTORS.generateBtn);
    const bubble = page.locator(SELECTORS.assetBubble).first();
    await expect(bubble).toBeVisible({ timeout: 60_000 });
    await bubble.locator(".chat-asset-send").click();
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(bubble).toHaveClass(/chat-bubble-asset-saved/, {
      timeout: 30_000,
    });

    // The saved 3MF root carries kernel stats → mm dimensions in the status bar…
    const info = page.locator(SELECTORS.bottomBarAssetInfo);
    await expect(info).toBeVisible();
    await expect(info).toContainText("mm ·");
    // …and the mm units default lands in the annotations.
    const cid = manifestCidFromUrl(page.url());
    const saved = await fetchManifest(cid);
    expect(saved.metadata?.annotations?.units).toBe("mm");
    expect(saved.metadata?.computed?.dimensions?.unit).toBe("mm");

    await openInspector(page);
    await expect(page.locator(SELECTORS.metaUnits)).toHaveValue("mm");

    // Kernel output is guaranteed watertight — the positive print-ready case.
    await page
      .locator(".metadata-section summary", { hasText: "Auto-detected" })
      .click();
    await page.locator(SELECTORS.printCheckBtn).click();
    await expect(page.locator(SELECTORS.printBadge)).toHaveText("Print-ready");
  });
});
