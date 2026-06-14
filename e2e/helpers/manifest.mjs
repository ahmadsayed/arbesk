const IPFS_GATEWAY = "http://127.0.0.1:8080/ipfs";

export async function fetchManifest(cid) {
  const res = await fetch(`${IPFS_GATEWAY}/${cid}`);
  if (!res.ok) throw new Error(`Failed to fetch manifest ${cid}: ${res.status}`);
  return res.json();
}

export function assertGenerationManifest(manifest, { prompt, provider = "mock" }) {
  if (!manifest.asset_id) throw new Error("Missing asset_id");
  if (!manifest.version || manifest.version < 1) throw new Error("Invalid version");
  if (!Array.isArray(manifest.scene?.nodes)) throw new Error("Missing scene.nodes");
  if (manifest.scene.nodes.length !== 1) {
    throw new Error(`Expected 1 node, got ${manifest.scene.nodes.length}`);
  }

  const node = manifest.scene.nodes[0];
  if (node.type !== "source_asset") {
    throw new Error(`Expected node type source_asset, got ${node.type}`);
  }
  if (!node.source?.cid) throw new Error("Missing node.source.cid");
  if (!Array.isArray(node.history)) throw new Error("Missing node.history");
  if (node.history.length < 1) throw new Error("Empty node.history");

  const entry = node.history[0];
  if (entry.type !== "generation") {
    throw new Error(`Expected history type generation, got ${entry.type}`);
  }
  if (entry.provider !== provider) {
    throw new Error(`Expected provider ${provider}, got ${entry.provider}`);
  }
  if (entry.prompt !== prompt) {
    throw new Error(`Prompt mismatch: ${entry.prompt} !== ${prompt}`);
  }
  if (!/^0x[a-f0-9]{64}$/i.test(entry.txHash)) {
    throw new Error(`Invalid txHash: ${entry.txHash}`);
  }
}

export function assertSavedManifest(manifest, previousCid) {
  if (manifest.version !== 2) {
    throw new Error(`Expected version 2 after save, got ${manifest.version}`);
  }
  if (manifest.prev_asset_manifest_cid !== previousCid) {
    throw new Error(
      `prev_asset_manifest_cid mismatch: ${manifest.prev_asset_manifest_cid} !== ${previousCid}`
    );
  }
}

export function assertPublishedManifest(manifest) {
  if (!manifest.thumbnail?.cid) throw new Error("Published manifest missing thumbnail.cid");
}
