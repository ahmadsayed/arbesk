import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { fetchTokenManifest, findAssetCidByName } from "../helpers/manifest.mjs";
import {
  connectStudioAs,
  generate,
  generateSaveAndPublish,
  saveDraft,
  editFirstNodeColor,
  assetCardLocator,
  uniqueAssetName,
  connectLibrary,
  openLibraryCollection,
  openLibraryAssetInStudio,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";

// Two windows on the same scene with a live-ref child: republishing the child
// in window A must reload it in window B via the relay notice (kind 20001).
// The test also subscribes to the Nostr relay from the test process so a
// failure splits cleanly into publish-side (no relay event) vs subscribe-side
// (event seen, no reload in B).
test.describe("cross-window live scene update", () => {
  test.setTimeout(240_000);

  test("republishing a child in window A reloads it in window B", async ({
    browser,
  }) => {
    // ── 0. Watch the relay from the test process itself ─────────────────
    const relayEvents = [];
    const ws = new WebSocket("ws://127.0.0.1:7777");
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("relay ws connect failed"));
    });
    ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(m.data);
        if (msg[0] === "EVENT") relayEvents.push(msg[2]);
      } catch {
        /* ignore */
      }
    };
    ws.send(JSON.stringify(["REQ", "repro-sub", { kinds: [20001] }]));

    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    pageA.on("dialog", (d) => d.accept());
    pageB.on("dialog", (d) => d.accept());
    for (const [page, label] of [
      [pageA, "A"],
      [pageB, "B"],
    ]) {
      page.on("console", (msg) => {
        const text = msg.text();
        if (
          msg.type() === "error" ||
          /nostr|relay|live|publish|update/i.test(text)
        ) {
          console.log(`[page${label}] ${msg.type()}: ${text}`);
        }
      });
      page.on("pageerror", (err) =>
        console.log(`[page${label}] pageerror: ${err.message}`),
      );
    }

    try {
      // ── 1. Window A: publish child, then parent with a live-ref to it ──
      await connectStudioAs(pageA, 0);
      const childName = uniqueAssetName("XW Child");
      const parentName = uniqueAssetName("XW Parent");
      const childTokenHex = await generateSaveAndPublish(pageA, childName, PROMPT);
      const childTokenDec = BigInt(childTokenHex).toString();

      await pageA.click(SELECTORS.newAssetBtn);
      await expect(pageA.locator(SELECTORS.dialogInput)).toBeVisible();
      await pageA.fill(SELECTORS.dialogInput, parentName);
      await pageA.click(SELECTORS.dialogConfirmBtn);
      const parentGenCid = await generate(pageA, PROMPT);
      await pageA.click(SELECTORS.gallerySwitcherBtn);
      const childCard = assetCardLocator(pageA, childTokenDec, childName);
      await expect(childCard).toHaveCount(1, { timeout: 5000 });
      await childCard.getByRole("button", { name: "Add to Scene" }).click();
      await expect(pageA.locator(SELECTORS.dialogLiveRefBtn)).toBeVisible({
        timeout: 30000,
      });
      await pageA.click(SELECTORS.dialogLiveRefBtn);
      await saveDraft(pageA, parentGenCid);
      // The draft already carries its name from the creation dialog, so this
      // publish only shows a native confirm (accepted via the dialog handler).
      await pageA.click(SELECTORS.publishAssetBtn);
      await pageA.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });

      // ── 2. Window B: open the parent via the Library (SPA handoff) ────
      await connectLibrary(pageB);
      await openLibraryCollection(pageB, "Default");
      await openLibraryAssetInStudio(pageB, parentName);

      // Wait until B has actually resolved and rendered the child_ref node.
      await pageB.click(SELECTORS.outlinerSwitcherBtn);
      const childNodeInB = pageB
        .locator(SELECTORS.outlinerNode)
        .filter({ hasText: childTokenDec });
      await expect(childNodeInB).toHaveCount(1, { timeout: 30000 });

      // Subscribe to the bus in both windows before republishing.
      for (const page of [pageA, pageB]) {
        await page.evaluate(() => {
          const { on, EVENTS } = window.__arbeskBus;
          window.__liveUpdates = [];
          on(EVENTS.ASSET_URI_CHANGED, (p) =>
            window.__liveUpdates.push(["changed", String(p?.tokenId)]),
          );
          on(EVENTS.ASSET_URI_UPDATED, (p) =>
            window.__liveUpdates.push([
              "updated",
              String(p?.tokenId),
              p?.source,
            ]),
          );
        });
      }

      // ── 3. Window A: dive into the child, edit, republish ─────────────
      await pageA.click(SELECTORS.outlinerSwitcherBtn);
      const childNodeInA = pageA
        .locator(SELECTORS.outlinerNode)
        .filter({ hasText: childTokenDec });
      await expect(childNodeInA).toHaveCount(1, { timeout: 30000 });
      await childNodeInA.click();
      await expect(pageA.locator(SELECTORS.inspectorDiveBtn)).toBeVisible();
      await pageA.click(SELECTORS.inspectorDiveBtn);
      await editFirstNodeColor(pageA, "#00aa55");
      await pageA.click(SELECTORS.publishAssetBtn);

      // ── 4a. Publish-side: the relay must see the kind-20001 notice ────
      await expect
        .poll(() => relayEvents.length, { timeout: 30000 })
        .toBeGreaterThan(0);

      // ── 4b. Subscribe-side: window B must fire the reload trigger ─────
      // (payload tokenId stays in the publisher's hex format — compare
      // numerically, matching the frontend's normalized comparison)
      await expect
        .poll(
          async () => {
            const evts = await pageB.evaluate(() => window.__liveUpdates);
            return evts.some(
              (e) => e[0] === "updated" && BigInt(e[1]) === BigInt(childTokenHex),
            );
          },
          { timeout: 30000, intervals: [500, 1000, 1000] },
        )
        .toBe(true);

      // ── 4c. Content: B must re-resolve the child's NEW manifest CID ───
      // (pins the dive-republish assetID: a republish written under the
      // parent's assetID leaves the child_ref pointing at the old CID and
      // B visibly never updates, even though the bus event fired)
      const collection = await fetchTokenManifest(childTokenHex);
      const childNewCid = await findAssetCidByName(collection, childName);
      expect(childNewCid).toBeTruthy();
      await expect
        .poll(
          async () =>
            pageB.evaluate(
              (cid) =>
                performance
                  .getEntriesByType("resource")
                  .some((e) => e.name.includes(cid)),
              childNewCid,
            ),
          { timeout: 15000 },
        )
        .toBe(true);
    } finally {
      console.log("=== relay events seen:", relayEvents.length);
      for (const e of relayEvents) {
        console.log(
          "  relay event",
          e.id?.slice(0, 12),
          "tags:",
          JSON.stringify(e.tags),
        );
      }
      for (const [page, label] of [
        [pageA, "A"],
        [pageB, "B"],
      ]) {
        try {
          const evts = await page.evaluate(() => window.__liveUpdates);
          console.log(`=== page${label} bus events:`, JSON.stringify(evts));
        } catch {
          console.log(`=== page${label}: could not read bus events`);
        }
      }
      ws.close();
      await pageA.context().close();
      await pageB.context().close();
    }
  });
});
