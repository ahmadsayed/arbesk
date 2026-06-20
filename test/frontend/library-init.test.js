import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DIST_JS = path.resolve(__dirname, "../../frontend/dist/js");

function readBuilt(name) {
  return fs.readFileSync(path.join(DIST_JS, name), "utf-8");
}

describe("library-init.js", () => {
  const src = () => readBuilt("library-init.js");

  test("gates #libraryMain behind #libraryGate by toggling the hidden class", () => {
    expect(src()).toMatch(/gate\.classList\.toggle\(\s*["']hidden["']\s*,\s*connected\s*\)/);
    expect(src()).toMatch(/main\.classList\.toggle\(\s*["']hidden["']\s*,\s*!connected\s*\)/);
  });

  test("wires the wallet lifecycle", () => {
    expect(src()).toMatch(/initWallet\(\)/);
    expect(src()).toMatch(/autoConnectWallet\(\)/);
    expect(src()).toMatch(/EVENTS\.WALLET_CONNECTED/);
    expect(src()).toMatch(/EVENTS\.WALLET_DISCONNECTED/);
    expect(src()).toMatch(/initLibraryGrid\(\)/);
  });

  test("wires both the headerbar and gate Connect Wallet buttons", () => {
    expect(src()).toMatch(/getElementById\(\s*["']connectWalletBtn["']\s*\)/);
    expect(src()).toMatch(/getElementById\(\s*["']libraryConnectBtn["']\s*\)/);
  });

  test("initializes theme and the wallet popover", () => {
    expect(src()).toMatch(/initTheme\(\)/);
    expect(src()).toMatch(/initWalletPopover\(\)/);
  });

  test("wires the toolbar module", () => {
    expect(src()).toMatch(/initLibraryToolbar\(\)/);
  });
});
