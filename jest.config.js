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
  transform: {},
};
