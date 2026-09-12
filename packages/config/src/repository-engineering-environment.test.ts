import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

  test("reports safe context without reading user configuration", () => {
    const output = execFileSync(
      process.execPath,
      [".agents/skills/rove-engineering/scripts/context-snapshot.mjs"],
      { cwd: root, encoding: "utf8" },
    );
    expect(output).toContain("Rove engineering context");
    expect(output).toContain("authority: docs/README.md");
    expect(output).toContain("live model, real-account browser");
    expect(output).not.toContain("CODEX_HOME");
    expect(output).not.toContain("auth.json");
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
});
