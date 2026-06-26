/**
 * @jest-environment jsdom
 */
import { jest } from "@jest/globals";

let _saveResult = { ok: true, cid: "QmAsset", manifest: { asset_id: "asset_1" } };
let _publishResult = { tokenId: "123", isNew: false };
let _walletAddress = "0xOwner";
let _activeAssetName = "My Hat";
let _activeAssetTokenId = null;

beforeEach(() => {
  jest.resetModules();
  _saveResult = { ok: true, cid: "QmAsset", manifest: { asset_id: "asset_1" } };
  _publishResult = { tokenId: "123", isNew: false };
  _walletAddress = "0xOwner";
  _activeAssetName = "My Hat";
  _activeAssetTokenId = null;
});

async function loadModule() {
  await jest.unstable_mockModule(
    "../../frontend/src/js/services/asset-save/manifest-builder.js",
    () => ({
      saveAssetDraftCore: jest.fn().mockResolvedValue(_saveResult),
      manifestsSemanticallyEqual: jest.fn().mockReturnValue(false),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/services/asset-save/collection-publish.js",
    () => ({
      publishCollectionForAsset: jest.fn().mockResolvedValue(_publishResult),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/services/asset-save/editor-publish.js",
    () => ({
      verifyCanEdit: jest.fn().mockResolvedValue(undefined),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/state/wallet-state.js",
    () => ({
      walletState: {
        get: jest.fn(() => ({ walletAddress: _walletAddress })),
      },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/state/asset-state.js",
    () => ({
      assetState: {
        get: jest.fn(() => ({
          activeAssetName: _activeAssetName,
          activeAssetTokenId: _activeAssetTokenId,
          activeAssetId: "asset_1",
        })),
        set: jest.fn(),
      },
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ui/toasts.js",
    () => ({
      showToast: jest.fn(),
      dismissToast: jest.fn(),
      dismissAllToasts: jest.fn(),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/ui/dialog.js",
    () => ({
      showDialog: jest.fn().mockResolvedValue("Named Hat"),
    })
  );

  await jest.unstable_mockModule(
    "../../frontend/src/js/services/url-utils.js",
    () => ({
      updateUrlAsset: jest.fn(),
      updateUrlManifest: jest.fn(),
    })
  );

  const mod = await import("../../frontend/src/js/ui/asset-save.js");
  return mod;
}

describe("onPublishAsset", () => {
  test("publishes normally when saveAssetDraftCore succeeds", async () => {
    const { onPublishAsset } = await loadModule();
    const { publishCollectionForAsset } = await import(
      "../../frontend/src/js/services/asset-save/collection-publish.js"
    );
    await onPublishAsset();
    expect(publishCollectionForAsset).toHaveBeenCalledWith(
      "QmAsset",
      "asset_1",
      "0xOwner"
    );
  });

  test("still publishes when saveAssetDraftCore reports no asset-manifest changes", async () => {
    _saveResult = {
      ok: false,
      reason: "no-changes",
      cid: "QmExistingAsset",
      manifest: { asset_id: "asset_1", version: 3 },
    };
    const { onPublishAsset } = await loadModule();
    const { publishCollectionForAsset } = await import(
      "../../frontend/src/js/services/asset-save/collection-publish.js"
    );
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    await onPublishAsset();

    expect(showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "No Changes" })
    );
    expect(publishCollectionForAsset).toHaveBeenCalledWith(
      "QmExistingAsset",
      "asset_1",
      "0xOwner"
    );
  });

  test("stops with a warning when there is no asset data", async () => {
    _saveResult = { ok: false, reason: "empty" };
    const { onPublishAsset } = await loadModule();
    const { publishCollectionForAsset } = await import(
      "../../frontend/src/js/services/asset-save/collection-publish.js"
    );
    const { showToast } = await import("../../frontend/src/js/ui/toasts.js");

    await onPublishAsset();

    expect(publishCollectionForAsset).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Nothing to Publish" })
    );
  });
});
