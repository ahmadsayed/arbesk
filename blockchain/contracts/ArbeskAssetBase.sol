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
    ///        off-chain from the full list stored on IPFS).
    function publishAsset(
        string memory uri,
        uint256 tokenId,
        bytes32 editorRoot_,
        string memory editorListUri
    ) public returns (uint256) {
        if (_exists(tokenId)) revert TokenAlreadyMinted(tokenId);

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

    /// @notice Returns the asset manifest URI and current owner.
    /// @dev The editor list is off-chain (IPFS); retrieve it via the
    ///      Merkle root. The old `editorList` return is removed.
    function getAssetManifest(
        uint256 tokenId
    )
        public
        view
        returns (
            string memory manifestURI,
            address owner_
        )
    {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        manifestURI = _tokenURIs[tokenId];
        owner_ = _ownerOf(tokenId);
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

    function pause() external onlyOwner {
        _pause();
    }

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
    ///      token. Called internally by publishAsset only.
    function initEditors(uint256 tokenId, bytes32 root, string memory listUri) internal {
        if (editorRoot[tokenId] != bytes32(0))
            revert TokenAlreadyMinted(tokenId);
        editorRoot[tokenId] = root;
        editorSetVersion[tokenId] = 1;
        editorListURI[tokenId] = listUri;
        emit EditorSetChanged(tokenId, root, 1);
    }

    function _setTokenURI(uint256 tokenId, string memory uri) internal {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        _tokenURIs[tokenId] = uri;
    }
}
