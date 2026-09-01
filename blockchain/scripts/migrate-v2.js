// Dedicated v1 → v2 contract migration runner (Hardhat script, CJS).
//
// Usage (run from blockchain/, against the target network):
//   OP=snapshot OLD_CONTRACT_ADDRESS=0x... NEW_CONTRACT_ADDRESS=0x... \
//     npx hardhat run scripts/migrate-v2.js --network baseSepolia
//   OP=migrate  SNAPSHOT_PATH=... NEW_CONTRACT_ADDRESS=0x... IPFS_GATEWAY_URL=... \
//     npx hardhat run scripts/migrate-v2.js --network baseSepolia
//   OP=verify   SNAPSHOT_PATH=... NEW_CONTRACT_ADDRESS=0x... \
//     npx hardhat run scripts/migrate-v2.js --network baseSepolia
//
// Ops:
//   snapshot — scan the OLD contract's Transfer mints-minus-burns (chunked by
//              LOG_CHUNK_SIZES from DEPLOYMENT_BLOCKS) and snapshot
//              owner/tokenURI/editorRoot/editorSetVersion/editorListURI.
//   migrate  — re-mint every token on the NEW contract via the one-shot
//              `migrateAsset` entry point, recomputing each editor root under
//              the new asset-scoped leaf (assetScope = bytes32(0)), then
//              `finalizeMigration()`.
//   verify   — parity-check owner + tokenURI for every token vs the snapshot.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { SimpleMerkleTree } = require("@openzeppelin/merkle-tree");

const OP = process.env.OP || "snapshot";
const OLD = (process.env.OLD_CONTRACT_ADDRESS || "").toLowerCase();
const NEW = (process.env.NEW_CONTRACT_ADDRESS || "").toLowerCase();
const CONTRACT_NAME = process.env.CONTRACT_NAME || "ArbeskAssetFree";
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH;
const IPFS_GATEWAY = process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

// chainId → { deploymentBlock, logChunkSize } — mirrors constants/chains.js,
// inlined because this CJS script cannot require the ESM module.
const CHAIN_INDEX = {
  31415822: { deploymentBlock: 0, logChunkSize: 10000 }, // Hardhat local
  // sepolia.base.org rejects eth_getLogs ranges > 10000 blocks — use the max.
  84532: { deploymentBlock: 44309130, logChunkSize: 10000 }, // Base Sepolia
};

/** Leaf encoding matches ArbeskAssetBase._requireEditor (new asset-scoped schema). */
function makeLeaf(address, role, tokenId, version, assetScope = ZERO_HASH) {
  return hre.ethers.solidityPackedKeccak256(
    ["address", "uint8", "uint256", "bytes32", "uint256"],
    [address, role, tokenId, assetScope, version]
  );
}

function computeRoot(editorList, tokenId, version, assetScope = ZERO_HASH) {
  if (!editorList || editorList.length === 0) return ZERO_HASH;
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, version, assetScope)
  );
  return SimpleMerkleTree.of(leaves).root;
}

