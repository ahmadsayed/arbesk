const IPFS_GATEWAY = "http://127.0.0.1:8080/ipfs";

export async function fetchManifest(cid) {
  const res = await fetch(`${IPFS_GATEWAY}/${cid}`);
  if (!res.ok) throw new Error(`Failed to fetch manifest ${cid}: ${res.status}`);
  return res.json();
}

export function assertGenerationManifest(manifest, { prompt, provider = "mock" }) {
  if (!manifest.asset_id) throw new Error("Missing asset_id");
  if (!manifest.version || manifest.version < 1) throw new Error("Invalid version");
  if (!manifest.timestamp) throw new Error("Missing timestamp");
  if (!Array.isArray(manifest.scene?.nodes)) throw new Error("Missing scene.nodes");
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
      `prev_asset_manifest_cid mismatch: ${manifest.prev_asset_manifest_cid} !== ${previousCid}`
    );
  }
}

export function assertPublishedManifest(manifest) {
  // Thumbnails are best-effort, especially in headless SwiftShader environments.
  // Validate structure but do not fail when the snapshot is missing.
  if (manifest.thumbnail && !manifest.thumbnail.cid) {
    throw new Error("Published manifest has thumbnail object but missing thumbnail.cid");
  }
}
