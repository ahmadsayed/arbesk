// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title ArbeskAssetBase
 * @dev UUPS-upgradeable abstract base contract with Merkle-root editor
 *      architecture. The full editor list lives on IPFS; only `_tokenURIs`,
 *      `editorRoot`, `editorSetVersion`, and `editorListURI` stay on-chain
 *      (4 storage slots per token regardless of editor count — down from ~14
 *      in the old design).
 *
 *      Uses plain ERC721 (not ERC721Enumerable) to avoid the all/owned
 *      token arrays, which add ~3 extra storage slots per mint.
 *
 *      Concrete contracts: ArbeskAsset (paid), ArbeskAssetFree (free).
 *
 *      Editor leaves are asset-scoped: `assetScope = bytes32(0)` means a
 *      collection-wide grant; `assetScope = keccak256(assetId)` grants rights
 *      on a single asset within the collection.
 *
 *      `migrateAsset` / `finalizeMigration` provide a one-shot, owner-only
 *      window for the v1→v2 data migration (see blockchain/scripts/migrate-v2.js).
 */
abstract contract ArbeskAssetBase is
    Initializable,
    ERC721Upgradeable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    // ── Custom Errors ──
    error TokenAlreadyMinted(uint256 tokenId);
    error NonexistentToken(uint256 tokenId);
    error NotAuthorizedEditor(uint256 tokenId, address caller);
    error InvalidCollaboratorRole();
    error ZeroAddress();
    error InvalidPromptLength();
    error InvalidNodeId();
    error ZeroEditorRoot();
    error MigrationClosed();

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
    /// @dev One-shot migration window — `finalizeMigration()` closes it forever.
    bool public migrationFinalized;

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
    event MigrationComplete();

    // ── Initializer ──
    /// @dev Shared initializer. Concrete contracts call this from their own
    ///      `initialize()` (guarded by the `initializer` modifier).
    function __ArbeskAssetBase_init(
        string memory name_,
        string memory symbol_
    ) internal onlyInitializing {
        __ERC721_init(name_, symbol_);
        __Ownable_init(msg.sender);
        __Ownable2Step_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
    }

    // ── NFT Minting ──

    /// @notice Publish a new asset NFT. Mint + set tokenURI + commit the
    ///         Merkle root for the initial editor list.
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

    /// @notice Update the asset URI. Caller must submit a Merkle proof that
    ///         they hold the Editor role at `assetScope` in the current tree.
    ///         `assetScope = bytes32(0)` is a collection-wide grant;
    ///         `assetScope = keccak256(assetId)` is an asset-scoped grant.
    function updateAssetURI(
        uint256 tokenId,
        string memory newAssetURI,
        bytes32 assetScope,
        bytes32[] calldata proof
    ) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, assetScope, proof);
        _setTokenURI(tokenId, newAssetURI);
        emit AssetURIUpdated(tokenId, newAssetURI);
    }

    // ── Editor Set Management ──

    /// @notice Replace the entire editor set with a new Merkle root.
    ///         Caller must prove they are an Editor in the CURRENT tree
    ///         (collection-scope only — editor-set admin is never asset-scoped).
    function updateEditors(
        uint256 tokenId,
        bytes32 newRoot,
        string memory newListUri,
        CollaboratorRole callerRole,
        bytes32[] calldata callerProof
    ) external {
        _requireEditor(tokenId, msg.sender, callerRole, bytes32(0), callerProof);
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

    /// @notice Burn a token. Caller must prove Editor role (collection-scope).
    function burn(uint256 tokenId, bytes32[] calldata proof) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        _requireEditor(tokenId, msg.sender, CollaboratorRole.Editor, bytes32(0), proof);

        _burn(tokenId);
        delete editorRoot[tokenId];
        delete editorSetVersion[tokenId];
        delete editorListURI[tokenId];
        emit AssetBurned(tokenId, msg.sender);
    }

    // ── Admin ──

    /// @notice Pause the contract (payment/generation entry points only).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Migration (one-shot) ──

    /// @notice Re-mint an existing token to its original owner with its
    ///         historical URI + editor state, under the new leaf schema.
    ///         The migration script recomputes `editorRoot_` from the old
    ///         editor list using the new asset-scoped leaf. Owner-only,
    ///         gated by the migration window.
    function migrateAsset(
        uint256 tokenId,
        address owner,
        string calldata uri,
        bytes32 editorRoot_,
        uint256 editorSetVersion_,
        string calldata editorListUri
    ) external onlyOwner {
        if (migrationFinalized) revert MigrationClosed();
        if (_exists(tokenId)) revert TokenAlreadyMinted(tokenId);

        _mint(owner, tokenId);
        _setTokenURI(tokenId, uri);
        editorRoot[tokenId] = editorRoot_;
        editorSetVersion[tokenId] = editorSetVersion_;
        editorListURI[tokenId] = editorListUri;
        emit EditorSetChanged(tokenId, editorRoot_, editorSetVersion_);
    }

    /// @notice Permanently close the migration window.
    function finalizeMigration() external onlyOwner {
        migrationFinalized = true;
        emit MigrationComplete();
    }

    // ── Upgrade authorization ──

    /// @dev The upgrade key is the single highest-value target in the system;
    ///      gated to the contract owner (the Safe multisig + timelock after
    ///      governance transfer — see #57 / #56).
    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Internal Helpers ──

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    /// @dev Verify a caller is in the current Merkle tree with the required
    ///      role at the given scope. The leaf includes tokenId + assetScope +
    ///      editorSetVersion so proofs cannot be replayed after a set change,
    ///      across scopes, or across different tokens.
    function _requireEditor(
        uint256 tokenId,
        address caller,
        CollaboratorRole requiredRole,
        bytes32 assetScope,
        bytes32[] calldata proof
    ) internal view {
        bytes32 leaf = keccak256(
            abi.encodePacked(caller, requiredRole, tokenId, assetScope, editorSetVersion[tokenId])
        );
        if (!MerkleProof.verify(proof, editorRoot[tokenId], leaf))
            revert NotAuthorizedEditor(tokenId, caller);
    }

    /// @dev One-time initialization of the editor root for a newly minted
    ///      token. Called internally by publishAsset only.
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

    /// @dev Shared input validation for generation entry points.
    function _validateGenerationInput(
        bytes32 nodeId,
        string calldata prompt
    ) internal pure {
        uint256 promptLen = bytes(prompt).length;
        if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
        if (nodeId == bytes32(0)) revert InvalidNodeId();
    }

    /// @dev Reserved storage for future versions (must stay at the end).
    uint256[50] private __gap;
}
