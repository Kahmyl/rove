import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@rove/protocol": resolve(import.meta.dirname, "packages/protocol/src/index.ts"),
      "@rove/config": resolve(import.meta.dirname, "packages/config/src/index.ts"),
      "@rove/storage": resolve(import.meta.dirname, "packages/storage/src/index.ts"),
      "@rove/browser": resolve(import.meta.dirname, "packages/browser/src/index.ts")
    }
  },
  test: {
    include: ["{apps,packages}/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false
  }
});
