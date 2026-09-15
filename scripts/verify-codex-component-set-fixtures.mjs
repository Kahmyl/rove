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
  createQualificationReceipt,
  inspectExternalCandidate,
  installQualifiedComponent,
  promoteComponentSelection,
  readCompiledSchemaBindings,
  readComponentManifest,
  repositoryRoot,
  selectedComponent,
  sha256,
  verifyCompiledSchemaBinding,
  verifyComponentDirectory,
  verifyPromotableComponentSet,
  verifyQualificationReceipt,
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
  const durabilitySteps = [];
  await writeComponentManifestAtomically(
    manifestPath,
    promoteComponentSelection(manifest, retained.id, schemaBindings),
    { onDurabilityStep: (step) => durabilitySteps.push(step) },
  );
  assert.deepEqual(durabilitySteps, [
    "temporary-synced",
    "renamed",
    "parent-synced",
  ]);
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
  const schemaContents = `${JSON.stringify({ generatedBy: "Codex App Server generate-ts 9.8.7-qualified --experimental", generatedTsAggregateSha256: "fixture-generated-ts", roots: {}, $defs: {} }, null, 2)}\n`;
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
      compiledRuntimeSha256: await sha256(schemaPath),
      aggregateSha256: "fixture-aggregate",
      generatedTsAggregateSha256: "fixture-generated-ts",
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
      join(root, "missing-qualification.json"),
    ),
    /does not match qualified component|qualification receipt is unavailable/,
  );
  await assert.rejects(
    installQualifiedComponent(
      executable,
      component,
      managedRoot,
      join(root, "missing-qualification.json"),
    ),
    /qualification receipt is unavailable/,
  );

  const receiptPath = join(root, "qualification.json");
  const receipt = createQualificationReceipt(
    component,
    await inspectExternalCandidate(executable),
    "2026-09-14T00:00:00.000Z",
  );
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await verifyQualificationReceipt(receiptPath, component);
  const mismatchedReceiptPath = join(root, "mismatched-qualification.json");
  await writeFile(
    mismatchedReceiptPath,
    `${JSON.stringify({ ...receipt, schema: { ...receipt.schema, sha256: "wrong" } }, null, 2)}\n`,
  );
  await assert.rejects(
    installQualifiedComponent(
      executable,
      component,
      managedRoot,
      mismatchedReceiptPath,
    ),
    /qualification receipt does not match/,
  );

  await installQualifiedComponent(
    executable,
    component,
    managedRoot,
    receiptPath,
  );
  const installedReceiptBefore = await readFile(
    componentPaths(managedRoot, component).receipt,
    "utf8",
  );
  await installQualifiedComponent(
    executable,
    component,
    managedRoot,
    receiptPath,
  );
  assert.equal(
    await readFile(componentPaths(managedRoot, component).receipt, "utf8"),
    installedReceiptBefore,
    "An exact immutable install must be idempotent.",
  );

  const legacyReceipt = {
    componentId: component.id,
    installedAt: "2026-09-12T00:00:00.000Z",
    sourceDigests: {
      executable: component.executable.sha256,
      codeModeHost: component.codeModeHost.sha256,
    },
  };
  const installedPaths = componentPaths(managedRoot, component);
  const binaryInodes = {
    executable: (await stat(installedPaths.executable)).ino,
    codeModeHost: (await stat(installedPaths.codeModeHost)).ino,
  };
  await writeFile(
    installedPaths.receipt,
    `${JSON.stringify(legacyReceipt, null, 2)}\n`,
  );
  const receiptDurabilitySteps = [];
  await installQualifiedComponent(
    executable,
    component,
    managedRoot,
    receiptPath,
    {
      onReceiptDurabilityStep: (step) => receiptDurabilitySteps.push(step),
    },
  );
  assert.deepEqual(receiptDurabilitySteps, [
    "temporary-synced",
    "renamed",
    "parent-synced",
  ]);
  await verifyQualificationReceipt(installedPaths.receipt, component);
  assert.deepEqual(
    {
      executable: (await stat(installedPaths.executable)).ino,
      codeModeHost: (await stat(installedPaths.codeModeHost)).ino,
    },
    binaryInodes,
    "Legacy receipt migration must not replace immutable binaries.",
  );
  await rm(installedPaths.receipt);
  await installQualifiedComponent(
    executable,
    component,
    managedRoot,
    receiptPath,
  );
  await verifyQualificationReceipt(installedPaths.receipt, component);
  assert.deepEqual(
    {
      executable: (await stat(installedPaths.executable)).ino,
      codeModeHost: (await stat(installedPaths.codeModeHost)).ino,
    },
    binaryInodes,
    "Missing receipt recovery must not replace immutable binaries.",
  );

  await writeFile(
    installedPaths.receipt,
    `${JSON.stringify({ ...legacyReceipt, sourceDigests: { ...legacyReceipt.sourceDigests, executable: "wrong" } }, null, 2)}\n`,
  );
  const mismatchedLegacyReceipt = await readFile(
    installedPaths.receipt,
    "utf8",
  );
  await assert.rejects(
    installQualifiedComponent(executable, component, managedRoot, receiptPath),
    /already exists but conflicts/,
  );
  assert.equal(
    await readFile(installedPaths.receipt, "utf8"),
    mismatchedLegacyReceipt,
    "A conflicting legacy receipt must remain unchanged.",
  );
  await writeFile(installedPaths.receipt, installedReceiptBefore);

  const conflictRoot = join(root, "managed-conflict");
  const conflict = componentPaths(conflictRoot, component);
  await mkdir(conflict.directory, { recursive: true });
  await writeFile(join(conflict.directory, "sentinel"), "preserve me");
  await assert.rejects(
    installQualifiedComponent(executable, component, conflictRoot, receiptPath),
    /already exists but conflicts/,
  );
  assert.equal(
    await readFile(join(conflict.directory, "sentinel"), "utf8"),
    "preserve me",
  );

  const renameFailureRoot = join(root, "managed-rename-failure");
  await assert.rejects(
    installQualifiedComponent(
      executable,
      component,
      renameFailureRoot,
      receiptPath,
      {
        renameDirectory: async () => {
          throw new Error("injected rename failure");
        },
      },
    ),
    /injected rename failure/,
  );
  await assert.rejects(
    stat(componentPaths(renameFailureRoot, component).directory),
  );
  await assert.rejects(
    stat(
      `${componentPaths(renameFailureRoot, component).directory}.installing-${process.pid}`,
    ),
  );

  const receiptRenameFailureRoot = join(root, "managed-receipt-failure");
  await installQualifiedComponent(
    executable,
    component,
    receiptRenameFailureRoot,
    receiptPath,
  );
  const receiptRenameFailurePaths = componentPaths(
    receiptRenameFailureRoot,
    component,
  );
  const legacyReceiptText = `${JSON.stringify(legacyReceipt, null, 2)}\n`;
  await writeFile(receiptRenameFailurePaths.receipt, legacyReceiptText);
  const failureBinaryInodes = {
    executable: (await stat(receiptRenameFailurePaths.executable)).ino,
    codeModeHost: (await stat(receiptRenameFailurePaths.codeModeHost)).ino,
  };
  await assert.rejects(
    installQualifiedComponent(
      executable,
      component,
      receiptRenameFailureRoot,
      join(root, "missing-qualification.json"),
    ),
    /qualification receipt is unavailable/,
  );
  assert.equal(
    await readFile(receiptRenameFailurePaths.receipt, "utf8"),
    legacyReceiptText,
    "A legacy receipt must not migrate without new qualification evidence.",
  );
  await assert.rejects(
    installQualifiedComponent(
      executable,
      component,
      receiptRenameFailureRoot,
      mismatchedReceiptPath,
    ),
    /qualification receipt does not match/,
  );
  assert.equal(
    await readFile(receiptRenameFailurePaths.receipt, "utf8"),
    legacyReceiptText,
    "Mismatched schema evidence must not migrate a legacy receipt.",
  );
  await assert.rejects(
    installQualifiedComponent(
      executable,
      component,
      receiptRenameFailureRoot,
      receiptPath,
      {
        renameReceipt: async () => {
          throw new Error("injected receipt rename failure");
        },
      },
    ),
    /injected receipt rename failure/,
  );
  assert.equal(
    await readFile(receiptRenameFailurePaths.receipt, "utf8"),
    legacyReceiptText,
    "A failed receipt upgrade must preserve the preceding receipt.",
  );
  await assert.rejects(
    stat(`${receiptRenameFailurePaths.receipt}.upgrading-${process.pid}`),
  );
  assert.deepEqual(
    {
      executable: (await stat(receiptRenameFailurePaths.executable)).ino,
      codeModeHost: (await stat(receiptRenameFailurePaths.codeModeHost)).ino,
    },
    failureBinaryInodes,
    "A failed receipt upgrade must not replace immutable binaries.",
  );
  await writeFile(receiptRenameFailurePaths.codeModeHost, "tampered helper");
  await assert.rejects(
    installQualifiedComponent(
      executable,
      component,
      receiptRenameFailureRoot,
      receiptPath,
    ),
    /already exists but conflicts/,
  );
  assert.equal(
    await readFile(receiptRenameFailurePaths.receipt, "utf8"),
    legacyReceiptText,
    "A binary conflict must not migrate the legacy receipt.",
  );

  const retainedSchemaFilename = "retained-fixture.schemas.generated.json";
  const retainedSchemaPath = join(schemaRoot, retainedSchemaFilename);
  await writeFile(retainedSchemaPath, schemaContents);
  const retainedComponent = {
    ...component,
    id: "codex-fixture-retained-qualified",
    status: "retained-qualified",
    schema: { ...component.schema, filename: retainedSchemaFilename },
  };
  fixtureBindings.bindings.push({
    componentId: retainedComponent.id,
    ...retainedComponent.schema,
    historyMode: retainedComponent.historyMode,
  });
  const retainedReceiptPath = join(root, "retained-qualification.json");
  await writeFile(
    retainedReceiptPath,
    `${JSON.stringify(createQualificationReceipt(retainedComponent, await inspectExternalCandidate(executable), "2026-09-13T00:00:00.000Z"), null, 2)}\n`,
  );
  await installQualifiedComponent(
    executable,
    retainedComponent,
    managedRoot,
    retainedReceiptPath,
  );
  await writeFile(installedPaths.receipt, legacyReceiptText);
  await rm(componentPaths(managedRoot, retainedComponent).receipt);
  await installQualifiedComponent(
    executable,
    component,
    managedRoot,
    receiptPath,
  );
  await installQualifiedComponent(
    executable,
    retainedComponent,
    managedRoot,
    retainedReceiptPath,
  );
  const fixtureManifestPath = join(root, "fixture-approved-components.json");
  const fixtureManifest = {
    schemaVersion: 2,
    component: "codex-app-server",
    selection: "not-selected",
    components: [component, retainedComponent],
  };
  await verifyPromotableComponentSet(
    fixtureManifest,
    fixtureBindings,
    managedRoot,
    schemaRoot,
  );
  const retainedInstalled = componentPaths(managedRoot, retainedComponent);
  const retainedReceipt = await readFile(retainedInstalled.receipt, "utf8");
  await writeFile(
    retainedInstalled.receipt,
    `${JSON.stringify({ ...JSON.parse(retainedReceipt), compatibility: { ...JSON.parse(retainedReceipt).compatibility, mcpBoundary: false } }, null, 2)}\n`,
  );
  await assert.rejects(
    verifyPromotableComponentSet(
      fixtureManifest,
      fixtureBindings,
      managedRoot,
      schemaRoot,
    ),
    /qualification receipt does not match/,
  );
  await writeFile(retainedInstalled.receipt, retainedReceipt);
  const retainedHelperBytes = await readFile(retainedInstalled.codeModeHost);
  await writeFile(retainedInstalled.codeModeHost, "tampered retained helper");
  await assert.rejects(
    verifyPromotableComponentSet(
      fixtureManifest,
      fixtureBindings,
      managedRoot,
      schemaRoot,
    ),
    /size does not match|digest does not match/,
  );
  await writeFile(retainedInstalled.codeModeHost, retainedHelperBytes);
  await chmod(retainedInstalled.codeModeHost, 0o755);
  await rm(retainedInstalled.executable);
  await assert.rejects(
    verifyPromotableComponentSet(
      fixtureManifest,
      fixtureBindings,
      managedRoot,
      schemaRoot,
    ),
    /executable is unavailable/,
  );
  await writeFile(retainedInstalled.executable, executableBytes);
  await chmod(retainedInstalled.executable, 0o755);
  await rm(retainedSchemaPath);
  await assert.rejects(
    verifyPromotableComponentSet(
      fixtureManifest,
      fixtureBindings,
      managedRoot,
      schemaRoot,
    ),
    /schema is unavailable/,
  );
  await writeFile(retainedSchemaPath, schemaContents);
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
  await writeComponentManifestAtomically(
    fixtureManifestPath,
    promoteComponentSelection(
      fixtureManifest,
      retainedComponent.id,
      fixtureBindings,
    ),
  );
  assert.equal(
    selectedComponent(await readComponentManifest(fixtureManifestPath)).id,
    retainedComponent.id,
    "The requalified retained set must remain available for whole-set rollback.",
  );

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
