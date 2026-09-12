#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const root = git(["rev-parse", "--show-toplevel"], process.cwd());
const status = git(["status", "--short"], root);
const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
const checks = [
  "check:repository",
  "typecheck",
  "build",
  "test",
  "test:experiments",
].filter((name) => packageJson.scripts?.[name]);

const lines = [
  "Rove engineering context",
  `root: ${root}`,
  `worktree: ${basename(root)}`,
  `branch: ${git(["branch", "--show-current"], root) || "(detached)"}`,
  `head: ${git(["rev-parse", "HEAD"], root)}`,
  `status: ${status ? "dirty" : "clean"}`,
];

if (status) {
  lines.push("changed paths:");
  lines.push(...status.split("\n").map((entry) => `  ${entry}`));
}

lines.push(
  "authority: docs/README.md -> Product Brief -> Product Direction -> responsible contracts",
  `standard checks: ${checks.map((name) => `pnpm ${name}`).join(", ")}`,
  "live model, real-account browser, authentication, and third-party checks require explicit authorization",
);

process.stdout.write(`${lines.join("\n")}\n`);
