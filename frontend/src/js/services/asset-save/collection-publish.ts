/**
 * Thin orchestrator around domain/collection.js publishCollection.
 */
import { publishCollection } from "../../asset-core/domain/collection.ts";
import type { PublishCollectionResult } from "../../asset-core/domain/collection.ts";
import { adoptPublishedIdentity } from "../../asset-core/domain/asset.ts";
import { getOwnerOf, getTokenURI, getCollectionManifest } from "../token.ts";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.ts";
import {
  republishCollection,
  publishNewToken,
} from "./editor-publish.ts";

/**
 * @param assetCid - New asset manifest CID to add to the collection.
 * @param assetID - Asset ID inside the collection.
 * @param walletAddr - Connected wallet address.
 */
export async function publishCollectionForAsset(assetCid: string, assetID: string, walletAddr: string): Promise<PublishCollectionResult> {
  return publishCollection(assetCid, assetID, walletAddr, {
    getOwnerOf,
    getTokenURI,
    getCollectionManifest,
    writeJSONToIPFS,
    republishCollection,
    publishNewToken,
    onAdoptIdentity: ({ tokenId, assetId }) =>
      adoptPublishedIdentity(tokenId, assetId),
  });
}
