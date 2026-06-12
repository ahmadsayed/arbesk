// SPDX-License-Identifier: ISC
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ArbeskAssetBase
 * @dev Abstract base contract shared between ArbeskAsset (paid) and ArbeskAssetFree (free tier).
 *      Contains all ERC-721, collaboration, and burn logic. Concrete contracts override
 *      the quota limits and add their own payment / generation behavior.
 */
abstract contract ArbeskAssetBase is ERC721Enumerable, Ownable, Pausable {
    // ── Custom Errors ──
    error TokenAlreadyMinted(uint256 tokenId);
    error NonexistentToken(uint256 tokenId);
    error NotOwnerOrEditor(uint256 tokenId, address caller);
    error NotTokenOwner(uint256 tokenId, address caller);
    error MaxEditorsReached(uint256 tokenId);
    error MaxTokensPerEditorReached(address editor);
    error InvalidCollaboratorRole();
    error NotCollaborator(uint256 tokenId, address caller);
    error CannotBurn(uint256 tokenId, address caller);
    error ZeroAddress();

    // ── Enums ──
    enum CollaboratorRole {
        None, // 0
        Viewer, // 1
        Editor // 2
    }

    // ── State ──
    uint256 private _tokenCounts;
    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => address[]) internal members;
    mapping(uint256 => mapping(address => CollaboratorRole)) internal _editorRoles;
    mapping(uint256 => mapping(address => bool)) internal _canBurn;
    mapping(address => uint256[]) public tokensIParticipate;

    // ── Abstract Quota Limits ──
    function maxEditorsPerToken() public pure virtual returns (uint256);
    function maxTokensPerEditor() public pure virtual returns (uint256);

    // ── Events ──
    event AssetPublished(
        address indexed owner,
        uint256 indexed tokenId,
        string tokenURI
    );
    event EditorAdded(uint256 indexed tokenId, address indexed editor);
    event EditorRemoved(uint256 indexed tokenId, address indexed editor);
    event CollaboratorRoleChanged(
        uint256 indexed tokenId,
        address indexed collaborator,
        CollaboratorRole role
    );
    event BurnPermissionChanged(
        uint256 indexed tokenId,
        address indexed collaborator,
        bool canBurn
    );
    event AssetBurned(uint256 indexed tokenId, address indexed burner);
    event AssetURIUpdated(uint256 indexed tokenId, string newAssetURI);

    // ── Constructor ──
    constructor(
        string memory name_,
        string memory symbol_
    ) Ownable(msg.sender) ERC721(name_, symbol_) {}

    // ── NFT Minting ──

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

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    function totalSupply() public view override returns (uint256) {
        return _tokenCounts;
    }

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

    // ── Collaboration ──

    function updateAssetURI(uint256 tokenId, string memory newAssetURI) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (!_isEditor(tokenId, msg.sender))
            revert NotOwnerOrEditor(tokenId, msg.sender);
        _setTokenURI(tokenId, newAssetURI);
        emit AssetURIUpdated(tokenId, newAssetURI);
    }

    function addEditor(uint256 tokenId, address editor) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);
        _addEditor(tokenId, editor);
    }

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

    function addEditor(uint256 tokenId, address[] memory editors) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);
        uint256 remaining = msg.sender == owner()
            ? type(uint256).max
            : maxEditorsPerToken() - members[tokenId].length;
        unchecked {
            for (uint256 i = 0; i < editors.length && i < remaining; i++) {
                _addEditor(tokenId, editors[i]);
            }
        }
    }

    function removeEditor(uint256 tokenId, address editor) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);
        _removeEditor(tokenId, editor);
    }

    function setCollaboratorRole(
        uint256 tokenId,
        address collaborator,
        CollaboratorRole role
    ) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (_ownerOf(tokenId) != msg.sender)
            revert NotTokenOwner(tokenId, msg.sender);

        if (role == CollaboratorRole.None) {
            _removeEditor(tokenId, collaborator);
            return;
        }

        if (_editorRoles[tokenId][collaborator] == CollaboratorRole.None)
            revert NotCollaborator(tokenId, collaborator);

        _editorRoles[tokenId][collaborator] = role;
        emit CollaboratorRoleChanged(tokenId, collaborator, role);
    }

    function getCollaboratorRole(
        uint256 tokenId,
        address collaborator
    ) public view returns (CollaboratorRole) {
        return _editorRoles[tokenId][collaborator];
    }

    function listEditors(
        uint256 tokenId
    ) public view returns (address[] memory) {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        return members[tokenId];
    }

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

    function listTokens(address editor) public view returns (uint256[] memory) {
        return tokensIParticipate[editor];
    }

    // ── Burn ──

    function burn(uint256 tokenId) public {
        if (!_exists(tokenId)) revert NonexistentToken(tokenId);
        if (!_canBurnCheck(tokenId, msg.sender))
            revert CannotBurn(tokenId, msg.sender);

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

    function canBurn(uint256 tokenId, address who) public view returns (bool) {
        return _canBurnCheck(tokenId, who);
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
        return _editorRoles[tokenId][sender] == CollaboratorRole.Editor;
    }

    function _isCollaborator(
        uint256 tokenId,
        address sender
    ) internal view returns (bool) {
        return _editorRoles[tokenId][sender] != CollaboratorRole.None;
    }

    function _canBurnCheck(
        uint256 tokenId,
        address sender
    ) internal view returns (bool) {
        if (_ownerOf(tokenId) == sender) return true;
        return
            _editorRoles[tokenId][sender] == CollaboratorRole.Editor &&
            _canBurn[tokenId][sender];
    }

    function _addEditor(uint256 tokenId, address editor) internal {
        _addCollaborator(tokenId, editor, CollaboratorRole.Editor);
    }

    function _addCollaborator(
        uint256 tokenId,
        address editor,
        CollaboratorRole role
    ) internal {
        if (role == CollaboratorRole.None) revert InvalidCollaboratorRole();
        if (_editorRoles[tokenId][editor] != CollaboratorRole.None) return;

        // Contract owner bypasses collaboration quotas for testing/admin.
        if (msg.sender != owner()) {
            if (members[tokenId].length >= maxEditorsPerToken())
                revert MaxEditorsReached(tokenId);
            if (tokensIParticipate[editor].length >= maxTokensPerEditor())
                revert MaxTokensPerEditorReached(editor);
        }

        _editorRoles[tokenId][editor] = role;
        members[tokenId].push(editor);
        tokensIParticipate[editor].push(tokenId);
        emit EditorAdded(tokenId, editor);
        emit CollaboratorRoleChanged(tokenId, editor, role);
    }

    function _removeEditor(uint256 tokenId, address editor) internal {
        if (_editorRoles[tokenId][editor] == CollaboratorRole.None) return;

        uint256 membersLen = members[tokenId].length;
        address[] storage memberList = members[tokenId];

        uint256 memberIdx = membersLen;
        unchecked {
            for (uint256 i = 0; i < membersLen; i++) {
                if (memberList[i] == editor) {
                    memberIdx = i;
                    break;
                }
            }
        }
        if (memberIdx != membersLen) {
            if (memberIdx != membersLen - 1) {
                memberList[memberIdx] = memberList[membersLen - 1];
            }
            memberList.pop();
            delete _editorRoles[tokenId][editor];
            delete _canBurn[tokenId][editor];
        }

        uint256 partLen = tokensIParticipate[editor].length;
        uint256[] storage partList = tokensIParticipate[editor];

        uint256 participantIdx = partLen;
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
}
