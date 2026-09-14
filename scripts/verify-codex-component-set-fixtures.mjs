import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  componentPaths,
  compiledSchemaBinding,
  installQualifiedComponent,
  promoteComponentSelection,
  readCompiledSchemaBindings,
  readComponentManifest,
  repositoryRoot,
  selectedComponent,
  sha256,
  verifyCompiledSchemaBinding,
  verifyComponentDirectory,
  writeComponentManifestAtomically,
} from "./codex-component-lib.mjs";
import {
  stageCodexComponentSet,
  verifyCodexCodeModeHost,
  verifyCodexComponentSet,
} from "./package-desktop.mjs";

const root = await mkdtemp(join(tmpdir(), "rove-codex-components-"));
try {
  const manifest = await readComponentManifest();
  const schemaBindings = await readCompiledSchemaBindings();
  for (const source of [
    "apps/companion/src/main/main.ts",
    "scripts/package-desktop.mjs",
  ]) {
    const sourceText = await readFile(join(repositoryRoot, source), "utf8");
    assert.doesNotMatch(
      sourceText,
      /\/Applications\/ChatGPT|ROVE_CODEX_EXECUTABLE/,
    );
  }

  const selected = selectedComponent(manifest);
  assert.equal(selected.cliVersion, "0.154.0-alpha.6.2");
  await verifyCompiledSchemaBinding(selected, schemaBindings);
  const retained = manifest.components.find(
    (entry) => entry.status === "retained-qualified",
  );
  assert.ok(
    retained,
    "A retained qualified component is required for rollback.",
  );
  await verifyCompiledSchemaBinding(retained, schemaBindings);

  const manifestPath = join(root, "approved-components.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeComponentManifestAtomically(
    manifestPath,
    promoteComponentSelection(manifest, retained.id, schemaBindings),
  );
  const rolledBackManifest = await readComponentManifest(manifestPath);
  assert.equal(
    selectedComponent(rolledBackManifest).id,
    retained.id,
    "Rollback must durably select the retained qualified identity.",
  );
  assert.equal(
    compiledSchemaBinding(selectedComponent(rolledBackManifest), schemaBindings)
      .filename,
    retained.schema.filename,
    "Rollback must select the retained component's matching compiled schema.",
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
        schemaBindings,
      ),
    /has not passed qualification/,
  );
  assert.throws(
    () =>
      promoteComponentSelection(
        {
          ...manifest,
          components: manifest.components.map((entry) =>
            entry.id === retained.id
              ? {
                  ...entry,
                  schema: { ...entry.schema, sha256: "mismatched-schema" },
                }
              : entry,
          ),
        },
        retained.id,
        schemaBindings,
      ),
    /does not match its compiled schema binding/,
  );

  const sourceRoot = join(root, "explicit-candidate");
  const managedRoot = join(root, "managed");
  const schemaRoot = join(root, "schemas");
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(schemaRoot, { recursive: true }),
  ]);
  const executable = join(sourceRoot, "codex");
  const helper = join(sourceRoot, "codex-code-mode-host");
  const schemaFilename = "fixture.schemas.generated.json";
  const schemaPath = join(schemaRoot, schemaFilename);
  const schemaContents = `${JSON.stringify({ generatedBy: "Codex App Server generate-ts 9.8.7-qualified --experimental", roots: {}, $defs: {} }, null, 2)}\n`;
  await Promise.all([
    writeFile(executable, "#!/bin/sh\necho 'codex-cli 9.8.7-qualified'\n"),
    writeFile(helper, "#!/bin/sh\necho 'Usage: codex-code-mode-host'\n"),
    writeFile(schemaPath, schemaContents),
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
    historyMode: "legacy",
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
      filename: schemaFilename,
      sha256: await sha256(schemaPath),
      aggregateSha256: "fixture-aggregate",
    },
    qualification: {
      isolatedAppServerLifecycle: true,
      liveModelTurn: false,
    },
  };
  const fixtureBindings = {
    schemaVersion: 1,
    bindings: [
      {
        componentId: component.id,
        ...component.schema,
        historyMode: component.historyMode,
      },
    ],
  };
  await verifyCompiledSchemaBinding(component, fixtureBindings, schemaRoot);
  await writeFile(schemaPath, `${schemaContents} `);
  await assert.rejects(
    verifyCompiledSchemaBinding(component, fixtureBindings, schemaRoot),
    /schema digest does not match/,
  );
  await writeFile(schemaPath, schemaContents);

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
  const fixtureManifestPath = join(root, "fixture-approved-components.json");
  const fixtureManifest = {
    schemaVersion: 2,
    component: "codex-app-server",
    selection: "not-selected",
    components: [component],
  };
  await writeFile(
    fixtureManifestPath,
    `${JSON.stringify(fixtureManifest, null, 2)}\n`,
  );
  await writeComponentManifestAtomically(
    fixtureManifestPath,
    promoteComponentSelection(fixtureManifest, component.id, fixtureBindings),
  );
  const selectedFixtureComponent = selectedComponent(
    await readComponentManifest(fixtureManifestPath),
  );
  const installed = componentPaths(managedRoot, selectedFixtureComponent);
  await verifyComponentDirectory(installed.directory, selectedFixtureComponent);
  const verified = await verifyCodexComponentSet({
    root: managedRoot,
    component: selectedFixtureComponent,
    schemaBindings: fixtureBindings,
    schemaRoot,
  });

  const stagedRoot = join(root, "staged-codex");
  await stageCodexComponentSet(verified, {
    component: selectedFixtureComponent,
    destinationRoot: stagedRoot,
  });
  const [stagedExecutable, stagedHelper, compatibility] = await Promise.all([
    stat(join(stagedRoot, "codex")),
    stat(join(stagedRoot, component.codeModeHost.filename)),
    readFile(join(stagedRoot, "compatibility.json"), "utf8").then(JSON.parse),
  ]);
  assert.notEqual(stagedExecutable.mode & 0o111, 0);
  assert.notEqual(stagedHelper.mode & 0o111, 0);
  assert.equal(compatibility.componentId, component.id);
  assert.deepEqual(compatibility.schema, component.schema);
  assert.equal(
    await sha256(join(stagedRoot, "codex")),
    component.executable.sha256,
  );

  await writeFile(installed.codeModeHost, "changed helper");
  await assert.rejects(
    verifyComponentDirectory(installed.directory, component),
    /size does not match|digest does not match/,
  );
  await assert.rejects(
    verifyCodexCodeModeHost(
      join(root, "missing-code-mode-host"),
      component.codeModeHost,
      component.id,
    ),
    /code-mode host is unavailable/,
  );

  process.stdout.write(
    "Codex component selection, compiled schema, rollback, resolver, staging, verification, and tamper fixtures passed.\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
