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

    /// @notice Collaboration permission levels for editors on a token.
    /// @dev Viewer = read-only recognition, Editor = can update asset URI.
    ///      The token owner always has implicit full permissions.
    enum CollaboratorRole {
        None, // 0 — not a collaborator
        Viewer, // 1 — recognized collaborator, read-only
        Editor // 2 — can update asset URI
    }

    // ── Custom Errors (gas-efficient, no string storage) ──
    error IncorrectPaymentAmount();
    error InvalidPromptLength();
    error InvalidNodeId();
    error PaymentAlreadyUsed();
    error TreasuryTransferFailed();
    error UsdcPaymentsDisabled();
    error TierCostNotSet();
    error TokenAlreadyMinted(uint256 tokenId);
    error NonexistentToken(uint256 tokenId);
    error NotOwnerOrEditor(uint256 tokenId, address caller);
    error NotTokenOwner(uint256 tokenId, address caller);
    error MaxEditorsReached(uint256 tokenId);
    error MaxTokensPerEditorReached(address editor);
    error InvalidCost();
    error ZeroAddress();
    error NoBalanceToWithdraw();
    error WithdrawFailed();
    error UsdcTokenNotSet();
    error DirectTransferNotAllowed();
    error InvalidCollaboratorRole();
    error NotCollaborator(uint256 tokenId, address caller);
    error CannotBurn(uint256 tokenId, address caller);

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

    /// @notice Mapping to prevent same-block replay attacks.
    /// @dev Key: keccak256(nodeId + sender + block.number) → bool.
    ///      Internal — use isPaymentUsed() to query.
    mapping(bytes32 => bool) internal usedPayments;

    /// @notice Total number of minted tokens (manual counter; OZ v5 removed Counters).
    uint256 private _tokenCounts;

    /// @notice Token URI storage.
    mapping(uint256 => string) private _tokenURIs;

    /// @notice Collaborator members per tokenId (Viewers + Editors).
    /// @dev Internal — use listEditors() or listCollaboratorsByRole() to query.
    mapping(uint256 => address[]) internal members;

    /// @notice O(1) collaborator role lookup — kept in sync with members[].
    /// @dev Internal — use getCollaboratorRole() or _isEditor() / _isCollaborator().
    mapping(uint256 => mapping(address => CollaboratorRole))
        internal _editorRoles;

    /// @notice Per-collaborator burn permission (additive — only Editor-role
    ///         collaborators can be granted this; owner always has it).
    /// @dev Internal — use canBurn() to query.
    mapping(uint256 => mapping(address => bool)) internal _canBurn;

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

    /// @notice Emitted when a collaborator's role is changed.
    event CollaboratorRoleChanged(
        uint256 indexed tokenId,
        address indexed collaborator,
        CollaboratorRole role
    );

    /// @notice Emitted when a collaborator's burn permission is changed.
    event BurnPermissionChanged(
        uint256 indexed tokenId,
        address indexed collaborator,
        bool canBurn
    );

    /// @notice Emitted when a token is burned (destroyed).
    event AssetBurned(uint256 indexed tokenId, address indexed burner);

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
        if (_treasury == address(0)) revert ZeroAddress();
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
        if (msg.value != costPerGeneration) revert IncorrectPaymentAmount();
        uint256 promptLen = bytes(prompt).length;
        if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
        if (nodeId == bytes32(0)) revert InvalidNodeId();

        bytes32 paymentKey = keccak256(
            abi.encodePacked(nodeId, msg.sender, block.number)
        );
        if (usedPayments[paymentKey]) revert PaymentAlreadyUsed();
        usedPayments[paymentKey] = true;

        // Forward 100% to treasury
        (bool sent, ) = developerTreasuryWallet.call{value: msg.value}("");
        if (!sent) revert TreasuryTransferFailed();

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
        if (address(usdcToken) == address(0)) revert UsdcPaymentsDisabled();
        uint256 promptLen = bytes(prompt).length;
        if (promptLen == 0 || promptLen > 500) revert InvalidPromptLength();
        if (nodeId == bytes32(0)) revert InvalidNodeId();

        uint256 cost = tierCosts[tier];
        if (cost == 0) revert TierCostNotSet();

        bytes32 paymentKey = keccak256(
            abi.encodePacked(nodeId, msg.sender, block.number)
        );
        if (usedPayments[paymentKey]) revert PaymentAlreadyUsed();
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
        if (_exists(tokenId)) revert TokenAlreadyMinted(tokenId);

        unchecked {
            _tokenCounts++;
        }
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
        unchecked {
            for (uint256 i = 0; i < editors.length; i++) {
                _addEditor(tokenId, editors[i]);
            }
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
        return _tokenURIs[tokenId];
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
     * @return editorList The list of collaborator addresses (Viewers + Editors).
     *         Use getCollaboratorRole() to distinguish permissions.
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
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        manifestURI = _tokenURIs[tokenId];
        owner = _ownerOf(tokenId);
        editorList = members[tokenId];
    }

    // ─────────────────────────────────────────────────────────────────
    // Collaboration
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Update the token URI. Owner or Editor-role collaborator only.
     *          Viewers cannot update.
     * @param tokenId The token to update.
     * @param newAssetURI The new URI (e.g. new asset manifest CID).
     */
    function updateAssetURI(uint256 tokenId, string memory newAssetURI) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (!_isEditor(tokenId, msg.sender))
            revert NotOwnerOrEditor(tokenId, msg.sender);
        _setTokenURI(tokenId, newAssetURI);
        emit AssetURIUpdated(tokenId, newAssetURI);
    }

    /**
     * @notice Add an editor to a token with Editor role. Owner only.
     * @param tokenId The token to modify.
     * @param editor Address to add as editor.
     */
    function addEditor(uint256 tokenId, address editor) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);
        _addEditor(tokenId, editor);
    }

    /**
     * @notice Add an editor to a token with a specific collaborator role. Owner only.
     * @param tokenId The token to modify.
     * @param editor Address to add as editor.
     * @param role CollaboratorRole (Viewer or Editor). None is rejected.
     */
    function addEditor(
        uint256 tokenId,
        address editor,
        CollaboratorRole role
    ) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);
        _addCollaborator(tokenId, editor, role);
    }

    /**
     * @notice Add multiple editors to a token with Editor role. Owner only.
     * @param tokenId The token to modify.
     * @param editors Addresses to add as editors.
     */
    function addEditor(uint256 tokenId, address[] memory editors) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);
        uint256 remaining = MAX_EDITORS_PER_TOKEN - members[tokenId].length;
        unchecked {
            for (uint256 i = 0; i < editors.length && i < remaining; i++) {
                _addEditor(tokenId, editors[i]);
            }
        }
    }

    /**
     * @notice Remove a collaborator from a token. Owner only.
     * @param tokenId The token to modify.
     * @param editor Address to remove.
     */
    function removeEditor(uint256 tokenId, address editor) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);
        _removeEditor(tokenId, editor);
    }

    /**
     * @notice Change the role of an existing collaborator. Owner only.
     * @param tokenId The token to modify.
     * @param collaborator The collaborator whose role to change.
     * @param role The new role (Viewer or Editor). None removes the collaborator.
     */
    function setCollaboratorRole(
        uint256 tokenId,
        address collaborator,
        CollaboratorRole role
    ) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);

        // If setting to None, remove the collaborator entirely
        if (role == CollaboratorRole.None) {
            _removeEditor(tokenId, collaborator);
            return;
        }

        // Only change role of existing collaborators (not adding new ones)
        if (_editorRoles[tokenId][collaborator] == CollaboratorRole.None)
            revert NotCollaborator(tokenId, collaborator);

        _editorRoles[tokenId][collaborator] = role;
        emit CollaboratorRoleChanged(tokenId, collaborator, role);
    }

    /**
     * @notice Get the collaborator role for a given token and address.
     * @param tokenId The token to query.
     * @param collaborator The address to query.
     * @return The CollaboratorRole (None, Viewer, or Editor).
     */
    function getCollaboratorRole(
        uint256 tokenId,
        address collaborator
    ) public view returns (CollaboratorRole) {
        return _editorRoles[tokenId][collaborator];
    }

    /**
     * @notice List all collaborators for a token (Viewers + Editors).
     * @param tokenId The token to query.
     * @return Array of collaborator addresses.
     */
    function listEditors(
        uint256 tokenId
    ) public view returns (address[] memory) {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        return members[tokenId];
    }

    /**
     * @notice List collaborators filtered by role.
     * @param tokenId The token to query.
     * @param role The role to filter by (Viewer or Editor).
     * @return Array of collaborator addresses matching the role.
     */
    function listCollaboratorsByRole(
        uint256 tokenId,
        CollaboratorRole role
    ) public view returns (address[] memory) {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (role == CollaboratorRole.None) revert InvalidCollaboratorRole();

        address[] storage allMembers = members[tokenId];
        uint256 count;
        unchecked {
            for (uint256 i = 0; i < allMembers.length; i++) {
                if (_editorRoles[tokenId][allMembers[i]] == role) {
                    count++;
                }
            }
        }

        address[] memory filtered = new address[](count);
        uint256 idx;
        unchecked {
            for (uint256 i = 0; i < allMembers.length; i++) {
                if (_editorRoles[tokenId][allMembers[i]] == role) {
                    filtered[idx] = allMembers[i];
                    idx++;
                }
            }
        }
        return filtered;
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
    // Burn
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Burn (destroy) a token. Owner or Editor with burn permission.
     * @param tokenId The token to burn.
     */
    function burn(uint256 tokenId) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (!_canBurnCheck(tokenId, msg.sender))
            revert CannotBurn(tokenId, msg.sender);

        // Clean up all collaborators before burning
        address[] storage memberList = members[tokenId];
        uint256 len = memberList.length;
        unchecked {
            for (uint256 i = len; i > 0; i--) {
                _removeEditor(tokenId, memberList[i - 1]);
            }
        }

        _burn(tokenId);
        unchecked {
            _tokenCounts--;
        }
        emit AssetBurned(tokenId, msg.sender);
    }

    /**
     * @notice Grant or revoke burn permission for a collaborator. Owner only.
     * @dev Only Editor-role collaborators can be granted burn permission.
     *      Setting canBurn=true on a Viewer or non-collaborator reverts.
     * @param tokenId The token to modify.
     * @param collaborator The collaborator to update.
     * @param _canBurnFlag True to grant burn permission, false to revoke.
     */
    function setBurnPermission(
        uint256 tokenId,
        address collaborator,
        bool _canBurnFlag
    ) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);

        if (_editorRoles[tokenId][collaborator] != CollaboratorRole.Editor)
            revert NotCollaborator(tokenId, collaborator);

        _canBurn[tokenId][collaborator] = _canBurnFlag;
        emit BurnPermissionChanged(tokenId, collaborator, _canBurnFlag);
    }

    /**
     * @notice Check if an address can burn a specific token.
     * @param tokenId The token to query.
     * @param who The address to check.
     * @return True if the address can burn the token.
     */
    function canBurn(uint256 tokenId, address who) public view returns (bool) {
        return _canBurnCheck(tokenId, who);
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

    /// @dev Returns true if sender has Editor role (can write).
    ///      Token owner always has implicit Editor permissions via ownership.
    function _isEditor(
        uint256 tokenId,
        address sender
    ) internal view returns (bool) {
        return _editorRoles[tokenId][sender] == CollaboratorRole.Editor;
    }

    /// @dev Returns true if sender has any collaborator role (Viewer or Editor).
    function _isCollaborator(
        uint256 tokenId,
        address sender
    ) internal view returns (bool) {
        return _editorRoles[tokenId][sender] != CollaboratorRole.None;
    }

    /// @dev Returns true if sender can burn this token (owner or Editor with burn flag).
    function _canBurnCheck(
        uint256 tokenId,
        address sender
    ) internal view returns (bool) {
        if (_ownerOf(tokenId) == sender) return true;
        return
            _editorRoles[tokenId][sender] == CollaboratorRole.Editor &&
            _canBurn[tokenId][sender];
    }

    /// @dev Add a collaborator with Editor role (default).
    function _addEditor(uint256 tokenId, address editor) internal {
        _addCollaborator(tokenId, editor, CollaboratorRole.Editor);
    }

    /// @dev Add a collaborator with a specific role.
    function _addCollaborator(
        uint256 tokenId,
        address editor,
        CollaboratorRole role
    ) internal {
        if (role == CollaboratorRole.None) revert InvalidCollaboratorRole();
        if (_editorRoles[tokenId][editor] != CollaboratorRole.None) return;
        if (members[tokenId].length >= MAX_EDITORS_PER_TOKEN)
            revert MaxEditorsReached(tokenId);
        if (tokensIParticipate[editor].length >= MAX_TOKENS_PER_EDITOR)
            revert MaxTokensPerEditorReached(editor);
        _editorRoles[tokenId][editor] = role;
        members[tokenId].push(editor);
        tokensIParticipate[editor].push(tokenId);
        emit EditorAdded(tokenId, editor);
        emit CollaboratorRoleChanged(tokenId, editor, role);
    }

    /// @dev Performs O(1) swap-and-pop removal from both members[] and tokensIParticipate[].
    ///      Skips swap when the element is already at the end to save gas.
    function _removeEditor(uint256 tokenId, address editor) internal {
        if (_editorRoles[tokenId][editor] == CollaboratorRole.None) return;

        // Cache array lengths to avoid repeated SLOADs
        uint256 membersLen = members[tokenId].length;
        address[] storage memberList = members[tokenId];

        uint256 memberIdx = membersLen; // sentinel for "not found"
        unchecked {
            for (uint256 i = 0; i < membersLen; i++) {
                if (memberList[i] == editor) {
                    memberIdx = i;
                    break;
                }
            }
        }
        if (memberIdx != membersLen) {
            // Swap-and-pop: only swap if not already the last element
            if (memberIdx != membersLen - 1) {
                memberList[memberIdx] = memberList[membersLen - 1];
            }
            memberList.pop();
            delete _editorRoles[tokenId][editor];
            delete _canBurn[tokenId][editor];
        }

        // Remove from reverse lookup (tokensIParticipate)
        uint256 partLen = tokensIParticipate[editor].length;
        uint256[] storage partList = tokensIParticipate[editor];

        uint256 participantIdx = partLen; // sentinel
        unchecked {
            for (uint256 i = 0; i < partLen; i++) {
                if (partList[i] == tokenId) {
                    participantIdx = i;
                    break;
                }
            }
        }
        if (participantIdx != partLen) {
            if (participantIdx != partLen - 1) {
                partList[participantIdx] = partList[partLen - 1];
            }
            partList.pop();
        }

        emit EditorRemoved(tokenId, editor);
    }

    function _setTokenURI(uint256 tokenId, string memory uri) internal {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        _tokenURIs[tokenId] = uri;
    }

    // ─────────────────────────────────────────────────────────────────
    // Admin — Native Token
    // ─────────────────────────────────────────────────────────────────

    function setCost(uint256 newCost) external onlyOwner {
        if (newCost == 0) revert InvalidCost();
        uint256 oldCost = costPerGeneration;
        costPerGeneration = newCost;
        emit CostUpdated(oldCost, newCost);
    }

    function setTreasury(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
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
        if (newCost == 0) revert InvalidCost();
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
        if (balance == 0) revert NoBalanceToWithdraw();
        (bool sent, ) = developerTreasuryWallet.call{value: balance}("");
        if (!sent) revert WithdrawFailed();
    }

    /**
     * @notice Recover USDC accidentally sent to this contract.
     * @dev Transfers all USDC held by this contract to the treasury.
     */
    function withdrawUSDC() external onlyOwner nonReentrant {
        if (address(usdcToken) == address(0)) revert UsdcTokenNotSet();
        uint256 balance = usdcToken.balanceOf(address(this));
        if (balance == 0) revert NoBalanceToWithdraw();
        usdcToken.safeTransfer(developerTreasuryWallet, balance);
    }

    receive() external payable {
        revert DirectTransferNotAllowed();
    }

    fallback() external payable {
        revert DirectTransferNotAllowed();
    }
}
