import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["eslint.config.js", "**/dist/**", "**/.output/**", "**/.wxt/**", "**/coverage/**", "**/node_modules/**", "packages/database/migrations/**", "MobileDataVaut/**"] },
  eslint.configs.recommended,
  // Type-aware rules need a tsconfig, so they only apply to TypeScript files.
  // Plain .js/.mjs files keep the untyped recommended rules.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: ["**/*.{ts,tsx}"] })),
  {
    files: ["**/service-worker.js", "**/sw.js"],
    languageOptions: {
      globals: { ...globals.serviceworker },
      sourceType: "script",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "@typescript-eslint/no-misused-promises": ["error", { "checksVoidReturn": { "attributes": false } }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/purity": "off"
    }
  }
);
