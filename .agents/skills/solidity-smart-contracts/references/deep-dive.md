# Deep Dive — Solidity Smart Contracts

General Solidity expertise: architecture principles, common patterns, OpenZeppelin v5 changes, and gas optimization.

## 1. General Solidity Expertise

### Contract Architecture Principles

| Principle | Rule |
|-----------|------|
| **Inheritance order** | Most-base → Most-derived. OpenZeppelin init calls go left-to-right. |
| **Storage layout** | `private`/`internal` vars first, then `public`, then mappings, then arrays. |
| **Event emission** | Every state-changing function must emit at least one event. |
| **Error handling** | Use `require()` for input validation, custom errors (Solidity 0.8.4+) for gas savings on complex conditions. |
| **Reentrancy** | Use OZ `ReentrancyGuard` on any function that transfers value or calls external contracts. |
| **Pausability** | Use OZ `Pausable` for emergency stop. Apply `whenNotPaused` to payment/mint functions. |
| **Access control** | Use OZ `Ownable` for single-owner, `AccessControl` for role-based. |
| **Upgradeability** | If using UUPS, storage gaps (`uint256[50] private __gap`) are mandatory in every base contract. |

### Common Patterns

**Payment pattern (PayGo):**
```solidity
function payForService(bytes32 requestId) external payable nonReentrant whenNotPaused {
    require(msg.value == serviceCost, "Incorrect payment");
    require(requestId != bytes32(0), "Invalid request");
    bytes32 key = keccak256(abi.encodePacked(requestId, msg.sender, block.number));
    require(!usedPayments[key], "Already paid");
    usedPayments[key] = true;
    (bool ok, ) = treasury.call{value: msg.value}("");
    require(ok, "Transfer failed");
    emit ServicePaid(msg.sender, requestId, msg.value, block.timestamp);
}
```

**ERC-20 payment pattern (tiered):**
```solidity
function payWithToken(bytes32 requestId, uint256 tierIndex) external nonReentrant whenNotPaused {
    uint256 cost = tierCosts[tierIndex];
    require(cost > 0, "Tier not set");
    bytes32 key = keccak256(abi.encodePacked(requestId, msg.sender, block.number));
    require(!usedPayments[key], "Already paid");
    usedPayments[key] = true;
    token.safeTransferFrom(msg.sender, treasury, cost);
    emit ServicePaidToken(msg.sender, requestId, cost, block.timestamp, tierIndex);
}
```

**Transfer hook for editor management:**
```solidity
function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
    address from = _ownerOf(tokenId);
    if (from != address(0) && from != to) {
        _removeEditor(tokenId, from);
        if (to != address(0)) _addEditor(tokenId, to);
    }
    return super._update(to, tokenId, auth);
}
```

**Swap-and-pop removal (O(1) array element removal):**
```solidity
function _removeFromArray(uint256[] storage arr, uint256 idx) internal {
    uint256 last = arr[arr.length - 1];
    arr[idx] = last;
    arr.pop();
}
```

### OpenZeppelin v5 Breaking Changes

| v4.x | v5.x | Impact |
|------|------|--------|
| `_mint(to, id)` | `_mint(to, id)` (unchanged) | No change |
| `_burn(id)` | `_burn(id)` (unchanged) | No change |
| `Counters.Counter` | Removed | Use manual `uint256` increment |
| `ERC721._beforeTokenTransfer` | `ERC721._update` | Must override `_update`, not a hook |
| `Ownable()` | `Ownable(msg.sender)` | Constructor requires initial owner |
| `Address.functionCall` | Removed from OZ v5, use low-level `call` | Manual inline or SafeERC20 for tokens |

### Gas Optimization Checklist

- [ ] Use `immutable` for constructor-set values that never change
- [ ] Use `constant` for compile-time constants
- [ ] Pack related state variables into single storage slots (uint128 + uint128, etc.)
- [ ] Use `unchecked` blocks for arithmetic known not to overflow
- [ ] Avoid redundant `SLOAD` — cache storage reads to memory
- [ ] Use `calldata` instead of `memory` for function parameters where possible
- [ ] Batch external calls into a single transaction when possible
