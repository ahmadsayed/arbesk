/**
 * Thin orchestrator around domain/collection.js publishCollection.
 */
import { publishCollection } from "../../domain/collection.js";
import { adoptPublishedIdentity } from "../../domain/asset.js";
import { getOwnerOf, getTokenURI, getCollectionManifest } from "../token.js";
import { writeJSONToIPFS } from "../../ipfs/write-to-ipfs.js";
import {
  republishCollection,
  publishNewToken,
} from "./editor-publish.js";

/**
 * @param {string} assetCid - New asset manifest CID to add to the collection.
 * @param {string} assetID - Asset ID inside the collection.
 * @param {string} walletAddr - Connected wallet address.
 */
export async function publishCollectionForAsset(assetCid, assetID, walletAddr) {
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
