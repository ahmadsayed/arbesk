const { expect } = require("chai");
const { ethers } = require("hardhat");

// ════════════════════════════════════════════════════════════════════════════
// Merkle Helpers — must match ArbeskAssetBase._requireEditor leaf structure
// ════════════════════════════════════════════════════════════════════════════

function makeLeaf(address, role, tokenId, setVersion) {
  return ethers.solidityPackedKeccak256(
    ["address", "uint8", "uint256", "uint256"],
    [address, role, tokenId, setVersion]
  );
}

function hashPair(a, b) {
  const [lo, hi] = BigInt(a) <= BigInt(b) ? [a, b] : [b, a];
  return ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [lo, hi]);
}

function sortLeaves(leaves) {
  return [...leaves].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
  );
}

function buildRoot(leaves) {
  if (leaves.length === 0) return ethers.ZeroHash;
  let layer = sortLeaves(leaves);
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]);
      }
    }
    layer = next;
  }
  return layer[0];
}

function computeRoot(editorList, tokenId, setVersion) {
  if (!editorList || editorList.length === 0) return ethers.ZeroHash;
  const leaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );
  return buildRoot(leaves);
}

function getProof(editorList, targetAddress, tokenId, setVersion) {
  const entry = editorList.find(
    (e) => e.address.toLowerCase() === targetAddress.toLowerCase()
  );
  if (!entry) return null;

  const leaf = makeLeaf(targetAddress, entry.role, tokenId, setVersion);
  const allLeaves = editorList.map((e) =>
    makeLeaf(e.address, e.role, tokenId, setVersion)
  );

  let layer = sortLeaves(allLeaves);
  const proof = [];
  let targetLeaf = leaf;

  while (layer.length > 1) {
    const idx = layer.findIndex((l) => l === targetLeaf);
    if (idx === -1) break;

    const pairIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (pairIdx >= 0 && pairIdx < layer.length) {
      proof.push(layer[pairIdx]);
    }

    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      if (i + 1 < layer.length) {
        next.push(hashPair(layer[i], layer[i + 1]));
      } else {
        next.push(layer[i]);
      }
    }
    targetLeaf = next[Math.floor(idx / 2)];
    layer = next;
  }

  return { proof, role: entry.role };
}

// ════════════════════════════════════════════════════════════════════════════
// Test Suite
// ════════════════════════════════════════════════════════════════════════════

