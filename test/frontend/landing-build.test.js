/**
 * Landing page build (frontend/dist/index.html) — minimal, prompt-first
 * (docs/superpowers/specs/2026-10-06-minimal-landing-design.md).
 * Needs a frontend build: (cd frontend && bun run build).
 */
import { describe, expect, test } from "bun:test";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../frontend/dist");
const html = () => fs.readFileSync(path.join(DIST, "index.html"), "utf-8");

describe("landing page build (index.html)", () => {
  test("the hero is the only form: a GET to /studio with provider radios and a prompt", () => {
    const h = html();
    const forms = h.match(/<form\b[^>]*>/g) ?? [];
    expect(forms).toHaveLength(1);
    expect(forms[0]).toContain('id="prompt"');
    expect(forms[0]).toContain('method="get"');
    expect(forms[0]).toContain('action="/studio"');
    expect(h).toMatch(/<input[^>]*name="provider"[^>]*value="tripo3d"[^>]*checked/);
    expect(h).toMatch(/<input[^>]*name="provider"[^>]*value="cad"/);
    expect(h).toMatch(/<input[^>]*name="prompt"[^>]*maxlength="500"[^>]*required/);
  });

  test("Library is one quiet footer link; sign-in and upload are deep links", () => {
    const h = html();
    expect(h.match(/href="\/library"/g)).toHaveLength(1);
    expect(h).toContain('href="/library?login=1"');
    expect(h).toContain('href="/library?upload=1"');
  });

  test("only the two Generate actions are orange CTAs", () => {
    expect(html().match(/class="landing-cta"/g)).toHaveLength(2);
  });

  test("the old sections are gone and nothing mentions agents", () => {
    const h = html();
    for (const gone of ["persona-card", "memory-cube", "ledger-chain", "team-scene", "band-dark", "scroll-cue"]) {
      expect(h).not.toContain(gone);
    }
    expect(h).not.toMatch(/AI agents|\bMCP\b|\bbesk\b/); // "Arbesk" has no word boundary before "besk"
  });

  test("loads the landing script and ships the version demo with its fallback", () => {
    const h = html();
    expect(h).toMatch(/<script[^>]*src="\/js\/landing\/landing\.js"[^>]*defer/);
    expect(fs.existsSync(path.join(DIST, "js/landing/landing.js"))).toBe(true);
    expect(h).toContain('id="versionDemo"');
    expect(h).toContain('id="versionRail"');
    expect(h).toContain('src="/landing/asset-howdy.webp"');
  });
});
