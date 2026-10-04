import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import {
  MANIFEST_URL_REGEX,
  fetchManifest,
  assertGenerationManifest,
  assertSavedManifest,
  manifestCidFromUrl,
} from "../helpers/manifest.mjs";
import { connectStudio } from "../helpers/flows.mjs";

const PROMPT = "a 40 by 30 by 20 mm box";
const DRAGON_PROMPT = "a dragon figurine";

// The e2e backend spawns with CAD_MOCK_GENERATION + CAD_MOCK_UNSUITABLE
// (e2e/global-setup.mjs): the canned parametric box settles every prompt, and
// a prompt containing "dragon" refuses with the same CadRequestUnsuitable
// shape as the real facade's suitability judgement.
test.describe("CAD generation (parametric, client-rendered)", () => {
  test("generates a parametric box, shows a 3MF bubble, saves as a 3mf asset", async ({
    page,
  }) => {
    await connectStudio(page);

    // Mock cad is on in the e2e stack — pick Parametric CAD in the composer.
    await page.locator(SELECTORS.providerSelect).selectOption("cad");

    // The CAD chain is slower than the mock adapter: POST → poll → worker
    // render (WASM) → 3MF export → two IPFS uploads. Wait explicitly.
    await page.fill(SELECTORS.promptInput, PROMPT);
    await page.click(SELECTORS.generateBtn);

    // The result lands as a version-card bubble with a live orbitable
    // preview; the Studio scene and URL stay untouched until send.
    const bubble = page.locator(SELECTORS.assetBubble).first();
    await expect(bubble).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(SELECTORS.assetBubbleCanvas)).toBeVisible();
    expect(MANIFEST_URL_REGEX.test(page.url())).toBe(false);

    // Send it to the Studio: Show in Studio auto-saves a draft, so the URL
    // CID is the saved v2 and the raw generation manifest (v1) is its prev.
    const sendButton = bubble.locator(".chat-asset-send");
    await sendButton.click();
    await expect(page.locator(SELECTORS.chatHistoryList)).toContainText(
      "Model carved via cad",
    );
    await page.waitForURL(MANIFEST_URL_REGEX);
    await expect(bubble).toHaveClass(/chat-bubble-asset-sent/);
    await expect(sendButton).toHaveText("Show in Studio");

    // The auto-save landed: the bubble earns the saved pill.
    await expect(bubble).toHaveClass(/chat-bubble-asset-saved/, {
      timeout: 30_000,
    });

    // The sent bubble collapses its live preview: a captured snapshot when
    // available, otherwise the static format chip. The chip renders the
    // bubble format uppercased — for CAD that is "3MF".
    const badge = bubble.locator(".chat-asset-badge");
    const snapshot = bubble.locator(".chat-asset-snapshot");
    await expect(badge.or(snapshot)).toBeVisible({ timeout: 15_000 });
    if (await badge.isVisible()) {
      await expect(badge).toHaveText("3MF");
    } else {
      await expect(snapshot).toHaveAttribute("alt", `Snapshot of ${PROMPT}`);
    }

    // Manifest assertions: the generation manifest is a raw 3MF source asset
    // carrying the CAD provenance; the saved manifest decomposed it and
    // recomputed the derived format fact.
    const savedCid = manifestCidFromUrl(page.url());
    expect(savedCid).toBeTruthy();
    const savedManifest = await fetchManifest(savedCid);
    const genCid = savedManifest.prev_asset_manifest_cid;
    expect(genCid).toBeTruthy();

    const genManifest = await fetchManifest(genCid);
    assertGenerationManifest(genManifest, { prompt: PROMPT });
    const genNode = genManifest.scene.nodes[0];
    expect(genNode.source.format).toBe("3mf");
    expect(genNode.source.path).toBe("asset.3mf");
    expect(genManifest.metadata?.cad?.summary).toBeTruthy();

    assertSavedManifest(savedManifest, genCid);
    const savedNode = savedManifest.scene.nodes[0];
    expect(savedNode.source.format).toBe("3mf");
    expect(savedManifest.metadata?.computed?.format).toBe("3mf");
  });

  test("unsuitable request offers a Tripo 3D retry", async ({ page }) => {
    await connectStudio(page);
    await page.locator(SELECTORS.providerSelect).selectOption("cad");

    await page.fill(SELECTORS.promptInput, DRAGON_PROMPT);
    await page.click(SELECTORS.generateBtn);

    // The mock cad generator refuses organic subjects exactly like the real
    // facade (CadRequestUnsuitable before any model call); the UI turns that
    // into a choice bubble instead of a dead-end error.
    const choice = page.locator(SELECTORS.choiceBubble);
    await expect(choice).toBeVisible({ timeout: 30_000 });
    await expect(choice).toContainText(
      "Parametric CAD can't model this request",
    );
    const retry = page.locator(SELECTORS.choiceButton("Retry with Tripo 3D"));
    await expect(retry).toBeVisible();
    await retry.click();

    // Picking the retry flips the provider select to Tripo 3D and
    // re-dispatches the prompt — which, with no BYOK key configured in the
    // e2e stack, lands on the provider-key dialog rather than a generation.
    await expect(page.locator(SELECTORS.providerSelect)).toHaveValue(
      "tripo3d",
    );
    await expect(
      page.locator("#appDialogHost .dialog-title"),
    ).toHaveText("Tripo 3D API Key");
  });
});
