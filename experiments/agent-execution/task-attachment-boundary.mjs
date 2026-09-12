import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const files = [
  "apps/companion/src/main/codex/task-attachment-product.integration.test.ts",
  "apps/companion/src/main/codex/task-attachments.test.ts",
  "apps/companion/src/main/codex/local-product-api.test.ts",
  "apps/companion/src/main/host/local-file-grant.test.ts",
  "apps/companion/src/main/host/hub-command-executor.test.ts",
  "apps/companion/src/main/runtime-client.test.ts",
  "apps/companion/src/renderer/product-surface.test.tsx",
];
const result = spawnSync("pnpm", ["vitest", "run", ...files], {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status ?? 1);
const build = spawnSync("pnpm", ["--filter", "@rove/companion", "build"], {
  cwd: root,
  encoding: "utf8",
  stdio: "pipe",
});
process.stdout.write(build.stdout);
process.stderr.write(build.stderr);
if (build.status !== 0) process.exit(build.status ?? 1);
const renderer = spawnSync(
  process.execPath,
  [resolve(import.meta.dirname, "task-attachment-native-renderer.mjs")],
  { cwd: root, encoding: "utf8", stdio: "pipe" },
);
process.stdout.write(renderer.stdout);
process.stderr.write(renderer.stderr);
if (renderer.status !== 0) process.exit(renderer.status ?? 1);
process.stdout.write(
  `${JSON.stringify({
    status: "passed",
    boundary: "task_attachment",
    picker: "deterministic adapter (not the OS picker)",
    fixtureBytes: 74,
    sourceProduct: false,
    scope:
      "source-built semantic renderer plus component integration; full managed-browser product journey pending",
    cleanupVerified: true,
  })}\n`,
);