async function fetchEditorList(cid) {
  const res = await fetch(`${IPFS_GATEWAY}/ipfs/${cid}`);
  if (!res.ok) throw new Error(`IPFS fetch ${cid} failed: ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  // Editor lists are stored gzipped (writeJSONToIPFS compress:true) — Pinata
  // serves the raw gzip bytes, so decompress before parsing.
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }
  const json = JSON.parse(buf.toString("utf8"));
  if (!Array.isArray(json)) throw new Error(`editor list ${cid} is not an array`);
  return json;
}

async function snapshot() {
  if (!OLD) throw new Error("OLD_CONTRACT_ADDRESS is required for snapshot");
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const cfg = CHAIN_INDEX[chainId] ?? { deploymentBlock: 0, logChunkSize: 2000 };
  const fromBlock = cfg.deploymentBlock;
  const chunk = cfg.logChunkSize;
  const latest = await hre.ethers.provider.getBlockNumber();
  const transferTopic = hre.ethers.id("Transfer(address,address,uint256)");

  const old = await hre.ethers.getContractAt(CONTRACT_NAME, OLD);

  // First pass: track live tokens (mints minus burns) WITHOUT reading state —
  // a minted-then-burned token's tokenURI reverts against current state.
  const live = new Map(); // tokenId → owner from the mint event
  for (let from = fromBlock; from <= latest; from += chunk) {
    const to = Math.min(from + chunk - 1, latest);
    const logs = await hre.ethers.provider.getLogs({
      address: OLD,
      fromBlock: from,
      toBlock: to,
      topics: [transferTopic],
    });
    for (const log of logs) {
      // ERC-721 Transfer has all three args indexed → read from topics.
      const fromAddr = "0x" + log.topics[1].slice(26);
      const toAddr = "0x" + log.topics[2].slice(26);
      const tokenId = BigInt(log.topics[3]).toString();
      if (fromAddr.toLowerCase() === ZERO_ADDR) {
        live.set(tokenId, toAddr.toLowerCase());
      } else if (toAddr.toLowerCase() === ZERO_ADDR) {
        live.delete(tokenId);
      }
    }
  }

  // Second pass: snapshot current on-chain state for the live tokens only.
  const tokens = [];
  for (const tokenId of live.keys()) {
    tokens.push({
      tokenId,
      owner: (await old.ownerOf(tokenId)).toLowerCase(),
      tokenURI: await old.tokenURI(tokenId),
      editorRoot: await old.editorRoot(tokenId),
      editorSetVersion: (await old.editorSetVersion(tokenId)).toString(),
      editorListURI: await old.editorListURI(tokenId),
    });
  }

  const out = {
    chainId,
    blockNumber: latest,
    oldContract: OLD,
    newContract: NEW,
    tokens,
  };
  const file =
    SNAPSHOT_PATH ||
    path.join(__dirname, "..", "migrations", `snapshot-${chainId}-${latest}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`[MIGRATE] snapshot ${out.tokens.length} tokens -> ${file}`);
  return file;
}

async function migrate(snapshotPath) {
  if (!NEW) throw new Error("NEW_CONTRACT_ADDRESS is required for migrate");
  if (!snapshotPath) throw new Error("SNAPSHOT_PATH is required for migrate");
  const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const neu = await hre.ethers.getContractAt(CONTRACT_NAME, NEW);

  const CHUNK = 50;
  for (let i = 0; i < snap.tokens.length; i += CHUNK) {
    const batch = snap.tokens.slice(i, i + CHUNK);
    for (const tok of batch) {
      // Recompute the editor root under the NEW asset-scoped leaf schema,
      // collection-wide (assetScope = bytes32(0)). Fall back to the old root
      // (with a warning) if the editor list is unreachable — provenance is
      // on IPFS, so a re-run for drifted tokens is sufficient remediation.
      let newRoot = tok.editorRoot;
      if (tok.editorListURI) {
        try {
          const list = await fetchEditorList(tok.editorListURI);
          newRoot = computeRoot(list, tok.tokenId, tok.editorSetVersion, ZERO_HASH);
        } catch (err) {
          console.warn(
            `[MIGRATE] editor-list re-commit failed for ${tok.tokenId}: ${err.message}; migrating old root`
          );
        }
      }
      await (await neu.migrateAsset(
        tok.tokenId,
        tok.owner,
        tok.tokenURI,
        newRoot,
        tok.editorSetVersion,
        tok.editorListURI
      )).wait();
    }
    console.log(
      `[MIGRATE] migrated ${Math.min(i + CHUNK, snap.tokens.length)}/${snap.tokens.length}`
    );
  }

  await (await neu.finalizeMigration()).wait();
  console.log("[MIGRATE] migration finalized");
}

async function verify(snapshotPath) {
  if (!NEW) throw new Error("NEW_CONTRACT_ADDRESS is required for verify");
  if (!snapshotPath) throw new Error("SNAPSHOT_PATH is required for verify");
  const snap = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const neu = await hre.ethers.getContractAt(CONTRACT_NAME, NEW);

  let drift = 0;
  for (const tok of snap.tokens) {
    const owner = (await neu.ownerOf(tok.tokenId)).toLowerCase();
    const uri = await neu.tokenURI(tok.tokenId);
    if (owner !== tok.owner || uri !== tok.tokenURI) {
      drift++;
      console.warn(
        `[MIGRATE] drift token ${tok.tokenId}: owner ${owner} vs ${tok.owner}, uri ${uri} vs ${tok.tokenURI}`
      );
    }
  }
  console.log(`[MIGRATE] verify: ${snap.tokens.length} tokens, ${drift} drifted`);
  if (drift > 0) process.exitCode = 1;
}

async function main() {
  if (OP === "snapshot") await snapshot();
  else if (OP === "migrate") await migrate(SNAPSHOT_PATH);
  else if (OP === "verify") await verify(SNAPSHOT_PATH);
  else throw new Error(`Unknown OP: ${OP}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
