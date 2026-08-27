export default {
  testPathIgnorePatterns: [
    "/node_modules/",
    "/blockchain/",
    "/.claude/",
    "<rootDir>/\\.worktrees/",
    "/e2e/"
  ],
  coverageDirectory: "coverage/js",
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/frontend/dist/",
    "<rootDir>/\\.worktrees/",
    "/e2e/",
    "/blockchain/"
  ],
  setupFiles: ["<rootDir>/test/jest.setup.js"],
  moduleNameMapper: {
    "^multiformats/hashes/sha2$": "<rootDir>/node_modules/multiformats/src/hashes/sha2.js",
    // The @arbesk/asset-core workspace package is consumed via bare specifiers
    // ending in .js; map those to the package's .ts source so jest transforms
    // and tests source (no build step needed).
    "^@arbesk/asset-core$": "<rootDir>/packages/asset-core/src/index.ts",
    "^@arbesk/asset-core/(.+)\\.js$": "<rootDir>/packages/asset-core/src/$1.ts",
    "^@arbesk/wallet$": "<rootDir>/packages/wallet/src/index.ts",
    "^@arbesk/wallet/(.+)\\.js$": "<rootDir>/packages/wallet/src/$1.ts",
    "^@arbesk/authz$": "<rootDir>/packages/authz/src/index.ts",
    "^@arbesk/authz/(.+)\\.js$": "<rootDir>/packages/authz/src/$1.ts",
    "^@arbesk/ai-asset-gen$": "<rootDir>/packages/ai-asset-gen/src/index.ts",
    "^@arbesk/ai-asset-gen/(.+)\\.js$": "<rootDir>/packages/ai-asset-gen/src/$1.ts",
    // Frontend .ts sources import siblings with .js specifiers (emitted-ESM
    // convention); strip the extension so jest resolves the .ts source.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      { sourceMaps: "inline", module: { type: "es6" } },
    ],
  },
};
