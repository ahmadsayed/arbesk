import path from "path";
import { test, expect } from "../fixtures/coverage.mjs";
import { SELECTORS } from "../helpers/studio-selectors.mjs";
import { fetchTokenManifest, findAssetCidByName } from "../helpers/manifest.mjs";
import {
  connectLibrary,
  ensureStudioConnected,
  ensureLibraryConnected,
  createLibraryCollection,
  openLibraryCollection,
  openLibraryAssetInStudio,
  uploadLibraryFile,
  libraryAssetLocator,
  generate,
  saveDraft,
  editFirstNodeColor,
  assetCardLocator,
  uniqueAssetName,
} from "../helpers/flows.mjs";

const PROMPT = "cowboy";
const GLB_FIXTURE = path.resolve("mock-gltf-assets/howdy.glb");
const GC_ASSET_NAME = "howdy"; // uploads keep the fixture filename

// Three-level nesting: grandparent P live-refs child C, which live-refs a
// grandchild GC published in its OWN collection (so GC's token is distinct
// and only the nested anchor in the open scene can match its update notice).
// Republishing GC in window A must reload the GC node in window B.
test.describe("cross-window live scene update — nested grandchild", () => {
  test.setTimeout(360_000);

  test("republishing a grandchild reloads it in the open grandparent scene", async ({
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
      page.on("pageerror", (err) =>
        console.log(`[page${label}] pageerror: ${err.message}`),
      );
    }

    try {
      // ── 1. A: publish GC into its own named collection (distinct token) ─
      const gcColName = uniqueAssetName("GC Col");
      const childName = uniqueAssetName("Nest Child");
      const parentName = uniqueAssetName("Nest Parent");
      await connectLibrary(pageA);
      await createLibraryCollection(pageA, gcColName);
      await openLibraryCollection(pageA, gcColName);
      await uploadLibraryFile(pageA, GLB_FIXTURE, GC_ASSET_NAME);
      // Card data-id is `asset-<tokenId>-<assetId>` (library-controller).
      const gcCardId = await libraryAssetLocator(pageA, GC_ASSET_NAME)
        .first()
        .getAttribute("data-id");
      const gcTokenDec = gcCardId.split("-")[1];
      // GC's current asset manifest CID — window B must fetch it when the
      // nested node loads (and fetch its successor after the republish).
      const gcHex = `0x${BigInt(gcTokenDec).toString(16)}`;
      const gcCollection = await fetchTokenManifest(gcHex);
      const gcCid = await findAssetCidByName(gcCollection, GC_ASSET_NAME);

      // ── 2. A: build C (default collection) with a live-ref to GC ──────
      await pageA.goto("/studio");
      await ensureStudioConnected(pageA);
      await pageA.click(SELECTORS.newAssetBtn);
      await expect(pageA.locator(SELECTORS.dialogInput)).toBeVisible();
      await pageA.fill(SELECTORS.dialogInput, childName);
      await pageA.click(SELECTORS.dialogConfirmBtn);
      const childGenCid = await generate(pageA, PROMPT);
      await pageA.click(SELECTORS.gallerySwitcherBtn);
      const gcCard = assetCardLocator(pageA, gcTokenDec, GC_ASSET_NAME);
      await expect(gcCard).toHaveCount(1, { timeout: 10000 });
      await gcCard.getByRole("button", { name: "Add to Scene" }).click();
      await expect(pageA.locator(SELECTORS.dialogLiveRefBtn)).toBeVisible({
        timeout: 30000,
      });
      await pageA.click(SELECTORS.dialogLiveRefBtn);
      await saveDraft(pageA, childGenCid);
      await pageA.click(SELECTORS.publishAssetBtn);
      await pageA.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });
      const defaultTokenDec = BigInt(
        new URL(pageA.url()).searchParams.get("asset"),
      ).toString();

      // ── 3. A: build P (default collection) with a live-ref to C ───────
      await pageA.click(SELECTORS.newAssetBtn);
      await expect(pageA.locator(SELECTORS.dialogInput)).toBeVisible();
      await pageA.fill(SELECTORS.dialogInput, parentName);
      await pageA.click(SELECTORS.dialogConfirmBtn);
      const parentGenCid = await generate(pageA, PROMPT);
      await pageA.click(SELECTORS.gallerySwitcherBtn);
      const childCard = assetCardLocator(pageA, defaultTokenDec, childName);
      await expect(childCard).toHaveCount(1, { timeout: 10000 });
      await childCard.getByRole("button", { name: "Add to Scene" }).click();
      await expect(pageA.locator(SELECTORS.dialogLiveRefBtn)).toBeVisible({
        timeout: 30000,
      });
      await pageA.click(SELECTORS.dialogLiveRefBtn);
      await saveDraft(pageA, parentGenCid);
      await pageA.click(SELECTORS.publishAssetBtn);
      await pageA.waitForURL(/[?&]asset=0x[0-9a-fA-F]+/, { timeout: 30000 });

      // ── 4. B: open P from the Library; wait for the nested GC load ────
      // (the outliner renders only the root manifest's nodes, so the signal
      // that the grandchild loaded is B fetching GC's manifest over IPFS)
      await connectLibrary(pageB);
      const gcLoadedInB = pageB.waitForResponse(
        (r) => r.url().includes(`/ipfs/${gcCid}`),
        { timeout: 90000 },
      );
      await openLibraryCollection(pageB, "Default");
      await openLibraryAssetInStudio(pageB, parentName);
      await gcLoadedInB;

      // Subscribe to the bus in both windows before republishing.
      for (const page of [pageA, pageB]) {
        await page.evaluate(() => {
          const { on, EVENTS } = window.__arbeskBus;
          window.__liveUpdates = [];
          on(EVENTS.ASSET_URI_UPDATED, (p) =>
            window.__liveUpdates.push([
              "updated",
              String(p?.tokenId),
              p?.source,
            ]),
          );
        });
      }

      // ── 5. A: open GC from its own collection, edit, republish ────────
      // (publish targets the ACTIVE collection — diving keeps Default
      // active, so GC must be opened from its own collection to update it)
      await pageA.goto("/library");
      await ensureLibraryConnected(pageA);
      await openLibraryCollection(pageA, gcColName);
      await openLibraryAssetInStudio(pageA, GC_ASSET_NAME);
      await editFirstNodeColor(pageA, "#00aa55");
      await pageA.click(SELECTORS.publishAssetBtn);

      // ── 6a. The relay notice must carry GC's token (canonical decimal) ─
      await expect
        .poll(
          () =>
            relayEvents.some((e) =>
              e.tags?.some((t) => t[0] === "token" && t[1]?.endsWith(`:${gcTokenDec}`)),
            ),
          { timeout: 30000 },
        )
        .toBe(true);

      // ── 6b. Window B must fire the reload trigger for GC's token ──────
      await expect
        .poll(
          async () => {
            const evts = await pageB.evaluate(() => window.__liveUpdates);
            return evts.some(
              (e) =>
                e[0] === "updated" &&
                e[2] === "remote" &&
                BigInt(e[1]) === BigInt(gcTokenDec),
            );
          },
          { timeout: 30000, intervals: [500, 1000, 1000] },
        )
        .toBe(true);

      // ── 6c. B must re-resolve the nested node: GC's NEW manifest CID ──
      const gcCollectionAfter = await fetchTokenManifest(gcHex);
      const gcNewCid = await findAssetCidByName(gcCollectionAfter, GC_ASSET_NAME);
      expect(gcNewCid).toBeTruthy();
      expect(gcNewCid).not.toBe(gcCid);
      await expect
        .poll(
          async () =>
            pageB.evaluate(
              (cid) =>
                performance
                  .getEntriesByType("resource")
                  .some((e) => e.name.includes(cid)),
              gcNewCid,
            ),
          { timeout: 15000 },
        )
        .toBe(true);
    } finally {
      console.log("=== relay events seen:", relayEvents.length);
      for (const e of relayEvents) {
        console.log("  relay event", e.id?.slice(0, 12), "tags:", JSON.stringify(e.tags));
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
