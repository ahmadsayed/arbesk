import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC_JS = path.resolve(__dirname, "../../frontend/src/js");

function readSource(rel) {
  return fs.readFileSync(path.join(SRC_JS, rel), "utf-8");
}

// Library page wiring moved into the unified SPA bootstrap (app-init.ts) plus
// the extracted data/gate module (library-controller.ts). The frontend is now
// bundled into dist/js/app.js by esbuild, so these guards read the SOURCE
// files that esbuild consumes rather than per-file dist output.
describe("app-init.ts (Library wiring)", () => {
  const src = () => readSource("app-init.ts");

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

describe("library-controller.ts", () => {
  const src = () => readSource("ui/library-controller.ts");

  test("gates #libraryMain behind #libraryGate by toggling the hidden class", () => {
    expect(src()).toMatch(
      /gate\.classList\.toggle\(\s*["']hidden["']\s*,\s*connected\s*\)/,
    );
    expect(src()).toMatch(
      /main\.classList\.toggle\(\s*["']hidden["']\s*,\s*!connected\s*\)/,
    );
  });
});
