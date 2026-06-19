import { test, expect } from "@playwright/test";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { assertGenerationManifest } from "../helpers/manifest.mjs";

const PROMPT = "cowboy";

const PINATA_ENABLED =
  process.env.IPFS_BACKEND === "pinata" &&
  !!process.env.PINATA_JWT &&
  !!process.env.PINATA_GATEWAY;

function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

test.describe("Pinata storage (real network)", () => {
  test.skip(
    !PINATA_ENABLED,
    "Set IPFS_BACKEND=pinata + PINATA_JWT + PINATA_GATEWAY to run"
  );

  test("stores an asset on Pinata, returns a CIDv1, resolves via gateway, never leaks the JWT", async ({ page }) => {
    const pinataRequests = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("pinata.cloud") || url.includes("pinata")) {
        pinataRequests.push({ url, headers: req.headers() });
      }
    });

    await injectHardhatProvider(page);
    await page.goto("/studio.html");

    await expect(page.locator(SELECTORS.connectWalletBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.disconnectWalletBtn)).not.toContainText("Sign In");

    // Generate a mock asset. The backend is running with IPFS_BACKEND=pinata,
    // so the manifest/source CIDs are pinned to Pinata via the presigned URL.
    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);

    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(PROMPT);
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText("Model carved via mock");

    // CIDv1 manifests start with bafy... (Pinata public uploads).
    await page.waitForURL(/[?&]manifest=bafy[\w]+/);
    const manifestCid = manifestCidFromUrl(page.url());
    expect(manifestCid).toMatch(/^bafy/);

    // Save the draft so the thumbnail/manifest round-trip also exercises Pinata.
    await page.click(SELECTORS.saveAssetBtn);
    await page.waitForURL((url) => {
      const cid = manifestCidFromUrl(url.toString());
      return Boolean(cid) && cid !== manifestCid && /^bafy/.test(cid);
    });
    const savedCid = manifestCidFromUrl(page.url());
    expect(savedCid).toMatch(/^bafy/);

    // Resolve the saved manifest back through the Pinata dedicated gateway.
    const gw = `https://${process.env.PINATA_GATEWAY}/ipfs/${savedCid}`;
    const res = await page.request.get(gw);
    expect(res.ok()).toBe(true);

    const savedManifest = await res.json();
    assertGenerationManifest(savedManifest, { prompt: PROMPT, provider: "mock" });

    // The browser must have talked to Pinata (presigned upload URL), but the
    // master JWT never leaves the backend.
    expect(pinataRequests.length).toBeGreaterThan(0);
    const allHeaders = pinataRequests.map((r) => JSON.stringify(r.headers)).join("\n");
    expect(allHeaders).not.toMatch(/PINATA_JWT|Bearer\s+[A-Za-z0-9_\-]+/);
  });
});
