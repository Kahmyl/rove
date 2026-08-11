import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", ".rove/**", "release/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["apps/companion/**/*.tsx"],
    rules: { "no-undef": "off" }
  },
  {
    files: ["apps/runtime/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off"
    }
  }
);
