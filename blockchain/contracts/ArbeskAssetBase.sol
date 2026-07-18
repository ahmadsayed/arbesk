// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title ArbeskAssetBase
 * @dev Abstract base contract with Merkle-root editor architecture.
 *      The full editor list lives on IPFS; only `_tokenURIs`,
 *      `editorRoot`, `editorSetVersion`, and `editorListURI` stay on-chain
 *      (4 storage slots per token regardless of editor count —
 *      down from ~14 in the old design).
 *
 *      Uses plain ERC721 (not ERC721Enumerable) to avoid the all/owned
 *      token arrays, which add ~3 extra storage slots per mint.
 *
 *      Concrete contracts: ArbeskAsset (paid), ArbeskAssetFree (free).
 */
abstract contract ArbeskAssetBase is ERC721, Ownable, Pausable {
    // ── Custom Errors ──
    error TokenAlreadyMinted(uint256 tokenId);
    error NonexistentToken(uint256 tokenId);
    error NotAuthorizedEditor(uint256 tokenId, address caller);
    error InvalidCollaboratorRole();
    error ZeroAddress();
    error InvalidPromptLength();
    error InvalidNodeId();
    error ZeroEditorRoot();

    // ── Enums ──
    enum CollaboratorRole {
        None,   // 0
        Viewer, // 1
        Editor  // 2
    }

    // ── State ──
    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => bytes32) public editorRoot;
    mapping(uint256 => uint256) public editorSetVersion;
    /// @dev IPFS CID of the full editor list JSON. Stored on-chain so any
    ///      browser can discover the editor list without localStorage.
    mapping(uint256 => string) public editorListURI;

    // ── Events ──
    event AssetPublished(
        address indexed owner,
        uint256 indexed tokenId,
        string tokenURI
    );
    event EditorSetChanged(
        uint256 indexed tokenId,
        bytes32 newRoot,
        uint256 newVersion
    );
    event AssetBurned(uint256 indexed tokenId, address indexed burner);
    event AssetURIUpdated(uint256 indexed tokenId, string newAssetURI);

    // ── Constructor ──
    constructor(
        string memory name_,
        string memory symbol_
    ) Ownable(msg.sender) ERC721(name_, symbol_) {}

    // ── NFT Minting ──

    /// @notice Publish a new asset NFT. Mint + set tokenURI + commit the
    ///         Merkle root for the initial editor list.
    /// @param uri IPFS CID pointing to the asset manifest (tokenURI).
    /// @param tokenId Unique identifier chosen by the dapp.
    /// @param editorRoot_ Merkle root of the initial editor list (computed
    ///        off-chain from the full list stored on IPFS). Must be non-zero:
    ///        a zero root permanently bricks the token because every
    ///        editor-gated operation requires a proof against it.
    function publishAsset(
        string memory uri,
        uint256 tokenId,
        bytes32 editorRoot_,
        string memory editorListUri
    ) public returns (uint256) {
        if (_exists(tokenId)) revert TokenAlreadyMinted(tokenId);
        if (editorRoot_ == bytes32(0)) revert ZeroEditorRoot();

        _mint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        initEditors(tokenId, editorRoot_, editorListUri);

        emit AssetPublished(msg.sender, tokenId, uri);
        return tokenId;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    // ── URI Updates (requires Merkle proof) ──

    /// @notice Update the asset URI. Caller must submit a Merkle proof
    ///         that they hold the Editor role in the current tree.
    ///         Non-zero→non-zero SSTORE — immune to bucket multiplier.
    function updateAssetURI(
        uint256 tokenId,
        string memory newAssetURI,
        bytes32[] calldata proof
    ) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof);
        _setTokenURI(tokenId, newAssetURI);
        emit AssetURIUpdated(tokenId, newAssetURI);
    }

    // ── Editor Set Management ──

    /// @notice Replace the entire editor set with a new Merkle root.
    ///         Caller must prove they are an Editor in the CURRENT tree.
    ///         Bumping editorSetVersion invalidates all old proofs.
    /// @dev The new root must be non-zero: with a zero root no proof can ever
    ///      verify, permanently bricking the token (updateAssetURI,
    ///      updateEditors, and burn all require a proof against the root).
    function updateEditors(
        uint256 tokenId,
        bytes32 newRoot,
        string memory newListUri,
        CollaboratorRole callerRole,
        bytes32[] calldata callerProof
    ) external {
        _requireEditor(tokenId, msg.sender, callerRole, callerProof);
        if (callerRole != CollaboratorRole.Editor)
            revert InvalidCollaboratorRole();
        if (newRoot == bytes32(0)) revert ZeroEditorRoot();

        unchecked {
            editorSetVersion[tokenId]++;
        }
        editorRoot[tokenId] = newRoot;
        editorListURI[tokenId] = newListUri;
        emit EditorSetChanged(tokenId, newRoot, editorSetVersion[tokenId]);
    }

    // ── Burn ──

    /// @notice Burn a token. Caller must prove Editor role in the Merkle tree.
    ///         Cleans up root + version state after burn (storage refund).
    function burn(uint256 tokenId, bytes32[] calldata proof) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, proof);

        _burn(tokenId);
        delete editorRoot[tokenId];
        delete editorSetVersion[tokenId];
        delete editorListURI[tokenId];
        emit AssetBurned(tokenId, msg.sender);
    }

    // ── Admin ──

    /// @notice Pause the contract.
    /// @dev Payment-pause-only by design: Pausable gates generation/payment
    ///      entry points (`recordGeneration`, `payForGenerationWithUSDC`).
    ///      Publishing, URI updates, editor-set changes, and burn stay live
    ///      while paused so asset management is never frozen.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract. See `pause()` for the pause scope.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Internal Helpers ──

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @dev Verify a caller is in the current Merkle tree with the required
    ///      role. The leaf hash includes tokenId + editorSetVersion so proofs
    ///      cannot be replayed after a set change or across different tokens.
    function _requireEditor(
        uint256 tokenId,
        address caller,
        CollaboratorRole requiredRole,
        bytes32[] calldata proof
    ) internal view {
        bytes32 leaf = keccak256(
            abi.encodePacked(caller, requiredRole, tokenId, editorSetVersion[tokenId])
        );
        if (!MerkleProof.verify(proof, editorRoot[tokenId], leaf))
            revert NotAuthorizedEditor(tokenId, caller);
    }

    /// @dev One-time initialization of the editor root for a newly minted
    ///      token. Called internally by publishAsset only. No existing-root
    ///      guard is needed here: publishAsset/_mint already revert on
    ///      existing tokens, and burn deletes the root.
    function initEditors(uint256 tokenId, bytes32 root, string memory listUri) internal {
        editorRoot[tokenId] = root;
        editorSetVersion[tokenId] = 1;
        editorListURI[tokenId] = listUri;
        emit EditorSetChanged(tokenId, root, 1);
    }

    function _setTokenURI(uint256 tokenId, string memory uri) internal {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        _tokenURIs[tokenId] = uri;
    }

    /// @dev Shared input validation for generation entry points
    ///      (`recordGeneration`, `payForGenerationWithUSDC`).
    /// @param nodeId Off-chain scene node the generation is for. Reverts with
    ///        InvalidNodeId if zero.
    /// @param prompt Generation prompt. Reverts with InvalidPromptLength if
    ///        empty or longer than 500 bytes.
    function _validateGenerationInput(
        bytes32 nodeId,
        string calldata prompt
    ) internal pure {
        uint256 promptLen = bytes(prompt).length;
        if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
        if (nodeId == bytes32(0)) revert InvalidNodeId();
    }
}
