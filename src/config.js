/**
 * Arbesk Shared Backend Configuration
 *
 * Single source for Web3 instance, contract address, and IPFS URL.
 * Environment variables must be loaded (via dotenv) before importing this module.
 * Typically done by src/index.js at boot.
 */

import Web3 from "web3";

export const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
export const ASSETS_IPFS = process.env.ASSETS_IPFS;
export const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
export const HARDHAT_RPC_URL =
  process.env.HARDHAT_RPC_URL || "http://127.0.0.1:8545";
export const API_URL = process.env.API_URL || HARDHAT_RPC_URL;

// Single shared Web3 instance
export const web3 = new Web3(API_URL);
