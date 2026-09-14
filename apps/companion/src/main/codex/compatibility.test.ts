import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APPROVED_CODEX_CLI_VERSION,
  CodexExecutableResolver,
  approvedCodexBaseline,
} from "./compatibility.js";

describe("approved Codex component resolution", () => {
  let root: string;
  let executable: string;
  let helper: string;
  const baseline = approvedCodexBaseline("development");

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "rove-codex-resolver-"));
    executable = join(root, "codex");
    helper = join(root, baseline.codeModeHostFilename);
    await Promise.all([
      writeFile(executable, "qualified executable"),
      writeFile(helper, "qualified helper"),
    ]);
    await Promise.all([chmod(executable, 0o755), chmod(helper, 0o755)]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function resolver(overrides: Record<string, unknown> = {}) {
    return new CodexExecutableResolver({
      isPackaged: false,
      developmentExecutablePath: executable,
      developmentCodeModeHostPath: helper,
      platform: "darwin",
      architecture: "arm64",
      readVersion: async () => APPROVED_CODEX_CLI_VERSION,
      hashFile: async (path) =>
        path === executable
          ? baseline.executableSha256
          : baseline.codeModeHostSha256,
      fileSize: async () => baseline.codeModeHostBytes,
      ...overrides,
    });
  }

  it("resolves only the exact selected executable and helper set", async () => {
    await expect(resolver().resolve()).resolves.toMatchObject({
      executablePath: executable,
      codeModeHostPath: helper,
      baseline: { id: baseline.id },
      source: "development",
    });
  });

  it("gives an actionable error when the managed component is absent", async () => {
    const missing = new CodexExecutableResolver({ isPackaged: false });
    await expect(missing.resolve()).rejects.toThrow(/codex:component:install/);
    await rm(executable);
    await expect(resolver().resolve()).rejects.toThrow(
      /codex:component:install/,
    );
  });

  it("rejects an unapproved external version even at a configured path", async () => {
    await expect(
      resolver({ readVersion: async () => "99.0.0-candidate" }).resolve(),
    ).rejects.toMatchObject({ code: "unsupported_version" });
  });

  it("rejects changed executable and helper identities independently", async () => {
    await expect(
      resolver({ hashFile: async () => "changed" }).resolve(),
    ).rejects.toMatchObject({ code: "executable_digest_mismatch" });
    await expect(
      resolver({
        hashFile: async (path: string) =>
          path === executable ? baseline.executableSha256 : "changed",
      }).resolve(),
    ).rejects.toMatchObject({ code: "component_set_mismatch" });
  });

  it("rejects a missing helper after verifying the executable", async () => {
    await rm(helper);
    await expect(resolver().resolve()).rejects.toMatchObject({
      code: "component_set_mismatch",
    });
  });
});
