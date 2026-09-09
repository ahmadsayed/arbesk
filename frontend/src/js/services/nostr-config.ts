import { getConfig } from "./backend-client.ts";

/**
 * Local-dev fallback relay URL (same host as the app, standard port 7777).
 * Used when the backend does not advertise a public relay URL.
 */
export const NOSTR_RELAY_URL =
  (typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss://"
    : "ws://") +
  (typeof window !== "undefined" ? window.location.hostname : "127.0.0.1") +
  ":7777";

let _relayUrlPromise: Promise<string> | null = null;

/**
 * Browser-facing Nostr relay URL.
 * @remarks Prefers the backend-advertised `nostrPublicUrl` (set via the
 *   PUBLIC_NOSTR_URL env var, e.g. `wss://promptscad.com/nostr` on the k3s
 *   deployment where the relay is proxied through the ingress) and falls back
 *   to the local-dev host:7777 derivation. Config is immutable for the page
 *   lifetime, so the result is memoized.
 */
export function getNostrRelayUrl(): Promise<string> {
  if (_relayUrlPromise) return _relayUrlPromise;
  _relayUrlPromise = getConfig().then(
    (config) => config?.nostrPublicUrl || NOSTR_RELAY_URL,
    () => NOSTR_RELAY_URL
  );
  return _relayUrlPromise;
}
