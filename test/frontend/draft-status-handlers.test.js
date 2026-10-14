// @test-env dom
/**
 * The real Save/Publish handlers drive the derived unpublished-draft state.
 * Only the IPFS/chain seams are faked; stores and the version-history store
 * are real.
 */
import { beforeAll, expect, jest, mock, test } from "bun:test";

let published = null;
let saveN = 0;
let mods;

beforeAll(async () => {
  const { recordSavedVersion } = await import("@arbesk/asset-core/domain/asset.js");
  const { emit, EVENTS } = await import("@arbesk/asset-core/events/bus.js");
  await mock.module(
    "../../frontend/src/js/services/asset-save/manifest-builder.js",
    () => ({
      saveAssetDraftCore: jest.fn(async () => {
        const cid = `bafyDraft${++saveN}`;
        recordSavedVersion(cid, { asset_id: "a1" });
        emit(EVENTS.ASSET_DRAFT_SAVED, { cid });
        return { ok: true, cid, manifest: { asset_id: "a1" } };
      }),
      manifestsSemanticallyEqual: () => false,
    })
  );
  await mock.module(
    "../../frontend/src/js/services/asset-save/collection-publish.js",
    () => ({
      publishCollectionForAsset: jest.fn(async () => {
        const { getLatestAssetManifestCid } = await import(
          "@arbesk/asset-core/domain/asset.js"
        );
        published = getLatestAssetManifestCid();
        emit(EVENTS.ASSET_PUBLISHED, { tokenId: "7" });
        return { tokenId: "7", isNew: false };
      }),
    })
  );
  await mock.module(
    "../../frontend/src/js/services/asset-save/editor-publish.js",
    () => ({ verifyCanEdit: jest.fn().mockResolvedValue(undefined) })
  );
  await mock.module("../../frontend/src/js/state/wallet-state.js", () => ({
    walletState: { get: () => ({ walletAddress: "0xOwner", chainId: 1 }) },
  }));
  await mock.module("../../frontend/src/js/ui/toasts.js", () => ({
    showToast: jest.fn(), dismissToast: jest.fn(), dismissAllToasts: jest.fn(),
  }));
  await mock.module("../../frontend/src/js/ui/dialog.js", () => ({
    showDialog: jest.fn().mockResolvedValue("Hat"),
  }));
  await mock.module("../../frontend/src/js/services/url-utils.js", () => ({
    updateUrlAsset: jest.fn(), updateUrlManifest: jest.fn(),
  }));
  const vh = await import("@arbesk/asset-core/domain/version-history-store.js");
  vh.configureVersionHistoryDeps({
    walkChain: async () => [],
    fetchPublishedCid: async () => published,
  });
  const { assetStore } = await import("@arbesk/asset-core/domain/asset-store.js");
  mods = {
    vh, assetStore,
    ...(await import("../../frontend/src/js/ui/asset-save.js")),
    ...(await import("../../frontend/src/js/state/draft-status.js")),
  };
});

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test("Save draft makes it unpublished; Publish makes it published again", async () => {
  mods.assetStore.set({
    activeAssetName: "Hat", activeAssetId: "a1", activeAssetTokenId: "7",
    activeAssetManifestCid: "bafyPub", latestAssetManifestCid: "bafyPub",
  });
  published = "bafyPub";
  await mods.vh.loadVersion; // module is loaded
  await mods.onSaveAssetDraft();
  await tick(20);
  expect(mods.hasUnpublishedDraft()).toBe(true);

  await mods.onPublishAsset();
  await tick(700);
  expect(mods.hasUnpublishedDraft()).toBe(false);
});
