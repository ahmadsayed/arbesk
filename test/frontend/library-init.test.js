import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST_JS = path.resolve(__dirname, "../../frontend/dist/js");

function readBuilt(name) {
  return fs.readFileSync(path.join(DIST_JS, name), "utf-8");
}

// Library page wiring moved into the unified SPA bootstrap (app-init.js) plus
// the extracted data/gate module (library-controller.js). These tests guard
// that the Library controls are still wired in the single-document shell.
describe("app-init.js (Library wiring)", () => {
  const src = () => readBuilt("app-init.js");

  test("wires the wallet lifecycle", () => {
    expect(src()).toMatch(/initWallet\(\)/);
    expect(src()).not.toMatch(/autoConnectWallet\(\)/);
    expect(src()).toMatch(/connectWallet/);
    expect(src()).toMatch(/EVENTS\.WALLET_CONNECTED/);
    expect(src()).toMatch(/EVENTS\.WALLET_DISCONNECTED/);
    expect(src()).toMatch(/initLibraryGrid\(\)/);
  });

  test("wires both the headerbar and gate Connect Wallet buttons", () => {
    expect(src()).toMatch(/["']connectWalletBtn["']/);
    expect(src()).toMatch(/["']libraryConnectBtn["']/);
  });

  test("initializes theme and the wallet popover", () => {
    expect(src()).toMatch(/initTheme\(\)/);
    expect(src()).toMatch(/initWalletPopover\(\)/);
  });

  test("wires the toolbar and context-menu modules", () => {
    expect(src()).toMatch(/initLibraryToolbar\(\)/);
    expect(src()).toMatch(/initLibraryContextMenu\(\)/);
  });
});

describe("library-controller.js", () => {
  const src = () => readBuilt("ui/library-controller.js");

  test("gates #libraryMain behind #libraryGate by toggling the hidden class", () => {
    expect(src()).toMatch(
      /gate\.classList\.toggle\(\s*["']hidden["']\s*,\s*connected\s*\)/
    );
    expect(src()).toMatch(
      /main\.classList\.toggle\(\s*["']hidden["']\s*,\s*!connected\s*\)/
    );
  });
});
