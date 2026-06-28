// @ts-nocheck
import {
  createPublicClient,
  http,
  decodeAbiParameters,
  hashMessage,
  erc6492SignatureValidatorByteCode,
  erc6492SignatureValidatorAbi,
} from "viem";
import { encodeDeployData } from "viem/utils";
import { readFileSync } from "fs";
import Web3 from "web3";

const client = createPublicClient({
  transport: http("https://carrot.megaeth.com/rpc"),
});

const address = "0xAd78A7bE6133638fC7b97d04634887505512d227";
const message = `http://localhost:9090 wants you to sign in with your Ethereum account:
0xAd78A7bE6133638fC7b97d04634887505512d227

Sign in to Arbesk Studio

URI: http://localhost:9090
Version: 1
Chain ID: 6343
Nonce: e1145718f7f363e777aa7ed2a4ada907
Issued At: 2026-06-28T19:10:48.358Z`;
const signature = readFileSync("/tmp/signature.txt", "utf8").trim();

console.log("signature length:", signature.length);

const sigLower = signature.toLowerCase();
const magicBytes =
  "6492649264926492649264926492649264926492649264926492649264926492";
const isErc6492 = sigLower.endsWith(magicBytes);
console.log("isErc6492:", isErc6492);

let factory, factoryData, innerSignature;
if (isErc6492) {
  const encoded = signature.slice(2, -64);
  console.log("encoded length:", encoded.length);
  [factory, factoryData, innerSignature] = decodeAbiParameters(
    [
      { type: "address", name: "factory" },
      { type: "bytes", name: "factoryData" },
      { type: "bytes", name: "signature" },
    ],
    `0x${encoded}`,
  );
  console.log("factory:", factory);
  console.log("factoryData:", factoryData);
  console.log("factoryData length:", factoryData.length);
  console.log("innerSignature:", innerSignature);
  console.log("innerSignature length:", innerSignature.length);
}

const eip191Hash = hashMessage(message);
console.log("EIP-191 message hash:", eip191Hash);

const data = encodeDeployData({
  abi: erc6492SignatureValidatorAbi,
  args: [address, eip191Hash, signature],
  bytecode: erc6492SignatureValidatorByteCode,
});

console.log("deploy data length:", data.length);

try {
  const result = await client.call({
    data,
  });
  console.log("validation call result:", result.data);
} catch (err) {
  console.error("validation call error:", err.message);
  console.error("validation call error details:", err);
}

// Try recovering the EOA from the inner signature + EIP-191 hash
const w3 = new Web3();
try {
  const recovered = w3.eth.accounts.recover(eip191Hash, innerSignature);
  console.log("web3 recover from EIP-191 hash:", recovered);
} catch (e) {
  console.log("web3 recover from EIP-191 hash failed:", e.message);
}

// Also try raw keccak hash
try {
  const rawHash = w3.utils.keccak256(message);
  const recoveredRaw = w3.eth.accounts.recover(rawHash, innerSignature);
  console.log("web3 recover from raw keccak:", recoveredRaw);
} catch (e) {
  console.log("web3 recover from raw keccak failed:", e.message);
}
