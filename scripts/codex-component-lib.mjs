import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const componentManifestPath = join(
  repositoryRoot,
  "apps/companion/src/main/codex/approved-components.json",
);

export async function readComponentManifest() {
  return JSON.parse(await readFile(componentManifestPath, "utf8"));
}

export function selectedComponent(manifest, purpose = "development") {
  const id = manifest.selections?.[purpose];
  const component = manifest.components?.find((entry) => entry.id === id);
  if (!component)
    throw new Error(
      `Approved Codex ${purpose} selection ${String(id)} is missing.`,
    );
  return component;
}

export function promoteComponentSelection(manifest, componentId, purposes) {
  const component = manifest.components?.find(
    (entry) => entry.id === componentId,
  );
  if (
    !component ||
    !["qualified", "retained-qualified"].includes(component.status)
  )
    throw new Error(
      `Codex component ${componentId} has not passed qualification.`,
    );
  const selectedPurposes =
    purposes.length === 0 ? ["development", "packaging"] : purposes;
  for (const purpose of selectedPurposes) {
    if (!Object.hasOwn(manifest.selections, purpose))
      throw new Error(`Unknown Codex component selection purpose ${purpose}.`);
  }
  return {
    ...manifest,
    selections: Object.fromEntries(
      Object.entries(manifest.selections).map(([purpose, id]) => [
        purpose,
        selectedPurposes.includes(purpose) ? componentId : id,
      ]),
    ),
  };
}

export function defaultManagedCodexRoot() {
  const override = process.env.ROVE_CODEX_COMPONENTS_HOME?.trim();
  if (override) {
    if (!isAbsolute(override))
      throw new Error("ROVE_CODEX_COMPONENTS_HOME must be an absolute path.");
    return resolve(override);
  }
  if (process.platform === "darwin")
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Rove",
      "components",
      "codex",
    );
  if (process.platform === "win32")
    return join(
      process.env.LOCALAPPDATA ?? homedir(),
      "Rove",
      "components",
      "codex",
    );
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
    "rove",
    "components",
    "codex",
  );
}

export function componentPaths(root, component) {
  const directory = join(root, component.id);
  return {
    directory,
    executable: join(directory, component.executable.filename),
    codeModeHost: join(directory, component.codeModeHost.filename),
    receipt: join(directory, "qualification.json"),
  };
}

export async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function probeCodexVersion(path) {
  const { stdout, stderr } = await execFile(path, ["--version"], {
    timeout: 5_000,
  });
  const match = `${stdout}\n${stderr}`.match(/codex(?:-cli)?\s+(\S+)/i);
  if (!match?.[1])
    throw new Error("Codex version probe returned an unrecognized response.");
  return match[1];
}

async function verifyFile(path, expected, label) {
  await access(path).catch(() => {
    throw new Error(`${label} is unavailable: ${path}`);
  });
  const details = await stat(path);
  if (!details.isFile() || (details.mode & 0o111) === 0)
    throw new Error(`${label} is not an executable file: ${path}`);
  if (expected.bytes !== undefined && details.size !== expected.bytes)
    throw new Error(`${label} size does not match ${expected.bytes}.`);
  const digest = await sha256(path);
  if (digest !== expected.sha256)
    throw new Error(
      `${label} digest does not match approved component ${expected.sha256}.`,
    );
  return { path, sha256: digest, bytes: details.size };
}

export async function verifyComponentDirectory(directory, component) {
  if (
    process.platform !== component.nodePlatform ||
    process.arch !== component.architecture
  )
    throw new Error(
      `Codex component ${component.id} is for ${component.nodePlatform}/${component.architecture}, not ${process.platform}/${process.arch}.`,
    );
  const paths = componentPaths(dirname(directory), component);
  if (paths.directory !== resolve(directory))
    throw new Error(
      `Codex component directory must end in its immutable id ${component.id}.`,
    );
  const [executable, codeModeHost] = await Promise.all([
    verifyFile(paths.executable, component.executable, "Codex executable"),
    verifyFile(
      paths.codeModeHost,
      component.codeModeHost,
      "Codex code-mode host",
    ),
  ]);
  const cliVersion = await probeCodexVersion(paths.executable);
  if (cliVersion !== component.cliVersion)
    throw new Error(
      `Codex version ${cliVersion} does not match approved component ${component.cliVersion}.`,
    );
  return { component, executable, codeModeHost };
}

export async function inspectExternalCandidate(executablePath) {
  const executable = resolve(executablePath);
  const codeModeHost = join(dirname(executable), "codex-code-mode-host");
  const [version, executableStat, helperStat, executableDigest, helperDigest] =
    await Promise.all([
      probeCodexVersion(executable),
      stat(executable),
      stat(codeModeHost),
      sha256(executable),
      sha256(codeModeHost),
    ]);
  return {
    cliVersion: version,
    nodePlatform: process.platform,
    architecture: process.arch,
    executable: {
      path: executable,
      sha256: executableDigest,
      bytes: executableStat.size,
    },
    codeModeHost: {
      path: codeModeHost,
      sha256: helperDigest,
      bytes: helperStat.size,
    },
  };
}

export async function installQualifiedComponent(
  sourceExecutable,
  component,
  managedRoot = defaultManagedCodexRoot(),
) {
  const candidate = await inspectExternalCandidate(sourceExecutable);
  if (
    candidate.cliVersion !== component.cliVersion ||
    candidate.executable.sha256 !== component.executable.sha256 ||
    candidate.executable.bytes !== component.executable.bytes ||
    candidate.codeModeHost.sha256 !== component.codeModeHost.sha256 ||
    candidate.codeModeHost.bytes !== component.codeModeHost.bytes
  )
    throw new Error(
      `External candidate does not match qualified component ${component.id}.`,
    );
  await mkdir(managedRoot, { recursive: true, mode: 0o700 });
  const destination = componentPaths(managedRoot, component);
  const temporary = `${destination.directory}.installing-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  await Promise.all([
    copyFile(
      candidate.executable.path,
      join(temporary, component.executable.filename),
    ),
    copyFile(
      candidate.codeModeHost.path,
      join(temporary, component.codeModeHost.filename),
    ),
  ]);
  await Promise.all([
    chmod(join(temporary, component.executable.filename), 0o755),
    chmod(join(temporary, component.codeModeHost.filename), 0o755),
  ]);
  await writeFile(
    join(temporary, "qualification.json"),
    `${JSON.stringify({ componentId: component.id, installedAt: new Date().toISOString(), sourceDigests: { executable: candidate.executable.sha256, codeModeHost: candidate.codeModeHost.sha256 } }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rm(destination.directory, { recursive: true, force: true });
  await rename(temporary, destination.directory);
  return verifyComponentDirectory(destination.directory, component);
}
