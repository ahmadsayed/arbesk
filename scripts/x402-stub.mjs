// Stub for @coinbase/cdp-sdk's optional @x402/* peer dependencies. Arbesk does
// not use x402 payments; the SDK guards every x402 call behind a lazy loader
// that expects these packages to be absent. Each export throws with a clear
// message if an x402 code path is ever invoked — normal operation (CDP email
// wallets, paymaster) never touches them.
/** @param {string} name */
function unavailable(name) {
  return function () {
    throw new Error(
      `"${name}" (@x402/*) is stubbed out of this build — Arbesk does not support x402 payments`,
    );
  };
}

export const x402Client = unavailable("x402Client");
export const registerExactEvmScheme = unavailable("registerExactEvmScheme");
export const UptoEvmScheme = unavailable("UptoEvmScheme");
export const ExactSvmScheme = unavailable("ExactSvmScheme");
export const registerExactSvmScheme = unavailable("registerExactSvmScheme");
export const toClientEvmSigner = unavailable("toClientEvmSigner");
