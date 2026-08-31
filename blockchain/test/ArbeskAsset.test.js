const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { SimpleMerkleTree } = require("@openzeppelin/merkle-tree");

// ════════════════════════════════════════════════════════════════════════════
// Merkle Helpers - must match ArbeskAssetBase._requireEditor leaf structure.
// Tree construction uses @openzeppelin/merkle-tree — the same library the
// frontend uses (frontend/src/js/gltf/merkle-editors.js) — so tests are
// byte-compatible with OZ MerkleProof.sol by construction.
// ════════════════════════════════════════════════════════════════════════════

function makeLeaf(address, role, tokenId, setVersion, assetScope = ethers.ZeroHash) {
  return ethers.solidityPackedKeccak256(
    ["address", "uint8", "uint256", "bytes32", "uint256"],
    [address, role, tokenId, assetScope, setVersion]
  );
}

function computeRoot(editorList, tokenId, setVersion, assetScope = ethers.ZeroHash) {
  if (!editorList || editorList.length === 0) return ethers.ZeroHash;
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion, assetScope)
  );
  return SimpleMerkleTree.of(leaves).root;
}

function getProof(editorList, targetAddress, tokenId, setVersion, assetScope = ethers.ZeroHash) {
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase()
  );
  if (!entry) return null;

  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion, assetScope)
  );
  const tree = SimpleMerkleTree.of(leaves);
  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion, assetScope);

  return { proof: tree.getProof(leaf), role: entry.role };
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite
// ════════════════════════════════════════════════════════════════════════════

