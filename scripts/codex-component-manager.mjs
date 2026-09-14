#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import {
  componentPaths,
  componentManifestPath,
  createQualificationReceipt,
  defaultManagedCodexRoot,
  inspectExternalCandidate,
  installQualifiedComponent,
  qualificationEvidencePath,
  readComponentManifest,
  repositoryRoot,
  selectedComponent,
  promoteComponentSelection,
  readCompiledSchemaBindings,
  verifyComponentDirectory,
  verifyCompiledSchemaBinding,
  verifyPromotableComponentSet,
  writeComponentManifestAtomically,
} from "./codex-component-lib.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function run(command, args, environment = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`${command} ${args.join(" ")} exited ${code}.`)),
    );
  });
}

const command = process.argv[2];
if (command === "promote" && process.argv.includes("--purpose"))
  throw new Error(
    "Codex promotion selects one coherent development and packaging component set; --purpose is not supported.",
  );
const manifest = await readComponentManifest();
const schemaBindings = await readCompiledSchemaBindings();
const component = argument("--component")
  ? manifest.components.find((entry) => entry.id === argument("--component"))
  : selectedComponent(manifest);
if (!component)
  throw new Error("Requested qualified Codex component is not registered.");

if (command === "inspect") {
  const source = argument("--source");
  if (!source) throw new Error("inspect requires --source <codex executable>.");
  process.stdout.write(
    `${JSON.stringify(await inspectExternalCandidate(source), null, 2)}\n`,
  );
} else if (command === "qualify") {
  const source = argument("--source");
  if (!source) throw new Error("qualify requires --source <codex executable>.");
  const candidate = await inspectExternalCandidate(source);
  if (
    candidate.executable.sha256 !== component.executable.sha256 ||
    candidate.codeModeHost.sha256 !== component.codeModeHost.sha256
  )
    throw new Error(
      `Candidate is not registered as qualified component ${component.id}; qualification cannot promote an unknown digest.`,
    );
  await run("pnpm", ["agent:schema"], {
    ROVE_CODEX_EXECUTABLE: resolve(source),
  });
  await verifyCompiledSchemaBinding(component, schemaBindings);
  await run(
    process.execPath,
    ["experiments/agent-execution/live-app-server.mjs", "--mcp-boundary"],
    { ROVE_CODEX_EXECUTABLE: resolve(source) },
  );
  const evidencePath = qualificationEvidencePath(component);
  const evidenceRoot = dirname(evidencePath);
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(
    evidencePath,
    `${JSON.stringify(createQualificationReceipt(component, candidate, new Date().toISOString()), null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(
    `Qualified ${component.id}. Evidence: ${evidencePath}\n`,
  );
} else if (command === "install") {
  const source = argument("--source");
  if (!source) throw new Error("install requires --source <codex executable>.");
  const result = await installQualifiedComponent(source, component);
  process.stdout.write(
    `Installed ${result.component.id} at ${defaultManagedCodexRoot()}.\n`,
  );
} else if (command === "verify") {
  const paths = componentPaths(defaultManagedCodexRoot(), component);
  const result = await verifyComponentDirectory(paths.directory, component);
  process.stdout.write(
    `${JSON.stringify({ status: "ready", componentId: result.component.id, executable: result.executable }, null, 2)}\n`,
  );
} else if (command === "promote") {
  const componentId = argument("--component");
  if (!componentId)
    throw new Error("promote requires --component <qualified-component-id>.");
  const promotionComponent = manifest.components.find(
    (entry) => entry.id === componentId,
  );
  if (!promotionComponent)
    throw new Error(
      `Qualified Codex component ${componentId} is not registered.`,
    );
  await verifyPromotableComponentSet(manifest, schemaBindings);
  const promoted = promoteComponentSelection(
    manifest,
    componentId,
    schemaBindings,
  );
  await writeComponentManifestAtomically(componentManifestPath, promoted);
  process.stdout.write(`Promoted coherent component set ${componentId}.\n`);
} else {
  throw new Error(
    "Usage: codex-component-manager.mjs <inspect|qualify|install|verify|promote> [--source <path>] [--component <id>]",
  );
}
