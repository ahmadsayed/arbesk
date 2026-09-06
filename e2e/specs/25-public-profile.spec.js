import { test, expect } from "../fixtures/coverage.mjs";
import { injectHardhatProvider } from "../fixtures/hardhat-provider.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  connectLibrary,
  ensureLibraryConnected,
  ensureStudioConnected,
  seedDefaultCollection,
  generateSaveAndPublish,
  libraryCollectionLocator,
  libraryAssetLocator,
  openLibraryCollection,
  openLibraryAssetInStudio,
  uniqueAssetName,
} from "../helpers/flows.mjs";
import { HARDHAT_ACCOUNTS } from "../fixtures/multi-wallet.mjs";

// base58 (Bitcoin alphabet) of the 20-byte EVM address — the public profile
// id format produced by frontend/src/js/utils/base58.ts.
function addressToBase58(address) {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const hex = address.replace(/^0x/i, "");
  let num = BigInt(`0x${hex}`);
  let encoded = "";
  while (num > 0n) {
    encoded = ALPHABET[Number(num % 58n)] + encoded;
    num = num / 58n;
  }
  let zeros = 0;
  while (hex.slice(zeros * 2, zeros * 2 + 2) === "00") zeros++;
  return "1".repeat(zeros) + encoded;
}

const OWNER_BASE58 = addressToBase58(HARDHAT_ACCOUNTS[0].address);
const SEED_ASSET_NAME = "Public Profile Seed Asset";

// The profile subject's default collection is seeded in beforeAll so the spec
// runs in isolation. The visitor page itself never connects a wallet.
test.describe.serial("Public profile (anonymous visitor)", () => {
  test.beforeAll(async ({ browser }) => {
    await seedDefaultCollection(browser, SEED_ASSET_NAME);
  });

  test("anonymous visitor browses a public library read-only", async ({
    page,
  }) => {
    await page.goto(`/library/${OWNER_BASE58}`);

    // No sign-in gate for a valid profile subject.
    await expect(page.locator(SELECTORS.libraryGate)).toBeHidden();
    await expect(page.locator(SELECTORS.libraryMain)).toBeVisible();

    // The subject's seeded collection renders without any wallet.
    await expect(libraryCollectionLocator(page, "Default")).toBeVisible();

    // Read-only chrome: no create/upload, visitor badge identifies the profile.
    await expect(
      page.locator(SELECTORS.libraryCreateCollectionBtn),
    ).toBeHidden();
    await expect(page.locator(SELECTORS.libraryUploadBtn)).toBeHidden();
    await expect(page.locator(SELECTORS.libraryVisitorBadge)).toBeVisible();
    await expect(page.locator(SELECTORS.libraryVisitorBadge)).toContainText(
      "public library",
    );
  });

  test("bare /library without a wallet still shows the sign-in gate", async ({
    page,
  }) => {
    await page.goto("/library");
    await expect(page.locator(SELECTORS.libraryGate)).toBeVisible();
    await expect(page.locator(SELECTORS.libraryMain)).toBeHidden();
  });

  test("connecting a wallet scopes a bare view URL to the wallet's profile", async ({
    page,
  }) => {
    await connectLibrary(page);

    // The bare /library URL is rewritten (replaceState) to the connected
    // wallet's public profile URL.
    expect(page.url()).toContain(`/library/${OWNER_BASE58}`);

    // Subject == connected wallet: owner mode, no visitor chrome.
    await expect(page.locator(SELECTORS.libraryVisitorBadge)).toBeHidden();
    await expect(
      page.locator(SELECTORS.libraryCreateCollectionBtn),
    ).toBeVisible();
    await expect(libraryCollectionLocator(page, "Default")).toBeVisible();
  });

  test("opening an asset from the library scopes the Studio URL", async ({
    page,
  }) => {
    await connectLibrary(page);
    await openLibraryCollection(page, "Default");
    await openLibraryAssetInStudio(page, SEED_ASSET_NAME);

    // The Library → Studio handoff carries the profile subject:
    // /studio/<base58>?asset=…&assetId=…
    expect(page.url()).toContain(`/studio/${OWNER_BASE58}?asset=`);
  });

  test("anonymous visitor opens a published asset in Studio read-only", async ({
    browser,
    page,
  }) => {
    // Create a real published asset as the connected owner.
    const assetName = uniqueAssetName("Anonymous Studio Asset");
    await injectHardhatProvider(page);
    await page.goto("/studio");
    await ensureStudioConnected(page);
    const tokenIdHex = await generateSaveAndPublish(page, assetName);
    const tokenIdDec = BigInt(tokenIdHex).toString();

    // Resolve the asset's id within the collection from its library card
    // (data-id="asset-<tokenId>-<assetId>").
    await page.goto("/library");
    await ensureLibraryConnected(page);
    await openLibraryCollection(page, "Default");
    const card = libraryAssetLocator(page, assetName).first();
    await expect(card).toBeVisible();
    const cardId = await card.getAttribute("data-id");
    const assetId = cardId.replace(`asset-${tokenIdDec}-`, "");

    // Fresh anonymous page — no injected wallet, no session.
    const anon = await browser.newPage();
    try {
      await anon.goto(
        `/studio/${OWNER_BASE58}?asset=${tokenIdDec}&assetId=${assetId}`,
      );
      // The tokenURI read and manifest load work without a wallet.
      await expect(anon.locator(SELECTORS.assetStatusName)).toContainText(
        assetName,
        { timeout: 30000 },
      );
      // View-only: save/publish stay hidden without a wallet.
      await expect(anon.locator(SELECTORS.saveAssetBtn)).toBeHidden();
      await expect(anon.locator(SELECTORS.publishAssetBtn)).toBeHidden();
    } finally {
      await anon.close();
    }
  });

  test("anonymous studio profile loads the sidebar gallery (no sign-in prompt)", async ({
    browser,
    page,
  }) => {
    // Publish a real asset as the owner so the profile has gallery content.
    const assetName = uniqueAssetName("Anonymous Gallery Asset");
    await injectHardhatProvider(page);
    await page.goto("/studio");
    await ensureStudioConnected(page);
    await generateSaveAndPublish(page, assetName);

    // Fresh anonymous page on the bare studio profile URL — no wallet.
    const anon = await browser.newPage();
    try {
      await anon.goto(`/studio/${OWNER_BASE58}`);

      // The sidebar Gallery shows the subject's assets, not a sign-in prompt.
      await anon.click(SELECTORS.gallerySwitcherBtn);
      const card = anon
        .locator(SELECTORS.assetCard)
        .filter({ hasText: assetName })
        .first();
      await expect(card).toBeVisible({ timeout: 30000 });
      await expect(anon.locator("#galleryConnectBtn")).toHaveCount(0);
      await expect(
        anon.locator(SELECTORS.galleryVisitorBadge),
      ).toBeVisible();
      await expect(
        anon.locator(SELECTORS.galleryVisitorBadge),
      ).toContainText("Read-only");
      // Read-only chrome: no New button for anonymous profile visitors.
      await expect(anon.locator(SELECTORS.newAssetBtn)).toBeHidden();

      // Clicking the card opens the asset in the viewport. Under full-suite
      // load the click races with anonymous profile init settling (a clobbered
      // open reverts to "No asset open"), so retry until the open sticks.
      await expect(async () => {
        await card.click();
        await expect(anon.locator(SELECTORS.assetStatusName)).toContainText(
          assetName,
          { timeout: 10000 },
        );
      }).toPass({ timeout: 60000, intervals: [1000, 2000, 5000] });
    } finally {
      await anon.close();
    }
  });
});
