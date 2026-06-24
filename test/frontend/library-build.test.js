import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../../frontend/dist");

function readDist(name) {
  return fs.readFileSync(path.join(DIST, name), "utf-8");
}

describe("Library page build", () => {
  test("library.html exists and has the wallet gate + main containers", () => {
    const html = readDist("library.html");
    expect(html).toMatch(/id="libraryGate"/);
    expect(html).toMatch(/id="libraryConnectBtn"/);
    expect(html).toMatch(/id="libraryMain"/);
    expect(html).toMatch(/class="[^"]*hidden[^"]*"\s+id="libraryMain"|id="libraryMain"\s+class="[^"]*hidden/);
  });

  test("library.html has the toolbar, content, and statusbar regions", () => {
    const html = readDist("library.html");
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

  test("library.html shares the headerbar wallet ids with studio.html", () => {
    const html = readDist("library.html");
    expect(html).toMatch(/id="themeToggle"/);
    expect(html).toMatch(/id="headerbarNetworkSelect"/);
    expect(html).toMatch(/id="connectWalletBtn"/);
    expect(html).toMatch(/id="disconnectWalletBtn"/);
    expect(html).toMatch(/id="walletPopover"/);
  });

  test("library.html loads library-init.js as a module script", () => {
    const html = readDist("library.html");
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="\/js\/library-init\.js"/);
  });

  test("studio.html gains a page-switcher with Library and Studio links", () => {
    const html = readDist("studio.html");
    expect(html).toMatch(/class="page-switcher"/);
    expect(html).toMatch(/href="\/library\.html"/);
    expect(html).toMatch(/href="\/studio\.html"/);
  });

  test("library.html has its own page-switcher with Library active", () => {
    const html = readDist("library.html");
    expect(html).toMatch(/class="page-switcher"/);
    expect(html).toMatch(/href="\/library\.html"/);
    expect(html).toMatch(/href="\/studio\.html"/);
  });
});
