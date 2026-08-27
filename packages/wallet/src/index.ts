/**
 * @arbesk/wallet — public API.
 */
export type * from "./types.ts";
export { createWalletFacade, buildUserIdentity, buildSiweProof } from "./facade.ts";
export type { WalletFacade, SiweProof, GetSiweOptions, GetMerkleProofOptions } from "./facade.ts";
export { createAssetContract } from "./contract.ts";
export type { AssetContractClient, AssetContractConfig, PublishParams, UpdateUriParams, UpdateEditorsParams, BurnParams } from "./contract.ts";
export { createEoaSigner } from "./adapters/eoa.ts";
export { buildSiweMessage, generateNonce, parseSiweMessage, verifySiwe, _resetSiweNonceStoreForTesting } from "./siwe.ts";
export type { ParsedSiweMessage, VerifySiweResult, VerifySiweContext } from "./siwe.ts";
export { verifyAuthProof } from "./verify.ts";
export type { VerifyProofResult, VerifyProofContext } from "./verify.ts";
export { createMemorySessionStore } from "./session.ts";
export type { MemorySessionStoreOptions } from "./session.ts";
export { makeLeaf, computeRoot, getProof, verifyEditorProof, MAX_EDITORS_PER_TOKEN, ZERO_HASH } from "./merkle.ts";
export type { EditorEntry } from "./merkle.ts";
