import { Hono } from "hono";
import {
  buildCspDirectives,
  buildCspHeaderValue,
  secureHeaders,
} from "../../src/hono/secure-headers.ts";

const ENV_KEYS = ["PINATA_GATEWAY", "PUBLIC_ORIGIN"];

describe("hono secure-headers", () => {
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("buildCspHeaderValue", () => {
    it("serializes the exact helmet directive set", () => {
      const value = buildCspHeaderValue();
      expect(value).toBe(
        [
          "default-src 'self'",
          "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://cdn.babylonjs.com https://cdn.jsdelivr.net https://esm.sh",
          "style-src 'self' 'unsafe-inline'",
          "connect-src 'self' http://127.0.0.1:5001 http://127.0.0.1:8545 http://127.0.0.1:9090 ws://localhost:9090 wss://localhost:9090 https://*.llamarpc.com https://*.publicnode.com https://esm.sh https://api.cdp.coinbase.com https://*.cdp.coinbase.com https://sepolia.base.org",
          "img-src 'self' blob: data: http://127.0.0.1:8080",
          "font-src 'self'",
          "media-src 'self'",
          "worker-src 'self' blob:",
          "frame-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join(";"),
      );
    });

    it("omits upgrade-insecure-requests (report-only mode)", () => {
      expect(buildCspHeaderValue()).not.toContain("upgrade-insecure-requests");
    });

    it("extends connect-src and img-src with PINATA_GATEWAY", () => {
      process.env.PINATA_GATEWAY = "gateway.pinata.cloud";
      const directives = buildCspDirectives();
      expect(directives.connectSrc).toContain("https://gateway.pinata.cloud");
      expect(directives.imgSrc).toContain("https://gateway.pinata.cloud");
    });

    it("extends connect-src with PUBLIC_ORIGIN and its ws(s) form", () => {
      process.env.PUBLIC_ORIGIN = "https://promptscad.com";
      const directives = buildCspDirectives();
      expect(directives.connectSrc).toContain("https://promptscad.com");
      expect(directives.connectSrc).toContain("wss://promptscad.com");
      expect(directives.imgSrc).not.toContain("https://promptscad.com");
    });
  });

  describe("secureHeaders middleware", () => {
    function buildApp() {
      const app = new Hono();
      app.use(secureHeaders());
      app.get("/", (c) => c.text("hi"));
      return app;
    }

    it("sets report-only CSP and COOP headers", async () => {
      const res = await buildApp().request("http://localhost/");
      expect(res.headers.get("Content-Security-Policy-Report-Only")).toBe(
        buildCspHeaderValue(),
      );
      expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe(
        "same-origin-allow-popups",
      );
    });

    it("does not set enforcing CSP, frameguard, or COEP headers", async () => {
      const res = await buildApp().request("http://localhost/");
      expect(res.headers.get("Content-Security-Policy")).toBeNull();
      expect(res.headers.get("X-Frame-Options")).toBeNull();
      expect(res.headers.get("Cross-Origin-Embedder-Policy")).toBeNull();
    });
  });
});
