// @ts-nocheck
import { BACKEND_URL, HARDHAT_RPC } from "../lib/infra.mjs";
import Web3 from "web3";

const IPFS_GATEWAY = "http://127.0.0.1:8080/ipfs";

/** Minimal ERC-721 ABI for tokenURI resolution. */
const TOKEN_URI_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "tokenId", type: "uint256" }],
    name: "tokenURI",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

let contractCache = null;

async function getFreeTierContract() {
  if (contractCache) return contractCache;

  // Fetch the configured free-tier contract address from the backend.
  const configRes = await fetch(`${BACKEND_URL}/api/v1/config`);
  if (!configRes.ok) {
    throw new Error(`Failed to fetch backend config: ${configRes.status}`);
  }
  const config = await configRes.json();
  const contractAddress = config.contractAddress;
  if (!contractAddress) {
    throw new Error("Backend config missing contractAddress");
  }

  const web3 = new Web3(HARDHAT_RPC);
  contractCache = new web3.eth.Contract(TOKEN_URI_ABI, contractAddress);
  return contractCache;
}

function normalizeTokenURI(uri) {
  if (!uri || typeof uri !== "string") return "";
  let normalized = uri.trim();
  if (normalized.startsWith("ipfs://")) {
    normalized = normalized.slice(7);
  }
  const ipfsPathMatch = normalized.match(/\/ipfs\/([A-Za-z0-9]{46,})/);
  if (ipfsPathMatch) {
    normalized = ipfsPathMatch[1];
  }
  const cidMatch = normalized.match(/^([A-Za-z0-9]{46,})/);
  if (cidMatch) {
    normalized = cidMatch[1];
  }
  return normalized;
}

export async function fetchManifest(cid) {
  const res = await fetch(`${IPFS_GATEWAY}/${cid}`);
  if (!res.ok)
    throw new Error(`Failed to fetch manifest ${cid}: ${res.status}`);
  return res.json();
}

/**
 * Resolve a token id (hex string) to its on-chain tokenURI collection manifest.
 * The backend `/api/v1/tokens/:id/manifest` route was removed as part of the
 * client-side-first refactoring; this helper calls the free-tier contract's
 * `tokenURI()` directly via the local Hardhat RPC and then fetches the CID
 * from the IPFS gateway.
 */
export async function fetchTokenManifest(tokenIdHex) {
  const contract = await getFreeTierContract();
  const uri = await contract.methods.tokenURI(tokenIdHex).call();
  if (!uri) {
    throw new Error(`tokenURI returned empty for token ${tokenIdHex}`);
  }
  const cid = normalizeTokenURI(uri);
  if (!cid) {
    throw new Error(`Could not extract CID from tokenURI "${uri}"`);
  }
  return fetchManifest(cid);
}

/** Pull the `?manifest=` CID the studio writes to the URL after a generate/save. */
export function manifestCidFromUrl(url) {
  return new URL(url).searchParams.get("manifest");
}

export function assertGenerationManifest(
  manifest,
  { prompt, provider = "mock" },
) {
  if (!manifest.asset_id) throw new Error("Missing asset_id");
  if (!manifest.version || manifest.version < 1)
    throw new Error("Invalid version");
  if (!manifest.timestamp) throw new Error("Missing timestamp");
  if (!Array.isArray(manifest.scene?.nodes))
    throw new Error("Missing scene.nodes");
  if (manifest.scene.nodes.length !== 1) {
    throw new Error(`Expected 1 node, got ${manifest.scene.nodes.length}`);
  }

  const node = manifest.scene.nodes[0];
  if (node.type !== "source_asset") {
    throw new Error(`Expected node type source_asset, got ${node.type}`);
  }
  if (!node.source?.cid) throw new Error("Missing node.source.cid");
  if (!node.source.format) throw new Error("Missing node.source.format");
  if (!node.transform_matrix || node.transform_matrix.length !== 16) {
    throw new Error("Missing or invalid node.transform_matrix");
  }

  // The generated node name should contain the prompt.
  const nodeName = node.name || "";
  if (!nodeName.toLowerCase().includes(prompt.toLowerCase())) {
    throw new Error(`Node name does not include prompt: ${nodeName}`);
  }
}

export function assertSavedManifest(manifest, previousCid) {
  if (manifest.version !== 2) {
    throw new Error(`Expected version 2 after save, got ${manifest.version}`);
  }
  if (manifest.prev_asset_manifest_cid !== previousCid) {
    throw new Error(
      `prev_asset_manifest_cid mismatch: ${manifest.prev_asset_manifest_cid} !== ${previousCid}`,
    );
  }
}

export function assertPublishedManifest(manifest) {
  // Thumbnails are best-effort, especially in headless SwiftShader environments.
  // Validate structure but do not fail when the snapshot is missing.
  if (manifest.thumbnail && !manifest.thumbnail.cid) {
    throw new Error(
      "Published manifest has thumbnail object but missing thumbnail.cid",
    );
  }
}

/**
 * Validates an optional comments archive CID stored in the manifest.
 * The archive is created on republish only when the asset has comments,
 * so its absence is valid; when present it must be a non-empty string.
 */
export function assertCommentsArchive(manifest) {
  if (
    manifest.comments_archive_cid === undefined ||
    manifest.comments_archive_cid === null
  )
    return;
  if (
    typeof manifest.comments_archive_cid !== "string" ||
    !manifest.comments_archive_cid
  ) {
    throw new Error("Invalid comments_archive_cid in manifest");
  }
}

/**
 * Validate a collection manifest's shape: type, assets map, version chain.
 * Does not assert on individual asset manifest contents - use
 * assertGenerationManifest/assertSavedManifest on the resolved asset CID
 * for that.
 */
export function assertCollectionManifest(manifest, { expectedAssetIds } = {}) {
  if (manifest.type !== "collection") {
    throw new Error(`Expected type "collection", got "${manifest.type}"`);
  }
  if (!manifest.assets || typeof manifest.assets !== "object") {
    throw new Error("Collection manifest missing assets object");
  }
  if (typeof manifest.version !== "number" || manifest.version < 1) {
    throw new Error(`Expected version >= 1, got ${manifest.version}`);
  }
  if (expectedAssetIds) {
    const actualIds = Object.keys(manifest.assets).sort();
    const expected = [...expectedAssetIds].sort();
    if (JSON.stringify(actualIds) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected assetIds ${JSON.stringify(expected)}, got ${JSON.stringify(actualIds)}`,
      );
    }
  }
}

/**
 * Resolve the asset CID for a given name within a collection manifest.
 * The default collection is shared across tests, so callers must identify
 * their asset by an explicit property rather than assuming insertion order.
 * @param {object} collectionManifest
 * @param {string} name
 * @returns {Promise<string|null>} asset CID, or null if not found
 */
export async function findAssetCidByName(collectionManifest, name) {
  for (const cid of Object.values(collectionManifest.assets || {})) {
    try {
      const asset = await fetchManifest(cid);
      if (asset.name === name) return cid;
    } catch {
      // ignore unreadable entries
    }
  }
  return null;
}

/**
 * Resolve the asset id for a given name within a collection manifest.
 * @param {object} collectionManifest
 * @param {string} name
 * @returns {Promise<string|null>} asset id, or null if not found
 */
export async function findAssetIdByName(collectionManifest, name) {
  for (const [assetId, cid] of Object.entries(collectionManifest.assets || {})) {
    try {
      const asset = await fetchManifest(cid);
      if (asset.name === name) return assetId;
    } catch {
      // ignore unreadable entries
    }
  }
  return null;
}
