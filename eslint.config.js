import js from "@eslint/js";
import globals from "globals";

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
    rules: {
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