describe("ArbeskAsset (Merkle)", function () {
  let asset, usdc, owner, treasury, user, editor, editor2;
  const USDC_DECIMALS = 6;

  const TIER_COSTS = {
    Basic: 750000n,
    Standard: 1250000n,
    Premium: 1750000n,
    Pro: 2500000n,
  };

  const Tier = { Basic: 0, Standard: 1, Premium: 2, Pro: 3 };
  const CollaboratorRole = { None: 0, Viewer: 1, Editor: 2 };

  beforeEach(async () => {
    [owner, treasury, user, editor, editor2] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const mintAmount = ethers.parseUnits("10000", USDC_DECIMALS);
    await usdc.mint(user.address, mintAmount);
    await usdc.mint(editor.address, mintAmount);
    await usdc.mint(editor2.address, mintAmount);
    await usdc.mint(owner.address, mintAmount);

    const Factory = await ethers.getContractFactory("ArbeskAsset");
    asset = await upgrades.deployProxy(
      Factory,
      [treasury.address, await usdc.getAddress()],
      { initializer: "initialize" }
    );
  });

  // ── Helpers ──

  /** Publish a token with the caller as sole Editor (role=2). */
  async function publishAsEditor(signer, tokenId, uri = "ipfs://test") {
    const editorList = [
      { address: signer.address, role: CollaboratorRole.Editor },
    ];
    const root = computeRoot(editorList, tokenId, 1);
    const tx = await asset.connect(signer).publishAsset(uri, tokenId, root, "");
    await tx.wait();
    return { root, editorList };
  }

  /** Publish with multiple editors. */
  async function publishWithEditors(
    signer,
    tokenId,
    editors,
    uri = "ipfs://test"
  ) {
    const root = computeRoot(editors, tokenId, 1);
    const tx = await asset.connect(signer).publishAsset(uri, tokenId, root, "");
    await tx.wait();
    return root;
  }

  // ════════════════════════════════════════════════════════════════════
  // Deployment
  // ════════════════════════════════════════════════════════════════════

  describe("Deployment", function () {
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
      for (const [name, expected] of Object.entries(TIER_COSTS)) {
        expect(await asset.tierCosts(Tier[name])).to.equal(expected);
      }
    });

    it("has correct ERC721 metadata", async () => {
      expect(await asset.name()).to.equal("ArbeskAsset");
      expect(await asset.symbol()).to.equal("ARBA");
    });

    it("has MAX_EDITORS_PER_TOKEN = 5000", async () => {
      expect(await asset.MAX_EDITORS_PER_TOKEN()).to.equal(5000n);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Payment - USDC
  // ════════════════════════════════════════════════════════════════════

  describe("payForGenerationWithUSDC", function () {
    const nodeId = ethers.id("node-usdc");
    const prompt = "a blue sphere";

    beforeEach(async () => {
      await usdc
        .connect(user)
        .approve(
          await asset.getAddress(),
          ethers.parseUnits("100", USDC_DECIMALS)
        );
    });

    it("accepts Basic tier payment and emits AssetGenerationPaidUSDC", async () => {
      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      )
        .to.emit(asset, "AssetGenerationPaidUSDC")
        .withArgs(
          user.address,
          nodeId,
          prompt,
          TIER_COSTS.Basic,
          (v) => v > 0n,
          Tier.Basic
        );
    });

    it("reverts if USDC token is not set (address(0))", async () => {
      const Factory = await ethers.getContractFactory("ArbeskAsset");
      const noUsdc = await upgrades.deployProxy(
        Factory,
        [treasury.address, ethers.ZeroAddress],
        { initializer: "initialize" }
      );

      await usdc
        .connect(user)
        .approve(await noUsdc.getAddress(), ethers.parseUnits("100", 6));
      await expect(
        noUsdc
          .connect(user)
          .payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.be.revertedWithCustomError(noUsdc, "UsdcPaymentsDisabled");
    });

    it("reverts if prompt is empty", async () => {
      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, "", Tier.Basic)
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if prompt exceeds 500 bytes", async () => {
      const longPrompt = "x".repeat(501);
      await expect(
        asset
          .connect(user)
          .payForGenerationWithUSDC(nodeId, longPrompt, Tier.Basic)
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if nodeId is zero", async () => {
      await expect(
        asset
          .connect(user)
          .payForGenerationWithUSDC(ethers.ZeroHash, prompt, Tier.Basic)
      ).to.be.revertedWithCustomError(asset, "InvalidNodeId");
    });

    it("reverts when paused", async () => {
      await asset.connect(owner).pause();
      await expect(
        asset.connect(user).payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.be.reverted;
      await asset.connect(owner).unpause();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Admin
  // ════════════════════════════════════════════════════════════════════

  describe("Access Control", function () {
    it("only owner can pause/unpause", async () => {
      await expect(asset.connect(user).pause()).to.be.reverted;
      await asset.connect(owner).pause();
      expect(await asset.paused()).to.be.true;
      await asset.connect(owner).unpause();
      expect(await asset.paused()).to.be.false;
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Admin setters + withdrawUSDC (coverage gap #55 + regression #54)
  // ════════════════════════════════════════════════════════════════════

  describe("Admin", function () {
    it("setTreasury reverts on zero address", async () => {
      await expect(asset.setTreasury(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(asset, "ZeroAddress");
    });

    it("setTreasury reverts for non-owner", async () => {
      await expect(asset.connect(user).setTreasury(user.address))
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });

    it("setTreasury updates wallet and emits TreasuryUpdated", async () => {
      await expect(asset.setTreasury(editor.address))
        .to.emit(asset, "TreasuryUpdated")
        .withArgs(treasury.address, editor.address);
      expect(await asset.developerTreasuryWallet()).to.equal(editor.address);
    });

    it("setUsdcToken reverts for non-owner", async () => {
      await expect(asset.connect(user).setUsdcToken(await usdc.getAddress()))
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });

    it("setUsdcToken reverts on zero address", async () => {
      await expect(asset.setUsdcToken(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(asset, "ZeroAddress");
    });

    it("setUsdcToken updates token and emits UsdcTokenUpdated", async () => {
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const newUsdc = await MockUSDC.deploy();
      await newUsdc.waitForDeployment();
      const oldToken = await asset.usdcToken();
      await expect(asset.setUsdcToken(await newUsdc.getAddress()))
        .to.emit(asset, "UsdcTokenUpdated")
        .withArgs(oldToken, await newUsdc.getAddress());
      expect(await asset.usdcToken()).to.equal(await newUsdc.getAddress());
    });

    it("setTierCost reverts on zero cost", async () => {
      await expect(asset.setTierCost(Tier.Basic, 0))
        .to.be.revertedWithCustomError(asset, "InvalidCost");
    });

    it("setTierCost reverts for non-owner", async () => {
      await expect(asset.connect(user).setTierCost(Tier.Basic, 100))
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });

    it("setTierCost updates price and emits TierCostUpdated", async () => {
      await expect(asset.setTierCost(Tier.Standard, 999))
        .to.emit(asset, "TierCostUpdated")
        .withArgs(Tier.Standard, TIER_COSTS.Standard, 999n);
      expect(await asset.tierCosts(Tier.Standard)).to.equal(999n);
    });

    it("withdrawUSDC reverts when USDC token not set", async () => {
      const Factory = await ethers.getContractFactory("ArbeskAsset");
      const noUsdc = await upgrades.deployProxy(
        Factory,
        [treasury.address, ethers.ZeroAddress],
        { initializer: "initialize" }
      );
      await expect(noUsdc.withdrawUSDC())
        .to.be.revertedWithCustomError(noUsdc, "UsdcTokenNotSet");
    });

    it("withdrawUSDC reverts when balance is zero", async () => {
      await expect(asset.withdrawUSDC())
        .to.be.revertedWithCustomError(asset, "NoBalanceToWithdraw");
    });

    it("withdrawUSDC drains full balance to treasury (regression #54)", async () => {
      // The paid flow transfers USDC user→treasury directly, so the contract
      // balance only accumulates from a mistaken DIRECT transfer — which is
      // exactly what withdrawUSDC exists to recover.
      const amount = ethers.parseUnits("50", USDC_DECIMALS);
      await usdc.connect(user).transfer(await asset.getAddress(), amount);
      expect(await usdc.balanceOf(await asset.getAddress())).to.equal(amount);

      const before = await usdc.balanceOf(treasury.address);
      await expect(asset.withdrawUSDC())
        .to.emit(usdc, "Transfer")
        .withArgs(await asset.getAddress(), treasury.address, amount);
      expect(await usdc.balanceOf(await asset.getAddress())).to.equal(0n);
      expect(await usdc.balanceOf(treasury.address)).to.equal(before + amount);
    });

    it("withdrawUSDC reverts for non-owner", async () => {
      await expect(asset.connect(user).withdrawUSDC())
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Governance - Ownable2Step two-step transfer (#57)
  // ════════════════════════════════════════════════════════════════════

  describe("Governance (Ownable2Step)", function () {
    it("transferOwnership starts a two-step transfer", async () => {
      await expect(asset.transferOwnership(editor.address))
        .to.emit(asset, "OwnershipTransferStarted")
        .withArgs(owner.address, editor.address);
      expect(await asset.pendingOwner()).to.equal(editor.address);
      // owner() is unchanged until the pending owner accepts.
      expect(await asset.owner()).to.equal(owner.address);
    });

    it("old owner still controls until the transfer is accepted", async () => {
      await asset.transferOwnership(editor.address);
      await asset.pause();
      await asset.unpause();
    });

    it("non-pending-owner cannot accept", async () => {
      await asset.transferOwnership(editor.address);
      await expect(asset.connect(user).acceptOwnership())
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });

    it("pending owner accepts and becomes the new owner", async () => {
      await asset.transferOwnership(editor.address);
      await asset.connect(editor).acceptOwnership();
      expect(await asset.owner()).to.equal(editor.address);

      // The old deployer is no longer privileged.
      await expect(asset.pause())
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(owner.address);
      // The new owner is privileged.
      await asset.connect(editor).pause();
      await asset.connect(editor).unpause();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Asset-scoped editors (#50)
  // ════════════════════════════════════════════════════════════════════

  describe("Asset-scoped editors", function () {
    it("collection-scope (bytes32(0)) editor updates URI", async () => {
      const tokenId = 500;
      const editors = [{ address: editor.address, role: CollaboratorRole.Editor }];
      const root = computeRoot(editors, tokenId, 1); // scope = bytes32(0)
      await asset.connect(user).publishAsset("ipfs://scope", tokenId, root, "");

      const { proof } = getProof(editors, editor.address, tokenId, 1);
      await asset
        .connect(editor)
        .updateAssetURI(tokenId, "ipfs://ok", ethers.ZeroHash, proof);
      expect(await asset.tokenURI(tokenId)).to.equal("ipfs://ok");
    });

    it("asset-scoped editor updates URI with matching scope", async () => {
      const tokenId = 501;
      const assetScope = ethers.id("asset-1");
      const editors = [{ address: editor.address, role: CollaboratorRole.Editor }];
      const root = computeRoot(editors, tokenId, 1, assetScope);
      await asset.connect(user).publishAsset("ipfs://scope2", tokenId, root, "");

      const { proof } = getProof(editors, editor.address, tokenId, 1, assetScope);
      await asset
        .connect(editor)
        .updateAssetURI(tokenId, "ipfs://scoped", assetScope, proof);
      expect(await asset.tokenURI(tokenId)).to.equal("ipfs://scoped");
    });

    it("asset-scoped proof fails with a different assetScope", async () => {
      const tokenId = 502;
      const assetScope = ethers.id("asset-a");
      const otherScope = ethers.id("asset-b");
      const editors = [{ address: editor.address, role: CollaboratorRole.Editor }];
      const root = computeRoot(editors, tokenId, 1, assetScope);
      await asset.connect(user).publishAsset("ipfs://scope3", tokenId, root, "");

      const { proof } = getProof(editors, editor.address, tokenId, 1, assetScope);
      await expect(
        asset.connect(editor).updateAssetURI(tokenId, "ipfs://nope", otherScope, proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("asset-scoped proof fails as collection-wide (bytes32(0))", async () => {
      const tokenId = 503;
      const assetScope = ethers.id("asset-c");
      const editors = [{ address: editor.address, role: CollaboratorRole.Editor }];
      const root = computeRoot(editors, tokenId, 1, assetScope);
      await asset.connect(user).publishAsset("ipfs://scope4", tokenId, root, "");

      const { proof } = getProof(editors, editor.address, tokenId, 1, assetScope);
      await expect(
        asset.connect(editor).updateAssetURI(tokenId, "ipfs://nope", ethers.ZeroHash, proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Migration (one-shot re-mint, #56/#50)
  // ════════════════════════════════════════════════════════════════════

  describe("Migration", function () {
    it("owner can migrate a token with historical state", async () => {
      const tokenId = 700;
      const root = ethers.id("root");
      await asset.migrateAsset(
        tokenId,
        user.address,
        "ipfs://migrated",
        root,
        3,
        "ipfs://list"
      );
      expect(await asset.ownerOf(tokenId)).to.equal(user.address);
      expect(await asset.tokenURI(tokenId)).to.equal("ipfs://migrated");
      expect(await asset.editorRoot(tokenId)).to.equal(root);
      expect(await asset.editorSetVersion(tokenId)).to.equal(3n);
      expect(await asset.editorListURI(tokenId)).to.equal("ipfs://list");
    });

    it("migrateAsset reverts for non-owner", async () => {
      await expect(
        asset.connect(user).migrateAsset(701, user.address, "ipfs://x", ethers.ZeroHash, 1, "")
      )
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });

    it("migrateAsset reverts on duplicate tokenId", async () => {
      const tokenId = 702;
      const editors = [{ address: user.address, role: CollaboratorRole.Editor }];
      const root = computeRoot(editors, tokenId, 1);
      await asset.connect(user).publishAsset("ipfs://exists", tokenId, root, "");
      await expect(
        asset.migrateAsset(tokenId, user.address, "ipfs://dup", ethers.ZeroHash, 1, "")
      ).to.be.revertedWithCustomError(asset, "TokenAlreadyMinted");
    });

    it("migrateAsset reverts after finalizeMigration", async () => {
      await asset.finalizeMigration();
      await expect(
        asset.migrateAsset(703, user.address, "ipfs://late", ethers.ZeroHash, 1, "")
      ).to.be.revertedWithCustomError(asset, "MigrationClosed");
    });

    it("finalizeMigration is owner-only and emits MigrationComplete", async () => {
      await expect(asset.connect(user).finalizeMigration())
        .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
      await expect(asset.finalizeMigration()).to.emit(asset, "MigrationComplete");
      expect(await asset.migrationFinalized()).to.equal(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Upgradeability (UUPS, #56)
  // ════════════════════════════════════════════════════════════════════

  describe("Upgradeability (UUPS)", function () {
    it("upgrades to a new implementation and preserves state", async function () {
      const tokenId = 800;
      const editors = [{ address: user.address, role: CollaboratorRole.Editor }];
      const root = computeRoot(editors, tokenId, 1);
      await asset.connect(user).publishAsset("ipfs://pre-upgrade", tokenId, root, "");

      // Redeploy the same contract as a stand-in V2 implementation and
      // repoint the proxy — on-chain state must survive the upgrade.
      const V2 = await ethers.getContractFactory("ArbeskAsset");
      await upgrades.upgradeProxy(await asset.getAddress(), V2);

      expect(await asset.ownerOf(tokenId)).to.equal(user.address);
      expect(await asset.tokenURI(tokenId)).to.equal("ipfs://pre-upgrade");
      expect(await asset.editorRoot(tokenId)).to.equal(root);
      expect(await asset.developerTreasuryWallet()).to.equal(treasury.address);
      expect(await asset.tierCosts(Tier.Basic)).to.equal(TIER_COSTS.Basic);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // publishAsset (Merkle)
  // ════════════════════════════════════════════════════════════════════

  describe("publishAsset", function () {
    it("mints to caller and stores tokenURI", async () => {
      const tokenId = 1;
      const uri = "ipfs://bafy-test";
      const editorList = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editorList, tokenId, 1);

      await asset.connect(user).publishAsset(uri, tokenId, root, "");

      expect(await asset.ownerOf(tokenId)).to.equal(user.address);
      expect(await asset.tokenURI(tokenId)).to.equal(uri);
    });

    it("stores the Merkle root and sets version to 1", async () => {
      const tokenId = 2;
      const editorList = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editorList, tokenId, 1);

      await asset.connect(user).publishAsset("ipfs://test", tokenId, root, "");

      expect(await asset.editorRoot(tokenId)).to.equal(root);
      expect(await asset.editorSetVersion(tokenId)).to.equal(1n);
    });

    it("emits AssetPublished and EditorSetChanged", async () => {
      const tokenId = 3;
      const uri = "ipfs://emit-test";
      const editorList = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editorList, tokenId, 1);

      await expect(asset.connect(user).publishAsset(uri, tokenId, root, ""))
        .to.emit(asset, "AssetPublished")
        .withArgs(user.address, tokenId, uri)
        .and.to.emit(asset, "EditorSetChanged")
        .withArgs(tokenId, root, 1n);
    });

    it("reverts on duplicate tokenId", async () => {
      const tokenId = 4;
      const root = computeRoot(
        [{ address: user.address, role: CollaboratorRole.Editor }],
        tokenId,
        1
      );
      await asset.connect(user).publishAsset("ipfs://a", tokenId, root, "");
      await expect(
        asset.connect(user).publishAsset("ipfs://b", tokenId, root, "")
      ).to.be.revertedWithCustomError(asset, "TokenAlreadyMinted");
    });

    it("reverts on zero Merkle root (a zero root would brick the token)", async () => {
      await expect(
        asset.connect(user).publishAsset("ipfs://zero-root", 6, ethers.ZeroHash, "")
      ).to.be.revertedWithCustomError(asset, "ZeroEditorRoot");
    });

    it("supports multiple initial editors", async () => {
      const tokenId = 5;
      const editors = [
        { address: user.address, role: CollaboratorRole.Editor },
        { address: editor.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editors, tokenId, 1);

      await asset.connect(user).publishAsset("ipfs://multi", tokenId, root, "");

      expect(await asset.editorRoot(tokenId)).to.equal(root);
      expect(await asset.ownerOf(tokenId)).to.equal(user.address);
    });

    it("balanceOf increments", async () => {
      expect(await asset.balanceOf(user.address)).to.equal(0n);
      const root = computeRoot(
        [{ address: user.address, role: CollaboratorRole.Editor }],
        10,
        1
      );
      await asset.connect(user).publishAsset("ipfs://x", 10, root, "");
      expect(await asset.balanceOf(user.address)).to.equal(1n);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Merkle Proofs (the critical new behavior)
  // ════════════════════════════════════════════════════════════════════

  describe("Merkle proof verification", function () {
    let tokenId, editors, root, version;

    beforeEach(async () => {
      tokenId = 100;
      editors = [
        { address: user.address, role: CollaboratorRole.Editor },
        { address: editor.address, role: CollaboratorRole.Viewer },
      ];
      root = computeRoot(editors, tokenId, 1);
      version = 1;
      await asset.connect(user).publishAsset("ipfs://proof", tokenId, root, "");
    });

    it("valid proof for Editor passes _requireEditor", async () => {
      const { proof } = getProof(editors, user.address, tokenId, version);
      // updateAssetURI exercises _requireEditor with Editor role
      await asset
        .connect(user)
        .updateAssetURI(tokenId, "ipfs://updated", ethers.ZeroHash, proof);
      expect(await asset.tokenURI(tokenId)).to.equal("ipfs://updated");
    });

    it("valid proof for Viewer reverts when Editor role required", async () => {
      const { proof } = getProof(editors, editor.address, tokenId, version);
      // updateAssetURI requires Editor role; editor has Viewer role
      await expect(
        asset.connect(editor).updateAssetURI(tokenId, "ipfs://nope", ethers.ZeroHash, proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("invalid proof (wrong address) reverts", async () => {
      const { proof } = getProof(editors, user.address, tokenId, version);
      await expect(
        asset.connect(editor2).updateAssetURI(tokenId, "ipfs://nope", ethers.ZeroHash, proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("empty proof reverts for non-empty tree", async () => {
      await expect(
        asset.connect(user).updateAssetURI(tokenId, "ipfs://x", ethers.ZeroHash, [])
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("proof with wrong version (stale) reverts", async () => {
      // First get a valid proof at version 1
      const { proof } = getProof(editors, user.address, tokenId, 1);

      // Update editor set to bump version to 2
      const newEditors = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const newRoot = computeRoot(newEditors, tokenId, 2);
      const callerProof = getProof(editors, user.address, tokenId, 1);

      await asset
        .connect(user)
        .updateEditors(tokenId, newRoot, "", CollaboratorRole.Editor, callerProof.proof);

      // Old proof should now fail (version 1 ≠ current version 2)
      await expect(
        asset.connect(user).updateAssetURI(tokenId, "ipfs://nope", ethers.ZeroHash, proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("proof from different tokenId reverts", async () => {
      // Publish another token
      const tokenId2 = 200;
      const editors2 = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root2 = computeRoot(editors2, tokenId2, 1);
      await asset.connect(user).publishAsset("ipfs://t2", tokenId2, root2, "");

      // Get proof for tokenId2
      const { proof } = getProof(editors2, user.address, tokenId2, 1);

      // Try to use it on tokenId (100) - leaf has tokenId baked in
      await expect(
        asset.connect(user).updateAssetURI(tokenId, "ipfs://nope", ethers.ZeroHash, proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("single-editor tree proof works (1 leaf, 0 siblings)", async () => {
      const tid = 300;
      const single = [{ address: user.address, role: CollaboratorRole.Editor }];
      const r = computeRoot(single, tid, 1);
      await asset.connect(user).publishAsset("ipfs://solo", tid, r, "");

      const { proof } = getProof(single, user.address, tid, 1);
      expect(proof).to.have.lengthOf(0); // single leaf, no siblings

      await asset.connect(user).updateAssetURI(tid, "ipfs://updated", ethers.ZeroHash, proof);
      expect(await asset.tokenURI(tid)).to.equal("ipfs://updated");
    });

    it("large editor list (100 editors) proofs work", async function () {
      this.timeout(30000);

      const tid = 400;
      const largeList = [];
      // Generate 100 unique addresses
      const wallets = [];
      for (let i = 0; i < 100; i++) {
        const w = ethers.Wallet.createRandom();
        wallets.push(w);
        largeList.push({
          address: w.address,
          role: i < 50 ? CollaboratorRole.Editor : CollaboratorRole.Viewer,
        });
      }
      // User is also an editor (to publish and test)
      largeList.push({ address: user.address, role: CollaboratorRole.Editor });

      const r = computeRoot(largeList, tid, 1);
      await asset.connect(user).publishAsset("ipfs://big", tid, r, "");

      // Verify proof for user
      const { proof } = getProof(largeList, user.address, tid, 1);
      // 101 leaves → ~7 levels deep
      expect(proof.length).to.be.greaterThan(0);
      expect(proof.length).to.be.lessThan(10);

      await asset
        .connect(user)
        .updateAssetURI(tid, "ipfs://big-updated", ethers.ZeroHash, proof);
      expect(await asset.tokenURI(tid)).to.equal("ipfs://big-updated");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // updateEditors
  // ════════════════════════════════════════════════════════════════════

  describe("updateEditors", function () {
    let tokenId, editors;

    beforeEach(async () => {
      tokenId = 500;
      editors = [
        { address: user.address, role: CollaboratorRole.Editor },
        { address: editor.address, role: CollaboratorRole.Viewer },
      ];
      await publishWithEditors(user, tokenId, editors);
    });

    it("Editor can change the editor set", async () => {
      const newEditors = [
        { address: user.address, role: CollaboratorRole.Editor },
        { address: editor2.address, role: CollaboratorRole.Editor },
      ];
      const newRoot = computeRoot(newEditors, tokenId, 2);
      const { proof } = getProof(editors, user.address, tokenId, 1);

      const tx = await asset
        .connect(user)
        .updateEditors(tokenId, newRoot, "", CollaboratorRole.Editor, proof);
      await tx.wait();

      expect(await asset.editorRoot(tokenId)).to.equal(newRoot);
      expect(await asset.editorSetVersion(tokenId)).to.equal(2n);
    });

    it("emits EditorSetChanged with new version", async () => {
      const newEditors = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const newRoot = computeRoot(newEditors, tokenId, 2);
      const { proof } = getProof(editors, user.address, tokenId, 1);

      await expect(
        asset
          .connect(user)
          .updateEditors(tokenId, newRoot, "", CollaboratorRole.Editor, proof)
      )
        .to.emit(asset, "EditorSetChanged")
        .withArgs(tokenId, newRoot, 2n);
    });

    it("Viewer cannot change the editor set", async () => {
      const newEditors = [
        { address: editor.address, role: CollaboratorRole.Editor },
      ];
      const newRoot = computeRoot(newEditors, tokenId, 2);
      const { proof } = getProof(editors, editor.address, tokenId, 1);

      await expect(
        asset
          .connect(editor)
          .updateEditors(tokenId, newRoot, "", CollaboratorRole.Viewer, proof)
      ).to.be.revertedWithCustomError(asset, "InvalidCollaboratorRole");
    });

    it("non-member cannot change the editor set", async () => {
      const newRoot = computeRoot(
        [{ address: editor2.address, role: CollaboratorRole.Editor }],
        tokenId,
        2
      );
      // editor2 is not in the tree - their "proof" is garbage
      await expect(
        asset
          .connect(editor2)
          .updateEditors(tokenId, newRoot, "", CollaboratorRole.Editor, [])
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("reverts on zero new root (a zero root would brick the token)", async () => {
      const { proof } = getProof(editors, user.address, tokenId, 1);
      await expect(
        asset
          .connect(user)
          .updateEditors(tokenId, ethers.ZeroHash, "", CollaboratorRole.Editor, proof)
      ).to.be.revertedWithCustomError(asset, "ZeroEditorRoot");
    });

    it("stale proof (old version) reverts after a set change", async () => {
      // First change: add editor2
      const newEditors1 = [
        { address: user.address, role: CollaboratorRole.Editor },
        { address: editor2.address, role: CollaboratorRole.Editor },
      ];
      const newRoot1 = computeRoot(newEditors1, tokenId, 2);
      const { proof: proof1 } = getProof(editors, user.address, tokenId, 1);

      await asset
        .connect(user)
        .updateEditors(tokenId, newRoot1, "", CollaboratorRole.Editor, proof1);

      // Try to use the SAME proof again (version 1 is stale, current is 2)
      await expect(
        asset
          .connect(user)
          .updateEditors(
            tokenId,
            ethers.ZeroHash,
            "",
            CollaboratorRole.Editor,
            proof1
          )
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // burn
  // ════════════════════════════════════════════════════════════════════

  describe("burn", function () {
    it("Editor with valid proof can burn", async () => {
      const tokenId = 600;
      await publishAsEditor(user, tokenId);

      const editors = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const { proof } = getProof(editors, user.address, tokenId, 1);

      await asset.connect(user).burn(tokenId, proof);

      // Token no longer exists
      await expect(asset.ownerOf(tokenId)).to.be.reverted;
      // Merkle state cleaned up
      expect(await asset.editorRoot(tokenId)).to.equal(ethers.ZeroHash);
      expect(await asset.editorSetVersion(tokenId)).to.equal(0n);
    });

    it("emits AssetBurned", async () => {
      const tokenId = 601;
      await publishAsEditor(user, tokenId);
      const { proof } = getProof(
        [{ address: user.address, role: CollaboratorRole.Editor }],
        user.address,
        tokenId,
        1
      );

      await expect(asset.connect(user).burn(tokenId, proof))
        .to.emit(asset, "AssetBurned")
        .withArgs(tokenId, user.address);
    });

    it("non-editor cannot burn", async () => {
      const tokenId = 602;
      await publishAsEditor(user, tokenId);

      await expect(
        asset.connect(editor).burn(tokenId, [])
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("reverts on nonexistent token", async () => {
      await expect(
        asset.connect(user).burn(9999, [])
      ).to.be.revertedWithCustomError(asset, "NonexistentToken");
    });

    it("burning decrements owner balance", async () => {
      const tokenId = 603;
      await publishAsEditor(user, tokenId);
      expect(await asset.balanceOf(user.address)).to.equal(1n);

      const { proof } = getProof(
        [{ address: user.address, role: CollaboratorRole.Editor }],
        user.address,
        tokenId,
        1
      );
      await asset.connect(user).burn(tokenId, proof);
      expect(await asset.balanceOf(user.address)).to.equal(0n);
    });

    it("cannot burn twice", async () => {
      const tokenId = 604;
      await publishAsEditor(user, tokenId);
      const { proof } = getProof(
        [{ address: user.address, role: CollaboratorRole.Editor }],
        user.address,
        tokenId,
        1
      );
      await asset.connect(user).burn(tokenId, proof);
      await expect(asset.connect(user).burn(tokenId, proof)).to.be.reverted;
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Free Tier (ArbeskAssetFree) - Merkle version
  // ════════════════════════════════════════════════════════════════════

  describe("ArbeskAssetFree", function () {
    let freeAsset;

    beforeEach(async () => {
      const FreeFactory = await ethers.getContractFactory("ArbeskAssetFree");
      freeAsset = await upgrades.deployProxy(FreeFactory, [], {
        initializer: "initialize",
      });
    });

    it("has MAX_EDITORS_PER_TOKEN = 5000", async () => {
      expect(await freeAsset.MAX_EDITORS_PER_TOKEN()).to.equal(5000n);
    });

    it("publishes with Merkle root", async () => {
      const tokenId = 1;
      const editors = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editors, tokenId, 1);
      await freeAsset.connect(user).publishAsset("ipfs://free", tokenId, root, "");

      expect(await freeAsset.ownerOf(tokenId)).to.equal(user.address);
      expect(await freeAsset.editorRoot(tokenId)).to.equal(root);
      expect(await freeAsset.editorSetVersion(tokenId)).to.equal(1n);
    });

    it("recordGeneration works (unchanged)", async () => {
      await expect(
        freeAsset.connect(user).recordGeneration(ethers.id("n1"), "a cube")
      )
        .to.emit(freeAsset, "AssetGenerationRecorded")
        .withArgs(user.address, ethers.id("n1"), "a cube", (v) => v > 0n, 1n);
    });

    it("enforces daily generation limit", async () => {
      for (let i = 0; i < 10; i++) {
        await freeAsset
          .connect(user)
          .recordGeneration(ethers.id(`n${i}`), `prompt ${i}`);
      }
      await expect(
        freeAsset.connect(user).recordGeneration(ethers.id("n11"), "overflow")
      ).to.be.revertedWithCustomError(freeAsset, "DailyGenerationLimitReached");
    });

    it("owner bypasses daily generation limit", async () => {
      for (let i = 0; i < 14; i++) {
        await freeAsset
          .connect(owner)
          .recordGeneration(ethers.id(`o${i}`), `prompt ${i}`);
      }
      // 15th call must not revert - owner is exempt. The event's countToday
      // argument proves the counter kept incrementing past the limit.
      await expect(
        freeAsset.connect(owner).recordGeneration(ethers.id("o14"), "prompt 14")
      )
        .to.emit(freeAsset, "AssetGenerationRecorded")
        .withArgs(
          owner.address,
          ethers.id("o14"),
          "prompt 14",
          (v) => v > 0n,
          15n
        );
    });

    it("resets daily quota across a day boundary", async function () {
      const { time } = require("@nomicfoundation/hardhat-network-helpers");

      await expect(
        freeAsset.connect(user).recordGeneration(ethers.id("d1"), "prompt 1")
      )
        .to.emit(freeAsset, "AssetGenerationRecorded")
        .withArgs(user.address, ethers.id("d1"), "prompt 1", (v) => v > 0n, 1n);

      await time.increase(86401); // cross a full day boundary

      // countToday resets to 1 for the new day, not 2.
      await expect(
        freeAsset.connect(user).recordGeneration(ethers.id("d2"), "prompt 2")
      )
        .to.emit(freeAsset, "AssetGenerationRecorded")
        .withArgs(user.address, ethers.id("d2"), "prompt 2", (v) => v > 0n, 1n);
    });

    it("updateAssetURI with Merkle proof", async () => {
      const tokenId = 2;
      const editors = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editors, tokenId, 1);
      await freeAsset.connect(user).publishAsset("ipfs://f2", tokenId, root, "");

      const { proof } = getProof(editors, user.address, tokenId, 1);
      await freeAsset
        .connect(user)
        .updateAssetURI(tokenId, "ipfs://updated", ethers.ZeroHash, proof);
      expect(await freeAsset.tokenURI(tokenId)).to.equal("ipfs://updated");
    });

    it("burn with Merkle proof", async () => {
      const tokenId = 3;
      const editors = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editors, tokenId, 1);
      await freeAsset.connect(user).publishAsset("ipfs://f3", tokenId, root, "");

      const { proof } = getProof(editors, user.address, tokenId, 1);
      await freeAsset.connect(user).burn(tokenId, proof);

      await expect(freeAsset.ownerOf(tokenId)).to.be.reverted;
      expect(await freeAsset.editorRoot(tokenId)).to.equal(ethers.ZeroHash);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // transfer - no auto-editor on transfer
  // ════════════════════════════════════════════════════════════════════

  describe("transfer (no auto-editor)", function () {
    it("transfers ownership without modifying editor set", async () => {
      const tokenId = 800;
      const editors = [
        { address: user.address, role: CollaboratorRole.Editor },
      ];
      const root = computeRoot(editors, tokenId, 1);
      await asset.connect(user).publishAsset("ipfs://t", tokenId, root, "");

      const rootBefore = await asset.editorRoot(tokenId);
      const versionBefore = await asset.editorSetVersion(tokenId);

      await asset
        .connect(user)
        .transferFrom(user.address, editor.address, tokenId);

      expect(await asset.ownerOf(tokenId)).to.equal(editor.address);
      // Editor set unchanged - no auto-add/remove on transfer
      expect(await asset.editorRoot(tokenId)).to.equal(rootBefore);
      expect(await asset.editorSetVersion(tokenId)).to.equal(versionBefore);
    });

    it("new owner cannot act without being added to editor set", async () => {
      const tokenId = 801;
      await publishAsEditor(user, tokenId);

      // Transfer to editor (who is NOT in the editor list)
      await asset
        .connect(user)
        .transferFrom(user.address, editor.address, tokenId);

      // editor tries to update URI - they need a valid proof, but they're
      // not in the tree
      await expect(
        asset.connect(editor).updateAssetURI(tokenId, "ipfs://nope", ethers.ZeroHash, [])
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });
  });
});
