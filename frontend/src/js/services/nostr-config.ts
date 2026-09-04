/** Backend service-key pubkey (signs the CLI/MCP relay-published live updates). */
export const SERVICE_PUBKEY =
  "45ffa785bc3034c40e39d63fa4a37ab3c46de21a6c053963526a3f813d837c43";

/** Client-facing Nostr relay URL (same host as the app, standard port 7777). */
export const NOSTR_RELAY_URL =
  (typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss://"
    : "ws://") +
  (typeof window !== "undefined" ? window.location.hostname : "127.0.0.1") +
  ":7777";
