import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "../../..");

describe("repository-owned engineering agent environment", () => {
  test("validates its checked-in surfaces", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/check-codex-environment.mjs"], {
        cwd: root,
        encoding: "utf8",
      }),
    ).not.toThrow();
  });

  test("reports context without optional locks or repository writes", () => {
    const script = resolve(
      root,
      ".agents/skills/rove-engineering/scripts/context-snapshot.mjs",
    );
    expect(readFileSync(script, "utf8")).toContain('"--no-optional-locks"');

    const temporaryRepository = mkdtempSync(
      resolve(tmpdir(), "rove-context-test-"),
    );
    try {
      writeFileSync(
        resolve(temporaryRepository, "package.json"),
        JSON.stringify({
          scripts: {
            "check:repository": "true",
            typecheck: "true",
            build: "true",
            test: "true",
            "test:experiments": "true",
          },
        }),
      );
      execFileSync("git", ["init", "--quiet"], { cwd: temporaryRepository });
      execFileSync("git", ["add", "package.json"], {
        cwd: temporaryRepository,
      });
      execFileSync("git", ["commit", "--quiet", "-m", "fixture"], {
        cwd: temporaryRepository,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Rove Test",
          GIT_AUTHOR_EMAIL: "rove-test@example.invalid",
          GIT_COMMITTER_NAME: "Rove Test",
          GIT_COMMITTER_EMAIL: "rove-test@example.invalid",
        },
      });
      const indexPath = resolve(
        temporaryRepository,
        execFileSync("git", ["rev-parse", "--git-path", "index"], {
          cwd: temporaryRepository,
          encoding: "utf8",
        }).trim(),
      );
      const filesBefore = readdirSync(temporaryRepository, {
        recursive: true,
      }).sort();
      const indexMtimeBefore = statSync(indexPath, { bigint: true }).mtimeNs;

      const output = execFileSync(process.execPath, [script], {
        cwd: temporaryRepository,
        encoding: "utf8",
      });

      expect(output).toContain("Rove engineering context");
      expect(output).toContain("authority: docs/README.md");
      expect(output).toContain("live model, real-account browser");
      expect(output).not.toContain("CODEX_HOME");
      expect(output).not.toContain("auth.json");
      expect(statSync(indexPath, { bigint: true }).mtimeNs).toBe(
        indexMtimeBefore,
      );
      expect(
        readdirSync(temporaryRepository, { recursive: true }).sort(),
      ).toEqual(filesBefore);
      expect(
        existsSync(
          resolve(temporaryRepository, "artifacts/engineering-continuation.md"),
        ),
      ).toBe(false);
    } finally {
      rmSync(temporaryRepository, { recursive: true, force: true });
    }
  });

  test("keeps continuation notes out of canonical documentation", () => {
    const ignore = readFileSync(resolve(root, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^artifacts\/$/m);
    const continuation = readFileSync(
      resolve(
        root,
        ".agents/skills/rove-engineering/references/continuation.md",
      ),
      "utf8",
    );
    expect(continuation).toContain("artifacts/engineering-continuation.md");
  });

  test("keeps one bounded skill with progressive governance references", () => {
    const skillRoot = resolve(root, ".agents/skills");
    const topLevelSkills = readdirSync(skillRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(topLevelSkills).toEqual(["rove-engineering"]);

    const skill = readFileSync(
      resolve(skillRoot, "rove-engineering/SKILL.md"),
      "utf8",
    );
    expect(skill.split("\n").length).toBeLessThanOrEqual(110);
    for (const reference of [
      "design-judgment.md",
      "independent-review.md",
      "parallel-execution.md",
    ]) {
      expect(skill).toContain(`references/${reference}`);
      expect(
        existsSync(
          resolve(skillRoot, "rove-engineering/references", reference),
        ),
      ).toBe(true);
    }
    expect(skill).toContain("Codex owns normal technical architecture");
    expect(skill).toContain("Ordinary feature and bug work must not edit");
  });

  test("documents validation strength without overclaiming activation", () => {
    const documentation = readFileSync(
      resolve(root, "docs/Engineering/engineering-agent-environment.md"),
      "utf8",
    );
    for (const category of [
      "Automatically checked",
      "Structurally checked",
      "Manually inspected",
      "Intentionally deferred",
    ]) {
      expect(documentation).toContain(category);
    }
    expect(documentation).toContain(
      "does not prove that implicit skill activation improves a real task",
    );
    expect(documentation).not.toContain(
      "proves native memory behavior, hook runtime behavior, or subagent usefulness",
    );
  });
});
