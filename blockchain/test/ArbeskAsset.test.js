const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArbeskAsset", function () {
  let asset, usdc, owner, treasury, user, editor;
  const COST = ethers.parseEther("0.01");
  const USDC_DECIMALS = 6;

  // Tier costs in 6-decimal USDC units
  const TIER_COSTS = {
    Basic: 750000n, // $0.75
    Standard: 1250000n, // $1.25
    Premium: 1750000n, // $1.75
    Pro: 2500000n, // $2.50
  };

  // Tier enum values (Solidity enum indices)
  const Tier = { Basic: 0, Standard: 1, Premium: 2, Pro: 3 };

  // CollaboratorRole enum values (Solidity enum indices)
  const CollaboratorRole = { None: 0, Viewer: 1, Editor: 2 };

  beforeEach(async () => {
    [owner, treasury, user, editor] = await ethers.getSigners();

    // Deploy MockUSDC for local testing
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // Mint USDC to users for testing
    const mintAmount = ethers.parseUnits("10000", USDC_DECIMALS);
    await usdc.mint(user.address, mintAmount);
    await usdc.mint(editor.address, mintAmount);
    await usdc.mint(owner.address, mintAmount);

    // Deploy ArbeskAsset with USDC token
    const Factory = await ethers.getContractFactory("ArbeskAsset");
    asset = await Factory.deploy(treasury.address, await usdc.getAddress());
    await asset.waitForDeployment();
  });

  describe("Deployment", () => {
    it("sets owner to deployer", async () => {
      expect(await asset.owner()).to.equal(owner.address);
    });

    it("sets treasury to provided address", async () => {
      expect(await asset.developerTreasuryWallet()).to.equal(treasury.address);
    });

    it("sets USDC token address", async () => {
      expect(await asset.usdcToken()).to.equal(await usdc.getAddress());
    });

    it("initializes all tier costs", async () => {
      expect(await asset.tierCosts(Tier.Basic)).to.equal(TIER_COSTS.Basic);
      expect(await asset.tierCosts(Tier.Standard)).to.equal(
        TIER_COSTS.Standard
      );
      expect(await asset.tierCosts(Tier.Premium)).to.equal(TIER_COSTS.Premium);
      expect(await asset.tierCosts(Tier.Pro)).to.equal(TIER_COSTS.Pro);
    });

    it("getTierCost returns correct values", async () => {
      expect(await asset.getTierCost(Tier.Basic)).to.equal(TIER_COSTS.Basic);
      expect(await asset.getTierCost(Tier.Standard)).to.equal(
        TIER_COSTS.Standard
      );
      expect(await asset.getTierCost(Tier.Premium)).to.equal(
        TIER_COSTS.Premium
      );
      expect(await asset.getTierCost(Tier.Pro)).to.equal(TIER_COSTS.Pro);
    });

    it("reverts if treasury is zero address", async () => {
      const Factory = await ethers.getContractFactory("ArbeskAsset");
      await expect(
        Factory.deploy(ethers.ZeroAddress, await usdc.getAddress())
      ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    });

    it("allows zero USDC address (USDC payments disabled)", async () => {
      const Factory = await ethers.getContractFactory("ArbeskAsset");
      const a = await Factory.deploy(treasury.address, ethers.ZeroAddress);
      await a.waitForDeployment();
      expect(await a.usdcToken()).to.equal(ethers.ZeroAddress);
    });

    it("has correct ERC721 metadata", async () => {
      expect(await asset.name()).to.equal("ArbeskAsset");
      expect(await asset.symbol()).to.equal("ARBA");
    });
  });

  describe("payForGeneration (native token)", () => {
    it("accepts exact payment and emits AssetGenerationPaid", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const prompt = "A modern workbench";

      await expect(
        asset.connect(user).payForGeneration(nodeId, prompt, { value: COST })
      ).to.emit(asset, "AssetGenerationPaid");
    });

    it("records payment as used", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const tx = await asset
        .connect(user)
        .payForGeneration(nodeId, "prompt", { value: COST });
      const receipt = await tx.wait();
      const used = await asset.isPaymentUsed(
        nodeId,
        user.address,
        receipt.blockNumber
      );
      expect(used).to.be.true;
    });

    it("forwards 100% to treasury", async () => {
      const before = await ethers.provider.getBalance(treasury.address);
      const nodeId = ethers.encodeBytes32String("node_001");
      await asset
        .connect(user)
        .payForGeneration(nodeId, "prompt", { value: COST });
      const after = await ethers.provider.getBalance(treasury.address);
      expect(after - before).to.equal(COST);
    });

    it("reverts if payment amount is incorrect", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      await expect(
        asset.connect(user).payForGeneration(nodeId, "prompt", {
          value: ethers.parseEther("0.02"),
        })
      ).to.be.revertedWithCustomError(asset, "IncorrectPaymentAmount");
    });

    it("reverts if prompt is empty", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      await expect(
        asset.connect(user).payForGeneration(nodeId, "", { value: COST })
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if prompt exceeds 500 bytes", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const longPrompt = "a".repeat(501);
      await expect(
        asset
          .connect(user)
          .payForGeneration(nodeId, longPrompt, { value: COST })
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if nodeId is zero", async () => {
      await expect(
        asset
          .connect(user)
          .payForGeneration(ethers.ZeroHash, "prompt", { value: COST })
      ).to.be.revertedWithCustomError(asset, "InvalidNodeId");
    });

    it("prevents replay via paymentKey mapping", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const tx = await asset
        .connect(user)
        .payForGeneration(nodeId, "prompt1", { value: COST });
      const receipt = await tx.wait();

      expect(
        await asset.isPaymentUsed(nodeId, user.address, receipt.blockNumber)
      ).to.be.true;

      const tx2 = await asset
        .connect(user)
        .payForGeneration(nodeId, "prompt2", { value: COST });
      const receipt2 = await tx2.wait();
      expect(receipt2.blockNumber).to.not.equal(receipt.blockNumber);
      expect(
        await asset.isPaymentUsed(nodeId, user.address, receipt2.blockNumber)
      ).to.be.true;
    });

    it("reverts when paused", async () => {
      await asset.pause();
      const nodeId = ethers.encodeBytes32String("node_001");
      await expect(
        asset.connect(user).payForGeneration(nodeId, "prompt", { value: COST })
      ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    });
  });

  describe("payForGenerationWithUSDC", () => {
    const nodeId = ethers.encodeBytes32String("node_001");
    const prompt = "A modern workbench";

    it("accepts Basic tier payment and emits AssetGenerationPaidUSDC", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);

      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.emit(asset, "AssetGenerationPaidUSDC");
    });

    it("accepts Pro tier payment", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Pro);

      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, Tier.Pro)
      ).to.emit(asset, "AssetGenerationPaidUSDC");
    });

    it("transfers correct USDC amount per tier", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Premium);

      const beforeTreasury = await usdc.balanceOf(treasury.address);
      const beforeUser = await usdc.balanceOf(user.address);

      await asset
        .connect(user)
        .payForGenerationWithUSDC(nodeId, prompt, Tier.Premium);

      const afterTreasury = await usdc.balanceOf(treasury.address);
      const afterUser = await usdc.balanceOf(user.address);

      expect(afterTreasury - beforeTreasury).to.equal(TIER_COSTS.Premium);
      expect(beforeUser - afterUser).to.equal(TIER_COSTS.Premium);
    });

    it("charges different amounts for different tiers", async () => {
      // Pay Basic first
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic + TIER_COSTS.Pro);

      const before = await usdc.balanceOf(treasury.address);

      await asset
        .connect(user)
        .payForGenerationWithUSDC(
          ethers.encodeBytes32String("node_basic"),
          "basic gen",
          Tier.Basic
        );
      await asset
        .connect(user)
        .payForGenerationWithUSDC(
          ethers.encodeBytes32String("node_pro"),
          "pro gen",
          Tier.Pro
        );

      const after = await usdc.balanceOf(treasury.address);
      expect(after - before).to.equal(TIER_COSTS.Basic + TIER_COSTS.Pro);
    });

    it("records payment as used", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Standard);
      const tx = await asset
        .connect(user)
        .payForGenerationWithUSDC(nodeId, prompt, Tier.Standard);
      const receipt = await tx.wait();

      const used = await asset.isPaymentUsed(
        nodeId,
        user.address,
        receipt.blockNumber
      );
      expect(used).to.be.true;
    });

    it("reverts if USDC token is not set (address(0))", async () => {
      const Factory = await ethers.getContractFactory("ArbeskAsset");
      const noUsdc = await Factory.deploy(treasury.address, ethers.ZeroAddress);
      await noUsdc.waitForDeployment();

      await expect(
        noUsdc
          .connect(user)
          .payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.be.revertedWithCustomError(noUsdc, "UsdcPaymentsDisabled");
    });

    it("reverts if caller has not approved USDC", async () => {
      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.be.reverted; // ERC20: insufficient allowance
    });

    it("reverts if caller has insufficient USDC for the tier", async () => {
      // Approve huge amount but set cost > balance
      const hugeAmount = ethers.parseUnits("999999", USDC_DECIMALS);
      await usdc.connect(user).approve(await asset.getAddress(), hugeAmount);
      await asset.setTierCost(
        Tier.Basic,
        ethers.parseUnits("999999", USDC_DECIMALS)
      );

      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.be.reverted; // ERC20: transfer amount exceeds balance
    });

    it("reverts if prompt is empty", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);
      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, "", Tier.Basic)
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if prompt exceeds 500 bytes", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);
      const longPrompt = "a".repeat(501);
      await expect(
        asset
          .connect(user)
          .payForGenerationWithUSDC(nodeId, longPrompt, Tier.Basic)
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if nodeId is zero", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);
      await expect(
        asset
          .connect(user)
          .payForGenerationWithUSDC(ethers.ZeroHash, prompt, Tier.Basic)
      ).to.be.revertedWithCustomError(asset, "InvalidNodeId");
    });

    it("reverts when paused", async () => {
      await asset.pause();
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);
      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    });

    it("reverts with invalid tier value (out of enum range)", async () => {
      // Passing an out-of-range enum value triggers a Solidity panic
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);
      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, 99)
      ).to.be.reverted;
    });

    it("shared paymentKey: USDC and native payments don't collide", async () => {
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);
      const tx1 = await asset
        .connect(user)
        .payForGenerationWithUSDC(nodeId, "prompt1", Tier.Basic);
      const receipt1 = await tx1.wait();

      const tx2 = await asset
        .connect(user)
        .payForGeneration(nodeId, "prompt2", { value: COST });
      const receipt2 = await tx2.wait();

      expect(
        await asset.isPaymentUsed(nodeId, user.address, receipt1.blockNumber)
      ).to.be.true;
      expect(
        await asset.isPaymentUsed(nodeId, user.address, receipt2.blockNumber)
      ).to.be.true;
    });
  });

  describe("Access Control", () => {
    it("only owner can setCost", async () => {
      await expect(
        asset.connect(user).setCost(ethers.parseEther("0.02"))
      ).to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount");
    });

    it("only owner can setTreasury", async () => {
      await expect(
        asset.connect(user).setTreasury(user.address)
      ).to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount");
    });

    it("only owner can setTierCost", async () => {
      await expect(
        asset.connect(user).setTierCost(Tier.Basic, 500000)
      ).to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount");
    });

    it("only owner can setUsdcToken", async () => {
      await expect(
        asset.connect(user).setUsdcToken(user.address)
      ).to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount");
    });

    it("only owner can withdrawUSDC", async () => {
      await expect(
        asset.connect(user).withdrawUSDC()
      ).to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount");
    });

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

    it("only owner can withdraw", async () => {
      await expect(
        asset.connect(user).withdraw()
      ).to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount");
    });
  });

  describe("setCost", () => {
    it("updates costPerGeneration", async () => {
      const newCost = ethers.parseEther("0.02");
      await asset.setCost(newCost);
      expect(await asset.costPerGeneration()).to.equal(newCost);
    });

    it("emits CostUpdated", async () => {
      const newCost = ethers.parseEther("0.02");
      await expect(asset.setCost(newCost))
        .to.emit(asset, "CostUpdated")
        .withArgs(COST, newCost);
    });

    it("reverts if cost is 0", async () => {
      await expect(asset.setCost(0)).to.be.revertedWithCustomError(
        asset,
        "InvalidCost"
      );
    });
  });

  describe("setTreasury", () => {
    it("updates treasury wallet", async () => {
      await asset.setTreasury(user.address);
      expect(await asset.developerTreasuryWallet()).to.equal(user.address);
    });

    it("emits TreasuryUpdated", async () => {
      await expect(asset.setTreasury(user.address))
        .to.emit(asset, "TreasuryUpdated")
        .withArgs(treasury.address, user.address);
    });

    it("reverts if new wallet is zero address", async () => {
      await expect(
        asset.setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(asset, "ZeroAddress");
    });
  });

  describe("setTierCost", () => {
    it("updates a single tier cost", async () => {
      const newCost = 500000n; // $0.50
      await asset.setTierCost(Tier.Basic, newCost);
      expect(await asset.tierCosts(Tier.Basic)).to.equal(newCost);
      // Other tiers unchanged
      expect(await asset.tierCosts(Tier.Pro)).to.equal(TIER_COSTS.Pro);
    });

    it("emits TierCostUpdated", async () => {
      const newCost = 999999n;
      await expect(asset.setTierCost(Tier.Premium, newCost))
        .to.emit(asset, "TierCostUpdated")
        .withArgs(Tier.Premium, TIER_COSTS.Premium, newCost);
    });

    it("reverts if cost is 0", async () => {
      await expect(
        asset.setTierCost(Tier.Basic, 0)
      ).to.be.revertedWithCustomError(asset, "InvalidCost");
    });

    it("allows updating all tiers independently", async () => {
      await asset.setTierCost(Tier.Basic, 100000n);
      await asset.setTierCost(Tier.Standard, 200000n);
      await asset.setTierCost(Tier.Premium, 300000n);
      await asset.setTierCost(Tier.Pro, 400000n);

      expect(await asset.tierCosts(Tier.Basic)).to.equal(100000n);
      expect(await asset.tierCosts(Tier.Standard)).to.equal(200000n);
      expect(await asset.tierCosts(Tier.Premium)).to.equal(300000n);
      expect(await asset.tierCosts(Tier.Pro)).to.equal(400000n);
    });

    it("cannot set tier cost to zero", async () => {
      await expect(
        asset.setTierCost(Tier.Standard, 0)
      ).to.be.revertedWithCustomError(asset, "InvalidCost");
    });
  });

  describe("setUsdcToken", () => {
    it("updates USDC token address", async () => {
      const oldToken = await asset.usdcToken();
      await asset.setUsdcToken(user.address);
      expect(await asset.usdcToken()).to.equal(user.address);
    });

    it("emits UsdcTokenUpdated", async () => {
      const oldToken = await usdc.getAddress();
      await expect(asset.setUsdcToken(user.address))
        .to.emit(asset, "UsdcTokenUpdated")
        .withArgs(oldToken, user.address);
    });

    it("allows setting to zero address to disable USDC", async () => {
      await asset.setUsdcToken(ethers.ZeroAddress);
      expect(await asset.usdcToken()).to.equal(ethers.ZeroAddress);
    });
  });

  describe("withdraw", () => {
    it("sends stray balance to treasury", async () => {
      await expect(asset.withdraw()).to.be.revertedWithCustomError(
        asset,
        "NoBalanceToWithdraw"
      );
    });
  });

  describe("withdrawUSDC", () => {
    it("reverts when no USDC to withdraw", async () => {
      await expect(asset.withdrawUSDC()).to.be.revertedWithCustomError(
        asset,
        "NoBalanceToWithdraw"
      );
    });

    it("recovers USDC accidentally sent to contract", async () => {
      const recoverAmount = ethers.parseUnits("100", USDC_DECIMALS);
      await usdc
        .connect(user)
        .transfer(await asset.getAddress(), recoverAmount);

      const beforeTreasury = await usdc.balanceOf(treasury.address);
      await asset.withdrawUSDC();
      const afterTreasury = await usdc.balanceOf(treasury.address);

      expect(afterTreasury - beforeTreasury).to.equal(recoverAmount);
      expect(await usdc.balanceOf(await asset.getAddress())).to.equal(0);
    });

    it("reverts if USDC token is not set", async () => {
      await asset.setUsdcToken(ethers.ZeroAddress);
      await expect(asset.withdrawUSDC()).to.be.revertedWithCustomError(
        asset,
        "UsdcTokenNotSet"
      );
    });
  });

  describe("receive/fallback", () => {
    it("reverts direct ETH transfers", async () => {
      await expect(
        owner.sendTransaction({ to: await asset.getAddress(), value: 1 })
      ).to.be.revertedWithCustomError(asset, "DirectTransferNotAllowed");
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

  describe("addEditor / removeEditor", () => {
    beforeEach(async () => {
      await asset.connect(user).publishAsset("uri", 1);
    });

    it("only owner can add editor", async () => {
      await expect(
        asset.connect(editor)["addEditor(uint256,address)"](1, editor.address)
      )
        .to.be.revertedWithCustomError(asset, "NotTokenOwner")
        .withArgs(1, editor.address);
    });

    it("adds editor and updates reverse mapping", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      expect(await asset.listEditors(1)).to.include(editor.address);
      expect(await asset.listTokens(editor.address)).to.include(1n);
    });

    it("emits EditorAdded", async () => {
      await expect(
        asset.connect(user)["addEditor(uint256,address)"](1, editor.address)
      )
        .to.emit(asset, "EditorAdded")
        .withArgs(1, editor.address);
    });

    it("batch adds editors", async () => {
      const [, , , e1, e2] = await ethers.getSigners();
      await asset
        .connect(user)
        ["addEditor(uint256,address[])"](1, [e1.address, e2.address]);
      const editors = await asset.listEditors(1);
      expect(editors).to.include(e1.address);
      expect(editors).to.include(e2.address);
    });

    it("prevents duplicate editor entries", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await expect(
        asset.connect(user)["addEditor(uint256,address)"](1, editor.address)
      ).to.not.emit(asset, "EditorAdded");

      const editors = await asset.listEditors(1);
      const occurrences = editors.filter((e) => e === editor.address).length;
      expect(occurrences).to.equal(1);
    });

    it("reverts when exceeding MAX_EDITORS_PER_TOKEN", async () => {
      const cap = Number(await asset.MAX_EDITORS_PER_TOKEN());
      const freeSlots = cap - 1;
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

    it("reverts when exceeding MAX_TOKENS_PER_EDITOR", async () => {
      const cap = Number(await asset.MAX_TOKENS_PER_EDITOR());
      for (let i = 2; i <= cap; i++) {
        await asset.connect(user).publishAsset(`ipfs://QmToken${i}`, i);
      }
      expect((await asset.listTokens(user.address)).length).to.equal(cap);

      await expect(asset.connect(user).publishAsset("ipfs://QmToken501", 501))
        .to.be.revertedWithCustomError(asset, "MaxTokensPerEditorReached")
        .withArgs(user.address);
    });

    it("only owner can remove editor", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await expect(asset.connect(editor).removeEditor(1, editor.address))
        .to.be.revertedWithCustomError(asset, "NotTokenOwner")
        .withArgs(1, editor.address);
    });

    it("silently no-ops when removing a non-editor", async () => {
      await expect(
        asset.connect(user).removeEditor(1, editor.address)
      ).to.not.emit(asset, "EditorRemoved");
      const editors = await asset.listEditors(1);
      expect(editors).to.deep.equal([user.address]);
    });

    it("removes editor and updates reverse mapping", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await asset.connect(user).removeEditor(1, editor.address);
      expect(await asset.listEditors(1)).to.not.include(editor.address);
      expect(await asset.listTokens(editor.address)).to.not.include(1n);
    });

    it("emits EditorRemoved", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await expect(asset.connect(user).removeEditor(1, editor.address))
        .to.emit(asset, "EditorRemoved")
        .withArgs(1, editor.address);
    });
  });

  describe("collaborator roles (Viewer / Editor)", () => {
    beforeEach(async () => {
      await asset.connect(user).publishAsset("uri", 1);
    });

    it("adds editor with explicit Editor role and emits CollaboratorRoleChanged", async () => {
      await expect(
        asset
          .connect(user)
          ["addEditor(uint256,address,uint8)"](
            1,
            editor.address,
            CollaboratorRole.Editor
          )
      )
        .to.emit(asset, "EditorAdded")
        .withArgs(1, editor.address)
        .and.to.emit(asset, "CollaboratorRoleChanged")
        .withArgs(1, editor.address, CollaboratorRole.Editor);
    });

    it("adds viewer with explicit Viewer role", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          editor.address,
          CollaboratorRole.Viewer
        );

      expect(await asset.getCollaboratorRole(1, editor.address)).to.equal(
        CollaboratorRole.Viewer
      );
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

    it("editor (default) can update tokenURI", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await asset.connect(editor).updateAssetURI(1, "editorURI");
      expect(await asset.tokenURI(1)).to.equal("editorURI");
    });

    it("getCollaboratorRole returns correct values", async () => {
      expect(await asset.getCollaboratorRole(1, editor.address)).to.equal(
        CollaboratorRole.None
      );

      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          editor.address,
          CollaboratorRole.Viewer
        );
      expect(await asset.getCollaboratorRole(1, editor.address)).to.equal(
        CollaboratorRole.Viewer
      );

      await asset
        .connect(user)
        .setCollaboratorRole(1, editor.address, CollaboratorRole.Editor);
      expect(await asset.getCollaboratorRole(1, editor.address)).to.equal(
        CollaboratorRole.Editor
      );
    });

    it("setCollaboratorRole changes Viewer to Editor", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          editor.address,
          CollaboratorRole.Viewer
        );

      await expect(
        asset
          .connect(user)
          .setCollaboratorRole(1, editor.address, CollaboratorRole.Editor)
      )
        .to.emit(asset, "CollaboratorRoleChanged")
        .withArgs(1, editor.address, CollaboratorRole.Editor);

      expect(await asset.getCollaboratorRole(1, editor.address)).to.equal(
        CollaboratorRole.Editor
      );
    });

    it("setCollaboratorRole downgrades Editor to Viewer", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await asset
        .connect(user)
        .setCollaboratorRole(1, editor.address, CollaboratorRole.Viewer);

      expect(await asset.getCollaboratorRole(1, editor.address)).to.equal(
        CollaboratorRole.Viewer
      );

      // Downgraded viewer can no longer update
      await expect(asset.connect(editor).updateAssetURI(1, "downgraded"))
        .to.be.revertedWithCustomError(asset, "NotOwnerOrEditor")
        .withArgs(1, editor.address);
    });

    it("setCollaboratorRole to None removes collaborator", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await expect(
        asset
          .connect(user)
          .setCollaboratorRole(1, editor.address, CollaboratorRole.None)
      )
        .to.emit(asset, "EditorRemoved")
        .withArgs(1, editor.address);

      expect(await asset.getCollaboratorRole(1, editor.address)).to.equal(
        CollaboratorRole.None
      );
      expect(await asset.listEditors(1)).to.not.include(editor.address);
    });

    it("setCollaboratorRole reverts on non-collaborator", async () => {
      await expect(
        asset
          .connect(user)
          .setCollaboratorRole(1, editor.address, CollaboratorRole.Editor)
      )
        .to.be.revertedWithCustomError(asset, "NotCollaborator")
        .withArgs(1, editor.address);
    });

    it("setCollaboratorRole only owner can call", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await expect(
        asset
          .connect(editor)
          .setCollaboratorRole(1, editor.address, CollaboratorRole.Viewer)
      )
        .to.be.revertedWithCustomError(asset, "NotTokenOwner")
        .withArgs(1, editor.address);
    });

    it("listCollaboratorsByRole filters correctly", async () => {
      const [, , , e1, e2, e3] = await ethers.getSigners();

      // e1 = Editor, e2 = Viewer, e3 = Viewer
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          e1.address,
          CollaboratorRole.Editor
        );
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          e2.address,
          CollaboratorRole.Viewer
        );
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          e3.address,
          CollaboratorRole.Viewer
        );

      const editors = await asset.listCollaboratorsByRole(
        1,
        CollaboratorRole.Editor
      );
      expect(editors).to.include(e1.address);
      expect(editors).to.not.include(e2.address);
      expect(editors).to.not.include(e3.address);
      expect(editors).to.include(user.address); // owner auto-added as Editor

      const viewers = await asset.listCollaboratorsByRole(
        1,
        CollaboratorRole.Viewer
      );
      expect(viewers).to.include(e2.address);
      expect(viewers).to.include(e3.address);
      expect(viewers).to.not.include(e1.address);
      expect(viewers).to.not.include(user.address);
    });

    it("listCollaboratorsByRole reverts on None role", async () => {
      await expect(
        asset.listCollaboratorsByRole(1, CollaboratorRole.None)
      ).to.be.revertedWithCustomError(asset, "InvalidCollaboratorRole");
    });

    it("addEditor with None role reverts", async () => {
      await expect(
        asset
          .connect(user)
          ["addEditor(uint256,address,uint8)"](
            1,
            editor.address,
            CollaboratorRole.None
          )
      ).to.be.revertedWithCustomError(asset, "InvalidCollaboratorRole");
    });

    it("uses new _isEditor gate for Viewer vs Editor access", async () => {
      // Add as Viewer first — should NOT be able to update
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          editor.address,
          CollaboratorRole.Viewer
        );

      await expect(
        asset.connect(editor).updateAssetURI(1, "viewerFail")
      ).to.be.revertedWithCustomError(asset, "NotOwnerOrEditor");

      // Upgrade to Editor — should be able to update
      await asset
        .connect(user)
        .setCollaboratorRole(1, editor.address, CollaboratorRole.Editor);
      await asset.connect(editor).updateAssetURI(1, "editorOK");
      expect(await asset.tokenURI(1)).to.equal("editorOK");
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

      // Token should no longer exist
      await expect(asset.ownerOf(1)).to.be.reverted;
    });

    it("owner can burn with collaborators present", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      expect(await asset.listEditors(1)).to.include(editor.address);

      await asset.connect(user).burn(1);

      // All collaborators should be cleaned up
      await expect(asset.ownerOf(1)).to.be.reverted;
      expect(await asset.listTokens(editor.address)).to.not.include(1n);
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

    it("Editor without burn permission cannot burn", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await expect(asset.connect(editor).burn(1))
        .to.be.revertedWithCustomError(asset, "CannotBurn")
        .withArgs(1, editor.address);
    });

    it("Viewer cannot burn even with burn flag", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address,uint8)"](
          1,
          editor.address,
          CollaboratorRole.Viewer
        );

      // setBurnPermission should revert for a Viewer
      await expect(
        asset.connect(user).setBurnPermission(1, editor.address, true)
      ).to.be.revertedWithCustomError(asset, "NotCollaborator");
    });

    it("non-collaborator cannot burn", async () => {
      await expect(asset.connect(treasury).burn(1))
        .to.be.revertedWithCustomError(asset, "CannotBurn")
        .withArgs(1, treasury.address);
    });

    it("reverts on nonexistent token", async () => {
      await expect(asset.connect(user).burn(999))
        .to.be.revertedWithCustomError(asset, "NonexistentToken")
        .withArgs(999);
    });

    it("setBurnPermission revokes correctly", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await asset.connect(user).setBurnPermission(1, editor.address, true);
      expect(await asset.canBurn(1, editor.address)).to.be.true;

      await asset.connect(user).setBurnPermission(1, editor.address, false);
      expect(await asset.canBurn(1, editor.address)).to.be.false;

      await expect(asset.connect(editor).burn(1)).to.be.revertedWithCustomError(
        asset,
        "CannotBurn"
      );
    });

    it("setBurnPermission only owner can call", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await expect(
        asset.connect(editor).setBurnPermission(1, editor.address, true)
      )
        .to.be.revertedWithCustomError(asset, "NotTokenOwner")
        .withArgs(1, editor.address);
    });

    it("setBurnPermission emits event", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      await expect(
        asset.connect(user).setBurnPermission(1, editor.address, true)
      )
        .to.emit(asset, "BurnPermissionChanged")
        .withArgs(1, editor.address, true);
    });

    it("canBurn returns false for default state", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);

      expect(await asset.canBurn(1, user.address)).to.be.true; // owner always
      expect(await asset.canBurn(1, editor.address)).to.be.false; // no burn perm yet
      expect(await asset.canBurn(1, treasury.address)).to.be.false; // non-collaborator
    });

    it("burns decrement total supply", async () => {
      expect(await asset.totalSupply()).to.equal(1);
      await asset.connect(user).burn(1);
      expect(await asset.totalSupply()).to.equal(0);
    });

    it("cant burn twice", async () => {
      await asset.connect(user).burn(1);
      await expect(asset.connect(user).burn(1))
        .to.be.revertedWithCustomError(asset, "NonexistentToken")
        .withArgs(1);
    });

    it("burning frees MAX_TOKENS_PER_EDITOR slot for all collaborators", async () => {
      // Publish 3 tokens — owner auto-added as Editor on each
      await asset.connect(user).publishAsset("uri2", 2);
      await asset.connect(user).publishAsset("uri3", 3);

      // Add editor as collaborator on all 3 tokens
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](2, editor.address);
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](3, editor.address);

      expect((await asset.listTokens(user.address)).length).to.equal(3);
      expect((await asset.listTokens(editor.address)).length).to.equal(3);

      // Burn token 1 — should free a slot for both owner and editor
      await asset.connect(user).setBurnPermission(1, editor.address, true);
      await asset.connect(editor).burn(1);

      expect((await asset.listTokens(user.address)).length).to.equal(2);
      expect((await asset.listTokens(editor.address)).length).to.equal(2);

      // Owner should now be able to publish a new token (was at cap minus 1)
      await asset.connect(user).publishAsset("uri4", 4);
      expect((await asset.listTokens(user.address)).length).to.equal(3);
    });
  });

  describe("updateAssetURI", () => {
    beforeEach(async () => {
      await asset.connect(user).publishAsset("uri", 1);
    });

    it("owner can update tokenURI", async () => {
      await asset.connect(user).updateAssetURI(1, "newURI");
      expect(await asset.tokenURI(1)).to.equal("newURI");
    });

    it("editor can update tokenURI", async () => {
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
      await asset.connect(editor).updateAssetURI(1, "editorURI");
      expect(await asset.tokenURI(1)).to.equal("editorURI");
    });

    it("non-editor cannot update tokenURI", async () => {
      await expect(asset.connect(treasury).updateAssetURI(1, "x"))
        .to.be.revertedWithCustomError(asset, "NotOwnerOrEditor")
        .withArgs(1, treasury.address);
    });

    it("emits AssetURIUpdated", async () => {
      await expect(asset.connect(user).updateAssetURI(1, "newURI"))
        .to.emit(asset, "AssetURIUpdated")
        .withArgs(1, "newURI");
    });

    it("reverts on nonexistent token", async () => {
      await expect(asset.connect(user).updateAssetURI(999, "x"))
        .to.be.revertedWithCustomError(asset, "NonexistentToken")
        .withArgs(999);
    });
  });

  describe("isPaymentUsed", () => {
    it("returns false before payment", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const used = await asset.isPaymentUsed(nodeId, user.address, 0);
      expect(used).to.be.false;
    });

    it("returns true after native payment", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      const tx = await asset
        .connect(user)
        .payForGeneration(nodeId, "prompt", { value: COST });
      const receipt = await tx.wait();
      const used = await asset.isPaymentUsed(
        nodeId,
        user.address,
        receipt.blockNumber
      );
      expect(used).to.be.true;
    });

    it("returns true after USDC payment", async () => {
      const nodeId = ethers.encodeBytes32String("node_001");
      await usdc
        .connect(user)
        .approve(await asset.getAddress(), TIER_COSTS.Basic);
      const tx = await asset
        .connect(user)
        .payForGenerationWithUSDC(nodeId, "prompt", Tier.Basic);
      const receipt = await tx.wait();
      const used = await asset.isPaymentUsed(
        nodeId,
        user.address,
        receipt.blockNumber
      );
      expect(used).to.be.true;
    });
  });

  describe("transfer", () => {
    beforeEach(async () => {
      await asset.connect(user).publishAsset("ipfs://QmA", 1);
      await asset
        .connect(user)
        ["addEditor(uint256,address)"](1, editor.address);
    });

    it("revokes old owner editor rights after transfer", async () => {
      await asset
        .connect(user)
        .safeTransferFrom(user.address, treasury.address, 1);

      await expect(asset.connect(user).updateAssetURI(1, "ipfs://QmHijack"))
        .to.be.revertedWithCustomError(asset, "NotOwnerOrEditor")
        .withArgs(1, user.address);

      const editors = await asset.listEditors(1);
      expect(editors).to.not.include(user.address);
    });

    it("auto-adds new owner as editor after transfer", async () => {
      await asset
        .connect(user)
        .safeTransferFrom(user.address, treasury.address, 1);

      await expect(
        asset.connect(treasury).updateAssetURI(1, "ipfs://QmNew")
      ).to.emit(asset, "AssetURIUpdated");

      const editors = await asset.listEditors(1);
      expect(editors).to.include(treasury.address);
    });

    it("preserves other editors after transfer", async () => {
      await asset
        .connect(user)
        .safeTransferFrom(user.address, treasury.address, 1);

      await expect(
        asset.connect(editor).updateAssetURI(1, "ipfs://QmEditorUpdate")
      ).to.emit(asset, "AssetURIUpdated");
    });
  });
});
