#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const required = [
  ".codex/config.toml",
  ".codex/rules/rove.rules",
  ".agents/skills/rove-engineering/SKILL.md",
  ".agents/skills/rove-engineering/references/repository-map.md",
  ".agents/skills/rove-engineering/references/verification.md",
  ".agents/skills/rove-engineering/references/continuation.md",
  ".agents/skills/rove-engineering/references/design-judgment.md",
  ".agents/skills/rove-engineering/references/independent-review.md",
  ".agents/skills/rove-engineering/references/parallel-execution.md",
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
if (skill.split("\n").length > 110) {
  throw new Error("Rove engineering skill is too large for its routing role.");
}
for (const reference of [
  "design-judgment.md",
  "independent-review.md",
  "parallel-execution.md",
]) {
  if (!skill.includes(`references/${reference}`)) {
    throw new Error(`Rove engineering skill does not route to ${reference}.`);
  }
}
for (const redundantSkill of ["rove-change", "rove-verify", "rove-review"]) {
  if (existsSync(`.agents/skills/${redundantSkill}`)) {
    throw new Error(`Redundant top-level skill exists: ${redundantSkill}`);
  }
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
  "hooks = false",
  "multi_agent = true",
]) {
  if (!config.includes(expected))
    throw new Error(`Missing project default: ${expected}`);
}

const rulesPath = required[1];
const rules = readFileSync(rulesPath, "utf8");
for (const command of [
  "commit",
  "push",
  "branch",
  "worktree",
  "agent:live",
  "docker:reset",
]) {
  if (!rules.includes(command))
    throw new Error(`Missing command rule for ${command}`);
}

const agents = readFileSync("AGENTS.md", "utf8");
if (!agents.includes(".agents/skills/rove-engineering/SKILL.md")) {
  throw new Error(
    "AGENTS.md does not route engineering work through the skill.",
  );
}
for (const protectedPath of ["AGENTS.md", ".agents/**", ".codex/**"]) {
  if (!agents.includes(protectedPath)) {
    throw new Error(
      `AGENTS.md lacks governance protection for ${protectedPath}.`,
    );
  }
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

  function policy(command) {
    const output = execFileSync(
      "codex",
      ["execpolicy", "check", "--rules", rulesPath, "--", ...command],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(output);
  }

  const promptCommands = [
    ["git", "commit", "-m", "example"],
    ["git", "push", "origin", "example"],
    ["git", "merge", "feature/example"],
    ["git", "rebase", "main"],
    ["git", "reset", "--hard", "HEAD~1"],
    ["git", "clean", "-fd"],
    ["git", "branch", "-D", "example"],
    ["git", "worktree", "remove", "../example"],
    ["git", "worktree", "prune"],
    ["git", "checkout", "main"],
    ["git", "switch", "main"],
    ["git", "restore", "source.ts"],
    ["pnpm", "agent:live"],
    ["pnpm", "test:attachments:source-product-live"],
    ["pnpm", "test:browser:live-stability"],
    ["pnpm", "auth:profile"],
    ["pnpm", "docker:reset"],
  ];
  for (const command of promptCommands) {
    const result = policy(command);
    if (result.decision !== "prompt") {
      throw new Error(
        `Expected execpolicy prompt for ${command.join(" ")}, received ${result.decision ?? "no decision"}.`,
      );
    }
  }

  const sandboxGovernedCommands = [
    ["git", "status", "--short"],
    ["git", "diff", "--check"],
    ["git", "log", "-1"],
    ["git", "worktree", "list", "--porcelain"],
    ["git", "add", "source.ts"],
    ["pnpm", "test"],
  ];
  for (const command of sandboxGovernedCommands) {
    const result = policy(command);
    if (result.decision !== undefined || result.matchedRules?.length !== 0) {
      throw new Error(
        `Expected no execpolicy override for ${command.join(" ")}.`,
      );
    }
  }

  const isolatedHome = mkdtempSync(join(tmpdir(), "rove-codex-check-"));
  try {
    const projectRoot = resolve(process.cwd());
    const tomlRoot = projectRoot
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"');
    writeFileSync(
      join(isolatedHome, "config.toml"),
      `[projects."${tomlRoot}"]\ntrust_level = "trusted"\n`,
    );
    const isolatedEnvironment = { ...process.env, CODEX_HOME: isolatedHome };
    const features = execFileSync(
      "codex",
      ["-C", projectRoot, "features", "list"],
      { encoding: "utf8", env: isolatedEnvironment },
    );
    if (!/^hooks\s+stable\s+false$/m.test(features)) {
      throw new Error(
        "Installed Codex did not apply the repository hooks=false setting.",
      );
    }
    const promptInput = execFileSync(
      "codex",
      ["-C", projectRoot, "debug", "prompt-input", "Inspect Rove."],
      { encoding: "utf8", env: isolatedEnvironment, maxBuffer: 10_000_000 },
    );
    for (const discovered of [
      "- rove-engineering:",
      "(file: r1/rove-engineering/SKILL.md)",
      "Ordinary feature and bug work must not modify",
    ]) {
      if (!promptInput.includes(discovered)) {
        throw new Error(`Installed Codex did not discover: ${discovered}`);
      }
    }
  } finally {
    rmSync(isolatedHome, { recursive: true, force: true });
  }
  process.stdout.write(`Installed client: ${version}\n`);
  process.stdout.write(
    `Installed semantics: ${promptCommands.length} prompt rules; ${sandboxGovernedCommands.length} sandbox-governed commands; project config, AGENTS.md, and skill catalog discovered.\n`,
  );
}

process.stdout.write(
  `Codex environment checks passed: ${required.length} files.\n`,
);
