// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ArbeskAsset
 * @dev Unified PayGo + NFT + Collaboration contract for Arbesk 3D asset platform.
 *      Supports two payment paths:
 *        - Native token (ETH on Base, FIL on FEVM) via payForGeneration()
 *        - USDC (ERC-20) via payForGenerationWithUSDC() with tiered pricing
 *      Assets are minted as ERC721 NFTs with editor collaboration.
 *      Parametric edits (color/scale) do NOT use the payment function.
 *      Only generation costs money — pinning, downloads, and minting are gas-only.
 */
contract ArbeskAsset is ERC721Enumerable, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Generation quality tiers for USDC payments.
    /// @dev Only generation is priced; pinning, downloads, and minting are free.
    enum Tier {
        Basic, // 0
        Standard, // 1
        Premium, // 2
        Pro // 3
    }

    /// @notice Cost per generation in native wei (ETH on Base, FIL on FEVM).
    /// @dev Default: 0.01 ether. Flat rate — no tiering on native path. Owner can update.
    uint256 public costPerGeneration = 0.01 ether;

    /// @notice USDC cost per tier (6 decimals). Owner can update.
    /// @dev Defaults: Basic=$0.75, Standard=$1.25, Premium=$1.75, Pro=$2.50
    mapping(Tier => uint256) public tierCosts;

    /// @notice USDC token contract (ERC-20, 6 decimals).
    /// @dev Set to address(0) to disable USDC payments.
    ///      Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    ///      Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
    IERC20 public usdcToken;

    /// @notice Treasury wallet receiving all generation payments.
    address public developerTreasuryWallet;

    /// @notice Mapping to prevent txHash replay attacks.
    /// @dev Key: keccak256(nodeId + sender + block.number) → bool.
    mapping(bytes32 => bool) public usedPayments;

    /// @notice Total number of minted tokens (manual counter; OZ v5 removed Counters).
    uint256 private _tokenCounts;

    /// @notice Token URI storage.
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Editor members per tokenId.
    mapping(uint256 => address[]) public members;

    /// @notice O(1) editor membership test — kept in sync with members[].
    mapping(uint256 => mapping(address => bool)) private _isEditorMap;

    /// @notice Maximum number of editors per token.
    uint256 public constant MAX_EDITORS_PER_TOKEN = 50;

    /// @notice Maximum number of tokens an address can be editor on.
    uint256 public constant MAX_TOKENS_PER_EDITOR = 500;

    /// @notice Reverse lookup: which tokens an address participates in.
    mapping(address => uint256[]) public tokensIParticipate;

    /// @notice Emitted when a user pays for generation with native token.
    event AssetGenerationPaid(
        address indexed userWallet,
        bytes32 indexed nodeId,
        string prompt,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Emitted when a user pays for generation with USDC (tiered).
    /// @param tier The selected quality tier (0=Basic, 1=Standard, 2=Premium, 3=Pro).
    event AssetGenerationPaidUSDC(
        address indexed userWallet,
        bytes32 indexed nodeId,
        string prompt,
        uint256 amount,
        uint256 timestamp,
        Tier tier
    );

    /// @notice Emitted when a new asset NFT is minted.
    event AssetPublished(
        address indexed owner,
        uint256 indexed tokenId,
        string tokenURI
    );

    /// @notice Emitted when an editor is added.
    event EditorAdded(uint256 indexed tokenId, address indexed editor);

    /// @notice Emitted when an editor is removed.
    event EditorRemoved(uint256 indexed tokenId, address indexed editor);

    /// @notice Emitted when token URI is updated.
    event AssetURIUpdated(uint256 indexed tokenId, string newAssetURI);

    /// @notice Emitted when treasury wallet is updated.
    event TreasuryUpdated(
        address indexed previousWallet,
        address indexed newWallet
    );

    /// @notice Emitted when native-token generation cost is updated.
    event CostUpdated(uint256 previousCost, uint256 newCost);

    /// @notice Emitted when a tier's USDC cost is updated.
    event TierCostUpdated(
        Tier indexed tier,
        uint256 previousCost,
        uint256 newCost
    );

    /// @notice Emitted when USDC token address is updated.
    event UsdcTokenUpdated(
        address indexed previousToken,
        address indexed newToken
    );

    /// @param _treasury Initial treasury wallet address.
    /// @param _usdcToken Initial USDC token address (use address(0) to disable).
    constructor(
        address _treasury,
        address _usdcToken
    ) Ownable(msg.sender) ERC721("ArbeskAsset", "ARBA") {
        require(_treasury != address(0), "Treasury cannot be zero address");
        developerTreasuryWallet = _treasury;
        usdcToken = IERC20(_usdcToken);

        // Initialize tiered USDC pricing (6 decimals)
        // Basic:   $0.75  =   750000
        // Standard:$1.25  =  1250000
        // Premium: $1.75  =  1750000
        // Pro:     $2.50  =  2500000
        tierCosts[Tier.Basic] = 750000;
        tierCosts[Tier.Standard] = 1250000;
        tierCosts[Tier.Premium] = 1750000;
        tierCosts[Tier.Pro] = 2500000;
    }

    // ─────────────────────────────────────────────────────────────────
    // Payment — Native Token (ETH / FIL)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Pay for a 3D asset generation with native token (ETH on Base, FIL on FEVM).
     * @param nodeId Unique identifier for the target scene node.
     * @param prompt Text prompt sent to the generation engine.
     * @dev Flat-rate native payment. For tiered pricing, use payForGenerationWithUSDC().
     */
    function payForGeneration(
        bytes32 nodeId,
        string calldata prompt
    ) external payable nonReentrant whenNotPaused {
        require(msg.value == costPerGeneration, "Incorrect payment amount");
        require(
            bytes(prompt).length > 0 && bytes(prompt).length <= 500,
            "Invalid prompt length"
        );
        require(nodeId != bytes32(0), "Invalid nodeId");

        bytes32 paymentKey = keccak256(
            abi.encodePacked(nodeId, msg.sender, block.number)
        );
        require(!usedPayments[paymentKey], "Payment already used");
        usedPayments[paymentKey] = true;

        // Forward 100% to treasury
        (bool sent, ) = developerTreasuryWallet.call{value: msg.value}("");
        require(sent, "Treasury transfer failed");

        emit AssetGenerationPaid(
            msg.sender,
            nodeId,
            prompt,
            msg.value,
            block.timestamp
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // Payment — USDC (ERC-20, Tiered)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Pay for a 3D asset generation with USDC at the selected quality tier.
     * @param nodeId Unique identifier for the target scene node.
     * @param prompt Text prompt sent to the generation engine.
     * @param tier Quality tier (0=Basic, 1=Standard, 2=Premium, 3=Pro).
     * @dev Caller must first `approve()` this contract for the tier's USDC cost.
     *      Transfers USDC from caller to treasury via transferFrom.
     */
    function payForGenerationWithUSDC(
        bytes32 nodeId,
        string calldata prompt,
        Tier tier
    ) external nonReentrant whenNotPaused {
        require(address(usdcToken) != address(0), "USDC payments disabled");
        require(
            bytes(prompt).length > 0 && bytes(prompt).length <= 500,
            "Invalid prompt length"
        );
        require(nodeId != bytes32(0), "Invalid nodeId");

        uint256 cost = tierCosts[tier];
        require(cost > 0, "Tier cost not set");

        bytes32 paymentKey = keccak256(
            abi.encodePacked(nodeId, msg.sender, block.number)
        );
        require(!usedPayments[paymentKey], "Payment already used");
        usedPayments[paymentKey] = true;

        // Transfer USDC from caller to treasury
        usdcToken.safeTransferFrom(msg.sender, developerTreasuryWallet, cost);

        emit AssetGenerationPaidUSDC(
            msg.sender,
            nodeId,
            prompt,
            cost,
            block.timestamp,
            tier
        );
    }

    /// @notice Get the USDC cost for a given tier.
    function getTierCost(Tier tier) external view returns (uint256) {
        return tierCosts[tier];
    }

    // ─────────────────────────────────────────────────────────────────
    // Payment Queries
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Check if a payment key has been consumed.
     * @param nodeId The node identifier.
     * @param sender The payer address.
     * @param blockNum The block number of the payment.
     */
    function isPaymentUsed(
        bytes32 nodeId,
        address sender,
        uint256 blockNum
    ) external view returns (bool) {
        bytes32 key = keccak256(abi.encodePacked(nodeId, sender, blockNum));
        return usedPayments[key];
    }

    // ─────────────────────────────────────────────────────────────────
    // NFT Minting (no USDC cost — gas only)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Mint a new asset NFT.
     * @param uri IPFS CID or URI pointing to the manifest.
     * @param tokenId Unique token identifier.
     * @return The minted tokenId.
     */
    function publishAsset(
        string memory uri,
        uint256 tokenId
    ) public returns (uint256) {
        require(!_exists(tokenId), "ArbeskAsset: tokenId already minted");

        _tokenCounts++;
        _mint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        _addEditor(tokenId, msg.sender);

        emit AssetPublished(msg.sender, tokenId, uri);
        return tokenId;
    }

    /**
     * @notice Mint a new asset NFT with initial editors.
     * @param uri IPFS CID or URI pointing to the manifest.
     * @param tokenId Unique token identifier.
     * @param editors Array of editor addresses to add.
     * @return The minted tokenId.
     */
    function publishAsset(
        string memory uri,
        uint256 tokenId,
        address[] memory editors
    ) public returns (uint256) {
        publishAsset(uri, tokenId);
        for (uint256 i = 0; i < editors.length; i++) {
            _addEditor(tokenId, editors[i]);
        }
        return tokenId;
    }

    /**
     * @dev See {IERC721Metadata-tokenURI}.
     */
    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory _tokenURI = _tokenURIs[tokenId];
        string memory base = _baseURI();

        if (bytes(base).length == 0) {
            return _tokenURI;
        }
        if (bytes(_tokenURI).length > 0) {
            return string(abi.encodePacked(base, _tokenURI));
        }

        return super.tokenURI(tokenId);
    }

    /**
     * @dev Total number of tokens minted.
     */
    function totalSupply() public view override returns (uint256) {
        return _tokenCounts;
    }

    /**
     * @notice Get full manifest metadata for a token.
     * @param tokenId The token to query.
     * @return manifestURI The IPFS CID / URI pointing to the manifest.
     * @return owner The owner address of the token.
     * @return editorList The list of editor addresses for the token.
     */
    function getAssetManifest(
        uint256 tokenId
    )
        public
        view
        returns (
            string memory manifestURI,
            address owner,
            address[] memory editorList
        )
    {
        require(_exists(tokenId), "ArbeskAsset: nonexistent token");
        manifestURI = _tokenURIs[tokenId];
        owner = _ownerOf(tokenId);
        editorList = members[tokenId];
    }

    // ─────────────────────────────────────────────────────────────────
    // Collaboration
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Update the token URI. Owner or editor only.
     * @param tokenId The token to update.
     * @param newAssetURI The new URI (e.g. new asset manifest CID).
     */
    function updateAssetURI(uint256 tokenId, string memory newAssetURI) public {
        require(_exists(tokenId), "ArbeskAsset: nonexistent token");
        require(
            _isEditor(tokenId, msg.sender),
            "ArbeskAsset: Only owner or editor can update"
        );
        _setTokenURI(tokenId, newAssetURI);
        emit AssetURIUpdated(tokenId, newAssetURI);
    }

    /**
     * @notice Add an editor to a token. Owner only.
     * @param tokenId The token to modify.
     * @param editor Address to add as editor.
     */
    function addEditor(uint256 tokenId, address editor) public {
        require(_exists(tokenId), "ArbeskAsset: nonexistent token");
        require(
            _ownerOf(tokenId) == msg.sender,
            "ArbeskAsset: Only owner can add editor"
        );
        _addEditor(tokenId, editor);
    }

    /**
     * @notice Add multiple editors to a token. Owner only.
     * @param tokenId The token to modify.
     * @param editors Addresses to add as editors.
     */
    function addEditor(uint256 tokenId, address[] memory editors) public {
        require(_exists(tokenId), "ArbeskAsset: nonexistent token");
        require(
            _ownerOf(tokenId) == msg.sender,
            "ArbeskAsset: Only owner can add editors"
        );
        uint256 remaining = MAX_EDITORS_PER_TOKEN - members[tokenId].length;
        for (uint256 i = 0; i < editors.length && i < remaining; i++) {
            _addEditor(tokenId, editors[i]);
        }
    }

    /**
     * @notice Remove an editor from a token. Owner only.
     * @param tokenId The token to modify.
     * @param editor Address to remove.
     */
    function removeEditor(uint256 tokenId, address editor) public {
        require(_exists(tokenId), "ArbeskAsset: nonexistent token");
        require(
            _ownerOf(tokenId) == msg.sender,
            "ArbeskAsset: Only owner can remove editor"
        );
        _removeEditor(tokenId, editor);
    }

    /**
     * @notice List all editors for a token.
     * @param tokenId The token to query.
     * @return Array of editor addresses.
     */
    function listEditors(
        uint256 tokenId
    ) public view returns (address[] memory) {
        require(_exists(tokenId), "ArbeskAsset: nonexistent token");
        return members[tokenId];
    }

    /**
     * @notice List all tokens an editor participates in.
     * @param editor The address to query.
     * @return Array of tokenIds.
     */
    function listTokens(address editor) public view returns (uint256[] memory) {
        return tokensIParticipate[editor];
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────────────────

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @dev Override OZ v5 transfer hook — revoke editor rights on transfer.
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && from != to) {
            _removeEditor(tokenId, from);
            if (to != address(0)) {
                _addEditor(tokenId, to);
            }
        }
        return super._update(to, tokenId, auth);
    }

    function _isEditor(
        uint256 tokenId,
        address sender
    ) internal view returns (bool) {
        return _isEditorMap[tokenId][sender];
    }

    function _addEditor(uint256 tokenId, address editor) internal {
        if (_isEditorMap[tokenId][editor]) return;
        require(
            members[tokenId].length < MAX_EDITORS_PER_TOKEN,
            "ArbeskAsset: max editors reached"
        );
        require(
            tokensIParticipate[editor].length < MAX_TOKENS_PER_EDITOR,
            "ArbeskAsset: max tokens per editor reached"
        );
        _isEditorMap[tokenId][editor] = true;
        members[tokenId].push(editor);
        tokensIParticipate[editor].push(tokenId);
        emit EditorAdded(tokenId, editor);
    }

    function _removeEditor(uint256 tokenId, address editor) internal {
        if (!_isEditorMap[tokenId][editor]) return;

        int256 memberIdx = -1;
        for (uint256 i = 0; i < members[tokenId].length; i++) {
            if (members[tokenId][i] == editor) {
                memberIdx = int256(i);
                break;
            }
        }
        if (memberIdx != -1) {
            address temp = members[tokenId][members[tokenId].length - 1];
            members[tokenId][members[tokenId].length - 1] = members[tokenId][
                uint256(memberIdx)
            ];
            members[tokenId][uint256(memberIdx)] = temp;
            members[tokenId].pop();
            delete _isEditorMap[tokenId][editor];
        }

        int256 participantIdx = -1;
        for (uint256 i = 0; i < tokensIParticipate[editor].length; i++) {
            if (tokensIParticipate[editor][i] == tokenId) {
                participantIdx = int256(i);
                break;
            }
        }
        if (participantIdx != -1) {
            uint256 temp = tokensIParticipate[editor][
                tokensIParticipate[editor].length - 1
            ];
            tokensIParticipate[editor][
                tokensIParticipate[editor].length - 1
            ] = tokensIParticipate[editor][uint256(participantIdx)];
            tokensIParticipate[editor][uint256(participantIdx)] = temp;
            tokensIParticipate[editor].pop();
        }

        emit EditorRemoved(tokenId, editor);
    }

    function _setTokenURI(uint256 tokenId, string memory uri) internal {
        require(_exists(tokenId), "ArbeskAsset: nonexistent token");
        _tokenURIs[tokenId] = uri;
    }

    // ─────────────────────────────────────────────────────────────────
    // Admin — Native Token
    // ─────────────────────────────────────────────────────────────────

    function setCost(uint256 newCost) external onlyOwner {
        require(newCost > 0, "Cost must be > 0");
        uint256 oldCost = costPerGeneration;
        costPerGeneration = newCost;
        emit CostUpdated(oldCost, newCost);
    }

    function setTreasury(address newWallet) external onlyOwner {
        require(newWallet != address(0), "Treasury cannot be zero address");
        address oldWallet = developerTreasuryWallet;
        developerTreasuryWallet = newWallet;
        emit TreasuryUpdated(oldWallet, newWallet);
    }

    // ─────────────────────────────────────────────────────────────────
    // Admin — USDC Tiers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Set the USDC token contract address.
     * @param _usdcToken The USDC ERC-20 token address.
     *                   Use address(0) to disable USDC payments.
     *                   Base mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
     *                   Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
     */
    function setUsdcToken(address _usdcToken) external onlyOwner {
        address oldToken = address(usdcToken);
        usdcToken = IERC20(_usdcToken);
        emit UsdcTokenUpdated(oldToken, _usdcToken);
    }

    /**
     * @notice Update the USDC cost for a specific tier.
     * @param tier The quality tier to update.
     * @param newCost New cost in USDC base units (6 decimals).
     */
    function setTierCost(Tier tier, uint256 newCost) external onlyOwner {
        require(newCost > 0, "Tier cost must be > 0");
        uint256 oldCost = tierCosts[tier];
        tierCosts[tier] = newCost;
        emit TierCostUpdated(tier, oldCost, newCost);
    }

    // ─────────────────────────────────────────────────────────────────
    // Admin — Emergency
    // ─────────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Withdraw native token balance (ETH) to treasury.
     * @dev Only for stray ETH sent outside payForGeneration().
     */
    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance to withdraw");
        (bool sent, ) = developerTreasuryWallet.call{value: balance}("");
        require(sent, "Withdraw failed");
    }

    /**
     * @notice Recover USDC accidentally sent to this contract.
     * @dev Transfers all USDC held by this contract to the treasury.
     */
    function withdrawUSDC() external onlyOwner nonReentrant {
        require(address(usdcToken) != address(0), "USDC token not set");
        uint256 balance = usdcToken.balanceOf(address(this));
        require(balance > 0, "No USDC to withdraw");
        usdcToken.safeTransfer(developerTreasuryWallet, balance);
    }

    receive() external payable {
        revert("Use payForGeneration()");
    }

    fallback() external payable {
        revert("Use payForGeneration()");
    }
}
