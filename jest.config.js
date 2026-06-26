export default {
  testPathIgnorePatterns: [
    "/node_modules/",
    "/blockchain/",
    "/.claude/",
    "/.worktrees/",
    "/e2e/"
  ],
  coverageDirectory: "coverage/js",
  coveragePathIgnorePatterns: [
    "/node_modules/",
    "/frontend/dist/",
    "/.worktrees/",
    "/e2e/",
    "/blockchain/"
  ],
  setupFiles: ["<rootDir>/test/jest.setup.js"],
  moduleNameMapper: {
    "^multiformats/hashes/sha2$": "<rootDir>/node_modules/multiformats/src/hashes/sha2.js",
  },
  transform: {},
};
