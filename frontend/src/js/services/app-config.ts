/**
 * Deployment config advertised by the backend (GET /api/v1/config).
 * @remarks Kept dependency-free so low-level modules (viem-clients) can read
 *   it without importing backend-client, which itself imports viem-clients.
 */

let _configPromise: Promise<any> | null = null;

/**
 * GET /api/v1/config
 * @remarks Config is immutable for the page lifetime, so the result is
 *   memoized; a failed fetch clears the cache so the next call can retry.
 * @returns { contractAddress, ipfsGatewayUrl, hardhatRpcUrl, mockGeneration,
 *   cadGeneration } — `cadGeneration: false` means the deployment cannot
 *   serve the Parametric CAD provider (no CAD_MOCK_GENERATION and no
 *   DEEPSEEK_API_KEY); absent/true means it can.
 */
export async function getConfig(): Promise<any> {
  if (_configPromise) return _configPromise;
  _configPromise = (async () => {
    try {
      const res = await fetch("/api/v1/config");
      return await res.json();
    } catch {
      _configPromise = null;
      return null;
    }
  })();
  return _configPromise;
}
