import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  componentPaths,
  installQualifiedComponent,
  promoteComponentSelection,
  readComponentManifest,
  repositoryRoot,
  selectedComponent,
  sha256,
  verifyComponentDirectory,
} from "./codex-component-lib.mjs";
import {
  verifyCodexCodeModeHost,
  verifyCodexComponentSet,
} from "./package-desktop.mjs";

const root = await mkdtemp(join(tmpdir(), "rove-codex-components-"));
try {
  const manifest = await readComponentManifest();
  for (const source of [
    "apps/companion/src/main/main.ts",
    "scripts/package-desktop.mjs",
  ]) {
    const text = await readFile(join(repositoryRoot, source), "utf8");
    assert.doesNotMatch(text, /\/Applications\/ChatGPT|ROVE_CODEX_EXECUTABLE/);
  }
  const development = selectedComponent(manifest, "development");
  const packaging = selectedComponent(manifest, "packaging");
  assert.equal(development.id, packaging.id);
  assert.equal(development.cliVersion, "0.154.0-alpha.6.2");
  const retained = manifest.components.find(
    (entry) => entry.status === "retained-qualified",
  );
  assert.ok(
    retained,
    "A retained qualified component is required for rollback.",
  );
  assert.equal(
    selectedComponent(
      {
        ...manifest,
        selections: { ...manifest.selections, development: retained.id },
      },
      "development",
    ).id,
    retained.id,
    "Rollback must be a selection change to a retained qualified identity.",
  );
  assert.throws(
    () =>
      promoteComponentSelection(
        {
          ...manifest,
          components: [
            ...manifest.components,
            { id: "unqualified", status: "qualification-candidate" },
          ],
        },
        "unqualified",
        ["development"],
      ),
    /has not passed qualification/,
  );

  const sourceRoot = join(root, "explicit-candidate");
  const managedRoot = join(root, "managed");
  await mkdir(sourceRoot, { recursive: true });
  const executable = join(sourceRoot, "codex");
  const helper = join(sourceRoot, "codex-code-mode-host");
  await Promise.all([
    writeFile(executable, "#!/bin/sh\necho 'codex-cli 9.8.7-qualified'\n"),
    writeFile(helper, "#!/bin/sh\necho 'Usage: codex-code-mode-host'\n"),
  ]);
  await Promise.all([chmod(executable, 0o755), chmod(helper, 0o755)]);
  const [executableBytes, helperBytes] = await Promise.all([
    readFile(executable),
    readFile(helper),
  ]);
  const component = {
    id: "codex-fixture-qualified",
    status: "qualified",
    cliVersion: "9.8.7-qualified",
    platformOs:
      process.platform === "darwin"
        ? "macos"
        : process.platform === "win32"
          ? "windows"
          : "linux",
    nodePlatform: process.platform,
    architecture: process.arch,
    executable: {
      filename: "codex",
      sha256: await sha256(executable),
      bytes: executableBytes.length,
    },
    codeModeHost: {
      filename: "codex-code-mode-host",
      sha256: await sha256(helper),
      bytes: helperBytes.length,
    },
    schema: {
      filename: "fixture.json",
      sha256: "fixture",
      aggregateSha256: "fixture",
    },
    qualification: {
      isolatedAppServerLifecycle: true,
      liveModelTurn: false,
    },
  };

  await assert.rejects(
    installQualifiedComponent(
      executable,
      {
        ...component,
        executable: { ...component.executable, sha256: "unapproved" },
      },
      managedRoot,
    ),
    /does not match qualified component/,
  );

  await installQualifiedComponent(executable, component, managedRoot);
  const installed = componentPaths(managedRoot, component);
  await verifyComponentDirectory(installed.directory, component);
  await verifyCodexComponentSet({ root: managedRoot, component });

  await writeFile(installed.codeModeHost, "changed helper");
  await assert.rejects(
    verifyComponentDirectory(installed.directory, component),
    /size does not match|digest does not match/,
  );
  await assert.rejects(
    verifyCodexCodeModeHost(
      join(root, "missing-code-mode-host"),
      component.codeModeHost,
    ),
    /code-mode host is unavailable/,
  );

  process.stdout.write(
    "Codex candidate, install, resolver, package-source, tamper, promotion, and rollback fixtures passed.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
