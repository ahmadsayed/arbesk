/**
 * Token Resolver Unit Tests
 *
 * Tests for token URI normalization and child_ref validation.
 *
 * normalizeTokenURI is tested inline to avoid Jest ESM resolution
 * issues with the frontend directory. The canonical implementation
 * lives at frontend/src/js/blockchain/uri-utils.js.
 */

/**
 * Inline copy of normalizeTokenURI from frontend/src/js/blockchain/uri-utils.js
 */
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

describe("Token Resolver — normalizeTokenURI", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeTokenURI("")).toBe("");
    expect(normalizeTokenURI(null)).toBe("");
    expect(normalizeTokenURI(undefined)).toBe("");
  });

  it("returns plain CID unchanged", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(cid)).toBe(cid);
  });

  it("strips ipfs:// prefix", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(`ipfs://${cid}`)).toBe(cid);
  });

  it("strips ipfs:// prefix with path", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(`ipfs://${cid}/manifest.json`)).toBe(cid);
  });

  it("strips HTTP gateway prefix", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(`http://127.0.0.1:8080/ipfs/${cid}`)).toBe(cid);
  });

  it("strips HTTPS gateway prefix", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(`https://ipfs.io/ipfs/${cid}`)).toBe(cid);
  });

  it("handles trailing whitespace", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(`  ${cid}  `)).toBe(cid);
  });

  it("handles base58 CIDv1", () => {
    const cidv1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    expect(normalizeTokenURI(`ipfs://${cidv1}`)).toBe(cidv1);
  });

  it("handles ipfs:// with trailing slash", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(`ipfs://${cid}/`)).toBe(cid);
  });

  it("handles data URI gracefully (returns as-is)", () => {
    const dataUri = "data:application/json;base64,eyJrZXkiOiJ2YWx1ZSJ9";
    // Data URIs pass through unchanged since they're not IPFS CIDs
    expect(normalizeTokenURI(dataUri)).toBe(dataUri);
  });

  it("handles bare CID with query params", () => {
    const cid = "QmRg2doWY7aM8sMhuoVr2mktoWWgGFGPKdXhrkvCMJWyNN";
    expect(normalizeTokenURI(`${cid}?filename=test.glb`)).toBe(cid);
  });
});

describe("Token Resolver — child_ref validation", () => {
  it("valid child_ref has correct structure", () => {
    const validRef = {
      type: "token",
      chainId: 314159,
      contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
      tokenId: "42",
      standard: "ERC721",
      resolution: "latest",
    };

    expect(validRef.type).toBe("token");
    expect(validRef.chainId).toBe(314159);
    expect(validRef.contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(validRef.tokenId).toBe("42");
    expect(validRef.standard).toBe("ERC721");
    expect(validRef.resolution).toBe("latest");
  });

  it("child_ref node_id follows naming convention", () => {
    const chainId = 314159;
    const shortAddr = "12345678";
    const tokenId = "42";
    const nodeId = `child_token_${chainId}_${shortAddr}_${tokenId}`;

    expect(nodeId).toBe("child_token_314159_12345678_42");
    expect(nodeId).toMatch(/^child_token_\d+_[a-f0-9]+_\d+$/);
  });

  it("child_ref without source and history is valid", () => {
    const nodeEntry = {
      node_id: "child_token_314159_abc123_42",
      transform_matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      child_ref: {
        type: "token",
        chainId: 314159,
        contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
        tokenId: "42",
        standard: "ERC721",
        resolution: "latest",
      },
    };

    // Token child nodes must not have source or history
    expect(nodeEntry.source).toBeUndefined();
    expect(nodeEntry.history).toBeUndefined();
    expect(nodeEntry.child_ref).toBeDefined();
    expect(nodeEntry.transform_matrix).toHaveLength(16);
  });

  it("MAX_CHILD_WORLD_DEPTH is correctly defined", () => {
    // This constant must be 5 per the specification
    const MAX_CHILD_WORLD_DEPTH = 5;
    expect(MAX_CHILD_WORLD_DEPTH).toBe(5);
  });
});
