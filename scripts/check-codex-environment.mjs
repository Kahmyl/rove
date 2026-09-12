#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const required = [
  ".codex/config.toml",
  ".codex/rules/rove.rules",
  ".agents/skills/rove-engineering/SKILL.md",
  ".agents/skills/rove-engineering/references/repository-map.md",
  ".agents/skills/rove-engineering/references/verification.md",
  ".agents/skills/rove-engineering/references/continuation.md",
  ".agents/skills/rove-engineering/scripts/context-snapshot.mjs",
  "docs/Engineering/engineering-agent-environment.md",
];

for (const path of required) {
  if (!existsSync(path))
    throw new Error(`Missing Codex environment file: ${path}`);
}

const skill = readFileSync(required[2], "utf8");
if (!/^---\nname: rove-engineering\ndescription: .+\n---\n/.test(skill)) {
  throw new Error("Rove engineering skill frontmatter is invalid.");
}
for (const path of required) {
  const text = readFileSync(path, "utf8");
  if (/auth\.json|API[_ -]?key\s*=|Bearer\s+[A-Za-z0-9._-]+/i.test(text)) {
    throw new Error(`Potential secret or credential path in ${path}`);
  }
}

const config = readFileSync(required[0], "utf8");
for (const expected of [
  'approval_policy = "on-request"',
  'sandbox_mode = "workspace-write"',
  "multi_agent = true",
]) {
  if (!config.includes(expected))
    throw new Error(`Missing project default: ${expected}`);
}

const rules = readFileSync(required[1], "utf8");
for (const command of ["git", "agent:live", "docker:reset"]) {
  if (!rules.includes(command))
    throw new Error(`Missing command rule for ${command}`);
}

const agents = readFileSync("AGENTS.md", "utf8");
if (!agents.includes(".agents/skills/rove-engineering/SKILL.md")) {
  throw new Error(
    "AGENTS.md does not route engineering work through the skill.",
  );
}
const docsIndex = readFileSync("docs/README.md", "utf8");
if (!docsIndex.includes("Engineering/engineering-agent-environment.md")) {
  throw new Error(
    "Documentation index does not include the agent environment.",
  );
}
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
for (const script of ["codex:context", "codex:environment:check"]) {
  if (!packageJson.scripts?.[script]) {
    throw new Error(`Missing package script: ${script}`);
  }
}

if (process.argv.includes("--installed-client")) {
  const version = execFileSync("codex", ["--version"], {
    encoding: "utf8",
  }).trim();
  const help = execFileSync("codex", ["--help"], { encoding: "utf8" });
  for (const surface of ["--worktree", "features", "agents"]) {
    if (!help.includes(surface))
      throw new Error(`Installed Codex lacks ${surface}`);
  }
  execFileSync(
    "codex",
    [
      "execpolicy",
      "check",
      "--rules",
      required[1],
      "--",
      "git",
      "push",
      "origin",
      "example",
    ],
    { stdio: "ignore" },
  );
  process.stdout.write(`Installed client: ${version}\n`);
}

process.stdout.write(
  `Codex environment checks passed: ${required.length} files.\n`,
);
