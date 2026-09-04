/** Client-facing Nostr relay URL (same host as the app, standard port 7777). */
export const NOSTR_RELAY_URL =
  (typeof window !== "undefined" && window.location.protocol === "https:"
    ? "wss://"
    : "ws://") +
  (typeof window !== "undefined" ? window.location.hostname : "127.0.0.1") +
  ":7777";
