# Web3 / dApp UX — Arbesk Studio

Domain-specific UX guidance, scored as **category K** in the audit. GNOME HIG and WCAG know nothing about wallets, transactions, or on-chain trust — these checks fill that gap. Grounded in the empirical Web3 design-guideline work (MDPI *Computers* 14(2):46, 2025) and practical dApp onboarding guidance.

## K.1 Wallet & Onboarding Clarity

- [ ] **K.1.1** Connect state is visually unambiguous — connected (accent fill) vs disconnected (outline) never ambiguous.
- [ ] **K.1.2** The connected address is truncated in monospace, and the full address is recoverable (copy/popover). ✅
- [ ] **K.1.3** Before any signature, the user sees *what* they are signing (SIWE login vs contract write vs comment). **FAIL**: SIWE/login intent is often silent — verify the wallet modal explains the session intent.
- [ ] **K.1.4** Chain/network context (Base Sepolia vs local Hardhat) is visible before a transaction.

## K.2 Transaction Feedback

- [ ] **K.2.1** Pending → confirmed states are distinct and visible in the UI (not console-only).
- [ ] **K.2.2** Cost (gas / USDC) and wait expectation are surfaced before confirming.
- [ ] **K.2.3** Failure surfaces a recoverable error with a retry path. **FAIL**: no generic retry pattern for failed transactions.
- [ ] **K.2.4** Free-tier quota (10 gen/day) and "credits lost on stop" are communicated *before* the user hits them.

## K.3 On-Chain vs Off-Chain Transparency

- [ ] **K.3.1** Parametric color/scale edits are visually marked as local (no transaction) — they must not imply a blockchain write.
- [ ] **K.3.2** Save Draft vs Publish distinction is clear (draft = local/IPFS staging, publish = on-chain write).
- [ ] **K.3.3** The user can tell when an action will cost credits/gas vs is free.

## K.4 Trust & Security Cues

- [ ] **K.4.1** Irreversible actions (burn, unpin) are explicitly destructive (confirmation + `--destructive-*` styling).
- [ ] **K.4.2** Ownership/editor status is surfaced when it gates an action.
- [ ] **K.4.3** Nothing reads as "confirmed on-chain" unless the tx actually succeeded (optimistic UI is fine but must roll back visibly).

## K.5 Generation & Wait Feedback

- [ ] **K.5.1** Long generation shows a spinner + status at the action point. ✅
- [ ] **K.5.2** Progress beyond the spinner (queued → processing → done) is visible for long ops (IPFS upload, generation). **FAIL**: spinner-only for IPFS/chain waits.
- [ ] **K.5.3** A stopped/cancelled generation clearly reports credits lost.

## Scoring

Same `PASS / (PASS + FAIL) × 100` formula. The category carries its own weight in the master table (`SKILL.md`). Mark items `N/A ➖` when the surface doesn't exist yet — an unverifiable claim is worse than a gap, so record "unverified" rather than guessing.
