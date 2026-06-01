// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ArbeskWorld
 * @dev Unified PayGo + NFT + Collaboration contract for Arbesk 3D asset platform.
 *      Users pay native FIL to trigger AI mesh generation.
 *      Worlds/assets are minted as ERC721 NFTs with editor collaboration.
 *      Parametric edits (color/scale) do NOT use the payment function.
 */
contract ArbeskWorld is ERC721Enumerable, Ownable, ReentrancyGuard, Pausable {

    /// @notice Cost per generation in wei (native FIL).
    /// @dev Default: 0.01 FIL = 10^16 wei. Owner can update.
    uint256 public costPerGeneration = 0.01 ether;

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

    /// @notice Reverse lookup: which tokens an address participates in.
    mapping(address => uint256[]) public tokensIParticipate;

    /// @notice Emitted when a user pays for generation.
    event AssetGenerationPaid(
        address indexed userWallet,
        bytes32 indexed nodeId,
        string prompt,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Emitted when a new world NFT is minted.
    event WorldMinted(
        address indexed owner,
        uint256 indexed tokenId,
        string tokenURI
    );

    /// @notice Emitted when an editor is added.
    event EditorAdded(uint256 indexed tokenId, address indexed editor);

    /// @notice Emitted when an editor is removed.
    event EditorRemoved(uint256 indexed tokenId, address indexed editor);

    /// @notice Emitted when token URI is updated.
    event TokenURIUpdated(uint256 indexed tokenId, string newTokenURI);

    /// @notice Emitted when treasury wallet is updated.
    event TreasuryUpdated(address indexed previousWallet, address indexed newWallet);

    /// @notice Emitted when generation cost is updated.
    event CostUpdated(uint256 previousCost, uint256 newCost);

    /// @param _treasury Initial treasury wallet address.
    constructor(address _treasury) Ownable(msg.sender) ERC721("ArbeskWorld", "ARBW") {
        require(_treasury != address(0), "Treasury cannot be zero address");
        developerTreasuryWallet = _treasury;
    }

    // ─────────────────────────────────────────────────────────────────
    // Payment
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Pay for a 3D asset generation.
     * @param nodeId Unique identifier for the target scene node.
     * @param prompt Text prompt sent to the generation engine.
     * @dev Requires exact `costPerGeneration` FIL value. Forwards 100% to treasury.
     *      Emits `AssetGenerationPaid` for backend indexing.
     */
    function payForGeneration(bytes32 nodeId, string calldata prompt)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        require(msg.value == costPerGeneration, "Incorrect payment amount");
        require(bytes(prompt).length > 0 && bytes(prompt).length <= 500, "Invalid prompt length");
        require(nodeId != bytes32(0), "Invalid nodeId");

        bytes32 paymentKey = keccak256(abi.encodePacked(nodeId, msg.sender, block.number));
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

    /**
     * @notice Check if a payment key has been consumed.
     * @param nodeId The node identifier.
     * @param sender The payer address.
     * @param blockNum The block number of the payment.
     */
    function isPaymentUsed(bytes32 nodeId, address sender, uint256 blockNum)
        external
        view
        returns (bool)
    {
        bytes32 key = keccak256(abi.encodePacked(nodeId, sender, blockNum));
        return usedPayments[key];
    }

    // ─────────────────────────────────────────────────────────────────
    // NFT Minting
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Mint a new world NFT.
     * @param uri IPFS CID or URI pointing to the manifest.
     * @param tokenId Unique token identifier.
     * @return The minted tokenId.
     */
    function mintWorld(string memory uri, uint256 tokenId)
        public
        returns (uint256)
    {
        require(!_exists(tokenId), "ArbeskWorld: tokenId already minted");

        _tokenCounts++;
        _mint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        members[tokenId].push(msg.sender);

        emit WorldMinted(msg.sender, tokenId, uri);
        return tokenId;
    }

    /**
     * @notice Mint a new world NFT with initial editors.
     * @param uri IPFS CID or URI pointing to the manifest.
     * @param tokenId Unique token identifier.
     * @param editors Array of editor addresses to add.
     * @return The minted tokenId.
     */
    function mintWorld(string memory uri, uint256 tokenId, address[] memory editors)
        public
        returns (uint256)
    {
        mintWorld(uri, tokenId);
        for (uint256 i = 0; i < editors.length; i++) {
            _addEditor(tokenId, editors[i]);
        }
        return tokenId;
    }

    /**
     * @dev See {IERC721Metadata-tokenURI}.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
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
     * @dev Convenience function to "reach" a manifest by its token ID.
     */
    function getWorldManifest(uint256 tokenId)
        public
        view
        returns (string memory manifestURI, address owner, address[] memory editorList)
    {
        require(_exists(tokenId), "ArbeskWorld: nonexistent token");
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
     * @param newTokenURI The new URI (e.g. new manifest CID).
     */
    function updateTokenURI(uint256 tokenId, string memory newTokenURI) public {
        require(_exists(tokenId), "ArbeskWorld: nonexistent token");
        require(
            _isEditor(tokenId, msg.sender),
            "ArbeskWorld: Only owner or editor can update"
        );
        _setTokenURI(tokenId, newTokenURI);
        emit TokenURIUpdated(tokenId, newTokenURI);
    }

    /**
     * @notice Add an editor to a token. Owner only.
     * @param tokenId The token to modify.
     * @param editor Address to add as editor.
     */
    function addEditor(uint256 tokenId, address editor) public {
        require(_exists(tokenId), "ArbeskWorld: nonexistent token");
        require(
            _ownerOf(tokenId) == msg.sender,
            "ArbeskWorld: Only owner can add editor"
        );
        _addEditor(tokenId, editor);
    }

    /**
     * @notice Add multiple editors to a token. Owner only.
     * @param tokenId The token to modify.
     * @param editors Addresses to add as editors.
     */
    function addEditor(uint256 tokenId, address[] memory editors) public {
        require(_exists(tokenId), "ArbeskWorld: nonexistent token");
        require(
            _ownerOf(tokenId) == msg.sender,
            "ArbeskWorld: Only owner can add editors"
        );
        for (uint256 i = 0; i < editors.length; i++) {
            _addEditor(tokenId, editors[i]);
        }
    }

    /**
     * @notice Remove an editor from a token. Owner only.
     * @param tokenId The token to modify.
     * @param editor Address to remove.
     */
    function removeEditor(uint256 tokenId, address editor) public {
        require(_exists(tokenId), "ArbeskWorld: nonexistent token");
        require(
            _ownerOf(tokenId) == msg.sender,
            "ArbeskWorld: Only owner can remove editor"
        );
        _removeEditor(tokenId, editor);
    }

    /**
     * @notice List all editors for a token.
     * @param tokenId The token to query.
     * @return Array of editor addresses.
     */
    function listEditors(uint256 tokenId)
        public
        view
        returns (address[] memory)
    {
        require(_exists(tokenId), "ArbeskWorld: nonexistent token");
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

    function _isEditor(uint256 tokenId, address sender)
        internal
        view
        returns (bool)
    {
        for (uint256 i = 0; i < members[tokenId].length; i++) {
            if (members[tokenId][i] == sender) {
                return true;
            }
        }
        return false;
    }

    function _addEditor(uint256 tokenId, address editor) internal {
        members[tokenId].push(editor);
        tokensIParticipate[editor].push(tokenId);
        emit EditorAdded(tokenId, editor);
    }

    function _removeEditor(uint256 tokenId, address editor) internal {
        // Remove from members[tokenId]
        int256 memberIdx = -1;
        for (uint256 i = 0; i < members[tokenId].length; i++) {
            if (members[tokenId][i] == editor) {
                memberIdx = int256(i);
            }
        }
        if (memberIdx != -1) {
            address temp = members[tokenId][members[tokenId].length - 1];
            members[tokenId][members[tokenId].length - 1] = members[tokenId][uint256(memberIdx)];
            members[tokenId][uint256(memberIdx)] = temp;
            members[tokenId].pop();
        }

        // Remove from tokensIParticipate[editor]
        int256 participantIdx = -1;
        for (uint256 i = 0; i < tokensIParticipate[editor].length; i++) {
            if (tokensIParticipate[editor][i] == tokenId) {
                participantIdx = int256(i);
            }
        }
        if (participantIdx != -1) {
            uint256 temp = tokensIParticipate[editor][tokensIParticipate[editor].length - 1];
            tokensIParticipate[editor][tokensIParticipate[editor].length - 1] = tokensIParticipate[editor][uint256(participantIdx)];
            tokensIParticipate[editor][uint256(participantIdx)] = temp;
            tokensIParticipate[editor].pop();
        }

        emit EditorRemoved(tokenId, editor);
    }

    function _setTokenURI(uint256 tokenId, string memory uri) internal {
        require(_exists(tokenId), "ArbeskWorld: nonexistent token");
        _tokenURIs[tokenId] = uri;
    }

    // ─────────────────────────────────────────────────────────────────
    // Admin
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

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance to withdraw");
        (bool sent, ) = developerTreasuryWallet.call{value: balance}("");
        require(sent, "Withdraw failed");
    }

    receive() external payable {
        revert("Use payForGeneration()");
    }

    fallback() external payable {
        revert("Use payForGeneration()");
    }
}
