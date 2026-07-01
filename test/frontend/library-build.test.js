import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../frontend/dist");

function readDist(name) {
  return fs.readFileSync(path.join(DIST, name), "utf-8");
}

// Studio + Library are now a single SPA document (app.html); the Library view
// lives inside #libraryView and is toggled by the router.
describe("Library view build (app.html)", () => {
  test("app.html has the Library view with the wallet gate + main containers", () => {
    const html = readDist("app.html");
    expect(html).toMatch(/id="libraryView"/);
    expect(html).toMatch(/id="libraryGate"/);
    expect(html).toMatch(/id="libraryConnectBtn"/);
    expect(html).toMatch(/id="libraryMain"/);
    expect(html).toMatch(
      /class="[^"]*hidden[^"]*"\s+id="libraryMain"|id="libraryMain"\s+class="[^"]*hidden/
    );
  });

  test("app.html has the toolbar, content, and statusbar regions", () => {
    const html = readDist("app.html");
    expect(html).toMatch(/id="libraryUpBtn"/);
    expect(html).toMatch(/id="libraryBreadcrumb"/);
    expect(html).toMatch(/id="librarySearchInput"/);
    expect(html).toMatch(/id="librarySortSelect"/);
    expect(html).toMatch(/id="libraryContent"/);
    expect(html).toMatch(/id="libraryItems"/);
    expect(html).toMatch(/id="libraryItemCount"/);
    expect(html).toMatch(/id="libraryGridViewBtn"/);
    expect(html).toMatch(/id="libraryListViewBtn"/);
    expect(html).toMatch(/id="libraryLiveRegion"/);
  });

  test("app.html has the shared headerbar wallet ids", () => {
    const html = readDist("app.html");
    expect(html).toMatch(/id="themeToggle"/);
    expect(html).toMatch(/id="headerbarNetworkSelect"/);
    expect(html).toMatch(/id="connectWalletBtn"/);
    expect(html).toMatch(/id="disconnectWalletBtn"/);
    expect(html).toMatch(/id="walletPopover"/);
  });

  test("app.html loads app-init.js as the single module entry", () => {
    const html = readDist("app.html");
    expect(html).toMatch(
      /<script[^>]+type="module"[^>]+src="\/js\/app-init\.js"/
    );
  });

  test("app.html has a page-switcher with SPA route links for both views", () => {
    const html = readDist("app.html");
    expect(html).toMatch(/class="page-switcher"/);
    expect(html).toMatch(/href="\/library"/);
    expect(html).toMatch(/href="\/studio"/);
  });

  test("app.html contains both the Studio and Library view containers", () => {
    const html = readDist("app.html");
    expect(html).toMatch(/id="studioView"/);
    expect(html).toMatch(/id="libraryView"/);
  });
});
