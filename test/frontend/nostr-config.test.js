/**
 * @jest-environment jsdom
 *
 * nostr-config: the browser relay URL prefers the backend-advertised
 * nostrPublicUrl (k3s deployment proxies the relay through the ingress) and
 * falls back to the local-dev ws(s)://<hostname>:7777 derivation when the
 * config field is null or the config fetch fails.
 */
import { jest, describe, test, expect, beforeEach } from "@jest/globals";

async function loadModule(config) {
  jest.resetModules();
  await jest.unstable_mockModule(
    "../../frontend/src/js/services/backend-client.js",
    () => ({ getConfig: jest.fn().mockResolvedValue(config) })
  );
  return import("../../frontend/src/js/services/nostr-config.js");
}

describe("getNostrRelayUrl", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("prefers the backend-advertised public relay URL", async () => {
    const mod = await loadModule({ nostrPublicUrl: "wss://promptscad.com/nostr" });
    await expect(mod.getNostrRelayUrl()).resolves.toBe("wss://promptscad.com/nostr");
  });

  test("falls back to host:7777 when nostrPublicUrl is null", async () => {
    const mod = await loadModule({ nostrPublicUrl: null });
    await expect(mod.getNostrRelayUrl()).resolves.toBe(mod.NOSTR_RELAY_URL);
    expect(mod.NOSTR_RELAY_URL).toMatch(/^ws:\/\/.*:7777$/);
  });

  test("falls back when the config fetch fails", async () => {
    const mod = await loadModule(null);
    await expect(mod.getNostrRelayUrl()).resolves.toBe(mod.NOSTR_RELAY_URL);
  });
});