describe("ArbeskAsset (Merkle)", function () {
  let asset, usdc, owner, treasury, user, editor, editor2;
  const COST = ethers.parseEther("0.01");
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
    asset = await Factory.deploy(treasury.address, await usdc.getAddress());
    await asset.waitForDeployment();
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
  // Payment — Native Token (unchanged logic)
  // ════════════════════════════════════════════════════════════════════

  describe("payForGeneration (native token)", function () {
    const nodeId = ethers.id("node-1");
    const prompt = "a red cube";

    it("accepts exact payment and emits AssetGenerationPaid", async () => {
      await expect(
        asset.connect(user).payForGeneration(nodeId, prompt, { value: COST })
      )
        .to.emit(asset, "AssetGenerationPaid")
        .withArgs(user.address, nodeId, prompt, COST, (v) => v > 0n);
    });

    it("increments payment nonce", async () => {
      const nonceBefore = await asset.getPaymentNonce(user.address);
      await asset
        .connect(user)
        .payForGeneration(nodeId, prompt, { value: COST });
      expect(await asset.getPaymentNonce(user.address)).to.equal(
        nonceBefore + 1n
      );
    });

    it("forwards 100% to treasury", async () => {
      const before = await ethers.provider.getBalance(treasury.address);
      await asset
        .connect(user)
        .payForGeneration(nodeId, prompt, { value: COST });
      const after = await ethers.provider.getBalance(treasury.address);
      expect(after - before).to.equal(COST);
    });

    it("reverts if payment amount is incorrect", async () => {
      await expect(
        asset
          .connect(user)
          .payForGeneration(nodeId, prompt, {
            value: ethers.parseEther("0.02"),
          })
      ).to.be.revertedWithCustomError(asset, "IncorrectPaymentAmount");
    });

    it("reverts if prompt is empty", async () => {
      await expect(
        asset.connect(user).payForGeneration(nodeId, "", { value: COST })
      ).to.be.revertedWithCustomError(asset, "InvalidPromptLength");
    });

    it("reverts if prompt exceeds 500 bytes", async () => {
      const longPrompt = "x".repeat(501);
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
          .payForGeneration(ethers.ZeroHash, prompt, { value: COST })
      ).to.be.revertedWithCustomError(asset, "InvalidNodeId");
    });

    it("reverts when paused", async () => {
      await asset.connect(owner).pause();
      await expect(
        asset.connect(user).payForGeneration(nodeId, prompt, { value: COST })
      ).to.be.reverted;
      await asset.connect(owner).unpause();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Payment — USDC (unchanged logic)
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

    it("increments payment nonce", async () => {
      const nonceBefore = await asset.getPaymentNonce(user.address);
      await asset
        .connect(user)
        .payForGenerationWithUSDC(nodeId, prompt, Tier.Basic);
      expect(await asset.getPaymentNonce(user.address)).to.equal(
        nonceBefore + 1n
      );
    });

    it("reverts if USDC token is not set (address(0))", async () => {
      const Factory = await ethers.getContractFactory("ArbeskAsset");
      const noUsdc = await Factory.deploy(treasury.address, ethers.ZeroAddress);
      await noUsdc.waitForDeployment();

      await usdc
        .connect(user)
        .approve(await noUsdc.getAddress(), ethers.parseUnits("100", 6));
      await expect(
        noUsdc
          .connect(user)
          .payForGenerationWithUSDC(nodeId, prompt, Tier.Basic)
      ).to.be.revertedWithCustomError(noUsdc, "UsdcPaymentsDisabled");
    });

    it("shared nonce: USDC and native payments both increment same counter", async () => {
      const nonce0 = await asset.getPaymentNonce(user.address);
      await asset
        .connect(user)
        .payForGenerationWithUSDC(nodeId, prompt, Tier.Basic);
      const nonce1 = await asset.getPaymentNonce(user.address);
      expect(nonce1).to.equal(nonce0 + 1n);

      await asset
        .connect(user)
        .payForGeneration(ethers.id("node-2"), "test", { value: COST });
      expect(await asset.getPaymentNonce(user.address)).to.equal(nonce1 + 1n);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Admin
  // ════════════════════════════════════════════════════════════════════

  describe("Access Control", function () {
    it("only owner can setCost", async () => {
      await expect(asset.connect(user).setCost(ethers.parseEther("0.02"))).to.be
        .reverted;
    });

    it("only owner can pause/unpause", async () => {
      await expect(asset.connect(user).pause()).to.be.reverted;
      await asset.connect(owner).pause();
      expect(await asset.paused()).to.be.true;
      await asset.connect(owner).unpause();
      expect(await asset.paused()).to.be.false;
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

    it("totalSupply increments", async () => {
      expect(await asset.totalSupply()).to.equal(0n);
      const root = computeRoot(
        [{ address: user.address, role: CollaboratorRole.Editor }],
        10,
        1
      );
      await asset.connect(user).publishAsset("ipfs://x", 10, root, "");
      expect(await asset.totalSupply()).to.equal(1n);
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
        .updateAssetURI(tokenId, "ipfs://updated", proof);
      expect(await asset.tokenURI(tokenId)).to.equal("ipfs://updated");
    });

    it("valid proof for Viewer reverts when Editor role required", async () => {
      const { proof } = getProof(editors, editor.address, tokenId, version);
      // updateAssetURI requires Editor role; editor has Viewer role
      await expect(
        asset.connect(editor).updateAssetURI(tokenId, "ipfs://nope", proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("invalid proof (wrong address) reverts", async () => {
      const { proof } = getProof(editors, user.address, tokenId, version);
      await expect(
        asset.connect(editor2).updateAssetURI(tokenId, "ipfs://nope", proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("empty proof reverts for non-empty tree", async () => {
      await expect(
        asset.connect(user).updateAssetURI(tokenId, "ipfs://x", [])
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
        asset.connect(user).updateAssetURI(tokenId, "ipfs://nope", proof)
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

      // Try to use it on tokenId (100) — leaf has tokenId baked in
      await expect(
        asset.connect(user).updateAssetURI(tokenId, "ipfs://nope", proof)
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });

    it("single-editor tree proof works (1 leaf, 0 siblings)", async () => {
      const tid = 300;
      const single = [{ address: user.address, role: CollaboratorRole.Editor }];
      const r = computeRoot(single, tid, 1);
      await asset.connect(user).publishAsset("ipfs://solo", tid, r, "");

      const { proof } = getProof(single, user.address, tid, 1);
      expect(proof).to.have.lengthOf(0); // single leaf, no siblings

      await asset.connect(user).updateAssetURI(tid, "ipfs://updated", proof);
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
        .updateAssetURI(tid, "ipfs://big-updated", proof);
      expect(await asset.tokenURI(tid)).to.equal("ipfs://big-updated");
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // updateEditors
  // ════════════════════════════════════════════════════════════════════

  describe("updateEditors", function () {
    let tokenId, editors, root;

    beforeEach(async () => {
      tokenId = 500;
      editors = [
        { address: user.address, role: CollaboratorRole.Editor },
        { address: editor.address, role: CollaboratorRole.Viewer },
      ];
      root = await publishWithEditors(user, tokenId, editors);
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
      // editor2 is not in the tree — their "proof" is garbage
      await expect(
        asset
          .connect(editor2)
          .updateEditors(tokenId, newRoot, "", CollaboratorRole.Editor, [])
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
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

    it("burning decrements total supply", async () => {
      const tokenId = 603;
      await publishAsEditor(user, tokenId);
      expect(await asset.totalSupply()).to.equal(1n);

      const { proof } = getProof(
        [{ address: user.address, role: CollaboratorRole.Editor }],
        user.address,
        tokenId,
        1
      );
      await asset.connect(user).burn(tokenId, proof);
      expect(await asset.totalSupply()).to.equal(0n);
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
  // getAssetManifest (new return shape)
  // ════════════════════════════════════════════════════════════════════

  describe("getAssetManifest", function () {
    it("returns manifestURI and owner (2 values, no editorList)", async () => {
      const tokenId = 700;
      const uri = "ipfs://manifest-test";
      await publishAsEditor(user, tokenId, uri);

      const result = await asset.getAssetManifest(tokenId);
      expect(result.manifestURI).to.equal(uri);
      expect(result.owner_).to.equal(user.address);
      // No third return value
      expect(result.editorList).to.be.undefined;
    });

    it("reverts on nonexistent token", async () => {
      await expect(asset.getAssetManifest(9999)).to.be.revertedWithCustomError(
        asset,
        "NonexistentToken"
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Free Tier (ArbeskAssetFree) — Merkle version
  // ════════════════════════════════════════════════════════════════════

  describe("ArbeskAssetFree", function () {
    let freeAsset;

    beforeEach(async () => {
      const FreeFactory = await ethers.getContractFactory("ArbeskAssetFree");
      freeAsset = await FreeFactory.deploy();
      await freeAsset.waitForDeployment();
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
      for (let i = 0; i < 15; i++) {
        await freeAsset
          .connect(owner)
          .recordGeneration(ethers.id(`o${i}`), `prompt ${i}`);
      }
      // No revert — owner is exempt
      expect(await freeAsset.generationCountToday(owner.address)).to.equal(15n);
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
        .updateAssetURI(tokenId, "ipfs://updated", proof);
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
  // transfer — no auto-editor on transfer
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
      // Editor set unchanged — no auto-add/remove on transfer
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

      // editor tries to update URI — they need a valid proof, but they're
      // not in the tree
      await expect(
        asset.connect(editor).updateAssetURI(tokenId, "ipfs://nope", [])
      ).to.be.revertedWithCustomError(asset, "NotAuthorizedEditor");
    });
  });
});
