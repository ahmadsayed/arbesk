import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

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
    files: ["frontend/src/js/asset-core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "**/ipfs/remote-ipfs*",
            "**/ipfs/write-to-ipfs*",
            "**/ipfs/asset-core-adapter*",
            "**/services/*",
            "**/blockchain/*",
            "**/workers/*",
            "**/engine/*",
            "**/ui/*",
            "**/formats/*",
            "**/3mf/*",
          ],
          message: "asset-core must stay environment-agnostic — consume these via injected ports (see docs/superpowers/specs/2026-08-23-asset-core-externalization-design.md §3).",
        }],
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
        Web3: "readonly",
        IpfsHttpClient: "readonly",
        ethereum: "readonly",
        web3: "readonly",
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
