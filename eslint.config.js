import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

const baseRules = {
  ...js.configs.recommended.rules,
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "no-console": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-undef": "error",
  "no-redeclare": "error",
  "no-unreachable": "error",
  "no-var": "error",
  "prefer-const": "error",
  "eqeqeq": ["error", "always", { null: "ignore" }],
  // v10 recommended rules that are too noisy for this legacy codebase.
  "no-useless-assignment": "off",
  "preserve-caught-error": "off",
};

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    name: "arbesk/ignore",
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/.worktrees/**",
      "blockchain/artifacts/**",
      "blockchain/cache/**",
      "blockchain/deployments/**",
      "blockchain/coverage/**",
      // Mutation-testing Python venv (vendored pip/urllib3 JS is not ours)
      "blockchain/.venv-mutate/**",
      // Agent skill scaffolding, not product code
      ".agents/**",
      "frontend/src/js/vendor/**",
      "frontend/dist/**",
      "mock-gltf-assets/**",
    ],
  },

  {
    name: "arbesk/base",
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    plugins: {
      // Flat-config plugins go here when we add them.
    },
    rules: baseRules,
  },

  {
    name: "arbesk/typescript",
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      ...baseRules,
      // TypeScript itself reports unresolved names/types; eslint's no-undef
      // false-positives on type annotations.
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Node type-stripping does not elide imports: type-only imports must
      // be written as `import type` or the runtime resolution fails.
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },

  {
    name: "arbesk/asset-core",
    files: ["packages/asset-core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: [
              "**/frontend/**",
              "**/src/api/**",
              "**/constants/**",
            ],
            message: "asset-core must stay environment-agnostic — consume host capabilities via injected ports, never by reaching into the frontend/backend trees.",
          },
          {
            group: [
              "**/ipfs/remote-ipfs*",
              "**/ipfs/write-to-ipfs*",
              "**/ipfs/asset-core-adapter*",
              "**/services/*",
              "**/blockchain/*",
              "**/workers/*",
              "**/engine/*",
              "**/ui/*",
            ],
            message: "asset-core must stay environment-agnostic — consume these via injected ports (see docs/ASSET_CORE_SDK.md §7).",
          },
          {
            group: ["@babylonjs/*", "babylonjs", "babylon.js"],
            message: "asset-core must not depend on Babylon.js — it is a pure glTF/manifest engine.",
          },
        ],
      }],
      "no-restricted-globals": ["error",
        { name: "window", message: "asset-core is environment-agnostic; inject via ports." },
        { name: "document", message: "asset-core is environment-agnostic; inject via ports." },
        { name: "BABYLON", message: "asset-core must not touch the 3D engine." },
        { name: "Web3", message: "use the HashPort/ChainPort instead of the Web3 CDN global." },
        { name: "navigator", message: "asset-core is environment-agnostic; inject via ports." },
        { name: "localStorage", message: "use the StoragePort instead." },
      ],
    },
  },

  {
    name: "arbesk/nostr",
    files: ["packages/nostr/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: [
              "**/frontend/**",
              "**/src/api/**",
              "**/constants/**",
            ],
            message: "nostr must stay environment-agnostic — consume host capabilities via injected ports, never by reaching into the frontend/backend trees.",
          },
        ],
      }],
      "no-restricted-globals": ["error",
        { name: "window", message: "nostr is environment-agnostic; inject via ports." },
        { name: "document", message: "nostr is environment-agnostic; inject via ports." },
        { name: "navigator", message: "nostr is environment-agnostic; inject via ports." },
        { name: "localStorage", message: "nostr is environment-agnostic; inject via ports." },
        { name: "Web3", message: "use injected signer ports instead of the Web3 CDN global." },
        { name: "BABYLON", message: "nostr must not touch the 3D engine." },
      ],
    },
  },

  {
    name: "arbesk/typescript-declarations",
    files: ["**/*.d.ts"],
    rules: {
      // Ambient declaration files legitimately augment the same globals and
      // use inline import() types.
      "no-redeclare": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },

  {
    name: "arbesk/frontend",
    files: ["frontend/**/*.js", "frontend/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: {
        ...globals.browser,
        BABYLON: "readonly",
        IpfsHttpClient: "readonly",
        ethereum: "readonly",
        WorkerGlobalScope: "readonly",
      },
    },
  },

  {
    name: "arbesk/blockchain-scripts",
    files: ["blockchain/scripts/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.commonjs,
        ...globals.node,
      },
    },
  },

  {
    name: "arbesk/jsdoc",
    files: ["**/*.ts", "**/*.js", "**/*.mjs", "**/*.cjs"],
    plugins: { jsdoc },
    rules: {
      // Comment convention (see docs): summary + @remarks (why) + @throws (contract),
      // no invented tags, no type-duplicating @param/@returns. Warn-only so it
      // documents drift without failing the build yet.
      "jsdoc/check-tag-names": ["warn", { definedTags: ["remarks", "internal", "jest-environment", "jest-globals"] }],
      "jsdoc/check-param-names": ["warn", { disableMissingParamChecks: true }],
      "jsdoc/check-syntax": "warn",
      "jsdoc/no-undefined-types": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off",
    },
  },

  {
    name: "arbesk/tests",
    files: ["test/**/*.js", "e2e/**/*.mjs", "**/*.test.js", "**/*.spec.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-undef": "off",
    },
  },
];
