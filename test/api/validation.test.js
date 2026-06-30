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
      expect(unpinSchema.safeParse({ cid: "" }).success).toBe(false);
    });

    it("accepts a valid CID", () => {
      expect(unpinSchema.safeParse({ cid: "bafyTest" }).success).toBe(true);
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
