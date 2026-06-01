import { web3 } from "../config.js";

export default async function authorize(request, response, next) {
  try {
    const authHeader = request.headers["authorization"];
    if (!authHeader) {
      console.log(`[AUTH] rejected — missing Authorization header`);
      return response
        .status(401)
        .json({ error: "Missing Authorization header" });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      console.log(`[AUTH] rejected — invalid format`);
      return response
        .status(401)
        .json({
          error: "Invalid Authorization format. Expected: Bearer <token>",
        });
    }

    const apiToken = parts[1].split(".");
    if (apiToken.length !== 2) {
      console.log(`[AUTH] rejected — invalid token format`);
      return response
        .status(401)
        .json({
          error:
            "Invalid token format. Expected: base64message.base64signature",
        });
    }

    const message = Buffer.from(apiToken[0], "base64").toString();
    const signature = Buffer.from(apiToken[1], "base64").toString();
    const txHash = message.replace("txHash:", "");

    const address = await web3.eth.accounts.recover(message, signature);
    response.locals.userAddress = address;
    response.locals.txHash = txHash;
    console.log(`[AUTH] recovered address=${address} tx=${txHash}`);

    // Validate txHash on-chain
    const receipt = await web3.eth.getTransactionReceipt(txHash);
    if (!receipt || Number(receipt.status) !== 1) {
      console.log(`[AUTH] tx ${txHash} not found or failed`);
      return response
        .status(403)
        .json({ error: `Transaction ${txHash} not found or failed` });
    }
    console.log(`[AUTH] tx ${txHash} verified (block ${receipt.blockNumber})`);

    next();
  } catch (error) {
    console.error("[AUTH] error:", error.message);
    return response
      .status(403)
      .json({ error: "Authentication failed: " + error.message });
  }
}
