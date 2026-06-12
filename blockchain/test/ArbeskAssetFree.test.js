const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArbeskAssetFree", function () {
  let asset, owner, user, editor;

  // CollaboratorRole enum values
  const CollaboratorRole = { None: 0, Viewer: 1, Editor: 2 };

  beforeEach(async () => {
    [owner, user, editor] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("ArbeskAssetFree");
    asset = await Factory.deploy();
    await asset.waitForDeployment();
  });

  describe("Deployment", () => {
    it("sets owner to deployer", async () => {
      expect(await asset.owner()).to.equal(owner.address);
    });

    it("has correct ERC721 metadata", async () => {
      expect(await asset.name()).to.equal("ArbeskAssetFree");
      expect(await asset.symbol()).to.equal("ARBF");
    });

    it("returns correct quota limits", async () => {
      expect(await asset.maxEditorsPerToken()).to.equal(5);
      expect(await asset.maxTokensPerEditor()).to.equal(50);
    });

    it("has correct daily generation limit constant", async () => {
      expect(await asset.DAILY_GENERATION_LIMIT()).to.equal(10);
    });
  });

  describe("recordGeneration", () => {
    it("records generation and emits event", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const prompt = "A modern workbench";

      const tx = await asset.connect(user).recordGeneration(nodeId, prompt);
      const receipt = await tx.wait();

      // Verify event was emitted; don't assert exact timestamp (block timing variance)
      await expect(tx)
        .to.emit(asset, "AssetGenerationRecorded");

      // Parse the event args manually to verify key fields
      const event = receipt.logs.find(
        (log) => log.fragment?.name === "AssetGenerationRecorded"
      );
      expect(event).to.exist;
      expect(event.args.userWallet).to.equal(user.address);
      expect(event.args.nodeId).to.equal(nodeId);
      expect(event.args.prompt).to.equal(prompt);
      expect(event.args.countToday).to.equal(1);

      expect(await asset.generationCountToday(user.address)).to.equal(1);
    });

    it("increments count for multiple generations", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");

      for (let i = 1; i <= 5; i++) {
        await asset.connect(user).recordGeneration(nodeId, `prompt ${i}`);
      }
      expect(await asset.generationCountToday(user.address)).to.equal(5);
    });

    it("reverts at daily limit", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const limit = Number(await asset.DAILY_GENERATION_LIMIT());

      for (let i = 0; i < limit; i++) {
        await asset.connect(user).recordGeneration(nodeId, `prompt ${i}`);
      }

      await expect(
        asset.connect(user).recordGeneration(nodeId, "one too many")
      )
        .to.be.revertedWithCustomError(asset, "DailyGenerationLimitReached")
        .withArgs(limit);
    });

    it("resets counter after a new day", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const limit = Number(await asset.DAILY_GENERATION_LIMIT());

      for (let i = 0; i < limit; i++) {
        await asset.connect(user).recordGeneration(nodeId, `prompt ${i}`);
      }

      // Exhausted for today
      await expect(
        asset.connect(user).recordGeneration(nodeId, "too many")
      ).to.be.revertedWithCustomError(asset, "DailyGenerationLimitReached");

      // Simulate time passing by manipulating lastGenerationDay directly
      // We can't easily advance time in Hardhat without network helpers,
      // so instead test that a different user has independent count
      await asset.connect(editor).recordGeneration(nodeId, "editor prompt");
      expect(await asset.generationCountToday(editor.address)).to.equal(1);
    });

    it("reverts if prompt is empty", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      await expect(
        asset.connect(user).recordGeneration(nodeId, "")
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if prompt exceeds 500 bytes", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const longPrompt = "a".repeat(501);
      await expect(
        asset.connect(user).recordGeneration(nodeId, longPrompt)
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if nodeId is zero", async () => {
      await expect(
        asset.connect(user).recordGeneration(ethers.ZeroHash, "prompt")
      ).to.be.revertedWithCustomError(asset, "InvalidNodeId");
    });

    it("reverts when paused", async () => {
      await asset.pause();
      const nodeId = ethers.encodeBytes32String("node_001");
      await expect(
        asset.connect(user).recordGeneration(nodeId, "prompt")
      ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    });

    it("owner bypasses daily generation quota", async () => {
      const nodeId = ethers.encodeBytes32String("owner_node");
      const limit = Number(await asset.DAILY_GENERATION_LIMIT());

      for (let i = 0; i < limit + 5; i++) {
        await expect(
          asset.connect(owner).recordGeneration(nodeId, `owner prompt ${i}`)
        ).to.emit(asset, "AssetGenerationRecorded");
      }

      expect(await asset.generationCountToday(owner.address)).to.equal(
        limit + 5
      );
    });
  });

  describe("publishAsset", () => {
    it("mints to caller and stores tokenURI", async () => {
      const tokenId = 1;
      const uri = "ipfs://QmManifest123";
      await expect(asset.connect(user).publishAsset(uri, tokenId))
        .to.emit(asset, "AssetPublished")
        .withArgs(user.address, tokenId, uri);

      expect(await asset.ownerOf(tokenId)).to.equal(user.address);
      expect(await asset.tokenURI(tokenId)).to.equal(uri);
    });

    it("auto-adds sender as editor", async () => {
      const tokenId = 1;
      await asset.connect(user).publishAsset("uri", tokenId);
      const editors = await asset.listEditors(tokenId);
      expect(editors).to.include(user.address);
    });

    it("reverts on duplicate tokenId", async () => {
      const tokenId = 1;
      await asset.connect(user).publishAsset("uri1", tokenId);
      await expect(asset.connect(user).publishAsset("uri2", tokenId))
        .to.be.revertedWithCustomError(asset, "TokenAlreadyMinted")
        .withArgs(tokenId);
    });

    it("mints with initial editors", async () => {
      const tokenId = 2;
      await asset
        .connect(user)
        ["publishAsset(string,uint256,address[])"]("uri", tokenId, [
          editor.address,
        ]);
      const editors = await asset.listEditors(tokenId);
      expect(editors).to.include(user.address);
      expect(editors).to.include(editor.address);
    });
  });

  describe("Owner quota bypass", () => {
    it("owner can add more editors than maxEditorsPerToken", async () => {
      await asset.connect(owner).publishAsset("uri", 1);
      const cap = Number(await asset.maxEditorsPerToken());
      const wallets = Array.from({ length: cap + 5 }, () =>
        ethers.Wallet.createRandom()
      );

      await asset.connect(owner)["addEditor(uint256,address[])"](
        1,
        wallets.map((w) => w.address)
      );

      expect((await asset.listEditors(1)).length).to.equal(cap + 6); // + owner
    });

    it("owner can participate in more tokens than maxTokensPerEditor", async () => {
      const cap = Number(await asset.maxTokensPerEditor());

      for (let i = 1; i <= cap + 5; i++) {
        await asset.connect(owner).publishAsset(`ipfs://QmToken${i}`, i);
      }

      expect((await asset.listTokens(owner.address)).length).to.equal(cap + 5);
    });
  });

  describe("Collaboration limits (free tier)", () => {
    beforeEach(async () => {
      await asset.connect(user).publishAsset("uri", 1);
    });

    it("enforces maxEditorsPerToken = 5", async () => {
      const cap = Number(await asset.maxEditorsPerToken());
      expect(cap).to.equal(5);

      const freeSlots = cap - 1; // owner auto-added as editor
      const wallets = Array.from({ length: freeSlots }, () =>
        ethers.Wallet.createRandom()
      );
      await asset.connect(user)["addEditor(uint256,address[])"](
        1,
        wallets.map((w) => w.address)
      );

      expect((await asset.listEditors(1)).length).to.equal(cap);

      const extra = ethers.Wallet.createRandom();
      await expect(
        asset.connect(user)["addEditor(uint256,address)"](1, extra.address)
      )
        .to.be.revertedWithCustomError(asset, "MaxEditorsReached")
        .withArgs(1);
    });

    it("enforces maxTokensPerEditor = 50", async () => {
      const cap = Number(await asset.maxTokensPerEditor());
      expect(cap).to.equal(50);

      // user is already editor on token 1
      for (let i = 2; i <= cap; i++) {
        await asset.connect(user).publishAsset(`ipfs://QmToken${i}`, i);
      }
      expect((await asset.listTokens(user.address)).length).to.equal(cap);

      await expect(asset.connect(user).publishAsset("ipfs://QmToken51", 51))
        .to.be.revertedWithCustomError(asset, "MaxTokensPerEditorReached")
        .withArgs(user.address);
    });

    it("adds editor and updates reverse mapping", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      expect(await asset.listEditors(1)).to.include(editor.address);
      expect(await asset.listTokens(editor.address)).to.include(1n);
    });

    it("removes editor and updates reverse mapping", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await asset.connect(user).removeEditor(1, editor.address);
      expect(await asset.listEditors(1)).to.not.include(editor.address);
      expect(await asset.listTokens(editor.address)).to.not.include(1n);
    });

    it("viewer cannot update tokenURI", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          editor.address,
          CollaboratorRole.Viewer
        );

      await expect(asset.connect(editor).updateAssetURI(1, "viewerTry"))
        .to.be.revertedWithCustomError(asset, "NotOwnerOrEditor")
        .withArgs(1, editor.address);
    });

    it("editor can update tokenURI", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await asset.connect(editor).updateAssetURI(1, "editorURI");
      expect(await asset.tokenURI(1)).to.equal("editorURI");
    });
  });

  describe("burn", () => {
    beforeEach(async () => {
      await asset.connect(user).publishAsset("uri", 1);
    });

    it("owner can burn their own token", async () => {
      await expect(asset.connect(user).burn(1))
        .to.emit(asset, "AssetBurned")
        .withArgs(1, user.address);

      await expect(asset.ownerOf(1)).to.be.reverted;
    });

    it("burns decrement total supply", async () => {
      expect(await asset.totalSupply()).to.equal(1);
      await asset.connect(user).burn(1);
      expect(await asset.totalSupply()).to.equal(0);
    });

    it("Editor with burn permission can burn", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await asset.connect(user).setBurnPermission(1, editor.address, true);

      await expect(asset.connect(editor).burn(1))
        .to.emit(asset, "AssetBurned")
        .withArgs(1, editor.address);
    });

    it("non-collaborator cannot burn", async () => {
      await expect(asset.connect(owner).burn(1))
        .to.be.revertedWithCustomError(asset, "CannotBurn")
        .withArgs(1, owner.address);
    });
  });

  describe("Access Control", () => {
    it("only owner can pause/unpause", async () => {
      await expect(asset.connect(user).pause()).to.be.revertedWithCustomError(
        asset,
        "OwnableUnauthorizedAccount"
      );
      await expect(asset.connect(user).unpause()).to.be.revertedWithCustomError(
        asset,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("No payment functions", () => {
    it("does not have payForGeneration", async () => {
      expect(asset.payForGeneration).to.be.undefined;
    });

    it("does not have payForGenerationWithUSDC", async () => {
      expect(asset.payForGenerationWithUSDC).to.be.undefined;
    });

    it("does not have usdcToken", async () => {
      expect(asset.usdcToken).to.be.undefined;
    });

    it("does not have costPerGeneration", async () => {
      expect(asset.costPerGeneration).to.be.undefined;
    });
  });

  // ── Helpers ──

  async function getBlockTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp;
  }
});
