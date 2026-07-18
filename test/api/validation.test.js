import {
  cidSchema,
  ethereumAddressSchema,
  createSessionSchema,
  generateAssetSchema,
  snapshotCommentsSchema,
  unpinSchema,
  gcSchema,
  validateManifest,
} from "../../src/api/schemas.js";

describe("API schemas", () => {
  describe("cidSchema", () => {
    it("accepts a non-empty alphanumeric CID", () => {
      expect(cidSchema.safeParse("bafyTest123").success).toBe(true);
    });

    it("rejects an empty string", () => {
      expect(cidSchema.safeParse("").success).toBe(false);
    });

    it("rejects whitespace", () => {
      expect(cidSchema.safeParse("bafy Test").success).toBe(false);
    });
  });

  describe("ethereumAddressSchema", () => {
    it("accepts a checksummed address", () => {
      expect(
        ethereumAddressSchema.safeParse(
          "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        ).success,
      ).toBe(true);
    });

    it("accepts a lowercase address", () => {
      expect(
        ethereumAddressSchema.safeParse(
          "0x5fbdb2315678afecb367f032d93f642f64180aa3",
        ).success,
      ).toBe(true);
    });

    it("rejects a short address", () => {
      expect(ethereumAddressSchema.safeParse("0x1234").success).toBe(false);
    });

    it("rejects a missing 0x prefix", () => {
      expect(
        ethereumAddressSchema.safeParse("5fbdb2315678afecb367f032d93f642f64180aa3")
          .success,
      ).toBe(false);
    });
  });

  describe("createSessionSchema", () => {
    it("accepts a SIWE payload", () => {
      expect(
        createSessionSchema.safeParse({
          message: "siwe message",
          signature: "0xabc",
        }).success,
      ).toBe(true);
    });

    it("rejects a payload with neither SIWE fields nor auth token", () => {
      const result = createSessionSchema.safeParse({ message: "x" });
      expect(result.success).toBe(false);
    });
  });

  describe("generateAssetSchema", () => {
    it("requires prompt and nodeId", () => {
      const result = generateAssetSchema.safeParse({ prompt: "cowboy" });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path);
        expect(paths).toEqual(expect.arrayContaining([["nodeId"]]));
      }
    });

    it("rejects a providerKey longer than 200 chars", () => {
      expect(
        generateAssetSchema.safeParse({
          prompt: "x",
          nodeId: "y",
          providerKey: "x".repeat(201),
        }).success,
      ).toBe(false);
    });

    it("accepts minimal mock payload", () => {
      expect(
        generateAssetSchema.safeParse({ prompt: "cowboy", nodeId: "n1" }).success,
      ).toBe(true);
    });
  });

  describe("snapshotCommentsSchema", () => {
    it("coerces numeric tokenId to string", () => {
      const result = snapshotCommentsSchema.safeParse({
        tokenId: 42,
        assetId: "asset_1",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tokenId).toBe("42");
      }
    });

    it("validates contractAddress when present", () => {
      const result = snapshotCommentsSchema.safeParse({
        tokenId: "42",
        contractAddress: "not-an-address",
        assetId: "asset_1",
      });
      expect(result.success).toBe(false);
    });

    it("requires assetId", () => {
      const result = snapshotCommentsSchema.safeParse({ tokenId: "42" });
      expect(result.success).toBe(false);
    });
  });

  describe("unpinSchema", () => {
    it("requires a non-empty CID", () => {
      expect(unpinSchema.safeParse({ cid: "", tokenId: "1" }).success).toBe(
        false,
      );
    });

    it("requires tokenId", () => {
      expect(unpinSchema.safeParse({ cid: "bafyTest" }).success).toBe(false);
    });

    it("rejects a non-decimal tokenId", () => {
      expect(
        unpinSchema.safeParse({ cid: "bafyTest", tokenId: "0x12" }).success,
      ).toBe(false);
      expect(
        unpinSchema.safeParse({ cid: "bafyTest", tokenId: "1.5" }).success,
      ).toBe(false);
    });

    it("accepts a valid CID and tokenId", () => {
      expect(
        unpinSchema.safeParse({ cid: "bafyTest", tokenId: "123" }).success,
      ).toBe(true);
    });

    it("accepts optional chainId, contractAddress, and proof", () => {
      const result = unpinSchema.safeParse({
        cid: "bafyTest",
        tokenId: "123",
        chainId: 31415822,
        contractAddress: "0x1234567890123456789012345678901234567890",
        proof: [
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid optional fields", () => {
      expect(
        unpinSchema.safeParse({
          cid: "bafyTest",
          tokenId: "123",
          chainId: 0,
        }).success,
      ).toBe(false);
      expect(
        unpinSchema.safeParse({
          cid: "bafyTest",
          tokenId: "123",
          contractAddress: "not-an-address",
        }).success,
      ).toBe(false);
      expect(
        unpinSchema.safeParse({
          cid: "bafyTest",
          tokenId: "123",
          proof: ["0xabc"],
        }).success,
      ).toBe(false);
    });
  });

  describe("gcSchema", () => {
    it("defaults dryRun to true", () => {
      const result = gcSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dryRun).toBe(true);
      }
    });

    it("coerces string chainId to number", () => {
      const result = gcSchema.safeParse({ chainId: "31337" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chainId).toBe(31337);
      }
    });

    it("rejects non-positive maxUnpin", () => {
      expect(gcSchema.safeParse({ maxUnpin: 0 }).success).toBe(false);
    });
  });
});

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const result = validateManifest({ version: 1 });
    expect(result.valid).toBe(true);
  });

  it("accepts a manifest with a child_ref node", () => {
    const result = validateManifest({
      version: "1.0",
      scene: {
        nodes: [
          {
            node_id: "n1",
            transform_matrix: Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)),
            child_ref: {
              collection: {
                chainId: 31337,
                contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
                tokenId: "0x1",
              },
              assetID: "asset_1",
            },
          },
        ],
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a node missing node_id", () => {
    const result = validateManifest({
      version: 1,
      scene: {
        nodes: [{}],
      },
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a manifest with a thumbnail metadata object", () => {
    const result = validateManifest({
      version: 1,
      thumbnail: {
        cid: "bafyThumb",
        type: "snapshot",
        mime: "image/webp",
        width: 512,
        height: 288,
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a thumbnail object without a cid", () => {
    const result = validateManifest({
      version: 1,
      thumbnail: { mime: "image/webp" },
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a history entry with a src snapshot", () => {
    const result = validateManifest({
      version: 1,
      scene: {
        nodes: [
          {
            node_id: "n1",
            history: [
              {
                timestamp: 1720000000000,
                operation: "generate",
                src: { cid: "bafyHistSource", bundleCid: "bafyHistBundle" },
              },
            ],
          },
        ],
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an invalid Ethereum address in child_ref", () => {
    const result = validateManifest({
      version: 1,
      scene: {
        nodes: [
          {
            node_id: "n1",
            transform_matrix: Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)),
            child_ref: {
              collection: {
                chainId: 31337,
                contractAddress: "bad-address",
                tokenId: "0x1",
              },
              assetID: "asset_1",
            },
          },
        ],
      },
    });
    expect(result.valid).toBe(false);
  });
});
